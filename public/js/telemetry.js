// ─────────────────────────────────────────────────────────────
//  PandaOrbit Live Telemetry Engine
//  Powers real-time Server-Sent Events (SSE), the live Retina
//  HTML5 signal oscilloscope graph, and the interactive
//  JARVIS / God's-Eye-View command terminal.
// ─────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CAT_HEX = {
  "Development": "#38d9ff",
  "Web/Research": "#7d7aff",
  "Writing & Docs": "#30d158",
  "Communication": "#40c8e0",
  "System & Utilities": "#ff9f0a",
  "Distraction & Leisure": "#ff453a",
  "Uncategorized": "#8e95a8",
  "Idle": "#5c6478"
};

const TAG_CLASS = {
  SYS: "tag-sys",
  TRACK: "tag-track",
  LOCK: "tag-lock",
  COMMIT: "tag-commit",
  MANUAL: "tag-commit",
  SCAN: "tag-sys",
  OPEN: "tag-lock",
  PIN: "tag-sys",
  SEED: "tag-sys",
  CMD: "tag-cmd",
  ERR: "tag-err"
};

export function fmtClock(ts = Date.now()) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

export function fmtTimer(sec = 0) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return [h, m, rem].map((v) => String(v).padStart(2, "0")).join(":");
}

export function createTelemetryBus({ served, onTrackerUpdate, onSessionCommitted }) {
  const state = {
    connected: false,
    tracker: { running: false },
    latestSample: null,
    samples: [],
    events: [],
    history: []
  };

  const listeners = new Set();
  let es = null;

  function notify(kind = "update") {
    for (const fn of listeners) {
      try { fn(state, kind); } catch {}
    }
  }

  function pushLocalEvent(tag, message, extra = {}) {
    const evt = { ts: Date.now(), tag, message, ...extra };
    state.events.push(evt);
    if (state.events.length > 80) state.events.shift();
    notify("log");
  }

  function pushSample(sample) {
    state.latestSample = sample;
    state.samples.push(sample);
    if (state.samples.length > 90) state.samples.shift();
    notify("tick");
  }

  function connect() {
    if (!served || typeof EventSource === "undefined") {
      pushLocalEvent("SYS", "Offline preview mode — start `panda-orbit` server for live SSE telemetry.");
      return;
    }
    if (es) es.close();
    es = new EventSource("/api/stream");

    es.addEventListener("init", (e) => {
      try {
        const data = JSON.parse(e.data);
        state.connected = true;
        state.tracker = data.tracker || { running: false };
        state.samples = Array.isArray(data.samples) ? data.samples.slice(-90) : [];
        state.events = Array.isArray(data.events) ? data.events.slice(-80) : [];
        state.latestSample = state.samples[state.samples.length - 1] || null;
        onTrackerUpdate?.(state.tracker);
        notify("init");
      } catch {}
    });

    es.addEventListener("tick", (e) => {
      try {
        const sample = JSON.parse(e.data);
        state.connected = true;
        state.tracker = {
          ...state.tracker,
          running: true,
          currentApp: sample.appName,
          currentTitle: sample.windowTitle,
          currentDurationSec: sample.sessionSeconds,
          lastError: sample.error || null
        };
        pushSample(sample);
        onTrackerUpdate?.(state.tracker);
      } catch {}
    });

    es.addEventListener("log", (e) => {
      try {
        const evt = JSON.parse(e.data);
        state.events.push(evt);
        if (state.events.length > 80) state.events.shift();
        notify("log");
      } catch {}
    });

    es.addEventListener("session", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.evt) {
          state.events.push(data.evt);
          if (state.events.length > 80) state.events.shift();
        }
        onSessionCommitted?.(data.session);
        notify("session");
      } catch {}
    });

    es.addEventListener("tracker", (e) => {
      try {
        const data = JSON.parse(e.data);
        state.tracker = data.tracker || { running: false };
        if (data.evt) {
          state.events.push(data.evt);
          if (state.events.length > 80) state.events.shift();
        }
        onTrackerUpdate?.(state.tracker);
        notify("tracker");
      } catch {}
    });

    es.onerror = () => {
      state.connected = false;
      notify("connection");
    };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function clearEvents() {
    state.events = [];
    notify("log");
  }

  return { state, connect, subscribe, pushLocalEvent, clearEvents };
}

