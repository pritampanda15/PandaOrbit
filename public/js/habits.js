// ─────────────────────────────────────────────────────────────
//  Focus & Telemetry View — Live Signal Oscilloscope,
//  Interactive Terminal, Work Summaries & Daily Analytics.
// ─────────────────────────────────────────────────────────────

import { drawSignalGraph, renderTerminalLinesHtml, fmtTimer } from "./telemetry.js";

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

function fmtTime(epochSec) {
  return new Date(epochSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderDonut(categorySummary, totalHours, rangeLabel) {
  if (!categorySummary.length || totalHours <= 0) {
    return `<p style="text-align:center;padding:36px 12px;color:var(--apple-color-label-2);font-size:var(--apple-type-subheadline-size);margin:0;">
      No activity recorded for ${esc(rangeLabel.toLowerCase())}.
    </p>`;
  }
  const r = 74, cx = 96, cy = 96, circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = categorySummary.map((c) => {
    const frac = c.hours / totalHours;
    const len = Math.max(0.5, frac * circ);
    const col = catColor(c.category);
    const out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="22"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">
      <title>${esc(c.category)}: ${c.hours.toFixed(2)} hours (${c.pct}%)</title></circle>`;
    offset += len;
    return out;
  }).join("");

  const legend = categorySummary.map((c) => `
    <div class="legend-item">
      <div class="legend-left">
        <span class="swatch" style="background:${catColor(c.category)}" aria-hidden="true"></span>
        <span>${esc(c.category)}</span>
      </div>
      <div class="legend-right"><strong>${c.hours.toFixed(2)}h</strong> · ${c.pct}%</div>
    </div>
  `).join("");

  const summary = categorySummary.map((c) => `${c.category} ${c.pct}%`).join(", ");

  return `
    <div class="donut-layout">
      <svg width="192" height="192" viewBox="0 0 192 192" class="donut-svg" role="img" aria-label="Time allocation for ${esc(rangeLabel)}: ${esc(summary)}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--apple-color-fill-2)" stroke-width="22"/>
        ${arcs}
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="var(--apple-color-label)" font-size="24" font-weight="700" style="font-variant-numeric:tabular-nums">${totalHours.toFixed(2)}</text>
        <text x="${cx}" y="${cy + 15}" text-anchor="middle" fill="var(--apple-color-label-2)" font-size="11">hrs · ${esc(rangeLabel)}</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

function renderTrendChart(dailyTrend, mode = "focus-vs-distraction") {
  if (!dailyTrend || !dailyTrend.length) {
    return `<p style="text-align:center;padding:36px 12px;color:var(--apple-color-label-2);font-size:var(--apple-type-subheadline-size);margin:0;">
      No 7-day trend data available yet.
    </p>`;
  }

  const W = 540, H = 224;
  const pad = { top: 18, right: 18, bottom: 32, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const series = mode === "total"
    ? [
        { name: "Total Tracked", color: "var(--apple-color-tint)", values: dailyTrend.map((d) => d.totalHours) },
        { name: "Development", color: "var(--apple-color-green)", values: dailyTrend.map((d) => d.development) }
      ]
    : [
        { name: "Development", color: "var(--apple-color-tint)", values: dailyTrend.map((d) => d.development) },
        { name: "Distraction & Leisure", color: "var(--apple-color-red)", values: dailyTrend.map((d) => d.distraction) }
      ];

  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const yMax = Math.ceil(maxVal * 1.15 * 2) / 2;
  const xStep = dailyTrend.length > 1 ? plotW / (dailyTrend.length - 1) : plotW;
  const xAt = (i) => pad.left + i * xStep;
  const yAt = (v) => pad.top + plotH - (v / yMax) * plotH;

  const ticks = 4;
  let grid = "";
  for (let i = 0; i <= ticks; i++) {
    const val = (yMax / ticks) * i;
    const y = yAt(val);
    grid += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="var(--apple-color-separator)" stroke-dasharray="${i === 0 ? "" : "3 3"}"/>`;
    grid += `<text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--apple-color-label-2)" font-size="11">${val.toFixed(1)}h</text>`;
  }

  const xLabels = dailyTrend.map((d, i) => `
    <text x="${xAt(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="var(--apple-color-label-2)" font-size="11">${esc(d.label)}</text>
  `).join("");

  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    const lineD = `M ${pts.join(" L ")}`;
    const areaD = `${lineD} L ${xAt(s.values.length - 1).toFixed(1)},${(pad.top + plotH).toFixed(1)} L ${xAt(0).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;
    const dots = s.values.map((v, i) => `
      <circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--apple-color-surface)" stroke-width="1.8">
        <title>${esc(dailyTrend[i].date)} · ${esc(s.name)}: ${v.toFixed(2)} hours</title>
      </circle>
    `).join("");
    return `
      <path d="${areaD}" fill="${s.color}" fill-opacity="0.10"/>
      <path d="${lineD}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    `;
  }).join("");

  const legend = series.map((s) => `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2);font-weight:600">
      <span class="swatch" style="background:${s.color}" aria-hidden="true"></span>${esc(s.name)}
    </span>
  `).join("");

  const ariaSummary = dailyTrend.map((d) => `${d.label} ${d.totalHours}h`).join(", ");

  return `
    <div style="display:flex;gap:16px;margin-bottom:8px;justify-content:flex-end">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Last 7 days trend: ${esc(ariaSummary)}">
      ${grid}
      ${paths}
      ${xLabels}
    </svg>
  `;
}

function renderHourlyBars(hourly) {
  const maxM = Math.max(10, ...hourly.map((h) => h.minutes));
  const W = 720, H = 96;
  const barW = (W - 24) / 24;
  const bars = hourly.map((h, i) => {
    const bh = Math.max(3, (h.minutes / maxM) * 60);
    const x = 12 + i * barW + 4;
    const y = 68 - bh;
    const label = i % 3 === 0 ? `<text x="${(x + (barW - 8) / 2).toFixed(1)}" y="86" text-anchor="middle" fill="var(--apple-color-label-2)" font-size="10.5">${String(i).padStart(2, "0")}:00</text>` : "";
    const fill = h.minutes > 0 ? "var(--apple-color-tint)" : "var(--apple-color-fill-2)";
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 8).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${fill}">
        <title>${String(i).padStart(2, "0")}:00 — ${h.minutes} min</title>
      </rect>
      ${label}
    `;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="hourly-svg" role="img" aria-label="Hourly activity distribution across 24 hours">${bars}</svg>`;
}

export function createHabitsView({
  container,
  onChangeRange,
  onToggleTracker,
  onLogSession,
  onSeedHabits,
  onClearHabits,
  onJumpProject,
  onRunCommand,
  onUpdateCategory,
  onSaveSummaryDoc,
  onPublishGoogleDocs,
  onSaveDocsConfig,
  onCopySummary
}) {
  const ui = {
    range: "today",
    trendMode: "focus-vs-distraction",
    showLogger: false,
    showDocsSetup: false,
    summaryOpen: true,
    bottomTab: "recent",
    cmdHistory: [],
    cmdCursor: -1
  };

  function updateLiveTelemetry(busState) {
    const canvas = container.querySelector("#habit-signal-canvas");
    if (canvas) drawSignalGraph(canvas, busState, { mode: "jarvis" });

    const outEl = container.querySelector("#habit-term-output");
    if (outEl) {
      outEl.innerHTML = renderTerminalLinesHtml(busState.events, 60);
      outEl.scrollTop = outEl.scrollHeight;
    }

    const swEl = container.querySelector("#habit-stopwatch");
    if (swEl) {
      swEl.textContent = busState.tracker?.running
        ? fmtTimer(busState.latestSample?.sessionSeconds ?? busState.tracker?.currentDurationSec ?? 0)
        : "STANDBY";
    }

    const appEl = container.querySelector("#habit-live-app");
    if (appEl) {
      const s = busState.latestSample;
      if (busState.tracker?.running && s) {
        appEl.innerHTML = `ACTIVE: <strong>${esc(s.appName)}</strong> · ${esc(s.category)}${s.matchedProject ? ` · <span style="color:#ff9f0a">[${esc(s.matchedProject)}]</span>` : ""}`;
      } else if (busState.tracker?.running) {
        appEl.innerHTML = `ACTIVE: <strong>Detecting window…</strong>`;
      } else {
        appEl.innerHTML = `SIGNAL: <strong>Standby</strong> · Type <code>track start</code> or click Start Tracker`;
      }
    }

    const intensityEl = container.querySelector("#habit-live-intensity");
    if (intensityEl) {
      const pct = busState.latestSample ? Math.round((busState.latestSample.intensity ?? 0) * 100) : 0;
      intensityEl.textContent = busState.tracker?.running ? `FOCUS ${pct}%` : "IDLE";
    }
  }

  function render({ report, tracker, categories, projectNames, busState, summaryData, docsConfig, lastDocResult }) {
    const kpis = report?.kpis || {
      totalHoursToday: 0, totalHoursRange: 0, topCategory: "None yet",
      avgDailyHours7d: 0, distractionPct: 0, focusScore: 0
    };
    const rangeLabels = { today: "Today", "7d": "Last 7 Days", "30d": "Last 30 Days", all: "All Time" };
    const rangeLabel = rangeLabels[ui.range] || "Today";

    const maxMin = Math.max(1, ...(report?.topActivities || []).map((a) => a.minutes));
    const topActivitiesHtml = (report?.topActivities || []).length
      ? `<div class="hbar-list">` + report.topActivities.map((act) => {
          const pct = Math.max(2, (act.minutes / maxMin) * 100);
          const col = catColor(act.category);
          return `
            <div class="hbar-row">
              <div class="hbar-label">
                <div class="hbar-title" title="${esc(act.windowTitle)}">${esc(act.windowTitle)}</div>
                <div class="hbar-sub">
                  <span class="swatch" style="width:7px;height:7px;background:${col}" aria-hidden="true"></span>
                  <span>${esc(act.category)}</span>
                  <span>&middot; ${esc(act.appName)}</span>
                  ${act.matchedProject ? `<button type="button" class="proj-chip" data-jump-proj="${esc(act.matchedProject)}">${esc(act.matchedProject)}</button>` : ""}
                </div>
              </div>
              <div class="hbar-track" aria-hidden="true">
                <div class="hbar-fill" style="width:${pct.toFixed(1)}%;background:${col}"></div>
              </div>
              <div class="hbar-val">${act.minutes.toFixed(1)} min</div>
            </div>
          `;
        }).join("") + `</div>`
      : `<p style="text-align:center;padding:24px;color:var(--apple-color-label-2);font-size:var(--apple-type-subheadline-size);margin:0;">
          No window activities logged for ${rangeLabel.toLowerCase()}.
        </p>`;

    const recentHtml = (report?.recentSessions || []).length
      ? `<div class="session-log-list">` + report.recentSessions.map((s) => `
          <div class="session-row">
            <div class="session-row-left">
              <div class="session-row-title">${esc(s.windowTitle)}</div>
              <div class="session-row-meta">
                <span>${esc(s.category)}</span>
                &middot; ${esc(s.appName)}
                &middot; ${fmtTime(s.startTime)}
                ${s.matchedProject ? ` &middot; <span style="color:var(--apple-color-tint);font-weight:600">${esc(s.matchedProject)}</span>` : ""}
              </div>
            </div>
            <div style="font-variant-numeric:tabular-nums;color:var(--apple-color-label);font-weight:600;white-space:nowrap">${s.durationMin.toFixed(1)}m</div>
          </div>
        `).join("") + `</div>`
      : `<p style="margin:0;color:var(--apple-color-label-2);font-size:var(--apple-type-footnote-size)">No sessions recorded yet.</p>`;

    const rulesHtml = `<div class="cat-rules-grid">` + Object.entries(categories || {}).map(([cat, kws]) => `
      <div class="cat-rule-box">
        <h4>${esc(cat)} <span style="color:var(--apple-color-label-2);font-weight:400">(${kws.length})</span></h4>
        <div class="kw-tags">
          ${kws.map((k) => `<span class="kw-tag kw-tag-removable">${esc(k)}<button type="button" class="kw-rm-btn" data-rm-cat="${esc(cat)}" data-rm-kw="${esc(k)}" aria-label="Remove ${esc(k)} from ${esc(cat)}">×</button></span>`).join("")}
        </div>
        <form class="cat-add-form" data-add-cat="${esc(cat)}">
          <input type="text" placeholder="Add keyword…" aria-label="Add keyword to ${esc(cat)}" required>
          <button type="submit" class="mini-open">Add</button>
        </form>
      </div>
    `).join("") + `</div>`;

    const heatmapHtml = (report?.heatmap28 || []).length
      ? `<div class="heatmap-grid">` + report.heatmap28.map((d) => `
          <div class="hm-cell hm-l${d.level}" title="${esc(d.date)} (${esc(d.label)}): ${d.productiveHours}h focus / ${d.hours}h total">
            <span>${d.dayNum}</span>
          </div>
        `).join("") + `</div>`
      : "";

    const loggerForm = ui.showLogger ? `
      <form id="habit-log-form" class="session-form" novalidate>
        <div class="field">
          <label for="hl-app">Application</label>
          <input id="hl-app" type="text" placeholder="VS Code, Terminal, Chrome" value="VS Code" required>
        </div>
        <div class="field">
          <label for="hl-title">Window Title or Project</label>
          <input id="hl-title" type="text" list="hl-projects" placeholder="${esc(projectNames?.[0] || "PandaOrbit")} — focus session" required>
          <datalist id="hl-projects">
            ${(projectNames || []).map((n) => `<option value="${esc(n)} — work session"></option>`).join("")}
          </datalist>
        </div>
        <div class="field">
          <label for="hl-mins">Minutes</label>
          <input id="hl-mins" type="number" min="1" max="600" value="25" required>
        </div>
        <button class="btn btn-filled" type="submit" style="min-height:40px">Save Session</button>
      </form>
    ` : "";

    const emptyNotice = !report?.hasData ? `
      <div class="empty-state">
        <h3>No Historical Sessions Yet</h3>
        <p>
          Engage the live tracker above, run <code>log 25 VSCode PandaOrbit</code> in the terminal, or load a 7-day sample dataset to populate historical charts.
        </p>
        <div class="empty-actions">
          <button type="button" class="btn btn-filled btn-lg" id="hb-empty-track">Start Activity Tracker</button>
          <button type="button" class="btn btn-tinted btn-lg" id="hb-empty-seed">Load Sample Data</button>
          <button type="button" class="btn btn-plain btn-lg" id="hb-empty-log">Log Session</button>
        </div>
      </div>
    ` : "";

    // Preserve active terminal draft if user was typing
    const prevDraft = container.querySelector("#habit-term-input")?.value || "";

    container.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div>
            <h1>Focus &amp; Telemetry</h1>
            <p>Live activity telemetry &amp; time investment through ${esc(report?.currentDate || "")} &middot; ${esc(report?.storageMode || "sqlite")}</p>
          </div>
          <div class="head-controls">
            <div class="seg-pills" role="group" aria-label="Time range">
              ${[["today", "Today"], ["7d", "7 Days"], ["30d", "30 Days"], ["all", "All"]].map(([id, lbl]) =>
                `<button type="button" data-range="${id}" aria-pressed="${ui.range === id}" class="${ui.range === id ? "active" : ""}">${lbl}</button>`
              ).join("")}
            </div>
            <button type="button" class="btn btn-tinted" id="hb-toggle-logger">${ui.showLogger ? "Close Logger" : "Log Session"}</button>
            <button type="button" class="btn ${tracker?.running ? "btn-destructive" : "btn-filled"}" id="hb-track-btn">
              ${tracker?.running ? "Stop Tracker" : "Start Tracker"}
            </button>
          </div>
        </div>

        <!-- Live Telemetry Deck: Real-Time Oscilloscope + Interactive Command Terminal -->
        <div class="telemetry-deck">
          <div class="signal-card">
            <div class="tele-head">
              <div class="tele-title">
                <span class="status-dot" style="background:${tracker?.running ? "#30d158" : "#64748b"}" aria-hidden="true"></span>
                <span>REAL-TIME FOCUS SIGNAL</span>
              </div>
              <span class="tele-stopwatch" id="habit-stopwatch">${tracker?.running ? fmtTimer(tracker.currentDurationSec || 0) : "STANDBY"}</span>
            </div>
            <canvas id="habit-signal-canvas" class="signal-canvas" aria-label="Real-time focus intensity oscilloscope"></canvas>
            <div class="signal-meta-row">
              <span id="habit-live-app">SIGNAL: <strong>${tracker?.running ? esc(tracker.currentApp || "Scanning…") : "Standby"}</strong></span>
              <span id="habit-live-intensity" style="color:#38d9ff;font-weight:700">${tracker?.running ? "LIVE" : "IDLE"}</span>
            </div>
          </div>

          <div class="terminal-card">
            <div class="tele-head">
              <div class="tele-title">
                <span>TELEMETRY TERMINAL</span>
              </div>
              <span style="font:600 10.5px/1 var(--apple-font-mono);color:rgba(186,230,253,0.65)">type <code>help</code></span>
            </div>
            <div id="habit-term-output" class="term-output" role="log" aria-live="polite" aria-label="Live activity telemetry log"></div>
            <form id="habit-term-form" class="term-prompt-form" autocomplete="off">
              <span class="term-ps1" aria-hidden="true">panda@orbit:~$</span>
              <label class="sr-only" for="habit-term-input">Telemetry terminal command</label>
              <input id="habit-term-input" class="term-input" type="text" placeholder="track start | log 25 VSCode Project | focus MyRepo | mode flir" value="${esc(prevDraft)}">
              <button type="submit" class="term-run-btn">Run</button>
            </form>
          </div>
        </div>

        <!-- Work Summary & Google Docs Publisher -->
        <div class="card" style="margin-bottom:var(--apple-space-5)">
          <div class="card-title">
            <h3>Work Summary &amp; Google Docs</h3>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
              <button type="button" class="btn btn-tinted" id="sum-copy-gdocs">Copy for Google Docs</button>
              <a class="btn btn-tinted" href="https://docs.new" target="_blank" rel="noopener" style="text-decoration:none">Open docs.new</a>
              <button type="button" class="btn btn-tinted" id="sum-save-md">Save Local .md</button>
              <button type="button" class="btn btn-filled" id="sum-send-gdocs">${docsConfig?.hasWebhook || docsConfig?.hasApiToken ? "Send to Google Docs" : "Connect Google Docs"}</button>
              <button type="button" class="btn btn-plain" id="sum-setup-toggle">${ui.showDocsSetup ? "Hide Setup" : "Settings"}</button>
            </div>
          </div>

          ${summaryData ? `
            <div class="summary-box">
              <p class="summary-narrative">${esc(summaryData.narrative)}</p>
              <pre class="summary-pre">${esc(summaryData.markdown)}</pre>
              ${lastDocResult?.docUrl ? `<div style="margin-top:10px;font-size:var(--apple-type-footnote-size)">Published: <a href="${esc(lastDocResult.docUrl)}" target="_blank" rel="noopener" style="color:var(--apple-color-tint);font-weight:600">Open Google Doc ↗</a></div>` : ""}
              ${lastDocResult?.filePath ? `<div style="margin-top:8px;font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2)">Saved locally to <code>${esc(lastDocResult.filePath)}</code></div>` : ""}
            </div>
          ` : `<p style="margin:0;color:var(--apple-color-label-2);font-size:var(--apple-type-footnote-size)">Generating summary…</p>`}

          ${ui.showDocsSetup ? `
            <div class="gdocs-setup">
              <div style="font-weight:600;font-size:var(--apple-type-footnote-size);margin-bottom:4px">
                Connect Google Docs (${docsConfig?.hasWebhook ? `Connected via ${esc(docsConfig.webhookHost)}` : docsConfig?.hasApiToken ? "Connected via Google Docs API" : "Not connected"})
              </div>
              <p style="margin:0;font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2);line-height:1.5">
                Deploy <code>docs/google-docs-bridge.gs</code> at <strong>script.google.com</strong> as a Web App (60 seconds, no GCP console needed), then paste its <code>/exec</code> URL below. Optionally add an existing Google Doc ID to append daily summaries to one running journal.
              </p>
              <form id="gdocs-cfg-form" class="gdocs-form">
                <div class="field">
                  <label for="gd-webhook">Apps Script Web App URL</label>
                  <input id="gd-webhook" type="url" placeholder="https://script.google.com/macros/s/…/exec">
                </div>
                <div class="field">
                  <label for="gd-docid">Target Google Doc ID (optional)</label>
                  <input id="gd-docid" type="text" placeholder="Leave blank to create new doc" value="${esc(docsConfig?.docId || "")}">
                </div>
                <button type="submit" class="btn btn-filled" style="min-height:40px">Save Connection</button>
              </form>
            </div>
          ` : ""}
        </div>

        ${loggerForm}
        ${emptyNotice}

        ${report?.hasData ? `
          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">Total Hours (${esc(rangeLabel)})</div>
              <div class="kpi-val">${kpis.totalHoursRange.toFixed(2)} <span class="kpi-unit">hrs</span></div>
              <div class="kpi-sub">Today: ${kpis.totalHoursToday.toFixed(2)} hrs logged</div>
            </div>

            <div class="kpi-card">
              <div class="kpi-label">Dominant Activity</div>
              <div class="kpi-val kpi-val-text">${esc(kpis.topCategory === "N/A" ? "None yet" : kpis.topCategory)}</div>
              <div class="kpi-sub">${report.categorySummary.length} active categories</div>
            </div>

            <div class="kpi-card">
              <div class="kpi-label">Daily Average (7d)</div>
              <div class="kpi-val">${kpis.avgDailyHours7d.toFixed(2)} <span class="kpi-unit">hrs</span></div>
              <div class="kpi-sub">${report.totalSessions} total sessions</div>
            </div>

            <div class="kpi-card">
              <div class="kpi-label">Distraction Share</div>
              <div class="kpi-val" style="color:${kpis.distractionPct > 20 ? "var(--apple-color-red)" : "var(--apple-color-label)"}">${kpis.distractionPct.toFixed(1)}<span class="kpi-unit">%</span></div>
              <div class="kpi-sub">Focus score: ${kpis.focusScore.toFixed(1)}%</div>
            </div>
          </div>

          <div class="chart-grid-2">
            <div class="card">
              <div class="card-title">
                <h3>Time by Category</h3>
                <span style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2)">${esc(rangeLabel)}</span>
              </div>
              ${renderDonut(report.categorySummary, kpis.totalHoursRange, rangeLabel)}
            </div>

            <div class="card">
              <div class="card-title">
                <h3>7-Day Trend</h3>
                <div class="seg-pills" role="group" aria-label="Trend series">
                  <button type="button" data-trend="focus-vs-distraction" aria-pressed="${ui.trendMode === "focus-vs-distraction"}" class="${ui.trendMode === "focus-vs-distraction" ? "active" : ""}">Focus vs Distraction</button>
                  <button type="button" data-trend="total" aria-pressed="${ui.trendMode === "total"}" class="${ui.trendMode === "total" ? "active" : ""}">Total vs Dev</button>
                </div>
              </div>
              ${renderTrendChart(report.dailyTrend, ui.trendMode)}
            </div>
          </div>

          <div class="card" style="margin-top:var(--apple-space-5)">
            <div class="card-title">
              <h3>28-Day Focus Consistency</h3>
              <span style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-green);font-weight:600">${kpis.streakDays || 0}-day streak · Goal ${kpis.dailyGoalHours || 4}h/day</span>
            </div>
            ${heatmapHtml}
          </div>

          <div class="card" style="margin-top:var(--apple-space-5)">
            <div class="card-title">
              <h3>Hourly Focus Rhythm</h3>
              <span style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2)">Minutes per hour (${esc(rangeLabel)})</span>
            </div>
            ${renderHourlyBars(report.hourly || [])}
          </div>

          <div class="card" style="margin-top:var(--apple-space-5)">
            <div class="card-title">
              <h3>Top Activities</h3>
              <span style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2)">Select a project chip to lock onto it in Orbit HUD</span>
            </div>
            ${topActivitiesHtml}
          </div>

          <div class="card" style="margin-top:var(--apple-space-5)">
            <div class="card-title">
              <div class="seg-pills" role="group" aria-label="Activity details">
                <button type="button" data-btab="recent" aria-pressed="${ui.bottomTab === "recent"}" class="${ui.bottomTab === "recent" ? "active" : ""}">Recent Sessions (${report.recentSessions.length})</button>
                <button type="button" data-btab="rules" aria-pressed="${ui.bottomTab === "rules"}" class="${ui.bottomTab === "rules" ? "active" : ""}">Category Rules</button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                <a class="btn btn-tinted" href="/api/habits/export?format=csv" download="panda-orbit-habits.csv" style="text-decoration:none">Export CSV</a>
                <a class="btn btn-tinted" href="/api/habits/export?format=json" download="panda-orbit-habits.json" style="text-decoration:none">Export JSON</a>
                <button type="button" class="btn btn-tinted" id="hb-seed-more">Add Sample Data</button>
                <button type="button" class="btn btn-destructive" id="hb-clear-db">Clear History</button>
              </div>
            </div>
            ${ui.bottomTab === "recent" ? recentHtml : rulesHtml}
          </div>
        ` : ""}
      </div>
    `;

    // Immediately populate canvas & terminal
    if (busState) updateLiveTelemetry(busState);

    // Terminal input handlers
    const termForm = container.querySelector("#habit-term-form");
    const termInput = container.querySelector("#habit-term-input");
    if (termForm && termInput) {
      termForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const val = termInput.value.trim();
        if (!val) return;
        ui.cmdHistory.push(val);
        ui.cmdCursor = ui.cmdHistory.length;
        termInput.value = "";
        await onRunCommand(val);
      });
      termInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (ui.cmdCursor > 0) {
            ui.cmdCursor--;
            termInput.value = ui.cmdHistory[ui.cmdCursor] || "";
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (ui.cmdCursor < ui.cmdHistory.length - 1) {
            ui.cmdCursor++;
            termInput.value = ui.cmdHistory[ui.cmdCursor] || "";
          } else {
            ui.cmdCursor = ui.cmdHistory.length;
            termInput.value = "";
          }
        }
      });
    }

    container.querySelectorAll("[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.range = btn.dataset.range;
        onChangeRange(ui.range);
      });
    });

    container.querySelectorAll("[data-trend]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.trendMode = btn.dataset.trend;
        render({ report, tracker, categories, projectNames, busState, summaryData, docsConfig, lastDocResult });
      });
    });

    container.querySelectorAll("[data-btab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.bottomTab = btn.dataset.btab;
        render({ report, tracker, categories, projectNames, busState, summaryData, docsConfig, lastDocResult });
      });
    });

    container.querySelector("#hb-toggle-logger")?.addEventListener("click", () => {
      ui.showLogger = !ui.showLogger;
      render({ report, tracker, categories, projectNames, busState, summaryData, docsConfig, lastDocResult });
    });

    container.querySelector("#sum-setup-toggle")?.addEventListener("click", () => {
      ui.showDocsSetup = !ui.showDocsSetup;
      render({ report, tracker, categories, projectNames, busState, summaryData, docsConfig, lastDocResult });
    });

    container.querySelector("#sum-copy-gdocs")?.addEventListener("click", () => onCopySummary?.(summaryData));
    container.querySelector("#sum-save-md")?.addEventListener("click", () => onSaveSummaryDoc?.(ui.range));
    container.querySelector("#sum-send-gdocs")?.addEventListener("click", () => {
      if (!docsConfig?.hasWebhook && !docsConfig?.hasApiToken) {
        ui.showDocsSetup = true;
        render({ report, tracker, categories, projectNames, busState, summaryData, docsConfig, lastDocResult });
        return;
      }
      onPublishGoogleDocs?.(ui.range);
    });

    container.querySelector("#gdocs-cfg-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const webhookUrl = container.querySelector("#gd-webhook")?.value.trim();
      const docId = container.querySelector("#gd-docid")?.value.trim();
      const payload = {};
      if (webhookUrl) payload.webhookUrl = webhookUrl;
      payload.docId = docId;
      onSaveDocsConfig?.(payload);
      ui.showDocsSetup = false;
    });

    container.querySelector("#hb-track-btn")?.addEventListener("click", () => onToggleTracker());
    container.querySelector("#hb-empty-track")?.addEventListener("click", () => onToggleTracker());
    container.querySelector("#hb-empty-seed")?.addEventListener("click", () => onSeedHabits());
    container.querySelector("#hb-seed-more")?.addEventListener("click", () => onSeedHabits());
    container.querySelector("#hb-empty-log")?.addEventListener("click", () => {
      ui.showLogger = true;
      render({ report, tracker, categories, projectNames, busState });
    });

    container.querySelector("#hb-clear-db")?.addEventListener("click", () => {
      if (confirm("Clear all recorded activity sessions from the database?")) onClearHabits();
    });

    container.querySelector("#habit-log-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const appName = container.querySelector("#hl-app").value.trim();
      const windowTitle = container.querySelector("#hl-title").value.trim();
      const durationMinutes = Number(container.querySelector("#hl-mins").value);
      if (!appName || !windowTitle || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
        form.classList.remove("shake");
        void form.offsetWidth;
        form.classList.add("shake");
        return;
      }
      onLogSession({ appName, windowTitle, durationMinutes });
      ui.showLogger = false;
    });

    container.querySelectorAll("[data-jump-proj]").forEach((btn) => {
      btn.addEventListener("click", () => onJumpProject(btn.dataset.jumpProj));
    });

    container.querySelectorAll("[data-rm-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        onUpdateCategory?.({ category: btn.dataset.rmCat, keyword: btn.dataset.rmKw, action: "remove" });
      });
    });

    container.querySelectorAll("[data-add-cat]").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const inp = form.querySelector("input");
        const kw = inp?.value.trim();
        if (!kw) return;
        inp.value = "";
        onUpdateCategory?.({ category: form.dataset.addCat, keyword: kw, action: "add" });
      });
    });
  }

  return { render, updateLiveTelemetry, getRange: () => ui.range };
}
