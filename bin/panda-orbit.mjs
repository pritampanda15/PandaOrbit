#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PandaOrbit — personal workspace constellation, live focus
//  telemetry, work summaries, and disk analyzer.
//
//    panda-orbit                              scan cwd & launch dashboard
//    panda-orbit ~/code ~/Desktop             scan several roots at once
//    panda-orbit scan ~/code                  rescan only, don't serve
//    panda-orbit init ~/code                  write starter panda-orbit.config.json
//    panda-orbit track                        run live foreground activity tracker
//    panda-orbit demo ~/code -o orbit.svg     render animated SVG portrait
// ─────────────────────────────────────────────────────────────

import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { platform, homedir } from "node:os";
import { scan, scanSystem, serialise } from "../lib/scan.mjs";
import { serve } from "../lib/server.mjs";
import { renderDemo } from "../lib/demo.mjs";
import { loadConfig, loadCategories, autoHue, autoGlyph } from "../lib/config.mjs";
import { createHabitStore } from "../lib/habits.mjs";
import { createActivityTracker } from "../lib/tracker.mjs";
import { installAutostart, uninstallAutostart, autostartStatus, createMacApp } from "../lib/service.mjs";
import { generateWorkSummary, saveSummaryReport } from "../lib/summary.mjs";
import { publishToGoogleDocs } from "../lib/gdocs.mjs";
import { discoverSystemRepos } from "../lib/discover.mjs";
import { analyzeDisk } from "../lib/disk.mjs";

const HELP = `
PandaOrbit — your repositories, live focus telemetry, and storage in one orbit.

Usage
  panda-orbit [paths...]                     auto-discover all repos system-wide (or scan given paths)
  panda-orbit discover                       list all git repositories discovered across your machine
  panda-orbit disk [path]                    analyze disk space, heaviest folders, files & dev bloat
  panda-orbit scan [paths...]                rescan projects only, without serving
  panda-orbit init [paths...]                write a starter panda-orbit.config.json
  panda-orbit track                          run live foreground window tracker into SQLite DB
  panda-orbit summary [paths...]             generate Daily/Weekly Work Summary (.md/.html/Google Docs)
  panda-orbit demo [paths...]                render an animated SVG of the orbital map
  panda-orbit autostart on [paths...]        auto-start PandaOrbit in background on login (macOS/Linux)
  panda-orbit autostart off                  disable & remove auto-start background service
  panda-orbit autostart status               check auto-start service & live server status
  panda-orbit create-app [paths...]          build double-click PandaOrbit.app in ~/Applications (macOS)

Options
  --system           auto-discover all git repositories across your home directory (default if no paths)
  --cwd              scan only the current working directory instead of system-wide
  --port <n>         port to serve on                    (default 4173)
  --out <dir>        where generated files & DB live     (default ~/.panda-orbit)
  --config <f>       config file to use
  --categories <f>   activity categories.json file
  --db <file>        SQLite activity database path
  --app-dir <dir>    where to place PandaOrbit.app       (default ~/Applications)
  --range <r>        summary range: today|7d|30d|all     (default today)
  --save             save generated summary into <out>/reports/
  --gdocs            publish generated summary directly to Google Docs
  --track            also start live activity tracking while serving
  --no-track         disable live tracking in autostart/create-app
  --seed-habits      seed 7 days of sample activity data if DB is empty
  -o <file>          output file for \`demo\`              (default panda-orbit.svg)
  --open             open PandaOrbit in your browser
  --no-serve         scan and exit
  --help

Notes & pinned statuses live in <out>/overrides.json and survive every rescan.
Activity sessions live locally in <out>/activity_tracker.db.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv[0] === "help") { console.log(HELP); process.exit(0); }

const VALUE_FLAGS = new Set(["--port", "--out", "--config", "--categories", "--db", "--app-dir", "--range", "-o"]);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};
const has = (name) => argv.includes(name);

const CMDS = ["scan", "init", "serve", "demo", "track", "summary", "discover", "disk", "autostart", "create-app"];
const cmd = CMDS.includes(argv[0]) ? argv[0] : null;

const positionals = [];
for (let i = cmd ? 1 : 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("-")) { if (VALUE_FLAGS.has(a)) i++; continue; }
  positionals.push(a);
}

const die = (msg) => { console.error(`panda-orbit: ${msg}`); process.exit(1); };
const tilde = (p) => p.replace(homedir(), "~");

const out = resolve(flag("--out", join(homedir(), ".panda-orbit")));
const port = Number(flag("--port", 4173)) || 4173;
const dbPath = resolve(flag("--db", join(out, "activity_tracker.db")));
const jsonFallbackPath = join(out, "activity_sessions.json");

// ── discover command ──────────────────────────────────────────
if (cmd === "discover") {
  const res = discoverSystemRepos();
  console.log(`PandaOrbit system discovery: ${res.repoCount} repos across ${res.rootCount} workspaces (${res.durationMs}ms)`);
  for (const r of res.roots) {
    const count = res.repos.filter((p) => p.startsWith(r + "/") && !p.slice(r.length + 1).includes("/")).length;
    console.log(`  ${String(count).padStart(3)}  ${tilde(r)}`);
  }
  process.exit(0);
}

// ── disk command ──────────────────────────────────────────────
if (cmd === "disk") {
  const target = positionals[0] ? resolve(positionals[0]) : homedir();
  const fmtGB = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`;
  const d = await analyzeDisk({ targetPath: target }).catch((e) => die(e.message));
  console.log(`PandaOrbit Disk Analyzer — ${tilde(d.scanned.rootPath)} (${d.scanned.durationMs}ms)`);
  console.log(`  Volume : ${fmtGB(d.volume.usedBytes)} / ${fmtGB(d.volume.totalBytes)} used (${d.volume.capacityPct}% · ${fmtGB(d.volume.availBytes)} free)`);
  console.log(`  Bloat  : ${fmtGB(d.bloat.totalBytes)} across ${d.bloat.count} dev caches/deps`);
  console.log("\nTop Folders:");
  d.topFolders.slice(0, 10).forEach((f) => console.log(`  ${fmtGB(f.bytes).padStart(10)}  ${f.name}`));
  console.log("\nHeaviest Files:");
  d.heavyFiles.slice(0, 10).forEach((f) => console.log(`  ${fmtGB(f.bytes).padStart(10)}  ${f.relPath}`));
  process.exit(0);
}

