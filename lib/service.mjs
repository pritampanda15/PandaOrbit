// ─────────────────────────────────────────────────────────────
//  PandaOrbit Auto-Start & Native macOS App Launcher Builder.
//
//  Eliminates having to open Terminal:
//    - `panda-orbit autostart on [paths...]`  installs & starts a
//       macOS LaunchAgent (or Linux systemd --user service) that
//       runs PandaOrbit + live habit tracker automatically on login.
//    - `panda-orbit autostart off`            disables & removes it.
//    - `panda-orbit autostart status`         checks service & port.
//    - `panda-orbit create-app [paths...]`    creates a double-click
//       `PandaOrbit.app` in ~/Applications (Spotlight & Dock ready)
//       that silently ensures the server is running and opens the UI.
// ─────────────────────────────────────────────────────────────

import { mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, platform, userInfo } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const CLI_ENTRY = join(PKG_ROOT, "bin", "panda-orbit.mjs");
const LABEL = "com.pandaorbit.agent";

const xmlEsc = (s) => String(s).replace(/[&<>'"]/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;"
}[c]));

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function runCmd(cmd, args) {
  return new Promise((ok) => {
    execFile(cmd, args, { encoding: "utf8" }, (err, stdout, stderr) => {
      ok({ ok: !err, code: err?.code ?? 0, stdout: (stdout || "").trim(), stderr: (stderr || "").trim() });
    });
  });
}

export function launchAgentPath() {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function systemdUnitPath() {
  return join(homedir(), ".config", "systemd", "user", "panda-orbit.service");
}

function buildPlist({ nodePath, roots, systemWide, port, out, track, db }) {
  const args = [nodePath, CLI_ENTRY, ...(systemWide ? ["--system"] : roots), "--port", String(port), "--out", out];
  if (track) args.push("--track");
  if (db) args.push("--db", db);

  const envPath = process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const logFile = join(out, "panda-orbit.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xmlEsc(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEsc(PKG_ROOT)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEsc(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEsc(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEsc(envPath)}</string>
    <key>HOME</key>
    <string>${xmlEsc(homedir())}</string>
  </dict>
</dict>
</plist>
`;
}

export async function installAutostart({ roots = [], systemWide = false, port = 4173, out, track = true, db = null }) {
  await mkdir(out, { recursive: true });
  const os = platform();

  if (os === "darwin") {
    const plistPath = launchAgentPath();
    await mkdir(dirname(plistPath), { recursive: true });
    await writeFile(plistPath, buildPlist({
      nodePath: process.execPath,
      roots,
      systemWide,
      port,
      out,
      track,
      db
    }));

    const uid = userInfo().uid;
    await runCmd("launchctl", ["bootout", `gui/${uid}`, plistPath]);
    const boot = await runCmd("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    if (!boot.ok) {
      // Fallback for older macOS launchctl
      const load = await runCmd("launchctl", ["load", "-w", plistPath]);
      return {
        ok: load.ok,
        plistPath,
        loaded: load.ok,
        note: load.ok ? "Loaded via launchctl" : (boot.stderr || load.stderr || "Plist written; load manually or log in again")
      };
    }
    return { ok: true, plistPath, loaded: true, note: `Active via launchd (gui/${uid})` };
  }

  if (os === "linux") {
    const unitPath = systemdUnitPath();
    await mkdir(dirname(unitPath), { recursive: true });
    const args = [process.execPath, CLI_ENTRY, ...roots, "--port", String(port), "--out", out];
    if (track) args.push("--track");
    if (db) args.push("--db", db);
    const unit = `[Unit]
Description=PandaOrbit Workspace & Habit Telemetry Server
After=graphical-session.target

[Service]
ExecStart=${args.map(shQuote).join(" ")}
WorkingDirectory=${PKG_ROOT}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
    await writeFile(unitPath, unit);
    await runCmd("systemctl", ["--user", "daemon-reload"]);
    const en = await runCmd("systemctl", ["--user", "enable", "--now", "panda-orbit.service"]);
    return { ok: en.ok, unitPath, loaded: en.ok, note: en.ok ? "Enabled via systemd --user" : en.stderr };
  }

  throw new Error(`Autostart installer currently supports macOS and Linux (detected ${os})`);
}

export async function uninstallAutostart() {
  const os = platform();
  if (os === "darwin") {
    const plistPath = launchAgentPath();
    const uid = userInfo().uid;
    await runCmd("launchctl", ["bootout", `gui/${uid}`, plistPath]);
    await runCmd("launchctl", ["unload", "-w", plistPath]);
    if (existsSync(plistPath)) await unlink(plistPath);
    return { ok: true, removed: plistPath };
  }
  if (os === "linux") {
    const unitPath = systemdUnitPath();
    await runCmd("systemctl", ["--user", "disable", "--now", "panda-orbit.service"]);
    if (existsSync(unitPath)) await unlink(unitPath);
    await runCmd("systemctl", ["--user", "daemon-reload"]);
    return { ok: true, removed: unitPath };
  }
  throw new Error(`Unsupported OS: ${os}`);
}

export async function autostartStatus({ port = 4173 } = {}) {
  const os = platform();
  const filePath = os === "darwin" ? launchAgentPath() : systemdUnitPath();
  const installed = existsSync(filePath);
  let reachable = false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/tree`, { signal: AbortSignal.timeout(1200) });
    reachable = r.ok;
  } catch {}
  return { os, filePath, installed, reachable, url: `http://localhost:${port}` };
}

/**
 * Generates a native double-clickable `PandaOrbit.app` bundle on macOS.
 * Clicking it starts PandaOrbit silently if needed and opens it in the browser.
 */
export async function createMacApp({
  roots = [],
  systemWide = false,
  port = 4173,
  out,
  track = true,
  db = null,
  appDir = join(homedir(), "Applications")
}) {
  if (platform() !== "darwin") {
    throw new Error("create-app builds a macOS .app bundle (run on macOS)");
  }

  const appPath = join(resolve(appDir), "PandaOrbit.app");
  const contentsDir = join(appPath, "Contents");
  const macosDir = join(contentsDir, "MacOS");
  await mkdir(macosDir, { recursive: true });

  const envPath = process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const nodeBin = process.execPath;
  const logFile = join(out, "panda-orbit.log");
  const extraArgs = [...(systemWide ? ["--system"] : roots), "--port", String(port), "--out", out];
  if (track) extraArgs.push("--track");
  if (db) extraArgs.push("--db", db);

  const launcherScript = `#!/bin/bash
export PATH=${shQuote(envPath)}
export HOME=${shQuote(homedir())}
mkdir -p ${shQuote(out)}

URL="http://localhost:${port}"
if ! curl -sf "http://127.0.0.1:${port}/api/tree" >/dev/null 2>&1; then
  nohup ${shQuote(nodeBin)} ${shQuote(CLI_ENTRY)} ${extraArgs.map(shQuote).join(" ")} >> ${shQuote(logFile)} 2>&1 &
  for i in $(seq 1 25); do
    if curl -sf "http://127.0.0.1:${port}/api/tree" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

open "$URL"
`;

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>PandaOrbit</string>
  <key>CFBundleIdentifier</key>
  <string>com.pandaorbit.launcher</string>
  <key>CFBundleName</key>
  <string>PandaOrbit</string>
  <key>CFBundleDisplayName</key>
  <string>PandaOrbit</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;

  const execPath = join(macosDir, "PandaOrbit");
  await writeFile(join(contentsDir, "Info.plist"), infoPlist);
  await writeFile(execPath, launcherScript);
  await chmod(execPath, 0o755);

  return { ok: true, appPath, url: `http://localhost:${port}` };
}
