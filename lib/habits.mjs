// ─────────────────────────────────────────────────────────────
//  PandaOrbit Habit Engine (HabitBoard SQLite-compatible).
//
//  Reads and writes the exact HabitBoard schema:
//    activity_sessions (id, start_time, end_time, duration, app_name, window_title)
//
//  Uses Node's built-in `node:sqlite` (Node 22+) with zero npm
//  dependencies, and gracefully falls back to a local JSON store
//  on Node 18–21 so the dashboard never crashes.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CATEGORY_COLORS } from "./config.mjs";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // Node < 22.5 — fallback to JSON persistence
}

const GENERIC_BROWSER_KEYWORDS = new Set([
  "firefox", "chrome", "google chrome", "safari", "arc", "brave", "edge"
]);

function dateKeyLocal(epochSec) {
  const d = new Date(epochSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

function formatDateHeading(d = new Date()) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

export function categoriseSession(appName, windowTitle, categories = {}) {
  const app = String(appName || "").toLowerCase();
  const title = String(windowTitle || "").toLowerCase();

  // Pass 1: specific window-title matches win over generic browser names
  // (e.g. "YouTube — Firefox" -> Distraction & Leisure, "GitHub — Chrome" -> Development)
  for (const [category, keywords] of Object.entries(categories)) {
    if (!Array.isArray(keywords)) continue;
    for (const kw of keywords) {
      const k = String(kw).toLowerCase();
      if (!k || GENERIC_BROWSER_KEYWORDS.has(k)) continue;
      if (title.includes(k)) return category;
    }
  }

  // Pass 2: specific app_name matches (non-browser)
  for (const [category, keywords] of Object.entries(categories)) {
    if (!Array.isArray(keywords)) continue;
    for (const kw of keywords) {
      const k = String(kw).toLowerCase();
      if (!k || GENERIC_BROWSER_KEYWORDS.has(k)) continue;
      if (app.includes(k)) return category;
    }
  }

  // Pass 3: fallback to generic browser / catch-all keywords
  for (const [category, keywords] of Object.entries(categories)) {
    if (!Array.isArray(keywords)) continue;
    for (const kw of keywords) {
      const k = String(kw).toLowerCase();
      if (!k) continue;
      if (app.includes(k) || title.includes(k)) return category;
    }
  }

  return "Uncategorized";
}

function matchProjectForSession(appName, windowTitle, projectNames = []) {
  if (!projectNames.length) return null;
  const hay = `${appName || ""} ${windowTitle || ""}`.toLowerCase();
  // Longest project name first so "RevFEP_v2" beats "RevFEP"
  for (const p of projectNames) {
    if (p.lower.length < 3) continue;
    if (hay.includes(p.lower)) return p.name;
  }
  return null;
}

export function createHabitStore({ dbPath, jsonFallbackPath }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const mode = DatabaseSync ? "sqlite" : "json";
  let db = null;

  if (mode === "sqlite") {
    db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        duration REAL NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_activity_start ON activity_sessions(start_time);
    `);
  }

  function readAllJson() {
    if (!existsSync(jsonFallbackPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(jsonFallbackPath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function writeAllJson(rows) {
    mkdirSync(dirname(jsonFallbackPath), { recursive: true });
    writeFileSync(jsonFallbackPath, JSON.stringify(rows, null, 2) + "\n");
  }

  function logSession({ startTime, endTime, appName, windowTitle }) {
    const start = Number(startTime);
    const end = Number(endTime);
    const duration = end - start;
    if (!Number.isFinite(duration) || duration < 1.0) return null;
    const app = String(appName || "Unknown").trim() || "Unknown";
    const title = String(windowTitle || app).trim();

    if (mode === "sqlite") {
      const stmt = db.prepare(`
        INSERT INTO activity_sessions (start_time, end_time, duration, app_name, window_title)
        VALUES (?, ?, ?, ?, ?)
      `);
      const info = stmt.run(start, end, duration, app, title);
      return { id: Number(info.lastInsertRowid), start_time: start, end_time: end, duration, app_name: app, window_title: title };
    }

    const rows = readAllJson();
    const id = rows.length ? (rows[rows.length - 1].id || rows.length) + 1 : 1;
    const row = { id, start_time: start, end_time: end, duration, app_name: app, window_title: title };
    rows.push(row);
    writeAllJson(rows);
    return row;
  }

  function getAllSessions() {
    if (mode === "sqlite") {
      return db.prepare("SELECT id, start_time, end_time, duration, app_name, window_title FROM activity_sessions ORDER BY start_time ASC").all();
    }
    return readAllJson().sort((a, b) => a.start_time - b.start_time);
  }

  function clearAllSessions() {
    if (mode === "sqlite") {
      db.exec("DELETE FROM activity_sessions");
      return;
    }
    writeAllJson([]);
  }

  function seedDemoData(projectList = []) {
    const names = projectList.length
      ? projectList.slice(0, 6)
      : ["PandaOrbit", "Orrery", "HabitBoard", "RevFEP", "RevPRS", "Virtual_Cell"];

    const nowSec = Math.floor(Date.now() / 1000);
    const templates = [
      { app: "VS Code", title: `${names[0]} — lib/server.mjs`, weight: 3.4 },
      { app: "VS Code", title: `${names[1 % names.length]} — dashboard analytics`, weight: 2.5 },
      { app: "Terminal", title: `zsh — ${names[0]} npm run check`, weight: 1.8 },
      { app: "Google Chrome", title: `GitHub — ${names[2 % names.length]} pull requests`, weight: 1.5 },
      { app: "Google Chrome", title: `MDN Web Docs — SVG textPath & animation`, weight: 1.7 },
      { app: "Google Chrome", title: `arXiv — free energy perturbation review`, weight: 1.4 },
      { app: "Notion", title: `Weekly Research Roadmap — ${names[0]}`, weight: 1.6 },
      { app: "Google Docs", title: `Manuscript Draft — Methods & Results`, weight: 1.3 },
      { app: "Slack", title: `Slack — #research-team`, weight: 1.0 },
      { app: "Mail", title: `Inbox — Weekly Sync & Reviews`, weight: 0.7 },
      { app: "Finder", title: `Finder — ${names[0]}`, weight: 0.5 },
      { app: "Google Chrome", title: `YouTube — Lo-fi Coding Beats & Tech Talks`, weight: 0.65 },
      { app: "Google Chrome", title: `Reddit — r/programming`, weight: 0.35 }
    ];

    // Deterministic pseudo-random generator for clean, repeatable demo curves
    let s = 42;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    let inserted = 0;
    for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
      const dayBase = new Date((nowSec - daysAgo * 86400) * 1000);
      dayBase.setHours(9, 10, 0, 0);
      let cursor = Math.floor(dayBase.getTime() / 1000);
      const cap = daysAgo === 0 ? Math.min(nowSec - 60, cursor + 8 * 3600) : cursor + 9.5 * 3600;

      // 8–13 realistic focus blocks per day
      const blocks = daysAgo === 0 ? 9 : 11 + Math.floor(rnd() * 3);
      for (let b = 0; b < blocks; b++) {
        const tpl = templates[(b * 3 + daysAgo * 2 + Math.floor(rnd() * 3)) % templates.length];
        const mins = Math.round((12 + rnd() * 36) * (tpl.weight / 2));
        const dur = Math.max(180, Math.min(4800, mins * 60));
        if (cursor + dur > cap) break;
        logSession({
          startTime: cursor,
          endTime: cursor + dur,
          appName: tpl.app,
          windowTitle: tpl.title
        });
        cursor += dur + Math.round(60 + rnd() * 300);
        inserted++;
      }
    }
    return inserted;
  }

  function getReport({ categories = {}, habitsCfg = {}, range = "today", projectNames = [] } = {}) {
    const raw = getAllSessions();
    const todayDate = new Date();
    const todayKey = dateKeyLocal(Date.now() / 1000);
    const distractionSet = new Set(habitsCfg.distractionCategories || ["Distraction & Leisure"]);
    const productiveSet = new Set(habitsCfg.productiveCategories || ["Development", "Writing & Docs", "Web/Research"]);

    const compiledProjects = [...new Set(projectNames)]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((name) => ({ name, lower: name.toLowerCase() }));

    // Build last-7-days date keys
    const last7Keys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - i);
      last7Keys.push(dateKeyLocal(d.getTime() / 1000));
    }
    const last7Set = new Set(last7Keys);

    const rangeDays = range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : null;
    const cutoffSec = rangeDays
      ? new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - (rangeDays - 1)).getTime() / 1000
      : 0;

    const enriched = raw.map((row) => {
      const category = categoriseSession(row.app_name, row.window_title, categories);
      const date = dateKeyLocal(row.start_time);
      const hour = new Date(row.start_time * 1000).getHours();
      const matchedProject = matchProjectForSession(row.app_name, row.window_title, compiledProjects);
      return {
        ...row,
        duration_min: row.duration / 60,
        duration_hrs: row.duration / 3600,
        category,
        date,
        hour,
        matchedProject
      };
    });

    const todayRows = enriched.filter((r) => r.date === todayKey);
    const rangeRows = range === "today"
      ? todayRows
      : rangeDays
        ? enriched.filter((r) => r.start_time >= cutoffSec)
        : enriched;

    // Active slice for charts: if user is on "today" and today is empty but history exists,
    // keep today metrics honest (0) while surfacing total sessions so UI can suggest switching to 7d/All.
    const chartRows = rangeRows;

    // 1. Category allocation
    const catTotals = new Map();
    for (const r of chartRows) {
      catTotals.set(r.category, (catTotals.get(r.category) || 0) + r.duration_hrs);
    }
    const totalHoursRange = [...catTotals.values()].reduce((a, b) => a + b, 0);
    const categorySummary = [...catTotals.entries()]
      .map(([category, hours]) => ({
        category,
        hours: Math.round(hours * 1000) / 1000,
        minutes: Math.round(hours * 60 * 10) / 10,
        pct: totalHoursRange > 0 ? Math.round((hours / totalHoursRange) * 1000) / 10 : 0,
        color: CATEGORY_COLORS[category] || "#94a3b8"
      }))
      .sort((a, b) => b.hours - a.hours);

    // Today's totals for KPI strip
    const todayHours = todayRows.reduce((s, r) => s + r.duration_hrs, 0);
    const topCategory = categorySummary[0]?.category || "N/A";

    // Distraction & Focus scores on selected range
    const distractionHours = categorySummary
      .filter((c) => distractionSet.has(c.category))
      .reduce((s, c) => s + c.hours, 0);
    const productiveHours = categorySummary
      .filter((c) => productiveSet.has(c.category))
      .reduce((s, c) => s + c.hours, 0);

    const distractionPct = totalHoursRange > 0 ? Math.round((distractionHours / totalHoursRange) * 1000) / 10 : 0;
    const focusScore = totalHoursRange > 0 ? Math.round((productiveHours / totalHoursRange) * 1000) / 10 : 0;

    // 2. 7-day trend & avg daily hours (HabitBoard parity)
    const dailyTotalsMap = new Map(last7Keys.map((k) => [k, 0]));
    const dailyByCat = new Map(last7Keys.map((k) => [k, {}]));
    for (const r of enriched) {
      if (!last7Set.has(r.date)) continue;
      dailyTotalsMap.set(r.date, (dailyTotalsMap.get(r.date) || 0) + r.duration_hrs);
      const bucket = dailyByCat.get(r.date);
      bucket[r.category] = (bucket[r.category] || 0) + r.duration_hrs;
    }

    const activeDays7 = [...dailyTotalsMap.values()].filter((v) => v > 0);
    const avgDailyHours7d = activeDays7.length
      ? Math.round((activeDays7.reduce((a, b) => a + b, 0) / activeDays7.length) * 100) / 100
      : 0;

    const dailyTrend = last7Keys.map((date) => {
      const cats = dailyByCat.get(date) || {};
      const roundedCats = {};
      for (const [k, v] of Object.entries(cats)) roundedCats[k] = Math.round(v * 100) / 100;
      return {
        date,
        label: dayLabel(date),
        totalHours: Math.round((dailyTotalsMap.get(date) || 0) * 100) / 100,
        development: roundedCats["Development"] || 0,
        distraction: roundedCats["Distraction & Leisure"] || 0,
        categories: roundedCats
      };
    });

    // 3. Top 15 window activities (HabitBoard parity)
    const titleMap = new Map();
    for (const r of chartRows) {
      const key = r.window_title || r.app_name || "Untitled";
      const cur = titleMap.get(key) || {
        windowTitle: key,
        appName: r.app_name,
        category: r.category,
        color: CATEGORY_COLORS[r.category] || "#94a3b8",
        matchedProject: r.matchedProject,
        minutes: 0,
        sessions: 0
      };
      cur.minutes += r.duration_min;
      cur.sessions += 1;
      titleMap.set(key, cur);
    }
    const topActivities = [...titleMap.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 15)
      .map((a) => ({ ...a, minutes: Math.round(a.minutes * 10) / 10 }));

    // 4. Hourly focus rhythm (0..23)
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, minutes: 0 }));
    for (const r of chartRows) {
      if (r.hour >= 0 && r.hour < 24) hourly[r.hour].minutes += r.duration_min;
    }
    hourly.forEach((h) => { h.minutes = Math.round(h.minutes * 10) / 10; });

    // 5. Project-time correlation (Orrery × HabitBoard!)
    const projectTime = {};
    for (const r of enriched) {
      if (!r.matchedProject) continue;
      const entry = projectTime[r.matchedProject] || { minutesTotal: 0, minutesToday: 0, minutes7d: 0, sessions: 0 };
      entry.minutesTotal += r.duration_min;
      if (r.date === todayKey) entry.minutesToday += r.duration_min;
      if (last7Set.has(r.date)) entry.minutes7d += r.duration_min;
      entry.sessions += 1;
      projectTime[r.matchedProject] = entry;
    }
    for (const v of Object.values(projectTime)) {
      v.minutesTotal = Math.round(v.minutesTotal * 10) / 10;
      v.minutesToday = Math.round(v.minutesToday * 10) / 10;
      v.minutes7d = Math.round(v.minutes7d * 10) / 10;
    }

    // 6. Recent sessions
    const recentSessions = enriched
      .slice(-25)
      .reverse()
      .map((r) => ({
        id: r.id,
        startTime: r.start_time,
        durationMin: Math.round(r.duration_min * 10) / 10,
        appName: r.app_name,
        windowTitle: r.window_title,
        category: r.category,
        color: CATEGORY_COLORS[r.category] || "#94a3b8",
        matchedProject: r.matchedProject
      }));

    // 7. Daily Focus Goal, Streak, and 28-Day Activity Heatmap
    const dailyGoalHours = Math.max(0.5, Number(habitsCfg.dailyGoalHours) || 4);
    const productiveHoursToday = todayRows
      .filter((r) => productiveSet.has(r.category))
      .reduce((s, r) => s + r.duration_hrs, 0);
    const goalProgressPct = Math.min(100, Math.round((productiveHoursToday / dailyGoalHours) * 1000) / 10);

    const allDaysTotals = new Map();
    const allDaysProductive = new Map();
    for (const r of enriched) {
      allDaysTotals.set(r.date, (allDaysTotals.get(r.date) || 0) + r.duration_hrs);
      if (productiveSet.has(r.category)) {
        allDaysProductive.set(r.date, (allDaysProductive.get(r.date) || 0) + r.duration_hrs);
      }
    }

    // Active streak: consecutive days ending today (or yesterday if today hasn't started yet) with >= 15m productive time
    let streakDays = 0;
    const hasToday = (allDaysProductive.get(todayKey) || 0) >= 0.25;
    for (let offset = hasToday ? 0 : 1; offset < 365; offset++) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - offset);
      const dk = dateKeyLocal(d.getTime() / 1000);
      if ((allDaysProductive.get(dk) || 0) >= 0.25) streakDays++;
      else break;
    }

    const heatmap28 = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - i);
      const dk = dateKeyLocal(d.getTime() / 1000);
      const hrs = Math.round((allDaysTotals.get(dk) || 0) * 100) / 100;
      const prod = Math.round((allDaysProductive.get(dk) || 0) * 100) / 100;
      const ratio = prod / dailyGoalHours;
      const level = prod <= 0 ? 0 : ratio < 0.35 ? 1 : ratio < 0.7 ? 2 : ratio < 1.0 ? 3 : 4;
      heatmap28.push({
        date: dk,
        label: dayLabel(dk),
        dayNum: d.getDate(),
        hours: hrs,
        productiveHours: prod,
        level
      });
    }

    return {
      hasData: raw.length > 0,
      hasRangeData: chartRows.length > 0,
      range,
      currentDate: formatDateHeading(todayDate),
      storageMode: mode,
      dbPath: mode === "sqlite" ? dbPath : jsonFallbackPath,
      totalSessions: raw.length,
      kpis: {
        totalHoursToday: Math.round(todayHours * 100) / 100,
        productiveHoursToday: Math.round(productiveHoursToday * 100) / 100,
        dailyGoalHours,
        goalProgressPct,
        streakDays,
        totalHoursRange: Math.round(totalHoursRange * 100) / 100,
        topCategory,
        avgDailyHours7d,
        distractionPct,
        focusScore
      },
      categorySummary,
      dailyTrend,
      heatmap28,
      topActivities,
      hourly,
      projectTime,
      recentSessions
    };
  }

  function exportSessions({ categories = {}, format = "csv" } = {}) {
    const rows = getAllSessions().map((r) => ({
      id: r.id,
      date: dateKeyLocal(r.start_time),
      start_iso: new Date(r.start_time * 1000).toISOString(),
      end_iso: new Date(r.end_time * 1000).toISOString(),
      duration_seconds: Math.round(r.duration),
      duration_minutes: Math.round((r.duration / 60) * 100) / 100,
      category: categoriseSession(r.app_name, r.window_title, categories),
      app_name: r.app_name,
      window_title: r.window_title || ""
    }));

    if (format === "json") {
      return {
        mime: "application/json; charset=utf-8",
        filename: "panda-orbit-habits.json",
        body: JSON.stringify(rows, null, 2) + "\n"
      };
    }

    const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = ["id", "date", "start_iso", "end_iso", "duration_seconds", "duration_minutes", "category", "app_name", "window_title"];
    const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))];
    return {
      mime: "text/csv; charset=utf-8",
      filename: "panda-orbit-habits.csv",
      body: lines.join("\n") + "\n"
    };
  }

  function close() {
    if (db) {
      try { db.close(); } catch {}
      db = null;
    }
  }

  return {
    mode,
    dbPath: mode === "sqlite" ? dbPath : jsonFallbackPath,
    logSession,
    getAllSessions,
    clearAllSessions,
    seedDemoData,
    getReport,
    exportSessions,
    close
  };
}