// ── autostart service (macOS LaunchAgent / Linux systemd) ────
if (cmd === "autostart") {
  const sub = (positionals[0] || "status").toLowerCase();
  if (sub === "status") {
    const st = await autostartStatus({ port });
    console.log(`PandaOrbit autostart (${st.os})`);
    console.log(`  service file : ${tilde(st.filePath)} (${st.installed ? "installed" : "not installed"})`);
    console.log(`  server       : ${st.url} (${st.reachable ? "ONLINE" : "offline"})`);
    process.exit(0);
  }
  if (sub === "off" || sub === "disable" || sub === "uninstall") {
    const res = await uninstallAutostart().catch((e) => die(e.message));
    console.log(`PandaOrbit autostart disabled — removed ${tilde(res.removed)}`);
    process.exit(0);
  }
  if (sub === "on" || sub === "enable" || sub === "install") {
    const rawPaths = positionals.slice(1);
    const resolvedRoots = [];
    for (const p of rawPaths) {
      const r = await realpath(resolve(p)).catch(() => die(`no such directory: ${p}`));
      if (!resolvedRoots.includes(r)) resolvedRoots.push(r);
    }
    const res = await installAutostart({
      roots: resolvedRoots,
      systemWide: resolvedRoots.length === 0 || has("--system"),
      port,
      out,
      track: !has("--no-track"),
      db: flag("--db", null) ? dbPath : null
    }).catch((e) => die(e.message));
    console.log(`PandaOrbit autostart enabled`);
    console.log(`  scope   : ${resolvedRoots.length ? resolvedRoots.map(tilde).join(", ") : "System-Wide (all repos under ~)"}`);
    console.log(`  service : ${tilde(res.plistPath || res.unitPath)}`);
    console.log(`  status  : ${res.note}`);
    console.log(`  url     : http://localhost:${port}`);
    process.exit(0);
  }
  die(`unknown autostart action "${sub}" — use: on | off | status`);
}

// ── native macOS double-click PandaOrbit.app builder ─────────
if (cmd === "create-app") {
  const resolvedRoots = [];
  for (const p of positionals) {
    const r = await realpath(resolve(p)).catch(() => die(`no such directory: ${p}`));
    if (!resolvedRoots.includes(r)) resolvedRoots.push(r);
  }
  const appDir = flag("--app-dir", join(homedir(), "Applications"));
  const res = await createMacApp({
    roots: resolvedRoots,
    systemWide: resolvedRoots.length === 0 || has("--system"),
    port,
    out,
    track: !has("--no-track"),
    db: flag("--db", null) ? dbPath : null,
    appDir
  }).catch((e) => die(e.message));
  console.log(`Created ${tilde(res.appPath)}`);
  console.log(`  scope : ${resolvedRoots.length ? resolvedRoots.map(tilde).join(", ") : "System-Wide (all repos under ~)"}`);
  console.log(`  Double-click PandaOrbit.app (or launch via Spotlight / Dock) — no Terminal required.`);
  process.exit(0);
}

