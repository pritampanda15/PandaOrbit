// ─────────────────────────────────────────────────────────────
//  Dashboard View — System-Wide Workspace & Focus Pulse.
//  Crafted with Apple semantic tokens, restraint, and calm copy.
// ─────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CAT_TOKEN = {
  "Development": "var(--apple-color-tint)",
  "Web/Research": "var(--apple-color-indigo)",
  "Writing & Docs": "var(--apple-color-green)",
  "Communication": "var(--apple-color-teal)",
  "System & Utilities": "var(--apple-color-orange)",
  "Distraction & Leisure": "var(--apple-color-red)",
  "Uncategorized": "var(--apple-color-label-3)"
};
const catColor = (name) => CAT_TOKEN[name] || "var(--apple-color-label-3)";

const STATUS_LABEL = { active: "Active", steady: "Steady", dormant: "Dormant" };

function fmtDuration(mins) {
  if (!mins || mins < 1) return "0m";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtAge(days) {
  if (days == null || Number.isNaN(days)) return "—";
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 30) return `${Math.round(days)}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function renderMiniDonut(categorySummary, totalHours) {
  if (!categorySummary.length || totalHours <= 0) {
    return `<p style="margin:0;padding:12px 0;color:var(--apple-color-label-2);font-size:var(--apple-type-footnote-size);">
      No activity has been recorded today.
    </p>`;
  }
  const r = 46, cx = 58, cy = 58, circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = categorySummary.map((c) => {
    const frac = c.hours / totalHours;
    const len = Math.max(0.5, frac * circ);
    const col = catColor(c.category);
    const out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="14"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">
      <title>${esc(c.category)}: ${c.hours.toFixed(2)} hours (${c.pct}%)</title></circle>`;
    offset += len;
    return out;
  }).join("");

  const legend = categorySummary.slice(0, 5).map((c) => `
    <div class="legend-item">
      <div class="legend-left">
        <span class="swatch" style="background:${catColor(c.category)}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.category)}</span>
      </div>
      <div class="legend-right"><strong>${c.hours.toFixed(1)}h</strong> · ${c.pct}%</div>
    </div>
  `).join("");

  return `
    <div class="donut-layout" style="gap:16px">
      <svg width="116" height="116" viewBox="0 0 116 116" class="donut-svg" role="img" aria-label="Today's time allocation totaling ${totalHours.toFixed(1)} hours">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--apple-color-fill-2)" stroke-width="14"/>
        ${segs}
        <text x="${cx}" y="${cy - 1}" text-anchor="middle" fill="var(--apple-color-label)" font-size="16" font-weight="700" style="font-variant-numeric:tabular-nums">${totalHours.toFixed(1)}h</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--apple-color-label-2)" font-size="10">Today</text>
      </svg>
      <div class="donut-legend" style="min-width:140px">${legend}</div>
    </div>
  `;
}

function renderGoalRing(kpis) {
  const goal = kpis.dailyGoalHours || 4;
  const prod = kpis.productiveHoursToday || 0;
  const pct = Math.min(100, Math.round((prod / goal) * 100));
  const r = 34, cx = 42, cy = 42, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const ringCol = pct >= 100 ? "var(--apple-color-green)" : "var(--apple-color-tint)";
  return `
    <div class="goal-ring-row">
      <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label="Daily focus goal ${pct}% complete, ${prod.toFixed(1)} of ${goal} hours">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--apple-color-fill-2)" stroke-width="9"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ringCol}" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
        <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="var(--apple-color-label)" font-size="14" font-weight="700" style="font-variant-numeric:tabular-nums">${pct}%</text>
      </svg>
      <div>
        <div style="font-weight:700;font-size:var(--apple-type-headline-size);font-variant-numeric:tabular-nums">${prod.toFixed(1)} <span style="font-weight:400;color:var(--apple-color-label-2);font-size:13px">/ ${goal} hrs</span></div>
        <div style="font-size:var(--apple-type-footnote-size);color:var(--apple-color-label-2);margin-top:2px">Daily deep-focus goal</div>
        <div style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-green);font-weight:600;margin-top:4px">${kpis.streakDays || 0}-day active streak</div>
      </div>
    </div>
  `;
}

