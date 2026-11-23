// ─────────────────────────────────────────────────────────────
//  Cross-platform foreground window activity tracker.
//  Works natively on macOS (osascript), Linux (xdotool), and
//  Windows (PowerShell), logging sessions directly into the
//  HabitBoard-compatible SQLite database and streaming live
//  telemetry ticks for real-time graphs & terminals.
// ─────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";

const OS = platform();

function execAsync(cmd, args, timeout = 1800) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, encoding: "utf8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

const MAC_SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set winTitle to ""
  try
    set winTitle to name of front window of frontApp
  end try
  return appName & linefeed & winTitle
end tell
`;

const MAC_FALLBACK_SCRIPT = `
tell application "System Events"
  return name of first application process whose frontmost is true
end tell
`;

const WIN_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][Win32]::GetWindowText($h, $sb, 512)
$pidOut = 0
[void][Win32]::GetWindowThreadProcessId($h, [ref]$pidOut)
$proc = (Get-Process -Id $pidOut -ErrorAction SilentlyContinue).ProcessName
Write-Output "$proc\`n$($sb.ToString())"
`;

async function queryActiveWindow() {
  if (OS === "darwin") {
    try {
      const out = await execAsync("osascript", ["-e", MAC_SCRIPT]);
      const [appName = "Unknown", ...rest] = out.split(/\r?\n/);
      const windowTitle = rest.join(" ").trim() || appName;
      return { appName: appName.trim() || "Unknown", windowTitle };
    } catch {
      const appName = await execAsync("osascript", ["-e", MAC_FALLBACK_SCRIPT]);
      return { appName: appName.trim() || "Unknown", windowTitle: appName.trim() || "Unknown" };
    }
  }

  if (OS === "linux") {
    const winId = await execAsync("xdotool", ["getactivewindow"]);
    const windowTitle = await execAsync("xdotool", ["getwindowname", winId]).catch(() => "");
    let appName = "Unknown";
    try {
      const pid = await execAsync("xdotool", ["getwindowpid", winId]);
      const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
      const first = cmdline.split("\0")[0] || "";
      appName = first.split("/").pop() || "Unknown";
    } catch {
      appName = "System Process";
    }
    return { appName, windowTitle: windowTitle || appName };
  }

  if (OS === "win32") {
    const out = await execAsync("powershell", ["-NoProfile", "-Command", WIN_SCRIPT], 2500);
    const [appName = "Unknown", ...rest] = out.split(/\r?\n/);
    const windowTitle = rest.join(" ").trim() || appName;
    return { appName: appName.trim() || "Unknown", windowTitle };
  }

  throw new Error(`Unsupported platform: ${OS}`);
}

export function createActivityTracker({ store, pollSeconds = 2, onLog, onTick } = {}) {
  let timer = null;
  let polling = false;
  let running = false;
  let startedAt = null;
  let currentApp = null;
  let currentTitle = null;
  let sessionStartSec = null;
  let sessionsLogged = 0;
  let lastError = null;
  const listeners = new Set();

  if (onLog) listeners.add({ type: "log", fn: onLog });
  if (onTick) listeners.add({ type: "tick", fn: onTick });

  function emit(type, payload) {
    for (const l of listeners) {
      if (l.type === type) {
        try { l.fn(payload); } catch {}
      }
    }
  }

  function subscribe(type, fn) {
    const entry = { type, fn };
    listeners.add(entry);
    return () => listeners.delete(entry);
  }

  function flushCurrent(nowSec = Date.now() / 1000) {
    if (!currentApp || !sessionStartSec) return null;
    const saved = store.logSession({
      startTime: sessionStartSec,
      endTime: nowSec,
      appName: currentApp,
      windowTitle: currentTitle || currentApp
    });
    if (saved) {
      sessionsLogged++;
      emit("log", saved);
    }
    return saved;
  }

  async function tick() {
    if (!running || polling) return;
    polling = true;
    try {
      const { appName, windowTitle } = await queryActiveWindow();
      lastError = null;
      const nowSec = Date.now() / 1000;
      const changed = appName !== currentApp || windowTitle !== currentTitle;
      if (changed) {
        if (currentApp && sessionStartSec) flushCurrent(nowSec);
        currentApp = appName;
        currentTitle = windowTitle;
        sessionStartSec = nowSec;
      }
      emit("tick", {
        ts: Date.now(),
        changed,
        running: true,
        appName: currentApp,
        windowTitle: currentTitle,
        sessionSeconds: sessionStartSec ? Math.max(0, Math.round(nowSec - sessionStartSec)) : 0,
        sessionsLogged
      });
    } catch (err) {
      lastError = err.message || String(err);
      emit("tick", {
        ts: Date.now(),
        changed: false,
        running: true,
        appName: currentApp,
        windowTitle: currentTitle,
        sessionSeconds: sessionStartSec ? Math.max(0, Math.round(Date.now() / 1000 - sessionStartSec)) : 0,
        sessionsLogged,
        error: lastError
      });
    } finally {
      polling = false;
    }
  }

  function start() {
    if (running) return status();
    running = true;
    startedAt = Date.now();
    lastError = null;
    sessionStartSec = Date.now() / 1000;
    emit("state", status());
    tick();
    timer = setInterval(tick, Math.max(1000, pollSeconds * 1000));
    return status();
  }

  function stop() {
    if (!running) return status();
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    flushCurrent();
    currentApp = null;
    currentTitle = null;
    sessionStartSec = null;
    emit("state", status());
    return status();
  }

  function status() {
    return {
      running,
      platform: OS,
      pollSeconds,
      startedAt,
      currentApp,
      currentTitle,
      currentDurationSec: running && sessionStartSec ? Math.max(0, Math.round(Date.now() / 1000 - sessionStartSec)) : 0,
      sessionsLogged,
      lastError
    };
  }

  return { start, stop, status, flushCurrent, subscribe };
}
