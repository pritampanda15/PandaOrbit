// ─────────────────────────────────────────────────────────────
//  PandaOrbit Main Controller.
//  Coordinates Dashboard, JARVIS Orbit HUD, Focus & Telemetry,
//  and Storage views with live SSE telemetry, ⌘K palette, and
//  Apple-style focus & theme handling.
// ─────────────────────────────────────────────────────────────

import { createOrbitView } from "./orbit.js";
import { createDashboardView } from "./dashboard.js";
import { createHabitsView } from "./habits.js";
import { createStorageView } from "./storage.js";
import {
  createTelemetryBus,
  drawSignalGraph,
  renderTerminalLinesHtml,
  executeTerminalCommand,
  fmtClock
} from "./telemetry.js";

const SERVED = location.protocol === "http:" || location.protocol === "https:";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STATUS_LABEL = { active: "Active", steady: "Steady", dormant: "Dormant" };

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeOverrides(rawTree, overrides) {
  const tree = deepClone(rawTree);

  (function remember(node) {
    if (node.status) node._auto = node.status;
    (node.children || []).forEach(remember);
  })({ children: tree.domains });

  (function apply(node) {
    (node.children || []).forEach(apply);
    const key = node.key || null;
    if (!key || key.startsWith("_")) return;
    node._key = key;
    const o = overrides[key];
    if (!o) return;
    if (o.label) node.name = o.label;
    if (o.note) node.mine = o.note;
    if (o.status) { node.status = o.status; node.pinned = true; }
    if (o.hide) node.hidden = true;
  })({ children: tree.domains });

  (function prune(node) {
    if (!node.children) return;
    node.children = node.children.filter((c) => !c.hidden);
    node.children.forEach(prune);
  })({ children: tree.domains });

  for (const dom of tree.domains || []) {
    dom._isHub = true;
    (function linkParents(parent) {
      for (const c of parent.children || []) {
        c._parent = parent;
        c._dom = dom;
        linkParents(c);
      }
    })(dom);
  }

  return tree;
}

function chainOf(node) {
  const out = [];
  let cur = node;
  while (cur) { out.unshift(cur); cur = cur._parent; }
  return out;
}

function setupAppearanceToggle(btn) {
  const docEl = document.documentElement;
  const saved = localStorage.getItem("panda-orbit-theme");
  if (saved === "light" || saved === "dark") docEl.dataset.theme = saved;

  const isDarkNow = () => {
    if (docEl.dataset.theme === "dark") return true;
    if (docEl.dataset.theme === "light") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  };

  function syncIcon() {
    const dark = isDarkNow();
    btn.setAttribute("aria-label", dark ? "Switch to Light Appearance" : "Switch to Dark Appearance");
    btn.title = dark ? "Switch to Light Appearance" : "Switch to Dark Appearance";
    const svg = btn.querySelector("svg");
    if (!svg) return;
    svg.innerHTML = dark
      ? `<circle cx="10" cy="10" r="3.5"/><path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.87 4.87l1.06 1.06M14.07 14.07l1.06 1.06M15.13 4.87l-1.06 1.06M5.93 14.07l-1.06 1.06"/>`
      : `<path d="M15.6 12.2A6.25 6.25 0 0 1 7.8 4.4a6.25 6.25 0 1 0 7.8 7.8Z"/>`;
  }

  btn.addEventListener("click", () => {
    const next = isDarkNow() ? "light" : "dark";
    docEl.classList.add("theme-switching");
    docEl.dataset.theme = next;
    localStorage.setItem("panda-orbit-theme", next);
    syncIcon();
    requestAnimationFrame(() => requestAnimationFrame(() => docEl.classList.remove("theme-switching")));
  });

  syncIcon();
}

