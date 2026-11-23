// ─────────────────────────────────────────────────────────────
//  PandaOrbit Unified Local Server.
//
//  Serves the combined Dashboard + JARVIS Orbit HUD + HabitBoard UI,
//  exposes symlink-fenced POST /open, atomic /override persistence,
//  HabitBoard SQLite analytics, and real-time Server-Sent Events
//  (GET /api/stream) for live telemetry graphs & terminals.
// ─────────────────────────────────────────────────────────────

import { createServer } from "node:http";
import { readFile, readdir, writeFile, rename, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, extname, dirname, basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, homedir } from "node:os";
import { scan, scanSystem, serialise } from "./scan.mjs";
import { categoriseSession } from "./habits.mjs";
import { generateWorkSummary, saveSummaryReport } from "./summary.mjs";
import { loadDocsConfig, saveDocsConfig, publishToGoogleDocs } from "./gdocs.mjs";
import { analyzeDisk } from "./disk.mjs";

const PUBLIC = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "public"));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const send = (res, code, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};

const sendJson = (res, code, payload) =>
  send(res, code, JSON.stringify(payload), "application/json; charset=utf-8");

const opener = () =>
  platform() === "darwin" ? ["open", []] :
  platform() === "win32"  ? ["explorer", []] :
                            ["xdg-open", []];

function extractProjectNames(tree) {
  const names = new Set();
  for (const dom of tree?.domains || []) {
    for (const c of dom.children || []) {
      if (c.name) names.add(c.name);
      if (c.key) {
        const parts = c.key.split("/");
        if (parts[1]) names.add(parts[1]);
      }
    }
  }
  return [...names];
}

function matchProject(appName, windowTitle, projectNames) {
  const hay = `${appName || ""} ${windowTitle || ""}`.toLowerCase();
  const sorted = [...projectNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (name.length >= 3 && hay.includes(name.toLowerCase())) return name;
  }
  return null;
}

function intensityForCategory(category, habitsCfg = {}) {
  const prod = new Set(habitsCfg.productiveCategories || ["Development", "Writing & Docs", "Web/Research"]);
  const dist = new Set(habitsCfg.distractionCategories || ["Distraction & Leisure"]);
  if (category === "Development") return 0.96;
  if (prod.has(category)) return 0.82;
  if (dist.has(category)) return 0.18;
  if (category === "Communication") return 0.56;
  return 0.45;
}