/**
 * Draws a Retina-DPI real-time focus signal oscilloscope onto a <canvas>.
 */
export function drawSignalGraph(canvas, state, opts = {}) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(rect.width * dpr);
  const H = Math.round(rect.height * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const mode = opts.mode || "jarvis";
  const palette = {
    jarvis: { bg: "#070d17", grid: "rgba(56, 217, 255, 0.11)", line: "#38d9ff", dim: "rgba(186, 230, 253, 0.55)" },
    nvg:    { bg: "#041109", grid: "rgba(57, 255, 136, 0.12)", line: "#39ff88", dim: "rgba(167, 243, 208, 0.55)" },
    flir:   { bg: "#0d0718", grid: "rgba(255, 136, 56, 0.13)", line: "#ff9f0a", dim: "rgba(254, 215, 170, 0.58)" },
    crt:    { bg: "#0c0a05", grid: "rgba(255, 196, 61, 0.12)", line: "#ffc43d", dim: "rgba(253, 230, 138, 0.58)" }
  }[mode] || { bg: "#070d17", grid: "rgba(56, 217, 255, 0.11)", line: "#38d9ff", dim: "rgba(186, 230, 253, 0.55)" };

  // Background
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, h);

  const pad = { top: 18, right: 14, bottom: 22, left: 38 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  // Gridlines
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.font = `10px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = palette.dim;

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ph / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    const label = `${100 - i * 25}%`;
    ctx.textAlign = "right";
    ctx.fillText(label, pad.left - 6, y + 3);
  }

  for (let i = 0; i <= 6; i++) {
    const x = pad.left + (pw / 6) * i;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + ph);
    ctx.stroke();
  }

  ctx.textAlign = "left";
  ctx.fillText("-90s", pad.left, h - 6);
  ctx.textAlign = "center";
  ctx.fillText("-45s", pad.left + pw / 2, h - 6);
  ctx.textAlign = "right";
  ctx.fillText("LIVE", w - pad.right, h - 6);

  const samples = state.samples || [];
  const slots = 60;
  const nowPulse = Math.sin(Date.now() / 420) * 0.025;

  // Build normalized points (pad left with gentle baseline if fewer than 60 samples)
  const pts = [];
  for (let i = 0; i < slots; i++) {
    const idx = samples.length - slots + i;
    const s = idx >= 0 ? samples[idx] : null;
    const x = pad.left + (i / (slots - 1)) * pw;
    const rawVal = s ? Math.max(0.06, Math.min(0.99, (s.intensity ?? 0.5) + (i === slots - 1 ? nowPulse : 0))) : 0.08 + Math.sin((i + Date.now() / 600) * 0.35) * 0.012;
    const y = pad.top + ph * (1 - rawVal);
    pts.push({ x, y, val: rawVal, sample: s });
  }

  const activeColor = state.latestSample?.category
    ? (mode === "jarvis" ? (CAT_HEX[state.latestSample.category] || palette.line) : palette.line)
    : palette.line;

  // Subtle vertical spectrum bars behind curve
  const barW = Math.max(2, pw / slots - 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p.sample) continue;
    const c = mode === "jarvis" ? (CAT_HEX[p.sample.category] || palette.line) : palette.line;
    ctx.fillStyle = c + "26";
    ctx.fillRect(p.x - barW / 2, p.y, barW, pad.top + ph - p.y);
  }

  // Area fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
  grad.addColorStop(0, activeColor + "40");
  grad.addColorStop(1, activeColor + "02");
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pad.top + ph);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1].x, pad.top + ph);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Main signal waveform
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = activeColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Live beacon at right edge
  const head = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(head.x, head.y, 7 + Math.sin(Date.now() / 240) * 2, 0, Math.PI * 2);
  ctx.fillStyle = activeColor + "33";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Standby caption when tracker is off and no live samples
  if (!state.tracker?.running && !samples.length) {
    ctx.fillStyle = palette.dim;
    ctx.font = `600 11px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.fillText("STANDBY — ENGAGE TRACKER OR RUN `track start` IN TERMINAL", pad.left + pw / 2, pad.top + ph / 2 - 4);
  }

  ctx.restore();
}

/**
 * Renders terminal event rows HTML (reusable in both HabitBoard & Orbit HUD).
 */
