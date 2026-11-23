// ─────────────────────────────────────────────────────────────
//  PandaOrbit — J.A.R.V.I.S. / God's-Eye-View Holographic HUD
//
//  Clicking ANY node expands an in-canvas 360° Stark schematic
//  branch mandala directly on the hologram (no right side panel):
//   - Smooth animated camera fly-in & depth dimming
//   - Live /api/inspect deep directory & file branch unfurling
//   - Click subfolders to drill deeper; click files to open in Finder
//   - Opposite arc displays live Git Commit Telemetry & README plate
//   - Floating bottom holographic command bar for Open, Status Pin,
//     Quick Note, Drill Up, and Collapse (Esc / click backdrop)
//   - Optical modes: JARVIS | NVG | FLIR | CRT
// ─────────────────────────────────────────────────────────────

const NS = "http://www.w3.org/2000/svg";
const el = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
};

const MODES = {
  jarvis: {
    name: "JARVIS",
    bg: "#050a14",
    primary: "#38d9ff",
    secondary: "#0ea5e9",
    active: "#ff9f0a",
    steady: "#7dd3fc",
    dormant: "#3b4c6b",
    grid: "rgba(56, 217, 255, 0.14)",
    sweep: "#38d9ff",
    text: "#e6f6ff",
    textDim: "rgba(186, 230, 253, 0.65)",
    code: "#38d9ff",
    doc: "#30d158",
    config: "#ff9f0a",
    data: "#a855f7"
  },
  nvg: {
    name: "NVG",
    bg: "#030e07",
    primary: "#39ff88",
    secondary: "#16a34a",
    active: "#d9ff66",
    steady: "#4ade80",
    dormant: "#1f5135",
    grid: "rgba(57, 255, 136, 0.16)",
    sweep: "#39ff88",
    text: "#dcfce7",
    textDim: "rgba(134, 239, 172, 0.68)",
    code: "#39ff88",
    doc: "#bef264",
    config: "#86efac",
    data: "#4ade80"
  },
  flir: {
    name: "FLIR",
    bg: "#090414",
    primary: "#f97316",
    secondary: "#a855f7",
    active: "#fef08a",
    steady: "#e879f9",
    dormant: "#4c1d95",
    grid: "rgba(249, 115, 22, 0.16)",
    sweep: "#f97316",
    text: "#fff7ed",
    textDim: "rgba(254, 215, 170, 0.70)",
    code: "#fb923c",
    doc: "#fef08a",
    config: "#e879f9",
    data: "#c084fc"
  },
  crt: {
    name: "CRT",
    bg: "#0b0904",
    primary: "#ffc43d",
    secondary: "#d97706",
    active: "#fff3b0",
    steady: "#fbbf24",
    dormant: "#5c4a24",
    grid: "rgba(255, 196, 61, 0.15)",
    sweep: "#ffc43d",
    text: "#fef3c7",
    textDim: "rgba(253, 230, 138, 0.68)",
    code: "#ffc43d",
    doc: "#fef08a",
    config: "#fb923c",
    data: "#f59e0b"
  }
};