export function createDashboardView({ container, onSelectNode, onOpenFolder, onSwitchView, onSeedHabits, onToggleTracker, onStartSprint, onSwitchSystemWide }) {
  const ui = {
    search: "",
    status: "all",
    domain: "all",
    sort: "recent",
    layout: "cards"
  };

  function flattenProjects(tree) {
    const list = [];
    for (const dom of tree.domains || []) {
      for (const proj of dom.children || []) list.push({ proj, dom });
    }
    return list;
  }

  function render({ tree, habitReport, tracker }) {
    const all = flattenProjects(tree);
    const projectTime = habitReport?.projectTime || {};
    const kpis = habitReport?.kpis || {
      totalHoursToday: 0, totalHoursRange: 0, topCategory: "None yet",
      avgDailyHours7d: 0, distractionPct: 0, focusScore: 0
    };

    const counts = { total: all.length, active: 0, steady: 0, dormant: 0, pinned: 0 };
    for (const { proj } of all) {
      if (proj.status === "active") counts.active++;
      else if (proj.status === "steady") counts.steady++;
      else counts.dormant++;
      if (proj.pinned) counts.pinned++;
    }

    const q = ui.search.trim().toLowerCase();
    const filtered = all.filter(({ proj, dom }) => {
      if (ui.domain !== "all" && dom.name !== ui.domain) return false;
      if (ui.status === "pinned" && !proj.pinned) return false;
      if (["active", "steady", "dormant"].includes(ui.status) && proj.status !== ui.status) return false;
      if (q) {
        const hay = `${proj.name} ${dom.name} ${proj.tagline || ""} ${proj.mine || ""} ${proj.note || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const pa = a.proj, pb = b.proj;
      if (ui.sort === "name") return pa.name.localeCompare(pb.name);
      if (ui.sort === "commits") return (pb.commits || 0) - (pa.commits || 0);
      if (ui.sort === "time") {
        const ta = projectTime[pa.name]?.minutesTotal || 0;
        const tb = projectTime[pb.name]?.minutesTotal || 0;
        return tb - ta || (pb.lastTouchedMs || 0) - (pa.lastTouchedMs || 0);
      }
      return (pb.lastTouchedMs || 0) - (pa.lastTouchedMs || 0);
    });

    const domainCards = (tree.domains || []).map((dom) => {
      const kids = dom.children || [];
      const nAct = kids.filter((c) => c.status === "active").length;
      const nStd = kids.filter((c) => c.status === "steady").length;
      const nDor = kids.length - nAct - nStd;
      const tot = Math.max(1, kids.length);
      const mins = kids.reduce((s, c) => s + (projectTime[c.name]?.minutes7d || 0), 0);
      const selected = ui.domain === dom.name;
      return `
        <button type="button" class="domain-card ${selected ? "selected" : ""}" data-domain="${esc(dom.name)}" aria-pressed="${selected}">
          <div class="domain-top">
            <div class="domain-title">
              <span class="domain-dot" style="background:hsl(${dom.hue} 68% 52%)" aria-hidden="true"></span>
              <span class="domain-title-name">${esc(dom.name)}</span>
            </div>
            <span class="domain-count">${kids.length}</span>
          </div>
          <div class="domain-blurb-txt">${esc(dom.blurb || "Project group")}</div>
          <div class="seg-bar" aria-hidden="true">
            <div class="seg-active" style="width:${(nAct / tot) * 100}%"></div>
            <div class="seg-steady" style="width:${(nStd / tot) * 100}%"></div>
            <div class="seg-dormant" style="width:${(nDor / tot) * 100}%"></div>
          </div>
          <div class="domain-meta">
            <span>${nAct} active · ${nStd} steady</span>
            <span>${mins > 0 ? `${fmtDuration(mins)} (7d)` : `${nDor} dormant`}</span>
          </div>
        </button>
      `;
    }).join("");

    let projectsHtml = "";
    if (!filtered.length) {
      projectsHtml = `<p style="text-align:center;padding:32px 12px;color:var(--apple-color-label-2);font-size:var(--apple-type-subheadline-size);margin:0;">
        No projects match the current filter.
      </p>`;
    } else if (ui.layout === "cards") {
      projectsHtml = `<div class="project-grid">` + filtered.map(({ proj, dom }) => {
        const pt = projectTime[proj.name];
        const desc = proj.tagline || (proj.note || "").split("\n")[0] || "";
        const statusText = STATUS_LABEL[proj.status] || proj.status;
        return `
          <article class="proj-card" tabindex="0" role="button" data-key="${esc(proj._key || proj.key)}" aria-label="${esc(proj.name)}, ${esc(statusText)}, in ${esc(dom.name)}">
            <div class="proj-card-head">
              <div>
                <div class="proj-name">${esc(proj.name)}</div>
                <div class="proj-domain-tag">
                  <span class="domain-dot" style="width:7px;height:7px;background:hsl(${dom.hue} 68% 52%)" aria-hidden="true"></span>
                  <span>${esc(dom.name)}</span>
                </div>
              </div>
              <span class="status-badge ${proj.status} ${proj.pinned ? "pinned" : ""}">${esc(statusText)}${proj.pinned ? " · Pinned" : ""}</span>
            </div>
            ${proj.mine ? `<div class="proj-mine">${esc(proj.mine)}</div>` : ""}
            ${desc ? `<div class="proj-desc">${esc(desc)}</div>` : ""}
            <div class="proj-foot">
              <div class="proj-stats">
                <span>${fmtAge(proj.ageDays)}</span>
                ${proj.commits ? `<span>${proj.commits} commits</span>` : ""}
                ${pt ? `<span style="color:var(--apple-color-tint);font-weight:600">${fmtDuration(pt.minutes7d || pt.minutesTotal)}</span>` : ""}
              </div>
              ${proj.path ? `<button type="button" class="mini-open" data-open="${esc(proj.path)}" aria-label="Open ${esc(proj.name)} folder">Open</button>` : ""}
            </div>
          </article>
        `;
      }).join("") + `</div>`;
    } else {
      projectsHtml = `
        <div class="table-wrap">
          <table class="proj-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Domain</th>
                <th>Status</th>
                <th>Updated</th>
                <th class="num">Commits</th>
                <th class="num">Tracked (7d)</th>
                <th class="num">Action</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(({ proj, dom }) => {
                const pt = projectTime[proj.name];
                const statusText = STATUS_LABEL[proj.status] || proj.status;
                return `
                  <tr tabindex="0" data-key="${esc(proj._key || proj.key)}">
                    <td>
                      <div style="font-weight:600;color:var(--apple-color-label)">${esc(proj.name)}</div>
                      ${proj.mine ? `<div style="font-size:12px;color:var(--apple-color-label-2);margin-top:2px">${esc(proj.mine)}</div>` : ""}
                    </td>
                    <td>
                      <span style="display:inline-flex;align-items:center;gap:6px">
                        <span class="domain-dot" style="width:7px;height:7px;background:hsl(${dom.hue} 68% 52%)" aria-hidden="true"></span>
                        ${esc(dom.name)}
                      </span>
                    </td>
                    <td><span class="status-badge ${proj.status} ${proj.pinned ? "pinned" : ""}">${esc(statusText)}</span></td>
                    <td style="color:var(--apple-color-label-2)">${fmtAge(proj.ageDays)}</td>
                    <td class="num" style="color:var(--apple-color-label-2)">${proj.commits || "—"}</td>
                    <td class="num" style="color:${pt ? "var(--apple-color-tint)" : "var(--apple-color-label-3)"};font-weight:${pt ? 600 : 400}">${pt ? fmtDuration(pt.minutes7d || pt.minutesTotal) : "—"}</td>
                    <td class="num">
                      ${proj.path ? `<button type="button" class="mini-open" data-open="${esc(proj.path)}">Open</button>` : ""}
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    const topTrackedProjects = Object.entries(projectTime)
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.minutes7d - a.minutes7d || b.minutesTotal - a.minutesTotal)
      .slice(0, 6);

    const trackedProjectsHtml = topTrackedProjects.length
      ? topTrackedProjects.map((item) => {
          const matched = all.find(({ proj }) => proj.name === item.name);
          const pct = Math.min(100, (item.minutes7d / Math.max(1, topTrackedProjects[0].minutes7d)) * 100);
          return `
            <div style="margin-bottom:12px;cursor:${matched ? "pointer" : "default"}" ${matched ? `tabindex="0" role="button" data-key="${esc(matched.proj._key || matched.proj.key)}"` : ""}>
              <div style="display:flex;justify-content:space-between;font-size:var(--apple-type-footnote-size);margin-bottom:5px">
                <span style="color:var(--apple-color-label);font-weight:600">${esc(item.name)}</span>
                <span style="color:var(--apple-color-tint);font-variant-numeric:tabular-nums;font-weight:600">${fmtDuration(item.minutes7d)} <span style="color:var(--apple-color-label-2);font-weight:400">(7d)</span></span>
              </div>
              <div class="hbar-track" style="height:6px">
                <div class="hbar-fill" style="width:${pct}%;background:var(--apple-color-tint)"></div>
              </div>
            </div>
          `;
        }).join("")
      : `<p style="margin:0;font-size:var(--apple-type-footnote-size);color:var(--apple-color-label-2);line-height:var(--apple-type-footnote-line)">
          Sessions whose window title matches a scanned project name appear here automatically.
        </p>`;

    container.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div>
            <h1>Dashboard</h1>
            <p>${tree.scanMode === "system" ? `System-Wide (${tree.roots.length} workspaces)` : esc(tree.roots.map((r) => r.path).join(" · "))} &middot; ${esc(habitReport?.currentDate || "")}</p>
          </div>
          <div class="head-controls">
            ${tree.scanMode !== "system" ? `<button type="button" class="btn btn-tinted" id="dash-system-wide">Scan System-Wide</button>` : ""}
            <button type="button" class="btn btn-tinted" id="dash-open-storage">Disk Analyzer</button>
            <button type="button" class="btn btn-tinted" id="dash-open-habits">Open Habits</button>
            <button type="button" class="btn btn-filled" id="dash-open-orbit">Open Orbit Map</button>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Active Projects (≤${tree.activeDays || 7}d)</div>
            <div class="kpi-val">${counts.active} <span class="kpi-unit">of ${counts.total}</span></div>
            <div class="kpi-sub">${counts.steady} steady · ${counts.dormant} dormant · ${counts.pinned} pinned</div>
          </div>

          <button type="button" class="kpi-card" id="kpi-hours-today">
            <div class="kpi-label">Hours Logged Today</div>
            <div class="kpi-val">${kpis.totalHoursToday.toFixed(2)} <span class="kpi-unit">hrs</span></div>
            <div class="kpi-sub">7-day average: ${kpis.avgDailyHours7d.toFixed(2)} hrs/day</div>
          </button>

          <button type="button" class="kpi-card" id="kpi-focus">
            <div class="kpi-label">Focus Score</div>
            <div class="kpi-val">${kpis.focusScore.toFixed(0)}<span class="kpi-unit">%</span></div>
            <div class="kpi-sub">Distraction share: ${kpis.distractionPct.toFixed(1)}%</div>
          </button>

          <button type="button" class="kpi-card" id="kpi-top-cat">
            <div class="kpi-label">Top Activity</div>
            <div class="kpi-val kpi-val-text">${esc(kpis.topCategory === "N/A" ? "None yet" : kpis.topCategory)}</div>
            <div class="kpi-sub">${habitReport?.totalSessions || 0} recorded sessions</div>
          </button>
        </div>

        <div class="section-head">
          <h2>Domains</h2>
          ${ui.domain !== "all" ? `<button type="button" class="btn btn-plain" id="clear-domain-filter">Clear filter: ${esc(ui.domain)}</button>` : ""}
        </div>
        <div class="domain-grid">${domainCards}</div>

        <div class="dash-split">
          <div class="card">
            <div class="card-title">
              <h3>Projects (${filtered.length})</h3>
              <div class="seg-pills" role="group" aria-label="Project layout">
                <button type="button" data-layout="cards" aria-pressed="${ui.layout === "cards"}" class="${ui.layout === "cards" ? "active" : ""}">Cards</button>
                <button type="button" data-layout="table" aria-pressed="${ui.layout === "table"}" class="${ui.layout === "table" ? "active" : ""}">Table</button>
              </div>
            </div>

            <div class="filter-bar">
              <label class="sr-only" for="dash-search">Search projects</label>
              <input id="dash-search" class="search-input" type="search" placeholder="Search projects, notes, or README summaries…" value="${esc(ui.search)}">
              <div class="seg-pills" role="group" aria-label="Filter by status">
                ${[["all", "All"], ["active", "Active"], ["steady", "Steady"], ["dormant", "Dormant"], ["pinned", "Pinned"]].map(([s, lbl]) =>
                  `<button type="button" data-status="${s}" aria-pressed="${ui.status === s}" class="${ui.status === s ? "active" : ""}">${lbl}</button>`
                ).join("")}
              </div>
              <label class="sr-only" for="dash-sort">Sort projects</label>
              <select id="dash-sort" class="select-input">
                <option value="recent" ${ui.sort === "recent" ? "selected" : ""}>Recently Updated</option>
                <option value="time" ${ui.sort === "time" ? "selected" : ""}>Tracked Time</option>
                <option value="commits" ${ui.sort === "commits" ? "selected" : ""}>Most Commits</option>
                <option value="name" ${ui.sort === "name" ? "selected" : ""}>Name (A–Z)</option>
              </select>
            </div>

            ${projectsHtml}
          </div>

          <div>
            <div class="card">
              <div class="card-title">
                <h3>Focus Goal &amp; Streak</h3>
                <button type="button" class="meta-link" id="dash-quick-sprint">Start 25m Sprint</button>
              </div>
              ${renderGoalRing(kpis)}
            </div>

            <div class="card">
              <div class="card-title">
                <h3>Today's Habits</h3>
                <button type="button" class="meta-link" id="side-go-habits">View All</button>
              </div>
              ${renderMiniDonut(habitReport?.categorySummary || [], kpis.totalHoursToday)}
              ${!habitReport?.hasData ? `
                <div style="display:flex;gap:8px;margin-top:14px">
                  <button type="button" class="btn btn-filled" id="dash-start-track" style="flex:1">${tracker?.running ? "Tracker Active" : "Start Tracker"}</button>
                  <button type="button" class="btn btn-tinted" id="dash-seed" style="flex:1">Load Sample</button>
                </div>
              ` : ""}
            </div>

            <div class="card">
              <div class="card-title">
                <h3>Focus by Project</h3>
              </div>
              ${trackedProjectsHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire events
    container.querySelector("#dash-open-orbit")?.addEventListener("click", () => onSwitchView("orbit"));
    container.querySelector("#dash-open-habits")?.addEventListener("click", () => onSwitchView("habits"));
    container.querySelector("#dash-open-storage")?.addEventListener("click", () => onSwitchView("storage"));
    container.querySelector("#dash-system-wide")?.addEventListener("click", () => onSwitchSystemWide?.());
    container.querySelector("#side-go-habits")?.addEventListener("click", () => onSwitchView("habits"));
    container.querySelector("#kpi-hours-today")?.addEventListener("click", () => onSwitchView("habits"));
    container.querySelector("#kpi-focus")?.addEventListener("click", () => onSwitchView("habits"));
    container.querySelector("#kpi-top-cat")?.addEventListener("click", () => onSwitchView("habits"));
    container.querySelector("#dash-seed")?.addEventListener("click", () => onSeedHabits());
    container.querySelector("#dash-start-track")?.addEventListener("click", () => onToggleTracker());
    container.querySelector("#dash-quick-sprint")?.addEventListener("click", () => {
      const topProj = filtered[0]?.proj?.name || all[0]?.proj?.name || "Deep Work";
      onStartSprint?.(topProj, 25);
    });

    container.querySelector("#clear-domain-filter")?.addEventListener("click", () => {
      ui.domain = "all";
      render({ tree, habitReport, tracker });
    });

    container.querySelectorAll(".domain-card").forEach((card) => {
      card.addEventListener("click", () => {
        const d = card.dataset.domain;
        ui.domain = ui.domain === d ? "all" : d;
        render({ tree, habitReport, tracker });
      });
    });

    const searchEl = container.querySelector("#dash-search");
    if (searchEl) {
      searchEl.addEventListener("input", () => {
        ui.search = searchEl.value;
        const pos = searchEl.selectionStart;
        render({ tree, habitReport, tracker });
        const next = container.querySelector("#dash-search");
        if (next) { next.focus(); next.setSelectionRange(pos, pos); }
      });
    }

    container.querySelectorAll("[data-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.status = btn.dataset.status;
        render({ tree, habitReport, tracker });
      });
    });

    container.querySelectorAll("[data-layout]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.layout = btn.dataset.layout;
        render({ tree, habitReport, tracker });
      });
    });

    container.querySelector("#dash-sort")?.addEventListener("change", (e) => {
      ui.sort = e.target.value;
      render({ tree, habitReport, tracker });
    });

    container.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onOpenFolder(btn.dataset.open);
      });
    });

    const activateKey = (elItem) => {
      const key = elItem.dataset.key;
      const found = all.find(({ proj }) => (proj._key || proj.key) === key);
      if (found) onSelectNode(found.proj, elItem);
    };

    container.querySelectorAll("[data-key]").forEach((elItem) => {
      elItem.addEventListener("click", () => activateKey(elItem));
      elItem.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activateKey(elItem);
        }
      });
    });
  }

  return { render };
}