export function serve({
  out,
  roots,
  scanMode = "roots",
  cfg,
  categories,
  initialTree,
  habitStore,
  tracker,
  port = 4173,
  onReady
}) {
  let currentMode = scanMode;
  let configuredRoots = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  const home = resolve(homedir());
  const allowRoots = () => {
    const set = new Set(configuredRoots);
    if (currentMode === "system") set.add(home);
    return [...set];
  };
  const OVERRIDES = join(out, "overrides.json");
  let currentTree = initialTree;
  const diskCache = new Map(); // resolved path -> { ts, data }

  // ── Real-time SSE Telemetry Hub ─────────────────────────────
  const sseClients = new Set();
  const liveSamples = [];     // last 90 signal points for real-time graph
  const liveEvents = [];      // last 60 terminal log entries

  function pushSample(sample) {
    liveSamples.push(sample);
    if (liveSamples.length > 90) liveSamples.shift();
  }

  function pushEvent(evt) {
    liveEvents.push(evt);
    if (liveEvents.length > 60) liveEvents.shift();
  }

  function broadcast(eventName, payload) {
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try { res.write(frame); } catch { sseClients.delete(res); }
    }
  }

  pushEvent({
    ts: Date.now(),
    tag: "SYS",
    message: `PandaOrbit telemetry online (${currentMode === "system" ? "system-wide" : `${configuredRoots.length} root${configuredRoots.length === 1 ? "" : "s"}`}) · ${extractProjectNames(currentTree).length} projects indexed`
  });

  if (tracker?.subscribe) {
    tracker.subscribe("tick", (t) => {
      const projNames = extractProjectNames(currentTree);
      const category = t.appName ? categoriseSession(t.appName, t.windowTitle, categories) : "Idle";
      const matchedProject = t.appName ? matchProject(t.appName, t.windowTitle, projNames) : null;
      const intensity = t.appName ? intensityForCategory(category, cfg?.habits) : 0.08;
      const sample = {
        ts: t.ts,
        running: true,
        appName: t.appName || "Unknown",
        windowTitle: t.windowTitle || "",
        category,
        matchedProject,
        sessionSeconds: t.sessionSeconds || 0,
        intensity,
        error: t.error || null
      };
      pushSample(sample);
      if (t.changed && t.appName) {
        const evt = {
          ts: t.ts,
          tag: matchedProject ? "LOCK" : "TRACK",
          category,
          matchedProject,
          message: `Active window -> ${t.appName} | ${t.windowTitle || t.appName}${matchedProject ? ` [${matchedProject}]` : ""}`
        };
        pushEvent(evt);
        broadcast("log", evt);
      }
      broadcast("tick", sample);
    });

    tracker.subscribe("log", (session) => {
      const projNames = extractProjectNames(currentTree);
      const category = categoriseSession(session.app_name, session.window_title, categories);
      const matchedProject = matchProject(session.app_name, session.window_title, projNames);
      const mins = (session.duration / 60).toFixed(1);
      const evt = {
        ts: Date.now(),
        tag: "COMMIT",
        category,
        matchedProject,
        durationMin: Number(mins),
        message: `Committed ${mins}m · ${session.app_name} (${category}) — ${session.window_title}`
      };
      pushEvent(evt);
      broadcast("session", { session, evt });
    });

    tracker.subscribe("state", (st) => {
      const evt = {
        ts: Date.now(),
        tag: "SYS",
        message: st.running
          ? `Foreground tracker ENGAGED (${st.platform}, ${st.pollSeconds}s poll)`
          : `Foreground tracker STANDBY (${st.sessionsLogged} sessions logged)`
      };
      pushEvent(evt);
      broadcast("tracker", { tracker: st, evt });
    });
  }

  // Heartbeat keep-alive every 15s for SSE connections
  const heartbeat = setInterval(() => {
    for (const res of sseClients) {
      try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { sseClients.delete(res); }
    }
  }, 15000);
  heartbeat.unref?.();

  function isAllowedPath(real, includeHome = false) {
    const list = allowRoots();
    if (includeHome && !list.includes(home)) list.push(home);
    return list.some((r) => real === r || real.startsWith(r + sep) || real.startsWith(r + "/"));
  }

  async function openInFinder(target) {
    const real = await realpath(target);           // resolve BEFORE checking
    if (!isAllowedPath(real, true)) {
      throw new Error(`refusing to open outside allowed workspace/home directories`);
    }
    const s = await stat(real);
    const dir = s.isDirectory() ? real : dirname(real);
    const [cmd, args] = opener();
    await new Promise((ok, no) => execFile(cmd, [...args, dir], (e) => (e ? no(e) : ok())));
    return dir;
  }

  const gitAsync = (cwd, args) =>
    new Promise((ok) => {
      execFile("git", ["-C", cwd, ...args], { timeout: 2000, encoding: "utf8" }, (err, out) => {
        ok(err ? "" : (out || "").trim());
      });
    });

  const skipRegexes = (cfg?.skip || ["^\\.", "^node_modules$", "^__pycache__$", "^\\.venv$", "^venv$"]).map((s) => new RegExp(s));

  function classifyFile(name) {
    const ext = extname(name).toLowerCase();
    if (/^readme/i.test(name) || [".md", ".rst", ".txt", ".pdf"].includes(ext)) return "doc";
    if ([".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".lock"].includes(ext)) return "config";
    if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".c", ".cpp", ".h", ".java", ".swift", ".sh", ".html", ".css", ".sql"].includes(ext)) return "code";
    if ([".csv", ".tsv", ".db", ".sqlite", ".parquet", ".pdb", ".cif", ".gro", ".xtc", ".tpr"].includes(ext)) return "data";
    if ([".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"].includes(ext)) return "asset";
    return "other";
  }

  async function inspectDirectory(target) {
    const real = await realpath(target);
    if (!isAllowedPath(real, false)) {
      throw new Error(`refusing to inspect outside ${allowRoots().join(", ")}`);
    }
    const s = await stat(real);
    const dir = s.isDirectory() ? real : dirname(real);
    const entries = await readdir(dir, { withFileTypes: true });

    const dirs = [];
    const files = [];
    let readmeName = null;

    for (const ent of entries) {
      if (skipRegexes.some((re) => re.test(ent.name))) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        let childCount = 0;
        let mtimeMs = 0;
        try {
          const st = await stat(full);
          mtimeMs = Math.round(st.mtimeMs);
          const sub = await readdir(full);
          childCount = sub.filter((n) => !n.startsWith(".")).length;
        } catch {}
        dirs.push({ name: ent.name, path: full, childCount, mtimeMs });
      } else if (ent.isFile()) {
        if (!readmeName && /^readme(\.md|\.rst|\.txt)?$/i.test(ent.name)) readmeName = ent.name;
        let size = 0;
        let mtimeMs = 0;
        try {
          const st = await stat(full);
          size = st.size;
          mtimeMs = Math.round(st.mtimeMs);
        } catch {}
        files.push({
          name: ent.name,
          path: full,
          ext: extname(ent.name).toLowerCase(),
          kind: classifyFile(ent.name),
          size,
          mtimeMs
        });
      }
    }

    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
    const kindOrder = { doc: 0, code: 1, config: 2, data: 3, asset: 4, other: 5 };
    files.sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || b.mtimeMs - a.mtimeMs);

    let readme = null;
    if (readmeName) {
      try {
        const raw = await readFile(join(dir, readmeName), "utf8");
        const prose = raw.split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("<") && !l.startsWith("![") && !/^[-=*_]{3,}$/.test(l) && !l.startsWith("```") && !l.startsWith("|"))
          .map((l) => l.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"))
          .slice(0, 3)
          .join(" — ");
        readme = prose.length > 260 ? prose.slice(0, 257) + "…" : prose;
      } catch {}
    }

    const [branch, statusRaw, countRaw, logRaw] = await Promise.all([
      gitAsync(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
      gitAsync(dir, ["status", "--porcelain"]),
      gitAsync(dir, ["rev-list", "--count", "HEAD"]),
      gitAsync(dir, ["log", "-n", "6", "--format=%h%x1f%cr%x1f%s%x1f%an"])
    ]);

    const commits = logRaw
      ? logRaw.split("\n").filter(Boolean).map((line) => {
          const [hash, relDate, subject, author] = line.split("\x1f");
          return { hash, relDate, subject, author };
        })
      : [];

    return {
      name: basename(dir),
      path: dir,
      totalDirs: dirs.length,
      totalFiles: files.length,
      dirs: dirs.slice(0, 14),
      files: files.slice(0, 16),
      readme,
      git: branch
        ? {
            branch,
            dirtyCount: statusRaw ? statusRaw.split("\n").filter(Boolean).length : 0,
            totalCommits: Number(countRaw) || commits.length,
            commits
          }
        : null
    };
  }

  const readBody = async (req) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65536) throw new Error("body too large");
    }
    return body;
  };

  let queue = Promise.resolve();
  const saveOverride = (key, patch) =>
    (queue = queue.then(async () => {
      if (typeof key !== "string" || !key || key.startsWith("_")) throw new Error("bad key");
      let all = {};
      try { all = JSON.parse(await readFile(OVERRIDES, "utf8")); } catch {}

      const entry = { ...(all[key] || {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (!["status", "note", "label", "hide"].includes(k)) continue;
        if (v === null || v === "") delete entry[k];
        else entry[k] = v;
      }
      if (Object.keys(entry).length) all[key] = entry; else delete all[key];

      const tmp = `${OVERRIDES}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 2) + "\n");
      await rename(tmp, OVERRIDES);
      return entry;
    }, (e) => { throw e; }));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    // ── Real-Time Telemetry SSE Stream ────────────────────────
    if (req.method === "GET" && pathname === "/api/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive"
      });
      res.write(`event: init\ndata: ${JSON.stringify({
        tracker: tracker.status(),
        samples: liveSamples,
        events: liveEvents
      })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method === "GET" && pathname === "/api/habits/live") {
      return sendJson(res, 200, {
        ok: true,
        tracker: tracker.status(),
        samples: liveSamples,
        events: liveEvents
      });
    }

    // ── Folder reveal (fenced to scanned roots) ───────────────
    if (req.method === "POST" && pathname === "/open") {
      try {
        const { path } = JSON.parse((await readBody(req)) || "{}");
        if (typeof path !== "string" || !path) return send(res, 400, "no path");
        const opened = await openInFinder(path);
        console.log(`  open   ${opened}`);
        const evt = { ts: Date.now(), tag: "OPEN", message: `Opened directory: ${opened}` };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, opened });
      } catch (e) {
        console.warn(`  deny   ${e.message}`);
        return sendJson(res, 403, { ok: false, error: e.message });
      }
    }

    // ── Node overrides ────────────────────────────────────────
    if (req.method === "POST" && pathname === "/override") {
      try {
        const { key, ...patch } = JSON.parse((await readBody(req)) || "{}");
        const entry = await saveOverride(key, patch);
        console.log(`  save   ${key} ${JSON.stringify(entry)}`);
        const evt = { ts: Date.now(), tag: "PIN", message: `Updated override for ${key}` };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, entry });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    // ── Project Tree, Deep Branch Inspection & Live Rescan ────
    if (req.method === "GET" && pathname === "/api/tree") {
      return sendJson(res, 200, { ok: true, tree: currentTree });
    }

    if (req.method === "GET" && pathname === "/api/inspect") {
      try {
        const target = url.searchParams.get("path");
        if (!target) return sendJson(res, 400, { ok: false, error: "missing path" });
        const detail = await inspectDirectory(target);
        return sendJson(res, 200, { ok: true, detail });
      } catch (e) {
        return sendJson(res, 403, { ok: false, error: e.message });
      }
    }

    if (req.method === "GET" && pathname === "/api/preview") {
      try {
        const target = url.searchParams.get("path");
        if (!target) return sendJson(res, 400, { ok: false, error: "missing path" });
        const real = await realpath(target);
        if (!isAllowedPath(real, false)) {
          throw new Error(`refusing to preview outside ${allowRoots().join(", ")}`);
        }
        const s = await stat(real);
        if (!s.isFile()) return sendJson(res, 400, { ok: false, error: "not a file" });
        const buf = await readFile(real);
        const cap = 10240;
        const slice = buf.subarray(0, cap);
        const isBinary = slice.includes(0);
        return sendJson(res, 200, {
          ok: true,
          name: basename(real),
          path: real,
          size: s.size,
          truncated: buf.length > cap,
          binary: isBinary,
          content: isBinary ? null : slice.toString("utf8")
        });
      } catch (e) {
        return sendJson(res, 403, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/rescan") {
      try {
        const refreshed = currentMode === "system"
          ? scanSystem(cfg)
          : scan(configuredRoots, cfg);
        currentTree = refreshed.tree;
        await writeFile(join(out, "data.js"), serialise(currentTree));
        console.log(`  rescan ${refreshed.stats.projects} projects · ${refreshed.stats.domains} domains (${currentMode})`);
        const evt = {
          ts: Date.now(),
          tag: "SCAN",
          message: `Rescanned ${refreshed.stats.projects} projects across ${refreshed.stats.domains} domains (${currentMode})`
        };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, tree: currentTree, stats: refreshed.stats });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // ── Workspace Roots & System-Wide Mode Switcher ───────────
    if (req.method === "GET" && pathname === "/api/roots") {
      return sendJson(res, 200, {
        ok: true,
        mode: currentMode,
        roots: configuredRoots,
        home
      });
    }

    if (req.method === "POST" && pathname === "/api/roots") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (body.mode === "system") {
          currentMode = "system";
        } else if (Array.isArray(body.roots) && body.roots.length) {
          const valid = [];
          for (const rawP of body.roots) {
            const expanded = String(rawP || "").trim().replace(/^~(?=\/|$)/, home);
            if (!expanded) continue;
            const rp = await realpath(resolve(expanded));
            if (!valid.includes(rp)) valid.push(rp);
          }
          if (!valid.length) return sendJson(res, 400, { ok: false, error: "no valid directories provided" });
          currentMode = "roots";
          configuredRoots = valid;
        } else {
          return sendJson(res, 400, { ok: false, error: "provide mode:'system' or roots:[...]" });
        }

        const refreshed = currentMode === "system"
          ? scanSystem(cfg)
          : scan(configuredRoots, cfg);
        currentTree = refreshed.tree;
        await writeFile(join(out, "data.js"), serialise(currentTree));
        const evt = {
          ts: Date.now(),
          tag: "SCAN",
          message: `Switched workspace to ${currentMode} (${refreshed.stats.projects} projects)`
        };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, mode: currentMode, roots: configuredRoots, tree: currentTree, stats: refreshed.stats });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    // ── System Disk & Heavy Files Analyzer ────────────────────
    if (req.method === "GET" && pathname === "/api/disk") {
      try {
        const rawTarget = url.searchParams.get("path");
        const scope = url.searchParams.get("scope") || "home";
        const force = url.searchParams.get("refresh") === "1";

        let target = home;
        if (rawTarget) {
          target = resolve(rawTarget.replace(/^~(?=\/|$)/, home));
        } else if (scope === "downloads") target = join(home, "Downloads");
        else if (scope === "desktop") target = join(home, "Desktop");
        else if (scope === "documents") target = join(home, "Documents");

        const realTarget = await realpath(target);
        if (realTarget !== home && !realTarget.startsWith(home + sep)) {
          return sendJson(res, 403, { ok: false, error: "disk analysis is fenced to your home directory" });
        }

        const cached = diskCache.get(realTarget);
        if (!force && cached && Date.now() - cached.ts < 90_000) {
          return sendJson(res, 200, { ok: true, cached: true, disk: cached.data });
        }

        const data = await analyzeDisk({ targetPath: realTarget });
        diskCache.set(realTarget, { ts: Date.now(), data });
        return sendJson(res, 200, { ok: true, cached: false, disk: data });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    // ── HabitBoard Analytics & Session Endpoints ──────────────
    if (req.method === "GET" && pathname === "/api/habits") {
      try {
        const range = url.searchParams.get("range") || "today";
        const report = habitStore.getReport({
          categories,
          habitsCfg: cfg?.habits,
          range,
          projectNames: extractProjectNames(currentTree)
        });
        return sendJson(res, 200, {
          ok: true,
          report,
          tracker: tracker.status(),
          categories
        });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/habits/session") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const durationMin = Number(body.durationMinutes || 0);
        const nowSec = Date.now() / 1000;
        const durationSec = body.durationSeconds
          ? Number(body.durationSeconds)
          : Math.max(60, Math.round(durationMin * 60));
        const endTime = body.endTime ? Number(body.endTime) : nowSec;
        const startTime = body.startTime ? Number(body.startTime) : endTime - durationSec;
        const saved = habitStore.logSession({
          startTime,
          endTime,
          appName: body.appName || "Manual",
          windowTitle: body.windowTitle || body.appName || "Focus Session"
        });
        if (!saved) return sendJson(res, 400, { ok: false, error: "invalid session duration" });
        const projNames = extractProjectNames(currentTree);
        const category = categoriseSession(saved.app_name, saved.window_title, categories);
        const matchedProject = matchProject(saved.app_name, saved.window_title, projNames);
        const sample = {
          ts: Date.now(),
          running: tracker.status().running,
          appName: saved.app_name,
          windowTitle: saved.window_title,
          category,
          matchedProject,
          sessionSeconds: Math.round(saved.duration),
          intensity: intensityForCategory(category, cfg?.habits)
        };
        pushSample(sample);
        const evt = {
          ts: Date.now(),
          tag: "MANUAL",
          category,
          matchedProject,
          message: `Logged ${(saved.duration / 60).toFixed(1)}m · ${saved.app_name} (${category}) — ${saved.window_title}`
        };
        pushEvent(evt);
        broadcast("tick", sample);
        broadcast("session", { session: saved, evt });
        console.log(`  habit  +1 session (${Math.round(saved.duration / 60)}m · ${saved.app_name})`);
        return sendJson(res, 200, { ok: true, session: saved });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/habits/seed") {
      try {
        const count = habitStore.seedDemoData(extractProjectNames(currentTree));
        const evt = { ts: Date.now(), tag: "SEED", message: `Loaded ${count} sample activity sessions across 7 days` };
        pushEvent(evt);
        broadcast("log", evt);
        console.log(`  habit  seeded ${count} sample sessions`);
        return sendJson(res, 200, { ok: true, inserted: count });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/habits/clear") {
      try {
        habitStore.clearAllSessions();
        const evt = { ts: Date.now(), tag: "SYS", message: "Cleared recorded activity sessions" };
        pushEvent(evt);
        broadcast("log", evt);
        console.log(`  habit  cleared sessions`);
        return sendJson(res, 200, { ok: true });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === "GET" && pathname === "/api/habits/tracker") {
      return sendJson(res, 200, { ok: true, tracker: tracker.status() });
    }

    if (req.method === "POST" && pathname === "/api/habits/tracker") {
      try {
        const { action } = JSON.parse((await readBody(req)) || "{}");
        const st = action === "start" ? tracker.start() : action === "stop" ? tracker.stop() : tracker.status();
        console.log(`  track  ${st.running ? "started" : "stopped"}`);
        return sendJson(res, 200, { ok: true, tracker: st });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    if (req.method === "GET" && pathname === "/api/habits/export") {
      try {
        const format = url.searchParams.get("format") === "json" ? "json" : "csv";
        const exported = habitStore.exportSessions({ categories, format });
        res.writeHead(200, {
          "content-type": exported.mime,
          "content-disposition": `attachment; filename="${exported.filename}"`,
          "cache-control": "no-store"
        });
        return res.end(exported.body);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // ── Work Summary & Google Docs Publisher ──────────────────
    const buildCurrentSummary = async (range) => {
      const report = habitStore.getReport({
        categories,
        habitsCfg: cfg?.habits,
        range,
        projectNames: extractProjectNames(currentTree)
      });
      let overrides = {};
      try { overrides = JSON.parse(await readFile(OVERRIDES, "utf8")); } catch {}
      return generateWorkSummary({ report, tree: currentTree, overrides, range });
    };

    if (req.method === "GET" && pathname === "/api/summary") {
      try {
        const range = url.searchParams.get("range") || "today";
        const format = url.searchParams.get("format") || "json";
        const summary = await buildCurrentSummary(range);
        if (format === "md") {
          res.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="work-summary-${summary.dateIso}-${range}.md"`,
            "cache-control": "no-store"
          });
          return res.end(summary.markdown);
        }
        if (format === "html") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-disposition": `attachment; filename="work-summary-${summary.dateIso}-${range}.html"`,
            "cache-control": "no-store"
          });
          return res.end(summary.html);
        }
        const docsCfg = await loadDocsConfig(out);
        return sendJson(res, 200, { ok: true, summary, docsConfig: docsCfg.publicInfo });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/summary/save") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const range = body.range || "today";
        const format = body.format === "html" ? "html" : "md";
        const summary = await buildCurrentSummary(range);
        const saved = await saveSummaryReport({ outDir: out, summary, format });
        const evt = { ts: Date.now(), tag: "SYS", message: `Saved work summary doc -> ${saved.filename}` };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, ...saved, summary });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/summary/gdocs") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const range = body.range || "today";
        const summary = await buildCurrentSummary(range);
        const result = await publishToGoogleDocs({ outDir: out, summary, docIdOverride: body.docId || null });
        const evt = { ts: Date.now(), tag: "COMMIT", message: `Published work summary to Google Docs (${result.mode})` };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/docs/config") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const updated = await saveDocsConfig(out, body);
        return sendJson(res, 200, { ok: true, docsConfig: updated.publicInfo });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    if (req.method === "GET" && pathname === "/api/categories") {
      return sendJson(res, 200, { ok: true, categories });
    }

    if (req.method === "POST" && pathname === "/api/categories") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const { category, keyword, action } = body;
        if (typeof category !== "string" || !category.trim()) {
          return sendJson(res, 400, { ok: false, error: "missing category" });
        }
        const cat = category.trim();
        const kw = typeof keyword === "string" ? keyword.trim() : "";
        if (!categories[cat]) categories[cat] = [];
        if (action === "add" && kw) {
          if (!categories[cat].some((k) => k.toLowerCase() === kw.toLowerCase())) {
            categories[cat].push(kw);
          }
        } else if (action === "remove" && kw) {
          categories[cat] = categories[cat].filter((k) => k.toLowerCase() !== kw.toLowerCase());
        }
        const catDest = join(out, "categories.json");
        const tmp = `${catDest}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(categories, null, 2) + "\n");
        await rename(tmp, catDest);
        const evt = { ts: Date.now(), tag: "SYS", message: `Category "${cat}" ${action === "remove" ? "removed" : "added"} keyword "${kw}"` };
        pushEvent(evt);
        broadcast("log", evt);
        return sendJson(res, 200, { ok: true, categories });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message });
      }
    }

    // ── Static files ──────────────────────────────────────────
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (!rel || rel.includes("..") || !/^[\w./-]+$/.test(rel)) {
      return send(res, 400, "bad path");
    }

    if (rel === "data.js" || rel === "overrides.json") {
      try {
        return send(res, 200, await readFile(join(out, rel)), MIME[extname(rel)] || "application/octet-stream");
      } catch {
        if (rel === "overrides.json") return send(res, 200, "{}", "application/json; charset=utf-8");
        return send(res, 404, "not found");
      }
    }

    const targetPath = resolve(join(PUBLIC, rel));
    if (targetPath !== PUBLIC && !targetPath.startsWith(PUBLIC + sep)) {
      return send(res, 403, "forbidden");
    }

    try {
      const buf = await readFile(targetPath);
      return send(res, 200, buf, MIME[extname(targetPath)] || "application/octet-stream");
    } catch {
      return send(res, 404, "not found");
    }
  });

  server.on("close", () => clearInterval(heartbeat));

  return new Promise((resolvePromise, reject) => {
    server.on("error", (e) =>
      reject(e.code === "EADDRINUSE"
        ? new Error(`port ${port} is already in use — try --port ${port + 1}`)
        : e));
    server.listen(port, "127.0.0.1", () => { onReady?.(port); resolvePromise(server); });
  });
}