// ── standalone track command ──────────────────────────────────
if (cmd === "track") {
  await mkdir(out, { recursive: true });
  const cfg = await loadConfig(flag("--config", null), process.cwd()).catch((e) => die(e.message));
  const store = createHabitStore({ dbPath, jsonFallbackPath });
  const tracker = createActivityTracker({
    store,
    pollSeconds: cfg.habits?.pollSeconds || 2,
    onLog: (s) => {
      const m = Math.floor(s.duration / 60), sec = Math.floor(s.duration % 60);
      console.log(`  logged  ${s.app_name} (${m}m ${sec}s) — ${s.window_title}`);
    }
  });
  console.log(`PandaOrbit tracker  (${store.mode})  ${tilde(store.dbPath)}`);
  console.log(`                    polling every ${cfg.habits?.pollSeconds || 2}s  (ctrl-c to stop)`);
  tracker.start();
  const shutdown = () => {
    console.log("\nPandaOrbit tracker stopping — flushing active session…");
    tracker.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // keep process alive until interrupted
  await new Promise(() => {});
}

// ── resolve roots & config ────────────────────────────────────
const roots = [];
for (const p of positionals) {
  const r = await realpath(resolve(p)).catch(() => die(`no such directory: ${p}`));
  if (!roots.includes(r)) roots.push(r);
}

const cfgRoot = roots[0] || process.cwd();
const cfg = await loadConfig(flag("--config", null), cfgRoot).catch((e) => die(e.message));
const { categories, _from: catFrom } = await loadCategories(
  flag("--categories", null),
  out,
  cfgRoot
).catch((e) => die(e.message));

// ── init ──────────────────────────────────────────────────────
if (cmd === "init") {
  const initRoots = roots.length ? roots : [await realpath(resolve("."))];
  const { tree } = scan(initRoots, { ...cfg, domains: [] });
  const names = [...new Set(tree.domains.flatMap((d) =>
    d.children.map((c) => c.key.split("/").slice(0, 2).join("/"))))].sort();
  const starter = {
    name: "PandaOrbit",
    activeDays: cfg.activeDays,
    dormantDays: cfg.dormantDays,
    spin: cfg.spin,
    defaultView: "dashboard",
    habits: cfg.habits,
    roots: initRoots,
    domains: [{
      name: "PROJECTS",
      blurb: "rename me · split me up",
      hue: autoHue(0, 3),
      glyph: autoGlyph(0),
      match: names
    }]
  };
  const dest = join(initRoots[0], "panda-orbit.config.json");
  await writeFile(dest, JSON.stringify(starter, null, 2) + "\n");
  console.log(`wrote ${tilde(dest)}`);
  console.log(`  ${names.length} projects in one domain — split "domains" into named groups,`);
  console.log(`  then run: panda-orbit ${initRoots.map(tilde).join(" ")}`);
  process.exit(0);
}

// System-wide auto-discovery is the default when no explicit paths or config roots are given
const useSystemWide = has("--system") || (!has("--cwd") && !roots.length && !cfg.roots?.length);
let effective = [];
let scanMode = "roots";

if (useSystemWide) {
  scanMode = "system";
} else if (cfg.roots?.length && !roots.length) {
  effective = await Promise.all(cfg.roots.map((p) => realpath(resolve(p)).catch(() => die(`config roots: no such directory: ${p}`))));
} else if (roots.length) {
  effective = roots;
} else {
  effective = [await realpath(resolve("."))];
}

// ── scan ──────────────────────────────────────────────────────
let result;
try {
  result = scanMode === "system" ? scanSystem(cfg) : scan(effective, cfg);
  if (scanMode === "system") effective = result.tree.roots.map((r) => r.path);
} catch (e) { die(e.message); }

// ── summary ───────────────────────────────────────────────────
if (cmd === "summary") {
  await mkdir(out, { recursive: true });
  const habitStore = createHabitStore({ dbPath, jsonFallbackPath });
  const range = flag("--range", "today");
  const projNames = result.tree.domains.flatMap((d) => d.children.map((c) => c.name));
  const report = habitStore.getReport({ categories, habitsCfg: cfg.habits, range, projectNames: projNames });
  let overrides = {};
  try { overrides = JSON.parse(await readFile(join(out, "overrides.json"), "utf8")); } catch {}
  const summary = generateWorkSummary({ report, tree: result.tree, overrides, range });
  habitStore.close();

  if (has("--save")) {
    const saved = await saveSummaryReport({ outDir: out, summary, format: "md" });
    console.log(`Saved work summary -> ${tilde(saved.filePath)}`);
  }
  if (has("--gdocs")) {
    const pub = await publishToGoogleDocs({ outDir: out, summary }).catch((e) => die(e.message));
    console.log(`Published to Google Docs (${pub.mode})${pub.docUrl ? ` -> ${pub.docUrl}` : ""}`);
  }
  if (!has("--save") && !has("--gdocs")) {
    console.log(summary.markdown);
  }
  process.exit(0);
}

// ── demo ──────────────────────────────────────────────────────
if (cmd === "demo") {
  const dest = resolve(flag("-o", "panda-orbit.svg"));
  await writeFile(dest, renderDemo(result.tree, { turnSeconds: 90 }));
  console.log(`wrote ${tilde(dest)}  ${result.stats.projects} projects`);
  process.exit(0);
}

await mkdir(out, { recursive: true });
await writeFile(join(out, "data.js"), serialise(result.tree));

// Preserve legacy ~/.orrery/overrides.json if user migrated and has no ~/.panda-orbit/overrides.json yet
const overridesDest = join(out, "overrides.json");
if (!existsSync(overridesDest)) {
  const legacyOverrides = join(homedir(), ".orrery", "overrides.json");
  if (existsSync(legacyOverrides)) {
    const legacyContent = await readFile(legacyOverrides, "utf8");
    await writeFile(overridesDest, legacyContent);
  } else {
    await writeFile(overridesDest, JSON.stringify({
      _readme: [
        "Your layer — PandaOrbit never overwrites this file.",
        "Keys are '<root>/<project>' or '<root>/<project>/<subfolder>'.",
        "Fields, all optional: status ('active'|'steady'|'dormant'), note, label, hide.",
        "A status set here is pinned: it stops tracking mtime and draws a dashed ring."
      ]
    }, null, 2) + "\n");
  }
}

const { projects, domains, unfiled, roots: nRoots } = result.stats;
console.log(`PandaOrbit  ${projects} projects · ${domains} domains · ${nRoots} root${nRoots === 1 ? "" : "s"}`);
effective.forEach((r) => console.log(`            ${tilde(r)}`));
if (!cfg._from) console.log(`            no config — \`panda-orbit init\` to group projects into domains`);
if (unfiled.length) console.log(`            unfiled: ${unfiled.join(", ")}`);

if (cmd === "scan" || has("--no-serve")) process.exit(0);

// ── habit store & optional live tracker ───────────────────────
const habitStore = createHabitStore({ dbPath, jsonFallbackPath });
if (has("--seed-habits") && habitStore.getAllSessions().length === 0) {
  const projNames = result.tree.domains.flatMap((d) => d.children.map((c) => c.name));
  const inserted = habitStore.seedDemoData(projNames);
  console.log(`            seeded ${inserted} sample habit sessions`);
}

const tracker = createActivityTracker({
  store: habitStore,
  pollSeconds: cfg.habits?.pollSeconds || 2,
  onLog: (s) => {
    const m = Math.floor(s.duration / 60), sec = Math.floor(s.duration % 60);
    console.log(`  habit  ${s.app_name} (${m}m ${sec}s)`);
  }
});

if (has("--track")) {
  tracker.start();
  console.log(`            live activity tracker enabled (${cfg.habits?.pollSeconds || 2}s poll)`);
}

console.log(`            habits db: ${tilde(habitStore.dbPath)} (${habitStore.mode})`);
if (catFrom) console.log(`            categories: ${tilde(catFrom)}`);

const cleanup = () => {
  tracker.stop();
  habitStore.close();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// ── serve ─────────────────────────────────────────────────────
try {
  await serve({
    out,
    roots: effective,
    scanMode,
    cfg,
    categories,
    initialTree: result.tree,
    habitStore,
    tracker,
    port,
    onReady: (p) => {
      console.log(`            http://localhost:${p}   (ctrl-c to stop)`);
      if (has("--open")) {
        const o = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
        execFile(o, [`http://localhost:${p}`], () => {});
      }
    }
  });
} catch (e) { die(e.message); }