(async () => {
  let rawTree = typeof TREE !== "undefined" ? TREE : { title: "PandaOrbit", domains: [], roots: [] };
  let overrides = {};
  let tree = null;
  let habitReport = null;
  let summaryData = null;
  let docsConfig = { hasWebhook: false, hasApiToken: false, docId: "" };
  let lastDocResult = null;
  let diskData = null;
  let diskLoading = false;
  let diskError = null;
  let trackerStatus = { running: false };
  let categories = {};
  let activeView = "dashboard";
  let selectedNode = null;
  let lastInspectorOpener = null;

  const panel = document.getElementById("panel");
  const titleEl = document.getElementById("title");
  const trackerPill = document.getElementById("tracker-pill");
  const trackerPillLabel = document.getElementById("tracker-pill-label");
  const rescanBtn = document.getElementById("rescan-btn");
  const themeBtn = document.getElementById("theme-btn");
  const hudClock = document.getElementById("hud-clock");
  const orbitDock = document.getElementById("orbit-telemetry-dock");
  const orbitDockToggle = document.getElementById("orbit-dock-toggle");
  const orbitSignalCanvas = document.getElementById("orbit-signal-canvas");
  const orbitTermFeed = document.getElementById("orbit-term-feed");
  const orbitSigPill = document.getElementById("orbit-sig-pill");

  setupAppearanceToggle(themeBtn);

  async function loadOverrides() {
    if (!SERVED) return;
    try {
      const r = await fetch("overrides.json", { cache: "no-store" });
      if (r.ok) overrides = await r.json();
    } catch {}
  }

  async function loadHabits(range) {
    if (!SERVED) return;
    const effRange = range || habitsView.getRange();
    try {
      const [r, rs] = await Promise.all([
        fetch(`/api/habits?range=${encodeURIComponent(effRange)}`, { cache: "no-store" }),
        fetch(`/api/summary?range=${encodeURIComponent(effRange)}`, { cache: "no-store" })
      ]);
      if (r.ok) {
        const data = await r.json();
        if (data.ok) {
          habitReport = data.report;
          trackerStatus = data.tracker || { running: false };
          categories = data.categories || {};
          updateTrackerPill();
        }
      }
      if (rs.ok) {
        const sdata = await rs.json();
        if (sdata.ok) {
          summaryData = sdata.summary;
          docsConfig = sdata.docsConfig || docsConfig;
        }
      }
    } catch {}
  }

  function updateTrackerPill() {
    const on = Boolean(trackerStatus?.running);
    trackerPill.classList.toggle("live", on);
    trackerPill.setAttribute("aria-pressed", String(on));
    trackerPillLabel.textContent = on
      ? (trackerStatus.currentApp ? `Live · ${trackerStatus.currentApp}` : "Tracking Live")
      : "Tracker Off";
    if (orbitSigPill) {
      orbitSigPill.textContent = on ? "LIVE" : "STANDBY";
      orbitSigPill.classList.toggle("live", on);
    }
  }

  async function openFolder(path, btnEl = null) {
    if (!path) return;
    if (!SERVED) {
      await navigator.clipboard?.writeText(path).catch(() => {});
      showToast("Path copied — start the local server to open Finder");
      return;
    }
    if (btnEl) btnEl.textContent = "Opening…";
    try {
      const r = await fetch("/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path })
      });
      const j = await r.json();
      if (j.ok) {
        showToast(`Opened ${path}`);
        if (btnEl) btnEl.textContent = "Opened";
      } else {
        showToast(`Refused: ${j.error}`);
        if (btnEl) btnEl.textContent = "Refused";
      }
    } catch {
      showToast("Local server is not reachable");
    }
    if (btnEl) setTimeout(() => { btnEl.textContent = "Open Folder"; }, 2000);
  }

  async function saveOverride(node, patch) {
    if (!SERVED) { showToast("Start the local server to save notes"); return; }
    const savedEl = panel.querySelector(".saved");
    try {
      const r = await fetch("/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: node._key, ...patch })
      });
      const j = await r.json();
      if (j.ok) {
        if (Object.keys(j.entry || {}).length) overrides[node._key] = j.entry;
        else delete overrides[node._key];
        if (savedEl) { savedEl.textContent = "Saved to overrides.json"; savedEl.style.color = "var(--apple-color-green)"; }
        renderCurrentDataViews();
      } else if (savedEl) {
        savedEl.textContent = `Could not save: ${j.error}`;
        savedEl.style.color = "var(--apple-color-red)";
      }
    } catch {
      if (savedEl) { savedEl.textContent = "Server unreachable"; savedEl.style.color = "var(--apple-color-red)"; }
    }
    if (savedEl) setTimeout(() => { if (savedEl) savedEl.textContent = ""; }, 2200);
  }

  function showInspector(n, openerEl = null) {
    selectedNode = n;
    if (!n) {
      panel.classList.remove("on");
      panel.setAttribute("aria-hidden", "true");
      if (lastInspectorOpener && document.contains(lastInspectorOpener)) {
        lastInspectorOpener.focus();
      }
      lastInspectorOpener = null;
      return;
    }
    if (openerEl) lastInspectorOpener = openerEl;

    const crumb = chainOf(n).slice(0, -1).map((c) => c.name).join(" › ");
    const s = n._isHub ? "" : (n.status || "dormant");
    const statusLabel = STATUS_LABEL[s] || s;
    const pt = habitReport?.projectTime?.[n.name];
    const kids = (n.children || []).map((c) => `
      <button type="button" class="kid-row" data-kid="${esc(c._key || c.key)}">
        <span>${esc(c.name)}</span>
        <span class="status-badge ${c.status || "dormant"}">${esc(STATUS_LABEL[c.status] || c.status || "")}</span>
      </button>
    `).join("");

    panel.innerHTML = `
      <div class="panel-head">
        <div class="panel-crumb">${esc(crumb || "Domain")}</div>
        <button type="button" class="close-btn" id="panel-close" aria-label="Close inspector">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8"/>
          </svg>
        </button>
      </div>
      <div class="panel-name">${esc(n.name)}</div>
      ${s
        ? `<div class="panel-st">
             <span class="status-badge ${s} ${n.pinned ? "pinned" : ""}">${esc(statusLabel)}${n.pinned ? " · Pinned" : ""}</span>
             ${n.branch ? `<span>Branch: ${esc(n.branch)}</span>` : ""}
           </div>`
        : `<div class="panel-st">${esc(n.blurb || "")}</div>`}
      ${pt ? `<div class="time-chip">${Math.round(pt.minutes7d)}m tracked (7d) · ${pt.sessions} sessions</div>` : ""}
      ${n.mine ? `<div class="panel-mine">${esc(n.mine).replace(/\n/g, "<br>")}</div>` : ""}
      ${n.note ? `<div class="panel-note">${esc(n.note).replace(/\n/g, "<br>")}</div>` : ""}
      ${n._key ? `
        <div class="panel-lbl">Status</div>
        <div class="pick" role="group" aria-label="Pin project status">${["auto", "active", "steady", "dormant"].map((v) =>
          `<button type="button" data-v="${v}" aria-pressed="${n.pinned ? v === n.status : v === "auto"}" class="${(n.pinned ? v === n.status : v === "auto") ? "sel" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`
        ).join("")}</div>
        <label class="panel-lbl" for="panel-mynote" style="display:block">Notes</label>
        <textarea id="panel-mynote" class="mynote" placeholder="Record next steps or blockers — saved to overrides.json">${esc(n.mine || "")}</textarea>
        <div class="saved" role="status" aria-live="polite"></div>
      ` : ""}
      ${n.path ? `<div class="panel-loc">${esc(n.path)}</div>` : ""}
      <div class="panel-actions">
        ${n.path ? `<button type="button" class="btn btn-filled open">Open Folder</button>` : ""}
        ${activeView !== "orbit" && (n._key || n.key) ? `<button type="button" class="btn btn-tinted locate">Lock in Orbit</button>` : ""}
      </div>
      ${kids ? `<div class="panel-kids">${kids}</div>` : ""}
    `;

    panel.classList.add("on");
    panel.setAttribute("aria-hidden", "false");

    panel.querySelector("#panel-close")?.addEventListener("click", () => showInspector(null));
    const openBtn = panel.querySelector(".open");
    if (openBtn) openBtn.addEventListener("click", () => openFolder(n.path, openBtn));

    const locateBtn = panel.querySelector(".locate");
    if (locateBtn) {
      locateBtn.addEventListener("click", () => {
        switchView("orbit");
        setTimeout(() => orbitView.focusNode(n._key || n.key), 60);
      });
    }

    panel.querySelectorAll(".pick button").forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.dataset.v, auto = v === "auto";
        n.pinned = !auto;
        n.status = auto ? n._auto : v;
        orbitView.recolourNode(n);
        saveOverride(n, { status: auto ? null : v });
        showInspector(n);
      });
    });

    const ta = panel.querySelector(".mynote");
    if (ta) {
      ta.addEventListener("change", () => {
        const val = ta.value.trim();
        n.mine = val || undefined;
        saveOverride(n, { note: val || null });
      });
    }

    panel.querySelectorAll("[data-kid]").forEach((row) => {
      row.addEventListener("click", () => {
        const kid = (n.children || []).find((c) => (c._key || c.key) === row.dataset.kid);
        if (kid) showInspector(kid);
      });
    });
  }

  function allProjectNames() {
    const names = [];
    for (const d of tree?.domains || []) {
      for (const c of d.children || []) names.push(c.name);
    }
    return names;
  }

  // Real-time SSE Telemetry Bus
  const telemetryBus = createTelemetryBus({
    served: SERVED,
    onTrackerUpdate: (st) => {
      trackerStatus = st;
      updateTrackerPill();
      orbitView.setLiveTrackedProject(telemetryBus.state.latestSample?.matchedProject || null);
    },
    onSessionCommitted: async () => {
      await loadHabits();
      renderCurrentDataViews();
    }
  });

  const orbitView = createOrbitView({
    pane: document.getElementById("view-orbit"),
    svg: document.getElementById("svg"),
    controls: {
      pauseBtn: document.getElementById("orbit-pause"),
      fitBtn: document.getElementById("orbit-fit"),
      searchInput: document.getElementById("orbit-search")
    },
    readouts: {
      mode: document.getElementById("ro-mode"),
      az: document.getElementById("ro-az"),
      zoom: document.getElementById("ro-zoom"),
      active: document.getElementById("ro-active"),
      target: document.getElementById("ro-target")
    },
    branchBar: document.getElementById("orbit-branch-bar"),
    filePreview: document.getElementById("orbit-file-preview"),
    onOpenFolder: (p) => openFolder(p),
    onSaveOverride: (node, patch) => saveOverride(node, patch),
    onStartSprint: (projectName, mins) => startSprint(projectName, mins),
    getProjectTime: (name) => habitReport?.projectTime?.[name] || null
  });

  const dashboardView = createDashboardView({
    container: document.getElementById("view-dashboard"),
    onSelectNode: (node, openerEl) => showInspector(node, openerEl),
    onOpenFolder: (p) => openFolder(p),
    onSwitchView: (v) => switchView(v),
    onSeedHabits: () => seedHabits(),
    onToggleTracker: () => toggleTracker(),
    onStartSprint: (projectName, mins) => startSprint(projectName, mins),
    onSwitchSystemWide: () => switchToSystemWide()
  });

  const storageView = createStorageView({
    container: document.getElementById("view-storage"),
    onLoadDisk: (opts) => loadDisk(opts),
    onOpenFolder: (p) => openFolder(p)
  });

  const habitsView = createHabitsView({
    container: document.getElementById("view-habits"),
    onChangeRange: async (r) => { await loadHabits(r); renderCurrentDataViews(); },
    onToggleTracker: () => toggleTracker(),
    onLogSession: (payload) => logManualSession(payload),
    onSeedHabits: () => seedHabits(),
    onClearHabits: () => clearHabits(),
    onUpdateCategory: (payload) => updateCategoryRule(payload),
    onSaveSummaryDoc: (range) => saveSummaryDoc(range),
    onPublishGoogleDocs: (range) => publishGoogleDocs(range),
    onSaveDocsConfig: (payload) => saveDocsConfigClient(payload),
    onCopySummary: (summary) => copySummaryForGoogleDocs(summary),
    onJumpProject: (projName) => {
      switchView("orbit");
      setTimeout(() => {
        const locked = orbitView.focusNode(projName);
        if (!locked) showToast(`Project "${projName}" was not found in the current scan`);
      }, 60);
    },
    onRunCommand: (cmd) => executeTerminalCommand(cmd, {
      bus: telemetryBus,
      setTracker: (action) => setTrackerState(action),
      toggleTracker: () => toggleTracker(),
      rescan: () => rescanWorkspace(),
      seedHabits: () => seedHabits(),
      logSession: (payload) => logManualSession(payload),
      saveSummaryDoc: () => saveSummaryDoc(habitsView.getRange()),
      publishGoogleDocs: () => publishGoogleDocs(habitsView.getRange()),
      setOpticalMode: (m) => {
        orbitView.setOpticalMode(m);
        if (activeView !== "orbit") switchView("orbit");
      },
      focusProject: (q) => {
        switchView("orbit");
        return orbitView.focusNode(q);
      },
      getSnapshot: () => {
        const projs = (tree?.domains || []).flatMap((d) => d.children || []);
        return {
          totalProjects: projs.length,
          activeProjects: projs.filter((p) => p.status === "active").length,
          todayHours: habitReport?.kpis?.totalHoursToday || 0,
          focusScore: habitReport?.kpis?.focusScore || 0,
          trackerRunning: Boolean(trackerStatus?.running)
        };
      }
    })
  });

  function syncLiveWidgets() {
    const busState = telemetryBus.state;
    if (activeView === "habits") {
      habitsView.updateLiveTelemetry(busState);
    }
    if (activeView === "orbit") {
      if (orbitSignalCanvas && !orbitDock?.classList.contains("collapsed")) {
        drawSignalGraph(orbitSignalCanvas, busState, { mode: orbitView.getOpticalMode() });
      }
      if (orbitTermFeed) {
        orbitTermFeed.innerHTML = renderTerminalLinesHtml(busState.events, 6);
        orbitTermFeed.scrollTop = orbitTermFeed.scrollHeight;
      }
    }
  }

  telemetryBus.subscribe(() => syncLiveWidgets());

  function renderCurrentDataViews() {
    dashboardView.render({ tree, habitReport, tracker: trackerStatus });
    habitsView.render({
      report: habitReport,
      tracker: trackerStatus,
      categories,
      projectNames: allProjectNames(),
      busState: telemetryBus.state,
      summaryData,
      docsConfig,
      lastDocResult
    });
    syncLiveWidgets();
  }

  const tabs = [...document.querySelectorAll(".seg-tab")];

  function switchView(viewName) {
    if (!["dashboard", "orbit", "habits", "storage"].includes(viewName)) viewName = "dashboard";
    activeView = viewName;
    if (location.hash !== `#${viewName}`) history.replaceState(null, "", `#${viewName}`);

    tabs.forEach((btn) => {
      const on = btn.dataset.view === viewName;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".view-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === `view-${viewName}`);
    });

    orbitView.setVisible(viewName === "orbit");
    if (viewName !== "dashboard") showInspector(null);
    if (viewName === "storage") {
      storageView.render({ diskData, loading: diskLoading, error: diskError });
      if (!diskData && !diskLoading) loadDisk({ scope: "home", refresh: false });
    }
    requestAnimationFrame(() => syncLiveWidgets());
  }

  const tablist = document.querySelector(".segmented-nav");
  tablist?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const cur = tabs.findIndex((t) => t.dataset.view === activeView);
    const next = (cur + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    switchView(tabs[next].dataset.view);
    tabs[next].focus();
  });

  async function setTrackerState(action) {
    if (!SERVED) { showToast("Start the local server to enable live tracking"); return; }
    try {
      const r = await fetch("/api/habits/tracker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const j = await r.json();
      if (j.ok) {
        trackerStatus = j.tracker;
        telemetryBus.state.tracker = j.tracker;
        updateTrackerPill();
        showToast(trackerStatus.running ? "Activity tracker started" : "Tracker stopped and session saved");
        await loadHabits();
        renderCurrentDataViews();
      }
    } catch { showToast("Could not update tracker state"); }
  }

  async function toggleTracker() {
    await setTrackerState(trackerStatus?.running ? "stop" : "start");
  }

  async function logManualSession(payload) {
    try {
      const r = await fetch("/api/habits/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (j.ok) {
        showToast(`Saved ${payload.durationMinutes}m in ${payload.appName}`);
        await loadHabits();
        renderCurrentDataViews();
      }
    } catch { showToast("Could not save session"); }
  }

  async function seedHabits() {
    try {
      const r = await fetch("/api/habits/seed", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        showToast(`Loaded ${j.inserted} sample activity sessions`);
        await loadHabits();
        renderCurrentDataViews();
      }
    } catch { showToast("Could not load sample data"); }
  }

  async function clearHabits() {
    try {
      const r = await fetch("/api/habits/clear", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        showToast("Cleared recorded sessions");
        await loadHabits();
        renderCurrentDataViews();
      }
    } catch { showToast("Could not clear database"); }
  }

  async function updateCategoryRule({ category, keyword, action }) {
    if (!SERVED) { showToast("Start the local server to edit categories"); return; }
    try {
      const r = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, keyword, action })
      });
      const j = await r.json();
      if (j.ok) {
        categories = j.categories;
        showToast(`${action === "remove" ? "Removed" : "Added"} "${keyword}" in ${category}`);
        await loadHabits();
        renderCurrentDataViews();
      }
    } catch { showToast("Could not update category rules"); }
  }

  async function copySummaryForGoogleDocs(summary) {
    if (!summary) return;
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const item = new ClipboardItem({
          "text/html": new Blob([summary.html], { type: "text/html" }),
          "text/plain": new Blob([summary.plainText], { type: "text/plain" })
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(summary.markdown);
      }
      showToast("Formatted summary copied — paste directly into Google Docs (⌘V)");
    } catch {
      await navigator.clipboard?.writeText(summary.markdown).catch(() => {});
      showToast("Markdown summary copied to clipboard");
    }
  }

  async function saveSummaryDoc(range = "today") {
    if (!SERVED) { showToast("Start the local server to save reports"); return; }
    try {
      const r = await fetch("/api/summary/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ range, format: "md" })
      });
      const j = await r.json();
      if (j.ok) {
        lastDocResult = { filePath: j.filePath };
        showToast(`Saved ${j.filename}`);
        renderCurrentDataViews();
      } else {
        showToast(`Save failed: ${j.error}`);
      }
    } catch { showToast("Could not save summary doc"); }
  }

  async function publishGoogleDocs(range = "today") {
    if (!SERVED) { showToast("Start the local server to publish to Google Docs"); return; }
    showToast("Publishing summary to Google Docs…");
    try {
      const r = await fetch("/api/summary/gdocs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ range })
      });
      const j = await r.json();
      if (j.ok) {
        lastDocResult = { docUrl: j.docUrl, docId: j.docId };
        showToast("Work summary published to Google Docs");
        renderCurrentDataViews();
      } else {
        showToast(j.error || "Google Docs publish failed");
      }
    } catch { showToast("Could not reach Google Docs connector"); }
  }

  async function readJsonSafe(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      const hint = res.status === 404
        ? "Endpoint not found — restart your PandaOrbit background server (`node bin/panda-orbit.mjs autostart on`) to load the latest update."
        : `Server returned HTTP ${res.status}: ${text.slice(0, 120)}`;
      return { ok: false, error: hint };
    }
  }

  async function switchToSystemWide() {
    if (!SERVED) { showToast("Start the local server to scan system-wide"); return; }
    showToast("Discovering repositories across your machine…");
    try {
      const r = await fetch("/api/roots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "system" })
      });
      const j = await readJsonSafe(r);
      if (j.ok) {
        rawTree = j.tree;
        rebuildTree();
        await loadHabits();
        renderCurrentDataViews();
        showToast(`Discovered ${j.stats.projects} repos across ${j.stats.domains} domains`);
      } else {
        showToast(j.error || "System-wide scan failed");
      }
    } catch { showToast("System-wide scan failed"); }
  }

  async function loadDisk({ scope = "home", path = null, refresh = false } = {}) {
    if (!SERVED) { showToast("Start the local server to analyze disk space"); return; }
    diskLoading = true;
    diskError = null;
    storageView.render({ diskData, loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      else params.set("scope", scope);
      if (refresh) params.set("refresh", "1");
      const r = await fetch(`/api/disk?${params.toString()}`, { cache: "no-store" });
      const j = await readJsonSafe(r);
      if (j.ok) {
        diskData = j.disk;
        diskError = null;
      } else {
        diskError = j.error || "Disk scan failed";
      }
    } catch (e) {
      diskError = e.message || "Server unreachable";
    }
    diskLoading = false;
    storageView.render({ diskData, loading: false, error: diskError });
  }

  async function saveDocsConfigClient(payload) {
    if (!SERVED) return;
    try {
      const r = await fetch("/api/docs/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (j.ok) {
        docsConfig = j.docsConfig;
        showToast("Google Docs connection saved");
        renderCurrentDataViews();
      } else {
        showToast(`Config error: ${j.error}`);
      }
    } catch { showToast("Could not save Google Docs connection"); }
  }

  // ── Project-Linked Focus Sprint / Pomodoro Timer ─────────────
  const sprintPill = document.getElementById("sprint-pill");
  const sprintPillLabel = document.getElementById("sprint-pill-label");
  let activeSprint = null;

  function renderSprintPill() {
    if (!sprintPill) return;
    if (!activeSprint) {
      sprintPill.hidden = true;
      return;
    }
    const remSec = Math.max(0, Math.ceil((activeSprint.endMs - Date.now()) / 1000));
    const m = String(Math.floor(remSec / 60)).padStart(2, "0");
    const s = String(remSec % 60).padStart(2, "0");
    sprintPill.hidden = false;
    sprintPillLabel.textContent = `${activeSprint.project} · ${m}:${s}`;
  }

  function startSprint(projectName, minutes = 25) {
    const mins = Math.max(1, Number(minutes) || 25);
    activeSprint = {
      project: projectName || "Deep Focus",
      startMs: Date.now(),
      endMs: Date.now() + mins * 60000,
      targetMinutes: mins
    };
    telemetryBus.pushLocalEvent("LOCK", `Focus sprint started: ${activeSprint.project} (${mins}m)`);
    showToast(`Focus sprint started · ${activeSprint.project} (${mins}m)`);
    renderSprintPill();
  }

  async function finishSprint(completed = true) {
    if (!activeSprint) return;
    const sp = activeSprint;
    activeSprint = null;
    renderSprintPill();
    const elapsedMin = Math.max(1, Math.round((Date.now() - sp.startMs) / 60000));
    if (completed || elapsedMin >= 1) {
      await logManualSession({
        appName: "Focus Sprint",
        windowTitle: `${sp.project} — Focus Sprint (${elapsedMin}m)`,
        durationMinutes: completed ? sp.targetMinutes : elapsedMin
      });
    }
  }

  sprintPill?.addEventListener("click", () => {
    if (!activeSprint) return;
    const elapsedMin = Math.max(1, Math.round((Date.now() - activeSprint.startMs) / 60000));
    if (confirm(`Finish focus sprint on "${activeSprint.project}" and log ${elapsedMin}m to your activity log?`)) {
      finishSprint(false);
    }
  });

  // ── Universal ⌘K Command Palette ─────────────────────────────
  const cmdkBackdrop = document.getElementById("cmdk-backdrop");
  const cmdkInput = document.getElementById("cmdk-input");
  const cmdkList = document.getElementById("cmdk-list");
  const cmdkBtn = document.getElementById("cmdk-btn");
  let cmdkOpen = false;
  let cmdkItems = [];
  let cmdkActiveIdx = 0;

  function buildCmdKCatalog() {
    const actions = [
      { title: "Go to Dashboard", sub: "Workspace command center", cat: "View", run: () => switchView("dashboard") },
      { title: "Go to Orbit HUD", sub: "J.A.R.V.I.S. holographic constellation", cat: "View", run: () => switchView("orbit") },
      { title: "Go to Focus & Telemetry", sub: "Live oscilloscope, terminal & work summaries", cat: "View", run: () => switchView("habits") },
      { title: "Go to Storage & Disk Analyzer", sub: "Heavy files, folder footprint & dev bloat", cat: "View", run: () => switchView("storage") },
      { title: "Scan All Repos System-Wide", sub: "Auto-discover every git repo under ~", cat: "System", run: () => switchToSystemWide() },
      { title: trackerStatus?.running ? "Stop Live Activity Tracker" : "Start Live Activity Tracker", sub: "Foreground window telemetry", cat: "Tracker", run: () => toggleTracker() },
      { title: "Start 25m Focus Sprint", sub: "Auto-logged Pomodoro session", cat: "Focus", run: () => startSprint(allProjectNames()[0] || "Deep Focus", 25) },
      { title: "Save Work Summary (.md)", sub: "Write Daily/Weekly summary to reports/", cat: "Docs", run: () => { switchView("habits"); saveSummaryDoc(habitsView.getRange()); } },
      { title: "Copy Work Summary for Google Docs", sub: "Rich HTML ready to paste into docs.new", cat: "Docs", run: () => copySummaryForGoogleDocs(summaryData) },
      { title: "Send Work Summary to Google Docs", sub: "Publish via connected Google Docs bridge", cat: "Docs", run: () => { switchView("habits"); publishGoogleDocs(habitsView.getRange()); } },
      { title: "Rescan Workspace Folders", sub: "Refresh filesystem & git commits", cat: "System", run: () => rescanWorkspace() },
      { title: "Optical Mode: JARVIS", sub: "Stark cyan & amber hologram", cat: "Optics", run: () => { switchView("orbit"); orbitView.setOpticalMode("jarvis"); } },
      { title: "Optical Mode: NVG", sub: "Night-vision phosphor green", cat: "Optics", run: () => { switchView("orbit"); orbitView.setOpticalMode("nvg"); } },
      { title: "Optical Mode: FLIR", sub: "Thermal infrared spectrum", cat: "Optics", run: () => { switchView("orbit"); orbitView.setOpticalMode("flir"); } },
      { title: "Optical Mode: CRT", sub: "Retro amber scanlines", cat: "Optics", run: () => { switchView("orbit"); orbitView.setOpticalMode("crt"); } },
      { title: "Switch Light / Dark Appearance", sub: "Instant theme toggle", cat: "System", run: () => themeBtn.click() }
    ];

    for (const dom of tree?.domains || []) {
      for (const proj of dom.children || []) {
        actions.push({
          title: proj.name,
          sub: `${dom.name} · ${proj.status}${proj.commits ? ` · ${proj.commits} commits` : ""}`,
          cat: "Orbit Branch",
          run: () => {
            switchView("orbit");
            setTimeout(() => orbitView.focusNode(proj._key || proj.key), 50);
          }
        });
      }
    }
    return actions;
  }

  function renderCmdK(query = "") {
    const q = query.trim().toLowerCase();
    const all = buildCmdKCatalog();
    cmdkItems = q
      ? all.filter((i) => `${i.title} ${i.sub} ${i.cat}`.toLowerCase().includes(q)).slice(0, 14)
      : all.slice(0, 14);
    cmdkActiveIdx = Math.min(cmdkActiveIdx, Math.max(0, cmdkItems.length - 1));

    if (!cmdkItems.length) {
      cmdkList.innerHTML = `<div style="padding:18px;text-align:center;color:var(--apple-color-label-2);font-size:13px">No matching commands or projects.</div>`;
      return;
    }

    cmdkList.innerHTML = cmdkItems.map((item, idx) => `
      <button type="button" class="cmdk-item ${idx === cmdkActiveIdx ? "active" : ""}" data-cmdk-idx="${idx}" role="option" aria-selected="${idx === cmdkActiveIdx}">
        <div>
          <div class="cmdk-item-title">${esc(item.title)}</div>
          <div class="cmdk-item-sub">${esc(item.sub)}</div>
        </div>
        <span class="cmdk-item-cat">${esc(item.cat)}</span>
      </button>
    `).join("");

    cmdkList.querySelectorAll("[data-cmdk-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.cmdkIdx);
        const target = cmdkItems[idx];
        closeCmdK();
        target?.run();
      });
    });
  }

  function openCmdK() {
    cmdkOpen = true;
    cmdkActiveIdx = 0;
    cmdkBackdrop.classList.add("on");
    cmdkBackdrop.setAttribute("aria-hidden", "false");
    cmdkInput.value = "";
    renderCmdK("");
    setTimeout(() => cmdkInput.focus(), 20);
  }

  function closeCmdK() {
    cmdkOpen = false;
    cmdkBackdrop.classList.remove("on");
    cmdkBackdrop.setAttribute("aria-hidden", "true");
  }

  cmdkBtn?.addEventListener("click", openCmdK);
  cmdkBackdrop?.addEventListener("click", (e) => { if (e.target === cmdkBackdrop) closeCmdK(); });
  cmdkInput?.addEventListener("input", () => { cmdkActiveIdx = 0; renderCmdK(cmdkInput.value); });
  cmdkInput?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cmdkActiveIdx = (cmdkActiveIdx + 1) % Math.max(1, cmdkItems.length);
      renderCmdK(cmdkInput.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cmdkActiveIdx = (cmdkActiveIdx - 1 + Math.max(1, cmdkItems.length)) % Math.max(1, cmdkItems.length);
      renderCmdK(cmdkInput.value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = cmdkItems[cmdkActiveIdx];
      closeCmdK();
      target?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCmdK();
    }
  });

  async function rescanWorkspace() {
    if (!SERVED) { showToast("Rescan requires the local server"); return; }
    rescanBtn.disabled = true;
    try {
      const r = await fetch("/api/rescan", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        rawTree = j.tree;
        rebuildTree();
        await loadHabits();
        renderCurrentDataViews();
        showToast(`Scanned ${j.stats.projects} projects across ${j.stats.domains} domains`);
      }
    } catch { showToast("Rescan failed"); }
    rescanBtn.disabled = false;
  }

  function rebuildTree() {
    tree = mergeOverrides(rawTree, overrides);
    titleEl.textContent = (tree.title || "PandaOrbit").replace(/^PandaOrbit\s*·\s*/i, "");
    document.title = tree.title || "PandaOrbit";
    orbitView.mount(tree);
  }

  // Optical mode switcher buttons in Orbit HUD
  document.querySelectorAll("[data-optical-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      orbitView.setOpticalMode(btn.dataset.opticalBtn);
      syncLiveWidgets();
    });
  });

  // Collapsible live telemetry dock in Orbit HUD
  orbitDockToggle?.addEventListener("click", () => {
    const collapsed = orbitDock.classList.toggle("collapsed");
    orbitDockToggle.textContent = collapsed ? "Show" : "Hide";
    orbitDockToggle.setAttribute("aria-expanded", String(!collapsed));
    if (!collapsed) syncLiveWidgets();
  });

  tabs.forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  document.getElementById("brand-home").addEventListener("click", () => switchView("dashboard"));
  trackerPill.addEventListener("click", () => toggleTracker());
  rescanBtn.addEventListener("click", () => rescanWorkspace());

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (cmdkOpen) closeCmdK();
      else openCmdK();
      return;
    }
    if (cmdkOpen) {
      if (e.key === "Escape") closeCmdK();
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }
    if (e.key === "1") switchView("dashboard");
    else if (e.key === "2") switchView("orbit");
    else if (e.key === "3") switchView("habits");
    else if (e.key === "4") switchView("storage");
    else if (e.key === "Escape") {
      if (activeView === "orbit" && orbitView.isExpanded()) orbitView.collapseBranch(true);
      else showInspector(null);
    } else if (e.key === "Enter" && selectedNode?.path && panel.classList.contains("on")) {
      openFolder(selectedNode.path, panel.querySelector(".open"));
    } else if (e.key === " " && activeView === "orbit") {
      e.preventDefault();
      orbitView.togglePause();
    }
  });

  // Boot
  await loadOverrides();
  rebuildTree();
  await loadHabits("today");
  telemetryBus.connect();
  renderCurrentDataViews();

  const hashView = location.hash.replace(/^#/, "");
  switchView(["dashboard", "orbit", "habits", "storage"].includes(hashView) ? hashView : (tree.defaultView || "dashboard"));

  // Gentle 1Hz HUD clock, live focus sprint countdown & oscilloscope loop
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  setInterval(() => {
    if (hudClock) hudClock.textContent = fmtClock();
    if (activeSprint) {
      if (Date.now() >= activeSprint.endMs) finishSprint(true);
      else renderSprintPill();
    }
    if (activeView === "habits") {
      const canvas = document.querySelector("#habit-signal-canvas");
      if (canvas) drawSignalGraph(canvas, telemetryBus.state, { mode: "jarvis" });
    } else if (activeView === "orbit" && orbitSignalCanvas && !orbitDock?.classList.contains("collapsed")) {
      drawSignalGraph(orbitSignalCanvas, telemetryBus.state, { mode: orbitView.getOpticalMode() });
    }
  }, reducedMotion ? 1000 : 120);
})();