export function renderTerminalLinesHtml(events, limit = 40) {
  const slice = (events || []).slice(-limit);
  if (!slice.length) {
    return `<div class="term-line"><span class="term-ts">${fmtClock()}</span><span class="term-tag tag-sys">SYS</span><span class="term-msg">Telemetry bus standing by. Type <code>help</code> for commands.</span></div>`;
  }
  return slice.map((e) => {
    const cls = TAG_CLASS[e.tag] || "tag-sys";
    return `<div class="term-line">
      <span class="term-ts">${esc(fmtClock(e.ts))}</span>
      <span class="term-tag ${cls}">${esc(e.tag || "SYS")}</span>
      <span class="term-msg">${esc(e.message)}</span>
    </div>`;
  }).join("");
}

/**
 * Parses and executes interactive terminal commands.
 */
export async function executeTerminalCommand(raw, ctx) {
  const input = String(raw || "").trim();
  if (!input) return;
  ctx.bus.pushLocalEvent("CMD", `panda@orbit:~$ ${input}`);

  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const rest = parts.slice(1);

  if (cmd === "help" || cmd === "?") {
    ctx.bus.pushLocalEvent("SYS", "Commands: track start | track stop | status | log <mins> <app> <title> | focus <project> | mode <jarvis|nvg|flir|crt> | summary [save|gdocs] | rescan | seed | clear");
    return;
  }

  if (cmd === "summary") {
    const sub = (rest[0] || "save").toLowerCase();
    if (sub === "gdocs" || sub === "docs") await ctx.publishGoogleDocs?.();
    else await ctx.saveSummaryDoc?.();
    return;
  }

  if (cmd === "clear") {
    ctx.bus.clearEvents();
    return;
  }

  if (cmd === "track") {
    const sub = (rest[0] || "toggle").toLowerCase();
    if (sub === "start" || sub === "on") await ctx.setTracker("start");
    else if (sub === "stop" || sub === "off") await ctx.setTracker("stop");
    else await ctx.toggleTracker();
    return;
  }

  if (cmd === "status") {
    const st = ctx.getSnapshot();
    ctx.bus.pushLocalEvent(
      "SYS",
      `Projects: ${st.activeProjects}/${st.totalProjects} active · Today: ${st.todayHours.toFixed(2)}h · Focus: ${st.focusScore.toFixed(0)}% · Tracker: ${st.trackerRunning ? "LIVE" : "STANDBY"}`
    );
    return;
  }

  if (cmd === "rescan") {
    await ctx.rescan();
    return;
  }

  if (cmd === "seed") {
    await ctx.seedHabits();
    return;
  }

  if (cmd === "mode") {
    const m = (rest[0] || "").toLowerCase();
    if (["jarvis", "nvg", "flir", "crt"].includes(m)) {
      ctx.setOpticalMode(m);
      ctx.bus.pushLocalEvent("SYS", `Optical HUD filter switched to ${m.toUpperCase()}`);
    } else {
      ctx.bus.pushLocalEvent("ERR", "Usage: mode <jarvis|nvg|flir|crt>");
    }
    return;
  }

  if (cmd === "focus" || cmd === "lock") {
    const q = rest.join(" ").trim();
    if (!q) {
      ctx.bus.pushLocalEvent("ERR", "Usage: focus <project-name>");
      return;
    }
    const ok = ctx.focusProject(q);
    if (ok) ctx.bus.pushLocalEvent("LOCK", `Target lock acquired on "${ok}"`);
    else ctx.bus.pushLocalEvent("ERR", `No scanned project matching "${q}"`);
    return;
  }

  if (cmd === "log") {
    const mins = Number(rest[0]);
    const app = rest[1];
    const title = rest.slice(2).join(" ") || app;
    if (!Number.isFinite(mins) || mins <= 0 || !app) {
      ctx.bus.pushLocalEvent("ERR", "Usage: log <minutes> <app> [window title]  e.g. log 25 VSCode PandaOrbit HUD");
      return;
    }
    await ctx.logSession({ appName: app, windowTitle: title, durationMinutes: mins });
    return;
  }

  ctx.bus.pushLocalEvent("ERR", `Unknown command "${cmd}". Type \`help\` for available commands.`);
}