function fmtBytes(b) {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function trunc(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

function hexPath(cx, cy, r) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 6;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

export function createOrbitView({
  pane,
  svg,
  controls,
  readouts,
  branchBar,
  filePreview,
  onOpenFolder,
  onSaveOverride,
  onStartSprint,
  getProjectTime
}) {
  let state = null;
  let visible = false;
  let rafId = null;
  let camAnimId = null;
  let opticalMode = "jarvis";
  let liveTrackedProject = null;
  let lastTree = null;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  const palette = () => MODES[opticalMode] || MODES.jarvis;

  function statusColor(n) {
    const p = palette();
    if (n.status === "active") return p.active;
    if (n.status === "steady") return p.steady;
    return p.dormant;
  }

  function destroySvg() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (camAnimId) { cancelAnimationFrame(camAnimId); camAnimId = null; }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function updateReadouts() {
    if (!state || !readouts) return;
    const cam = state.getCamera();
    if (readouts.zoom) readouts.zoom.textContent = `${(cam.k * 100).toFixed(0)}%`;
    if (readouts.az) readouts.az.textContent = `${((state.turn % 360 + 360) % 360).toFixed(1).padStart(5, "0")}°`;
    if (readouts.active) readouts.active.textContent = `${state.activeCount}/${state.projectCount}`;
    const targetName = state.expanded?.currentLabel || state.lockedNode?.name || "SCANNING";
    if (readouts.target) readouts.target.textContent = targetName;
    if (readouts.mode) readouts.mode.textContent = palette().name;
  }

  function worldPosOf(n) {
    const rad = ((state?.turn || 0) * Math.PI) / 180;
    return {
      x: n._x * Math.cos(rad) - n._y * Math.sin(rad),
      y: n._x * Math.sin(rad) + n._y * Math.cos(rad)
    };
  }

  function animateCameraTo(targetPanX, targetPanY, targetK, ms = 420) {
    if (!state) return;
    if (camAnimId) { cancelAnimationFrame(camAnimId); camAnimId = null; }
    if (reducedMotion || ms <= 0) {
      state.setCamera(targetPanX, targetPanY, targetK);
      return;
    }
    const start = state.getCamera();
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / ms);
      const ease = 1 - Math.pow(1 - t, 3);
      state.setCamera(
        start.panX + (targetPanX - start.panX) * ease,
        start.panY + (targetPanY - start.panY) * ease,
        start.k + (targetK - start.k) * ease
      );
      if (t < 1) camAnimId = requestAnimationFrame(step);
      else camAnimId = null;
    }
    camAnimId = requestAnimationFrame(step);
  }

  // ── Bottom Holographic Branch Action Bar (No side drawer!) ──
  function renderBranchBar() {
    if (!branchBar) return;
    const exp = state?.expanded;
    if (!exp) {
      branchBar.classList.remove("on");
      branchBar.setAttribute("aria-hidden", "true");
      branchBar.innerHTML = "";
      return;
    }

    const node = exp.node;
    const isSub = exp.stack.length > 1;
    const activePath = exp.stack[exp.stack.length - 1]?.path || node.path;
    const crumbs = exp.stack.map((s) => s.name).join(" › ");

    const statusBtns = node._key
      ? `<div class="hb-status-group" role="group" aria-label="Pin status">
          ${["auto", "active", "steady", "dormant"].map((v) => {
            const sel = node.pinned ? v === node.status : v === "auto";
            return `<button type="button" class="hb-pill ${sel ? "sel" : ""}" data-hb-status="${v}" aria-pressed="${sel}">${v.toUpperCase()}</button>`;
          }).join("")}
        </div>`
      : "";

    const notePanel = exp.showNote && node._key
      ? `<div class="hb-note-pop">
          <textarea id="hb-note-ta" class="hb-note-ta" placeholder="Holographic field note (saved to overrides.json)…">${(node.mine || "").replace(/</g, "&lt;")}</textarea>
          <button type="button" id="hb-note-save" class="hb-btn hb-btn-primary">Save Note</button>
        </div>`
      : "";

    branchBar.innerHTML = `
      ${notePanel}
      <div class="hb-bar-row">
        <div class="hb-crumbs">
          ${isSub ? `<button type="button" class="hb-btn" id="hb-up">← Up</button>` : ""}
          <span class="hb-crumb-txt" title="${activePath || ""}">${crumbs}</span>
        </div>
        ${statusBtns}
        <div class="hb-actions">
          ${!node._isHub ? `<button type="button" class="hb-btn" id="hb-sprint" title="Start a 25-minute focus sprint linked to this project">Focus 25m</button>` : ""}
          ${node._key ? `<button type="button" class="hb-btn" id="hb-note-toggle">${exp.showNote ? "Hide Note" : "Note"}</button>` : ""}
          ${activePath ? `<button type="button" class="hb-btn hb-btn-primary" id="hb-open">Open Folder</button>` : ""}
          <button type="button" class="hb-btn" id="hb-collapse" title="Collapse branch (Esc)">✕ Collapse</button>
        </div>
      </div>
    `;
    branchBar.classList.add("on");
    branchBar.setAttribute("aria-hidden", "false");

    branchBar.querySelector("#hb-collapse")?.addEventListener("click", () => collapseBranch(true));
    branchBar.querySelector("#hb-open")?.addEventListener("click", () => onOpenFolder(activePath));
    branchBar.querySelector("#hb-up")?.addEventListener("click", () => drillUp());
    branchBar.querySelector("#hb-sprint")?.addEventListener("click", () => onStartSprint?.(node.name, 25));

    branchBar.querySelector("#hb-note-toggle")?.addEventListener("click", () => {
      exp.showNote = !exp.showNote;
      renderBranchBar();
      if (exp.showNote) branchBar.querySelector("#hb-note-ta")?.focus();
    });

    branchBar.querySelector("#hb-note-save")?.addEventListener("click", async () => {
      const val = branchBar.querySelector("#hb-note-ta")?.value.trim() || "";
      node.mine = val || undefined;
      await onSaveOverride?.(node, { note: val || null });
      exp.showNote = false;
      renderBranchBar();
      renderExpandedMandala();
    });

    branchBar.querySelectorAll("[data-hb-status]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const v = btn.dataset.hbStatus, auto = v === "auto";
        node.pinned = !auto;
        node.status = auto ? node._auto : v;
        recolourNode(node);
        await onSaveOverride?.(node, { status: auto ? null : v });
        renderBranchBar();
        renderExpandedMandala();
      });
    });
  }

  function closeFilePreview() {
    if (!filePreview) return;
    filePreview.classList.remove("on");
    filePreview.setAttribute("aria-hidden", "true");
    filePreview.innerHTML = "";
  }

  async function openFilePreview(filePath, fileName) {
    if (!filePreview) { onOpenFolder(filePath); return; }
    const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    filePreview.innerHTML = `
      <div class="fp-head">
        <span class="fp-title">${escHtml(fileName)}</span>
        <button type="button" class="hb-btn" id="fp-close">✕</button>
      </div>
      <div class="fp-body"><span style="opacity:.65">Loading holographic preview…</span></div>
    `;
    filePreview.classList.add("on");
    filePreview.setAttribute("aria-hidden", "false");
    filePreview.querySelector("#fp-close")?.addEventListener("click", closeFilePreview);

    try {
      const r = await fetch(`/api/preview?path=${encodeURIComponent(filePath)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Cannot preview");
      const contentHtml = j.binary
        ? `<div class="fp-empty">Binary file (${fmtBytes(j.size)}). Click Open in Finder to launch it.</div>`
        : `<pre class="fp-code">${escHtml(j.content || "")}${j.truncated ? "\n\n… (truncated at 10 KB)" : ""}</pre>`;
      filePreview.innerHTML = `
        <div class="fp-head">
          <div>
            <span class="fp-title">${escHtml(j.name)}</span>
            <span class="fp-meta">${fmtBytes(j.size)}</span>
          </div>
          <div class="fp-actions">
            <button type="button" class="hb-btn hb-btn-primary" id="fp-open">Open in Finder</button>
            <button type="button" class="hb-btn" id="fp-close">✕</button>
          </div>
        </div>
        <div class="fp-body">${contentHtml}</div>
      `;
      filePreview.querySelector("#fp-close")?.addEventListener("click", closeFilePreview);
      filePreview.querySelector("#fp-open")?.addEventListener("click", () => onOpenFolder(j.path));
    } catch (e) {
      filePreview.querySelector(".fp-body").innerHTML = `<div class="fp-empty">Preview unavailable: ${escHtml(e.message)}</div>`;
    }
  }

  function collapseBranch(refit = false) {
    if (!state) return;
    closeFilePreview();
    state.expanded = null;
    if (state.gBranch) while (state.gBranch.firstChild) state.gBranch.removeChild(state.gBranch.firstChild);
    if (state.wheel) state.wheel.setAttribute("opacity", "1");
    if (state.gCore) state.gCore.setAttribute("opacity", "1");
    if (state.setReticle) state.setReticle(null);
    renderBranchBar();
    updateReadouts();
    if (refit) {
      const cam = state.getFitCamera();
      animateCameraTo(0, 0, cam.k, 420);
    }
  }

  async function fetchInspection(dirPath) {
    if (!dirPath) return null;
    try {
      const r = await fetch(`/api/inspect?path=${encodeURIComponent(dirPath)}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      return j.ok ? j.detail : null;
    } catch {
      return null;
    }
  }

  async function drillInto(dirPath, dirName) {
    if (!state?.expanded) return;
    const exp = state.expanded;
    exp.loading = true;
    exp.stack.push({ name: dirName, path: dirPath });
    exp.currentLabel = dirName;
    renderBranchBar();
    renderExpandedMandala();
    const detail = await fetchInspection(dirPath);
    if (state.expanded !== exp) return;
    exp.detail = detail;
    exp.loading = false;
    renderExpandedMandala();
    updateReadouts();
  }

  async function drillUp() {
    if (!state?.expanded || state.expanded.stack.length <= 1) return;
    const exp = state.expanded;
    exp.stack.pop();
    const top = exp.stack[exp.stack.length - 1];
    exp.currentLabel = top.name;
    exp.loading = true;
    renderBranchBar();
    renderExpandedMandala();
    const detail = await fetchInspection(top.path);
    if (state.expanded !== exp) return;
    exp.detail = detail;
    exp.loading = false;
    renderExpandedMandala();
    updateReadouts();
  }

  async function expandNode(n) {
    if (!state || !n) return;
    const pos = worldPosOf(n);
    const exp = {
      node: n,
      wx: pos.x,
      wy: pos.y,
      currentLabel: n.name,
      stack: [{ name: n.name, path: n.path || null }],
      detail: null,
      loading: !n._isHub && Boolean(n.path),
      showNote: false
    };
    state.expanded = exp;
    state.lockedNode = n;

    // Dim surrounding constellation so the expanded hologram commands focus
    state.wheel.setAttribute("opacity", "0.14");
    state.gCore.setAttribute("opacity", "0.18");
    state.setReticle(null);

    // Smooth camera fly-in centered on the expanded branch mandala
    const cam = state.getCamera();
    const heroK = Math.min(1.32, Math.max(0.88, Math.min(cam.W, cam.H) / 680));
    animateCameraTo(-pos.x * heroK, -pos.y * heroK - 14, heroK, 440);

    renderBranchBar();
    renderExpandedMandala();
    updateReadouts();

    if (!n._isHub && n.path) {
      const detail = await fetchInspection(n.path);
      if (state.expanded !== exp) return;
      exp.detail = detail;
      exp.loading = false;
      renderExpandedMandala();
    }
  }

  // ── Renders the 360° JARVIS Schematic Mandala on Canvas ─────
  function renderExpandedMandala() {
    if (!state?.gBranch) return;
    const g = state.gBranch;
    while (g.firstChild) g.removeChild(g.firstChild);

    const exp = state.expanded;
    if (!exp) return;

    const p = palette();
    const n = exp.node;
    const wrap = el("g", {
      transform: `translate(${exp.wx.toFixed(1)},${exp.wy.toFixed(1)})`,
      class: "jarvis-branch-root"
    });
    g.appendChild(wrap);

    // Holographic backdrop aura & concentric schematic rings
    wrap.appendChild(el("circle", { cx: 0, cy: 0, r: 280, fill: p.bg, "fill-opacity": 0.72 }));
    wrap.appendChild(el("circle", { cx: 0, cy: 0, r: 265, fill: "none", stroke: p.primary, "stroke-width": 1, "stroke-opacity": 0.24, "stroke-dasharray": "6 6" }));
    wrap.appendChild(el("circle", { cx: 0, cy: 0, r: 175, fill: "none", stroke: p.primary, "stroke-width": 0.9, "stroke-opacity": 0.22 }));
    wrap.appendChild(el("circle", { cx: 0, cy: 0, r: 92, fill: "none", stroke: p.active, "stroke-width": 1.1, "stroke-opacity": 0.35, "stroke-dasharray": "12 8" }));

    // Rotating outer schematic bezel rings (animated in main loop)
    const expRing1 = el("circle", {
      cx: 0, cy: 0, r: 70, fill: "none", stroke: p.primary,
      "stroke-width": 1.6, "stroke-dasharray": "24 10 4 10", "stroke-opacity": 0.85
    });
    const expRing2 = el("circle", {
      cx: 0, cy: 0, r: 58, fill: "none", stroke: p.active,
      "stroke-width": 1.2, "stroke-dasharray": "10 12", "stroke-opacity": 0.75
    });
    wrap.appendChild(expRing1);
    wrap.appendChild(expRing2);
    state.expRings = [expRing1, expRing2];

    // ── DOMAIN HUB EXPANSION: Fan out all projects in this domain ──
    if (n._isHub) {
      const kids = n.children || [];
      const radius = kids.length > 10 ? 210 : 180;
      kids.forEach((proj, idx) => {
        const ang = -Math.PI / 2 + (idx / Math.max(1, kids.length)) * Math.PI * 2;
        const x = Math.cos(ang) * radius, y = Math.sin(ang) * radius;
        const mx = Math.cos(ang) * 74, my = Math.sin(ang) * 74;
        const col = statusColor(proj);

        wrap.appendChild(el("line", {
          x1: mx.toFixed(1), y1: my.toFixed(1), x2: x.toFixed(1), y2: y.toFixed(1),
          stroke: col, "stroke-width": proj.status === "active" ? 1.4 : 0.9, "stroke-opacity": 0.65
        }));

        const ng = el("g", { class: "branch-item", style: "cursor:pointer" });
        ng.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 10, fill: p.bg, stroke: col, "stroke-width": 1.6, filter: "url(#holo-glow)" }));
        ng.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.5, fill: col }));

        const onLeft = Math.cos(ang) < -0.15;
        const lx = x + (onLeft ? -16 : 16);
        const t = el("text", {
          x: lx.toFixed(1), y: (y + 3.5).toFixed(1),
          "text-anchor": onLeft ? "end" : "start",
          fill: p.text, "font-size": "12", "font-weight": "600",
          "font-family": "-apple-system, BlinkMacSystemFont, sans-serif",
          "paint-order": "stroke", stroke: p.bg, "stroke-width": "4"
        });
        t.textContent = proj.name;
        ng.appendChild(t);

        const sub = el("text", {
          x: lx.toFixed(1), y: (y + 16).toFixed(1),
          "text-anchor": onLeft ? "end" : "start",
          fill: p.textDim, "font-size": "9.5",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
        });
        sub.textContent = `${proj.status.toUpperCase()}${proj.commits ? ` · ${proj.commits}c` : ""}`;
        ng.appendChild(sub);

        ng.addEventListener("click", (e) => {
          e.stopPropagation();
          expandNode(proj);
        });
        wrap.appendChild(ng);
      });

      // Center domain emblem
      const centerG = el("g", { style: "cursor:pointer" });
      centerG.appendChild(el("path", { d: hexPath(0, 0, 48), fill: p.bg, stroke: p.primary, "stroke-width": 1.8, filter: "url(#holo-glow)" }));
      const dt = el("text", { x: 0, y: -4, "text-anchor": "middle", fill: p.primary, "font-size": "11", "font-weight": "700", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace" });
      dt.textContent = trunc(n.name, 14);
      const dc = el("text", { x: 0, y: 14, "text-anchor": "middle", fill: p.textDim, "font-size": "9.5", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace" });
      dc.textContent = `${kids.length} PROJECTS`;
      centerG.appendChild(dt);
      centerG.appendChild(dc);
      centerG.addEventListener("click", (e) => { e.stopPropagation(); collapseBranch(true); });
      wrap.appendChild(centerG);
      return;
    }

    // ── PROJECT / SUBFOLDER EXPANSION ──────────────────────────
    const detail = exp.detail;
    const dirs = detail?.dirs || (exp.stack.length === 1 ? (n.children || []).map((c) => ({ name: c.rawName || c.name, path: c.path, childCount: 0 })) : []);
    const files = detail?.files || [];
    const commits = detail?.git?.commits || [];
    const pt = getProjectTime?.(n.name);

    // 1. RIGHT HEMISPHERE — Subfolder Branches (Upper-Right) & File Nodes (Lower-Right)
    const dirHeader = el("text", {
      x: 130, y: -195, fill: p.primary, "font-size": "9.5", "font-weight": "700",
      "letter-spacing": "0.16em", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
    });
    dirHeader.textContent = exp.loading
      ? "SCANNING TREE…"
      : `BRANCHES [${detail?.totalDirs ?? dirs.length} DIRS · ${detail?.totalFiles ?? files.length} FILES]`;
    wrap.appendChild(dirHeader);

    const rightItems = [
      ...dirs.slice(0, 8).map((d) => ({ type: "dir", ...d })),
      ...files.slice(0, Math.max(4, 14 - Math.min(8, dirs.length))).map((f) => ({ type: "file", ...f }))
    ];

    const rCount = rightItems.length;
    rightItems.forEach((item, idx) => {
      const spanRad = Math.min(Math.PI * 0.86, Math.max(0.45, rCount * 0.16));
      const ang = rCount === 1 ? 0 : -spanRad / 2 + (idx / (rCount - 1)) * spanRad;
      const isDir = item.type === "dir";
      const radius = isDir ? 182 : 212;
      const x = Math.cos(ang) * radius, y = Math.sin(ang) * radius;
      const sx = Math.cos(ang) * 62, sy = Math.sin(ang) * 62;
      const midR = 118;
      const mx = Math.cos(ang) * midR, my = Math.sin(ang) * midR;
      const col = isDir ? p.active : (p[item.kind] || p.primary);

      // Angled Stark schematic tether
      wrap.appendChild(el("path", {
        d: `M ${sx.toFixed(1)},${sy.toFixed(1)} L ${mx.toFixed(1)},${my.toFixed(1)} L ${x.toFixed(1)},${y.toFixed(1)}`,
        fill: "none", stroke: col, "stroke-width": isDir ? 1.3 : 0.85, "stroke-opacity": isDir ? 0.72 : 0.45
      }));

      const ig = el("g", { class: "branch-item", style: "cursor:pointer" });
      if (isDir) {
        ig.appendChild(el("path", {
          d: hexPath(x, y, 10),
          fill: p.bg, stroke: col, "stroke-width": 1.5, filter: "url(#holo-glow)"
        }));
        ig.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.5, fill: col }));
      } else {
        ig.appendChild(el("circle", {
          cx: x.toFixed(1), cy: y.toFixed(1), r: 5.5,
          fill: p.bg, stroke: col, "stroke-width": 1.3
        }));
        ig.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2, fill: col }));
      }

      // Leader stub + crisp horizontal callout
      const lx = x + 15;
      const lbl = el("text", {
        x: lx.toFixed(1), y: (y + 3.5).toFixed(1),
        fill: isDir ? p.text : p.textDim,
        "font-size": isDir ? "11.5" : "10.5",
        "font-weight": isDir ? "600" : "400",
        "font-family": isDir ? "-apple-system, BlinkMacSystemFont, sans-serif" : "ui-monospace, SFMono-Regular, Menlo, monospace",
        "paint-order": "stroke", stroke: p.bg, "stroke-width": "3.5"
      });
      lbl.textContent = isDir
        ? `${trunc(item.name, 22)}/${item.childCount ? ` (${item.childCount})` : ""}`
        : `${trunc(item.name, 24)} · ${fmtBytes(item.size)}`;
      ig.appendChild(lbl);

      ig.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isDir) { closeFilePreview(); drillInto(item.path, item.name); }
        else openFilePreview(item.path, item.name);
      });
      wrap.appendChild(ig);
    });

    // 2. LEFT HEMISPHERE — Git Commit Timeline Arc (Lower-Left) & README / Intel Plate (Upper-Left)
    const gitHeader = el("text", {
      x: -130, y: -195, "text-anchor": "end", fill: p.primary, "font-size": "9.5", "font-weight": "700",
      "letter-spacing": "0.16em", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
    });
    const gitBranch = detail?.git?.branch || n.branch;
    const dirty = detail?.git?.dirtyCount || 0;
    gitHeader.textContent = gitBranch
      ? `GIT // ${gitBranch.toUpperCase()}${dirty ? ` · ${dirty} MOD` : " · CLEAN"}`
      : "INTEL // TELEMETRY";
    wrap.appendChild(gitHeader);

    // Git Commit Nodes along Left Arc
    if (commits.length) {
      const cSpan = Math.min(Math.PI * 0.56, Math.max(0.35, commits.length * 0.17));
      commits.forEach((c, idx) => {
        const ang = Math.PI - cSpan / 2 + (commits.length === 1 ? cSpan / 2 : (idx / (commits.length - 1)) * cSpan);
        const radius = 186;
        const x = Math.cos(ang) * radius, y = Math.sin(ang) * radius;
        const sx = Math.cos(ang) * 62, sy = Math.sin(ang) * 62;

        wrap.appendChild(el("line", {
          x1: sx.toFixed(1), y1: sy.toFixed(1), x2: x.toFixed(1), y2: y.toFixed(1),
          stroke: p.secondary, "stroke-width": 1, "stroke-opacity": 0.48, "stroke-dasharray": "3 3"
        }));
        wrap.appendChild(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.5, fill: p.primary, filter: "url(#holo-glow)" }));

        const t1 = el("text", {
          x: (x - 13).toFixed(1), y: (y + 1).toFixed(1), "text-anchor": "end",
          fill: p.text, "font-size": "10.5", "font-weight": "600",
          "font-family": "-apple-system, BlinkMacSystemFont, sans-serif",
          "paint-order": "stroke", stroke: p.bg, "stroke-width": "3.5"
        });
        t1.textContent = trunc(c.subject, 34);
        const t2 = el("text", {
          x: (x - 13).toFixed(1), y: (y + 13).toFixed(1), "text-anchor": "end",
          fill: p.textDim, "font-size": "9",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
        });
        t2.textContent = `${c.hash} · ${c.relDate}`;
        wrap.appendChild(t1);
        wrap.appendChild(t2);
      });
    } else if (!exp.loading) {
      const noGit = el("text", {
        x: -140, y: 8, "text-anchor": "end", fill: p.textDim, "font-size": "10.5",
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
      });
      noGit.textContent = "No git history in this directory";
      wrap.appendChild(noGit);
    }

    // Top Holographic Intel Plate (README + Personal Note + Habit Focus)
    const intelText = n.mine || detail?.readme || n.tagline || "";
    if (intelText || pt) {
      const plateY = -148;
      wrap.appendChild(el("line", {
        x1: 0, y1: -58, x2: 0, y2: plateY + 26,
        stroke: p.primary, "stroke-width": 1, "stroke-opacity": 0.55
      }));
      wrap.appendChild(el("rect", {
        x: -185, y: plateY - 22, width: 370, height: 48, rx: 8,
        fill: p.bg, "fill-opacity": 0.88, stroke: p.primary, "stroke-width": 1, "stroke-opacity": 0.45
      }));
      const line1 = el("text", {
        x: 0, y: plateY - 4, "text-anchor": "middle",
        fill: p.text, "font-size": "10.5",
        "font-family": "-apple-system, BlinkMacSystemFont, sans-serif"
      });
      line1.textContent = trunc(intelText || "Active workspace project", 58);
      const line2 = el("text", {
        x: 0, y: plateY + 14, "text-anchor": "middle",
        fill: p.active, "font-size": "9.5", "font-weight": "600",
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
      });
      const statsBits = [
        `${(n.status || "dormant").toUpperCase()}${n.pinned ? " · PINNED" : ""}`,
        detail?.git?.totalCommits ? `${detail.git.totalCommits} COMMITS` : (n.commits ? `${n.commits} COMMITS` : null),
        pt ? `${Math.round(pt.minutes7d)}M FOCUS (7D)` : null
      ].filter(Boolean);
      line2.textContent = statsBits.join("  ·  ");
      wrap.appendChild(line1);
      wrap.appendChild(line2);
    }

    // 3. CENTER HERO CORE NODE
    const col = statusColor(n);
    const coreG = el("g", { style: "cursor:pointer" });
    coreG.appendChild(el("path", {
      d: hexPath(0, 0, 50),
      fill: p.bg, stroke: col, "stroke-width": 2.2, filter: "url(#holo-glow)"
    }));
    coreG.appendChild(el("path", {
      d: hexPath(0, 0, 41),
      fill: col, "fill-opacity": 0.12, stroke: col, "stroke-width": 0.8, "stroke-opacity": 0.55
    }));
    const ct1 = el("text", {
      x: 0, y: -4, "text-anchor": "middle", fill: p.text, "font-size": "12", "font-weight": "700",
      "font-family": "-apple-system, BlinkMacSystemFont, sans-serif"
    });
    ct1.textContent = trunc(exp.currentLabel, 15);
    const ct2 = el("text", {
      x: 0, y: 12, "text-anchor": "middle", fill: col, "font-size": "8.8", "font-weight": "700",
      "letter-spacing": "0.1em", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
    });
    ct2.textContent = exp.stack.length > 1 ? "SUBFOLDER" : (n.status || "NODE").toUpperCase();
    const ct3 = el("text", {
      x: 0, y: 24, "text-anchor": "middle", fill: p.textDim, "font-size": "7.8",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
    });
    ct3.textContent = "CLICK TO OPEN";
    coreG.appendChild(ct1);
    coreG.appendChild(ct2);
    coreG.appendChild(ct3);

    coreG.addEventListener("click", (e) => {
      e.stopPropagation();
      const topPath = exp.stack[exp.stack.length - 1]?.path || n.path;
      if (topPath) onOpenFolder(topPath);
    });
    wrap.appendChild(coreG);
  }

  // ── Mount Full Constellation ────────────────────────────────
  function mount(tree) {
    lastTree = tree;
    const prevExpandedKey = state?.expanded?.node?._key || state?.expanded?.node?.key || null;
    destroySvg();

    const p = palette();
    const D = tree.domains || [];
    const N = D.length;
    if (!N) return;

    const totalProjects = D.reduce((s, d) => s + (d.children?.length || 0), 0);
    const activeCount = D.reduce((s, d) => s + (d.children || []).filter((c) => c.status === "active").length, 0);

    const CORE_R = 104;
    const HUB_R = 178;
    const BASE_PROJ_R = totalProjects > 24 ? 275 : 255;
    const BAND_STEP = 66;

    const GAP = N > 1 ? 0.12 : 0.04;
    const weights = D.map((d) => Math.max(1.5, d.children?.length || 1));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const spans = weights.map((w) => (w / totalW) * Math.PI * 2 * (1 - GAP));
    const gutter = (Math.PI * 2 * GAP) / N;

    const nodes = [];
    const links = [];
    const parents = new Map();
    let maxRadius = BASE_PROJ_R + 60;

    let edge = -Math.PI / 2 - spans[0] / 2 - gutter / 2;

    D.forEach((dom) => {
      const span = spans[D.indexOf(dom)];
      edge += gutter;
      const startA = edge;
      const endA = edge + span;
      edge = endA;

      const kids = dom.children || [];
      const midA = (startA + endA) / 2;
      const arcPerProj = kids.length ? (BASE_PROJ_R * span) / kids.length : 999;
      const bands = arcPerProj < 28 ? 3 : arcPerProj < 54 ? 2 : 1;

      dom._a = midA; dom._r = HUB_R;
      dom._x = Math.cos(midA) * HUB_R; dom._y = Math.sin(midA) * HUB_R;
      dom._startA = startA; dom._endA = endA; dom._span = span;
      dom._depth = 0; dom._dom = dom; dom._isHub = true; dom._hue = dom.hue;
      nodes.push(dom);

      kids.forEach((proj, idx) => {
        const frac = kids.length === 1 ? 0.5 : (idx + 0.5) / kids.length;
        const ang = startA + frac * span;
        const band = idx % bands;
        const r = BASE_PROJ_R + band * BAND_STEP;
        maxRadius = Math.max(maxRadius, r);

        proj._a = ang; proj._r = r;
        proj._x = Math.cos(ang) * r; proj._y = Math.sin(ang) * r;
        proj._depth = 1; proj._band = band; proj._dom = dom;
        nodes.push(proj);
        links.push([dom, proj]);
        parents.set(proj, dom);
      });
    });

    const OUTER_RING_R = maxRadius + 68;
    const SECTOR_LABEL_R = OUTER_RING_R + 34;

    const defs = el("defs");
    defs.innerHTML = `
      <filter id="holo-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.2" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <radialGradient id="core-bg" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${p.primary}" stop-opacity="0.24"/>
        <stop offset="55%" stop-color="${p.primary}" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="${p.primary}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="sweep-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${p.sweep}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${p.sweep}" stop-opacity="0"/>
      </linearGradient>
    `;
    svg.appendChild(defs);

    const root = el("g");
    svg.appendChild(root);

    // Polar holographic grid
    const gGrid = el("g");
    root.appendChild(gGrid);

    let seed = 31;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, r = CORE_R + rnd() * (SECTOR_LABEL_R + 300);
      gGrid.appendChild(el("circle", {
        cx: (Math.cos(a) * r).toFixed(1), cy: (Math.sin(a) * r).toFixed(1),
        r: (rnd() * 0.9 + 0.3).toFixed(2), fill: p.primary, "fill-opacity": (rnd() * 0.24 + 0.05).toFixed(2)
      }));
    }

    [CORE_R, HUB_R, BASE_PROJ_R, BASE_PROJ_R + BAND_STEP, OUTER_RING_R].forEach((r, idx) => {
      if (r > OUTER_RING_R + 5) return;
      gGrid.appendChild(el("circle", {
        cx: 0, cy: 0, r, fill: "none", stroke: p.grid,
        "stroke-width": idx === 4 ? 1.2 : 0.9,
        "stroke-dasharray": idx === 1 ? "4 6" : idx === 2 ? "2 6" : "none"
      }));
    });

    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      gGrid.appendChild(el("line", {
        x1: (Math.cos(rad) * CORE_R).toFixed(1), y1: (Math.sin(rad) * CORE_R).toFixed(1),
        x2: (Math.cos(rad) * OUTER_RING_R).toFixed(1), y2: (Math.sin(rad) * OUTER_RING_R).toFixed(1),
        stroke: p.grid, "stroke-width": deg % 90 === 0 ? 1.0 : 0.55
      }));
      if (deg % 90 === 0) {
        const tx = Math.cos(rad) * (OUTER_RING_R + 14), ty = Math.sin(rad) * (OUTER_RING_R + 14);
        const lbl = el("text", {
          x: tx.toFixed(1), y: (ty + 3.5).toFixed(1), "text-anchor": "middle",
          fill: p.textDim, "font-size": "9.5",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace", "letter-spacing": "0.1em"
        });
        lbl.textContent = `${String((deg + 90) % 360).padStart(3, "0")}°`;
        gGrid.appendChild(lbl);
      }
    }

    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const major = deg % 15 === 0;
      const r0 = OUTER_RING_R - (major ? 8 : 4);
      gGrid.appendChild(el("line", {
        x1: (Math.cos(rad) * r0).toFixed(1), y1: (Math.sin(rad) * r0).toFixed(1),
        x2: (Math.cos(rad) * OUTER_RING_R).toFixed(1), y2: (Math.sin(rad) * OUTER_RING_R).toFixed(1),
        stroke: p.primary, "stroke-opacity": major ? 0.55 : 0.22, "stroke-width": major ? 1.2 : 0.7
      }));
    }

    // Radar sweep
    const sweepG = el("g");
    const coneAngle = 0.42;
    const sx = Math.cos(coneAngle) * OUTER_RING_R, sy = Math.sin(coneAngle) * OUTER_RING_R;
    sweepG.appendChild(el("path", {
      d: `M 0,0 L ${OUTER_RING_R},0 A ${OUTER_RING_R},${OUTER_RING_R} 0 0 1 ${sx.toFixed(1)},${sy.toFixed(1)} Z`,
      fill: "url(#sweep-grad)"
    }));
    sweepG.appendChild(el("line", {
      x1: 0, y1: 0, x2: OUTER_RING_R, y2: 0,
      stroke: p.sweep, "stroke-width": 1.3, "stroke-opacity": 0.65
    }));
    if (!reducedMotion) root.appendChild(sweepG);

    // Constellation wheel
    const wheel = el("g");
    wheel.style.transition = "opacity 320ms cubic-bezier(.2,.8,.2,1)";
    root.appendChild(wheel);

    // Sector arcs
    const gSectors = el("g");
    wheel.appendChild(gSectors);
    D.forEach((dom) => {
      const rIn = HUB_R - 14, rOut = OUTER_RING_R - 10;
      const a0 = dom._startA, a1 = dom._endA;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      gSectors.appendChild(el("path", {
        d: `M ${(Math.cos(a0) * rOut).toFixed(1)},${(Math.sin(a0) * rOut).toFixed(1)} A ${rOut},${rOut} 0 ${large} 1 ${(Math.cos(a1) * rOut).toFixed(1)},${(Math.sin(a1) * rOut).toFixed(1)}`,
        fill: "none", stroke: p.primary, "stroke-width": 2.2, "stroke-opacity": 0.45
      }));
      gSectors.appendChild(el("path", {
        d: `M ${(Math.cos(a0) * rIn).toFixed(1)},${(Math.sin(a0) * rIn).toFixed(1)} A ${rIn},${rIn} 0 ${large} 1 ${(Math.cos(a1) * rIn).toFixed(1)},${(Math.sin(a1) * rIn).toFixed(1)}`,
        fill: "none", stroke: p.primary, "stroke-width": 0.8, "stroke-opacity": 0.24
      }));
    });

    // Links
    const gLinks = el("g");
    wheel.appendChild(gLinks);
    links.forEach(([parent, child]) => {
      const mid = parent._r + (child._r - parent._r) * 0.42;
      const x1 = Math.cos(parent._a) * mid, y1 = Math.sin(parent._a) * mid;
      const x2 = Math.cos(child._a) * mid, y2 = Math.sin(child._a) * mid;
      const d = `M${parent._x.toFixed(1)},${parent._y.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${mid.toFixed(1)},${mid.toFixed(1)} 0 0 ${child._a > parent._a ? 1 : 0} ${x2.toFixed(1)},${y2.toFixed(1)} L${child._x.toFixed(1)},${child._y.toFixed(1)}`;
      const isAct = child.status === "active";
      const path = el("path", {
        d, fill: "none", stroke: isAct ? p.active : p.primary,
        "stroke-width": isAct ? 1.25 : 0.75,
        "stroke-opacity": isAct ? 0.55 : child.status === "steady" ? 0.28 : 0.14
      });
      child._link = path;
      child._len = path.getTotalLength();
      gLinks.appendChild(path);
    });

    // Active telemetry pulses
    const gPulse = el("g");
    wheel.appendChild(gPulse);
    const live = reducedMotion ? [] : links.filter(([, c]) => c.status === "active" && c._link && c._len);
    live.forEach(([, c], i) => {
      const dot = el("circle", { r: 2.5, fill: p.active, filter: "url(#holo-glow)", "fill-opacity": 0.95 });
      gPulse.appendChild(dot);
      c._pulse = { dot, t: -(i * 0.29) % 1, speed: 0.16 + (i % 4) * 0.03 };
    });

    const gNodes = el("g");
    wheel.appendChild(gNodes);
    const gLabels = el("g");
    wheel.appendChild(gLabels);

    const chain = (n) => {
      const out = []; let cur = n;
      while (cur) { out.unshift(cur); cur = parents.get(cur); }
      return out;
    };

    // Hover targeting reticle
    const reticle = el("g", { opacity: 0, "pointer-events": "none" });
    const retOuter = el("circle", { r: 22, fill: "none", stroke: p.primary, "stroke-width": 1.2, "stroke-dasharray": "7 5" });
    const retInner = el("circle", { r: 15, fill: "none", stroke: p.active, "stroke-width": 1.1, "stroke-dasharray": "3 4" });
    const retBrackets = el("path", {
      d: "M -26,-12 L -26,-26 L -12,-26 M 12,-26 L 26,-26 L 26,-12 M 26,12 L 26,26 L 12,26 M -12,26 L -26,26 L -26,12",
      fill: "none", stroke: p.active, "stroke-width": 1.5
    });
    const retTag = el("text", {
      x: 31, y: -14, fill: p.active, "font-size": "9.5",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace", "letter-spacing": "0.08em"
    });
    const retSub = el("text", {
      x: 31, y: -2, fill: p.text, "font-size": "11", "font-weight": "600",
      "font-family": "-apple-system, BlinkMacSystemFont, sans-serif"
    });
    reticle.appendChild(retOuter);
    reticle.appendChild(retInner);
    reticle.appendChild(retBrackets);
    reticle.appendChild(retTag);
    reticle.appendChild(retSub);
    wheel.appendChild(reticle);

    function setReticle(n) {
      if (!n || state?.expanded) {
        reticle.setAttribute("opacity", "0");
        if (state && !state.expanded) state.lockedNode = null;
        updateReadouts();
        return;
      }
      if (state) state.lockedNode = n;
      const deg = ((n._a * 180) / Math.PI + 360) % 360;
      reticle.setAttribute("transform", `translate(${n._x.toFixed(1)},${n._y.toFixed(1)}) rotate(${(-state.turn).toFixed(2)})`);
      retTag.textContent = `CLICK TO EXPAND · AZ ${deg.toFixed(1)}°`;
      retSub.textContent = n.name;
      reticle.setAttribute("opacity", "1");
      updateReadouts();
    }

    function highlight(n, on) {
      chain(n).forEach((c) => {
        if (!c._link) return;
        const isAct = c.status === "active";
        c._link.setAttribute("stroke", on ? p.active : (isAct ? p.active : p.primary));
        c._link.setAttribute("stroke-opacity", on ? "0.95" : (isAct ? "0.55" : c.status === "steady" ? "0.28" : "0.14"));
        c._link.setAttribute("stroke-width", on ? "1.8" : (isAct ? "1.25" : "0.75"));
      });
    }

    nodes.forEach((n) => {
      const g = el("g", { class: "node" });
      n._g = g;
      const col = statusColor(n);

      if (n._isHub) {
        g.appendChild(el("path", { d: hexPath(n._x, n._y, 20), fill: p.bg, stroke: p.primary, "stroke-width": 1.4, filter: "url(#holo-glow)" }));
        g.appendChild(el("path", { d: hexPath(n._x, n._y, 13), fill: p.primary, "fill-opacity": 0.14, stroke: p.primary, "stroke-width": 0.7, "stroke-opacity": 0.65 }));
        const t = el("text", { x: n._x.toFixed(1), y: (n._y + 5).toFixed(1), "text-anchor": "middle", "font-size": "13", fill: p.text });
        t.textContent = n.glyph || "◈";
        g.appendChild(t);
      } else {
        const r = n.status === "active" ? 7.5 : n.status === "steady" ? 5.8 : 4.6;
        const isLiveTracked = liveTrackedProject && n.name.toLowerCase() === liveTrackedProject.toLowerCase();

        if (n.status === "active" || isLiveTracked) {
          const ring = el("circle", {
            cx: n._x.toFixed(1), cy: n._y.toFixed(1), r: r + 5, fill: "none",
            stroke: isLiveTracked ? "#30d158" : col, "stroke-width": isLiveTracked ? 1.6 : 1, "stroke-opacity": 0.65
          });
          if (!reducedMotion) ring.style.animation = `breathe 2.8s ease-in-out ${(n._a * 1.4).toFixed(2)}s infinite`;
          g.appendChild(ring);
        }

        const dot = el("circle", {
          cx: n._x.toFixed(1), cy: n._y.toFixed(1), r,
          fill: n.status === "dormant" ? p.bg : col,
          stroke: col, "stroke-width": n.status === "active" ? 1.8 : 1.3,
          filter: n.status === "active" ? "url(#holo-glow)" : ""
        });
        n._circle = dot;
        g.appendChild(dot);

        if (n.status === "active") {
          g.appendChild(el("circle", { cx: n._x.toFixed(1), cy: n._y.toFixed(1), r: 2.4, fill: "#ffffff" }));
        }

        const pinRing = el("circle", {
          cx: n._x.toFixed(1), cy: n._y.toFixed(1), r: r + 5.5,
          fill: "none", stroke: col, "stroke-width": 1, "stroke-dasharray": "2.5 3",
          "stroke-opacity": n.pinned ? 0.8 : 0
        });
        n._pinRing = pinRing;
        g.appendChild(pinRing);

        const labG = el("g", { transform: `translate(${n._x.toFixed(1)},${n._y.toFixed(1)})`, "pointer-events": "none" });
        const labTxt = el("text", {
          x: 0, y: -(r + 8), "text-anchor": "middle",
          fill: n.status === "active" ? p.text : p.textDim,
          "font-size": n.status === "active" ? "11.5" : "10.5",
          "font-weight": n.status === "active" ? "600" : "400",
          "font-family": "-apple-system, BlinkMacSystemFont, sans-serif",
          "paint-order": "stroke", stroke: p.bg, "stroke-width": "3.5", "stroke-linejoin": "round"
        });
        labTxt.textContent = n.name;
        labG.appendChild(labTxt);
        gLabels.appendChild(labG);
        n._labG = labG;
      }

      g.addEventListener("mouseenter", () => {
        if (state?.expanded) return;
        if (state) state.hoverPaused = true;
        if (n._labG) n._labG.setAttribute("opacity", "1");
        highlight(n, true);
        setReticle(n);
      });
      g.addEventListener("mouseleave", () => {
        if (state?.expanded) return;
        if (state) state.hoverPaused = false;
        if (n._labG) n._labG.setAttribute("opacity", String(labelOpacity(n)));
        highlight(n, false);
        setReticle(null);
      });

      g.__node = n;
      gNodes.appendChild(g);
    });

    // Sector titles
    function arcPath(r, a, half, reversed) {
      const a0 = reversed ? a + half : a - half, a1 = reversed ? a - half : a + half;
      const pt = (t) => `${(Math.cos(t) * r).toFixed(1)},${(Math.sin(t) * r).toFixed(1)}`;
      return `M${pt(a0)} A${r},${r} 0 0 ${reversed ? 0 : 1} ${pt(a1)}`;
    }

    D.forEach((dom, i) => {
      const flip = Math.sin(dom._a) > 0;
      const half = Math.min(0.95, Math.max(0.28, (dom._span / 2) * 0.92));
      const id = `jarvis-sec-${i}`;
      const arc = el("path", { id, d: arcPath(SECTOR_LABEL_R, dom._a, half, flip), fill: "none" });
      defs.appendChild(arc);
      const t = el("text", {
        fill: p.primary, "font-size": "13", "font-weight": "600", "letter-spacing": "0.24em",
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace"
      });
      const tp = el("textPath", { href: `#${id}`, startOffset: "50%", "text-anchor": "middle" });
      tp.textContent = `${dom.name} [${dom.children?.length || 0}]`;
      t.appendChild(tp);
      wheel.appendChild(t);
      dom._arc = { arc, half, flip };
    });

    // Center Arc-Reactor core
    const gCore = el("g", { "pointer-events": "none" });
    gCore.style.transition = "opacity 320ms cubic-bezier(.2,.8,.2,1)";
    root.appendChild(gCore);
    gCore.appendChild(el("circle", { cx: 0, cy: 0, r: CORE_R, fill: "url(#core-bg)" }));
    const coreRing1 = el("circle", { cx: 0, cy: 0, r: 86, fill: "none", stroke: p.primary, "stroke-width": 1.6, "stroke-dasharray": "28 10 6 10", "stroke-opacity": 0.72 });
    const coreRing2 = el("circle", { cx: 0, cy: 0, r: 68, fill: "none", stroke: p.active, "stroke-width": 1.3, "stroke-dasharray": "14 18 4 8", "stroke-opacity": 0.65 });
    const coreRing3 = el("circle", { cx: 0, cy: 0, r: 52, fill: p.bg, "fill-opacity": 0.85, stroke: p.primary, "stroke-width": 1.1, "stroke-opacity": 0.85 });
    gCore.appendChild(coreRing1); gCore.appendChild(coreRing2); gCore.appendChild(coreRing3);

    const coreTitle = el("text", { x: 0, y: -10, "text-anchor": "middle", fill: p.primary, "font-size": "9", "font-weight": "700", "letter-spacing": "0.18em", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace" });
    coreTitle.textContent = "PANDA.ORBIT";
    const coreStat = el("text", { x: 0, y: 12, "text-anchor": "middle", fill: p.text, "font-size": "21", "font-weight": "700", "font-family": "-apple-system, BlinkMacSystemFont, sans-serif", style: "font-variant-numeric:tabular-nums" });
    coreStat.textContent = `${activeCount}/${totalProjects}`;
    const coreSub = el("text", { x: 0, y: 27, "text-anchor": "middle", fill: p.textDim, "font-size": "8.5", "letter-spacing": "0.14em", "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace" });
    coreSub.textContent = "ACTIVE NODES";
    gCore.appendChild(coreTitle); gCore.appendChild(coreStat); gCore.appendChild(coreSub);

    // Expanded Branch Mandala layer (above wheel & core, non-rotating!)
    const gBranch = el("g", { class: "jarvis-branch-layer" });
    root.appendChild(gBranch);

    let panX = 0, panY = 0, k = 1, W = 0, H = 0;

    function labelOpacity(n) {
      if (n._depth !== 1) return 0;
      if (k >= 0.82) return 1;
      if (n.status === "active" && activeCount <= 16) return 0.95;
      if (totalProjects <= 14) return 0.85;
      return 0;
    }

    function applyTransform() {
      root.setAttribute("transform", `translate(${(W / 2 + panX).toFixed(1)},${(H / 2 + panY).toFixed(1)}) scale(${k.toFixed(4)})`);
      nodes.forEach((n) => { if (n._labG) n._labG.setAttribute("opacity", String(labelOpacity(n))); });
      updateReadouts();
    }

    function getFitCamera() {
      const w = svg.clientWidth || window.innerWidth;
      const h = svg.clientHeight || (window.innerHeight - 56);
      const extent = SECTOR_LABEL_R + 55;
      return { W: w, H: h, k: Math.max(0.28, (Math.min(w, h) / (2 * extent)) * 0.92) };
    }

    function fit() {
      const f = getFitCamera();
      W = f.W; H = f.H; panX = 0; panY = 0; k = f.k;
      applyTransform();
    }

    function reflow() {
      const tDeg = state.turn;
      const tRad = (tDeg * Math.PI) / 180;
      nodes.forEach((n) => {
        if (n._labG) n._labG.setAttribute("transform", `translate(${n._x.toFixed(1)},${n._y.toFixed(1)}) rotate(${(-tDeg).toFixed(2)})`);
      });
      if (state.lockedNode && !state.expanded) {
        const n = state.lockedNode;
        reticle.setAttribute("transform", `translate(${n._x.toFixed(1)},${n._y.toFixed(1)}) rotate(${(-tDeg).toFixed(2)})`);
      }
      D.forEach((dom) => {
        const a = dom._arc;
        if (!a) return;
        const f = Math.sin(dom._a + tRad) > 0;
        if (f === a.flip) return;
        a.flip = f;
        a.arc.setAttribute("d", arcPath(SECTOR_LABEL_R, dom._a, a.half, f));
      });
    }

    const SPIN = (() => {
      if (reducedMotion) return 0;
      const v = new URLSearchParams(location.search).get("spin");
      const base = typeof tree.spin === "number" ? tree.spin : 0.18;
      return v === null ? base : Math.max(0, Math.min(90, parseFloat(v) || 0));
    })();

    state = {
      nodes, D, root, wheel, gCore, gBranch, live,
      projectCount: totalProjects, activeCount,
      turn: 0, sweepDeg: 0, coreSpin: 0, last: performance.now(),
      userPaused: reducedMotion, hoverPaused: false, lockedNode: null, expanded: null, expRings: null,
      fit, getFitCamera, applyTransform, reflow, highlight, setReticle,
      getCamera: () => ({ panX, panY, k, W, H }),
      setCamera: (nx, ny, nk) => { panX = nx; panY = ny; k = nk; applyTransform(); },
      resize: () => {
        W = svg.clientWidth || window.innerWidth;
        H = svg.clientHeight || (window.innerHeight - 56);
        applyTransform();
      }
    };

    controls.pauseBtn.textContent = state.userPaused ? "Resume" : "Pause";
    controls.pauseBtn.setAttribute("aria-pressed", String(state.userPaused));

    function frame(now) {
      if (!visible || !state || reducedMotion) { rafId = null; return; }
      const dt = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;

      const isPaused = state.userPaused || state.hoverPaused || Boolean(state.expanded);
      if (!isPaused) {
        state.turn = (state.turn + dt * SPIN) % 360;
        wheel.setAttribute("transform", `rotate(${state.turn.toFixed(3)})`);
        reflow();
      }

      state.sweepDeg = (state.sweepDeg + dt * 26) % 360;
      sweepG.setAttribute("transform", `rotate(${state.sweepDeg.toFixed(2)})`);

      state.coreSpin = (state.coreSpin + dt * 14) % 360;
      coreRing1.setAttribute("transform", `rotate(${state.coreSpin.toFixed(2)})`);
      coreRing2.setAttribute("transform", `rotate(${(-state.coreSpin * 1.4).toFixed(2)})`);

      if (state.expanded && state.expRings) {
        state.expRings[0].setAttribute("transform", `rotate(${(state.coreSpin * 1.1).toFixed(2)})`);
        state.expRings[1].setAttribute("transform", `rotate(${(-state.coreSpin * 1.8).toFixed(2)})`);
      }

      if (state.lockedNode && !state.expanded) {
        retOuter.setAttribute("transform", `rotate(${(state.coreSpin * 2.1).toFixed(1)})`);
        retInner.setAttribute("transform", `rotate(${(-state.coreSpin * 3.0).toFixed(1)})`);
      }

      live.forEach(([, c]) => {
        const pu = c._pulse;
        pu.t += dt * pu.speed;
        if (pu.t > 1.2) pu.t -= 1.2 + Math.random() * 0.4;
        if (pu.t < 0 || pu.t > 1) { pu.dot.setAttribute("fill-opacity", "0"); return; }
        const pt = c._link.getPointAtLength(pu.t * c._len);
        pu.dot.setAttribute("cx", pt.x.toFixed(1));
        pu.dot.setAttribute("cy", pt.y.toFixed(1));
        pu.dot.setAttribute("fill-opacity", (Math.sin(pu.t * Math.PI) * 0.95).toFixed(3));
      });

      if (readouts?.az) readouts.az.textContent = `${((state.turn % 360 + 360) % 360).toFixed(1).padStart(5, "0")}°`;
      rafId = requestAnimationFrame(frame);
    }

    state.startLoop = () => {
      if (!rafId && visible && !reducedMotion) {
        state.last = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    };

    fit();
    reflow();
    renderBranchBar();
    if (visible) state.startLoop();

    // Restore expanded branch if optical mode was switched while inspecting
    if (prevExpandedKey) {
      const same = nodes.find((n) => (n._key || n.key) === prevExpandedKey);
      if (same) expandNode(same);
    }
  }

  // Pan, zoom, click-to-expand, click-backdrop-to-collapse
  const DRAG_SLOP = 4;
  let drag = null, downNode = null, downInBranch = false, downAt = null, moved = false;
  const nodeAt = (e) => e.target.closest?.(".node")?.__node ?? null;

  svg.addEventListener("wheel", (e) => {
    if (!state || !visible) return;
    e.preventDefault();
    if (camAnimId) { cancelAnimationFrame(camAnimId); camAnimId = null; }
    const cam = state.getCamera();
    const f = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.min(4, Math.max(0.25, cam.k * f));
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) - cam.W / 2 - cam.panX;
    const my = (e.clientY - rect.top) - cam.H / 2 - cam.panY;
    state.setCamera(cam.panX - mx * (nk / cam.k - 1), cam.panY - my * (nk / cam.k - 1), nk);
  }, { passive: false });

  svg.addEventListener("pointerdown", (e) => {
    if (!state || !visible) return;
    const cam = state.getCamera();
    drag = { x: e.clientX - cam.panX, y: e.clientY - cam.panY };
    downAt = { x: e.clientX, y: e.clientY };
    downNode = nodeAt(e);
    downInBranch = Boolean(e.target.closest?.(".jarvis-branch-layer"));
    moved = false;
  });

  svg.addEventListener("pointermove", (e) => {
    if (!drag || !state) return;
    if (!moved) {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < DRAG_SLOP) return;
      moved = true;
      if (camAnimId) { cancelAnimationFrame(camAnimId); camAnimId = null; }
      svg.classList.add("dragging");
      svg.setPointerCapture(e.pointerId);
    }
    const cam = state.getCamera();
    state.setCamera(e.clientX - drag.x, e.clientY - drag.y, cam.k);
  });

  svg.addEventListener("pointerup", (e) => {
    if (drag && !moved) {
      if (downInBranch) {
        // Handled by branch item click handlers
      } else if (downNode && !state.expanded) {
        expandNode(downNode);
      } else if (state.expanded) {
        collapseBranch(true);
      }
    }
    if (moved) svg.releasePointerCapture?.(e.pointerId);
    drag = null; downNode = null; downInBranch = false; moved = false;
    svg.classList.remove("dragging");
  });

  svg.addEventListener("dblclick", (e) => {
    const n = nodeAt(e);
    if (n && n.path) onOpenFolder(n.path);
  });

  window.addEventListener("resize", () => {
    if (state && visible) state.resize();
  });

  controls.pauseBtn.addEventListener("click", () => togglePause());
  controls.fitBtn.addEventListener("click", () => {
    if (state?.expanded) collapseBranch(true);
    else state?.fit();
  });

  controls.searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !state) return;
    const q = controls.searchInput.value.trim().toLowerCase();
    if (!q) return;
    focusNode(q);
  });

  function setOpticalMode(mode) {
    if (!MODES[mode]) return;
    opticalMode = mode;
    if (pane) pane.dataset.optical = mode;
    document.querySelectorAll("[data-optical-btn]").forEach((btn) => {
      const on = btn.dataset.opticalBtn === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    if (lastTree) mount(lastTree);
  }

  function setLiveTrackedProject(name) {
    if (name === liveTrackedProject) return;
    liveTrackedProject = name || null;
    if (lastTree && visible && !state?.expanded) mount(lastTree);
  }

  function setVisible(v) {
    visible = v;
    if (v && state) {
      state.resize();
      const cam = state.getCamera();
      if (cam.W > 0 && cam.k === 1 && cam.panX === 0 && !state.expanded) state.fit();
      state.startLoop();
      updateReadouts();
    } else if (!v && rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function togglePause() {
    if (!state) return;
    state.userPaused = !state.userPaused;
    controls.pauseBtn.textContent = state.userPaused ? "Resume" : "Pause";
    controls.pauseBtn.setAttribute("aria-pressed", String(state.userPaused));
  }

  function focusNode(keyOrName) {
    if (!state || !keyOrName) return null;
    const lower = String(keyOrName).toLowerCase();
    const target = state.nodes.find((n) => (n._key || n.key) === keyOrName)
      || state.nodes.find((n) => !n._isHub && n.name.toLowerCase() === lower)
      || state.nodes.find((n) => !n._isHub && n.name.toLowerCase().includes(lower));
    if (!target) return null;
    expandNode(target);
    return target.name;
  }

  function recolourNode(n) {
    const col = statusColor(n);
    const p = palette();
    if (n._circle) {
      n._circle.setAttribute("fill", n.status === "dormant" ? p.bg : col);
      n._circle.setAttribute("stroke", col);
    }
    if (n._pinRing) {
      n._pinRing.setAttribute("stroke", col);
      n._pinRing.setAttribute("stroke-opacity", n.pinned ? "0.8" : "0");
    }
    if (n._link) n._link.setAttribute("stroke-opacity", n.status === "dormant" ? "0.14" : "0.55");
  }

  return {
    mount,
    setVisible,
    togglePause,
    focusNode,
    collapseBranch,
    isExpanded: () => Boolean(state?.expanded),
    recolourNode,
    setOpticalMode,
    getOpticalMode: () => opticalMode,
    setLiveTrackedProject,
    fit: () => (state?.expanded ? collapseBranch(true) : state?.fit())
  };
}
