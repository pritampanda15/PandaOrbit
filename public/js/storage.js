// ─────────────────────────────────────────────────────────────
//  Storage & Disk Analyzer View
//  Apple Storage + DaisyDisk inspired analyzer showing volume
//  usage, drillable heaviest folders ("what occupies what"),
//  reclaimable dev caches/bloat, category donut, and top 50
//  heaviest individual files with 1-click Reveal in Finder.
// ─────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DISK_CAT_COLOR = {
  "Workspaces & Projects": "var(--apple-color-tint)",
  "Models & Scientific Data": "var(--apple-color-indigo)",
  "Dev Caches & Deps": "var(--apple-color-orange)",
  "Media & Video": "var(--apple-color-red)",
  "Archives & Installers": "var(--apple-color-teal)",
  "Documents": "var(--apple-color-green)",
  "Code & Config": "var(--apple-color-tint)",
  "Other": "var(--apple-color-label-3)"
};
const catCol = (c) => DISK_CAT_COLOR[c] || "var(--apple-color-label-3)";

function fmtBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
}

function fmtDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderCategoryDonut(categories, totalBytes) {
  if (!categories?.length || totalBytes <= 0) {
    return `<p style="margin:0;color:var(--apple-color-label-2);font-size:var(--apple-type-footnote-size)">No storage breakdown available.</p>`;
  }
  const r = 64, cx = 82, cy = 82, circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = categories.map((c) => {
    const frac = c.bytes / totalBytes;
    const len = Math.max(0.6, frac * circ);
    const col = catCol(c.category);
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="20"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">
      <title>${esc(c.category)}: ${fmtBytes(c.bytes)} (${c.pct}%)</title></circle>`;
    offset += len;
    return seg;
  }).join("");

  const legend = categories.map((c) => `
    <div class="legend-item">
      <div class="legend-left">
        <span class="swatch" style="background:${catCol(c.category)}" aria-hidden="true"></span>
        <span>${esc(c.category)}</span>
      </div>
      <div class="legend-right"><strong>${fmtBytes(c.bytes)}</strong> · ${c.pct}%</div>
    </div>
  `).join("");

  return `
    <div class="donut-layout" style="gap:18px">
      <svg width="164" height="164" viewBox="0 0 164 164" class="donut-svg" role="img" aria-label="Storage breakdown totaling ${fmtBytes(totalBytes)}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--apple-color-fill-2)" stroke-width="20"/>
        ${arcs}
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="var(--apple-color-label)" font-size="18" font-weight="700" style="font-variant-numeric:tabular-nums">${fmtBytes(totalBytes)}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--apple-color-label-2)" font-size="10">scanned</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

export function createStorageView({ container, onLoadDisk, onOpenFolder }) {
  const ui = {
    scope: "home",
    customPath: null,
    fileSearch: "",
    fileCat: "all"
  };

  function render({ diskData, loading, error }) {
    if (loading && !diskData) {
      container.innerHTML = `
        <div class="container">
          <div class="page-head">
            <div>
              <h1>Storage &amp; Disk Analyzer</h1>
              <p>Scanning volumes, heaviest folders, dev caches, and largest files…</p>
            </div>
          </div>
          <div class="empty-state">
            <h3>Analyzing Disk Footprint…</h3>
            <p>Running parallel folder sizing and heavy file scan across your home directory. This usually takes 2–6 seconds.</p>
          </div>
        </div>
      `;
      return;
    }

    if (error && !diskData) {
      container.innerHTML = `
        <div class="container">
          <div class="page-head">
            <div><h1>Storage &amp; Disk Analyzer</h1><p>Could not complete disk scan.</p></div>
            <button type="button" class="btn btn-filled" id="st-retry">Retry Scan</button>
          </div>
          <div class="empty-state">
            <h3>Scan Error</h3>
            <p>${esc(error)}</p>
          </div>
        </div>
      `;
      container.querySelector("#st-retry")?.addEventListener("click", () => onLoadDisk({ scope: ui.scope, path: ui.customPath, refresh: true }));
      return;
    }

    if (!diskData) {
      container.innerHTML = `
        <div class="container">
          <div class="page-head">
            <div>
              <h1>Storage &amp; Disk Analyzer</h1>
              <p>See what occupies your disk, locate heavy files, and spot reclaimable dev caches.</p>
            </div>
            <button type="button" class="btn btn-filled" id="st-start-scan">Scan Home Disk</button>
          </div>
          <div class="empty-state">
            <h3>Ready to Analyze Storage</h3>
            <p>Inspect volume capacity, heaviest folders, top 50 largest files, and developer caches like node_modules, .venv, .cache, and Library caches.</p>
            <div class="empty-actions">
              <button type="button" class="btn btn-filled btn-lg" id="st-start-scan-2">Analyze Home Directory (~)</button>
            </div>
          </div>
        </div>
      `;
      container.querySelector("#st-start-scan")?.addEventListener("click", () => onLoadDisk({ scope: "home", refresh: true }));
      container.querySelector("#st-start-scan-2")?.addEventListener("click", () => onLoadDisk({ scope: "home", refresh: true }));
      return;
    }

    const vol = diskData.volume || {};
    const sc = diskData.scanned || {};
    const bloat = diskData.bloat || { totalBytes: 0, count: 0, items: [] };
    const topFolders = diskData.topFolders || [];
    const heavyFiles = diskData.heavyFiles || [];
    const categories = diskData.categories || [];

    const pct = Math.min(100, Math.max(0, vol.capacityPct || 0));
    const volColor = pct >= 90 ? "var(--apple-color-red)" : pct >= 75 ? "var(--apple-color-orange)" : "var(--apple-color-tint)";

    // Filter heavy files
    const q = ui.fileSearch.trim().toLowerCase();
    const fileCats = ["all", ...new Set(heavyFiles.map((f) => f.category))];
    const filteredFiles = heavyFiles.filter((f) => {
      if (ui.fileCat !== "all" && f.category !== ui.fileCat) return false;
      if (q && !`${f.name} ${f.relPath} ${f.category}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const maxFolderBytes = Math.max(1, topFolders[0]?.bytes || 1);
    const foldersHtml = topFolders.length
      ? `<div class="hbar-list">` + topFolders.map((f) => {
          const wPct = Math.max(2, (f.bytes / maxFolderBytes) * 100);
          return `
            <div class="disk-folder-row">
              <div class="hbar-label">
                <div style="display:flex;align-items:center;gap:6px;min-width:0">
                  ${f.isDir
                    ? `<button type="button" class="folder-drill-btn" data-drill="${esc(f.path)}" title="Drill into ${esc(f.name)}">${esc(f.name)}</button>`
                    : `<span class="hbar-title">${esc(f.name)}</span>`}
                  ${f.partial ? `<span class="kw-tag" title="Large folder partially timed out">partial+</span>` : ""}
                </div>
                <div class="hbar-sub">${f.pct}% of scanned total</div>
              </div>
              <div class="hbar-track" aria-hidden="true">
                <div class="hbar-fill" style="width:${wPct.toFixed(1)}%;background:var(--apple-color-tint)"></div>
              </div>
              <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
                <span class="hbar-val">${fmtBytes(f.bytes)}</span>
                <button type="button" class="mini-open" data-reveal="${esc(f.path)}">Reveal</button>
              </div>
            </div>
          `;
        }).join("") + `</div>`
      : `<p style="margin:0;color:var(--apple-color-label-2);font-size:var(--apple-type-footnote-size)">No folders measured in this directory.</p>`;

    const bloatHtml = bloat.items.length
      ? `<div class="session-log-list">` + bloat.items.slice(0, 14).map((b) => `
          <div class="session-row">
            <div class="session-row-left">
              <div class="session-row-title">${esc(b.name)}</div>
              <div class="session-row-meta">${esc(b.relPath)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              <strong style="font-variant-numeric:tabular-nums;color:var(--apple-color-orange)">${fmtBytes(b.bytes)}</strong>
              <button type="button" class="mini-open" data-reveal="${esc(b.path)}">Reveal</button>
            </div>
          </div>
        `).join("") + `</div>`
      : `<p style="margin:0;color:var(--apple-color-label-2);font-size:var(--apple-type-footnote-size)">No major dev caches (&ge;10 MB) detected in this scope.</p>`;

    const filesTableHtml = filteredFiles.length
      ? `<div class="table-wrap">
          <table class="proj-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Category</th>
                <th>Modified</th>
                <th class="num">Size</th>
                <th class="num">Action</th>
              </tr>
            </thead>
            <tbody>
              ${filteredFiles.map((f) => `
                <tr>
                  <td>
                    <div style="font-weight:600;color:var(--apple-color-label);word-break:break-word">${esc(f.name)}</div>
                    <div style="font-size:11.5px;color:var(--apple-color-label-2);font-family:var(--apple-font-mono);word-break:break-all">${esc(f.relPath)}</div>
                  </td>
                  <td>
                    <span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">
                      <span class="swatch" style="width:8px;height:8px;background:${catCol(f.category)}" aria-hidden="true"></span>
                      ${esc(f.category)}
                    </span>
                  </td>
                  <td style="color:var(--apple-color-label-2);white-space:nowrap">${fmtDate(f.mtimeMs)}</td>
                  <td class="num" style="font-weight:700;white-space:nowrap">${fmtBytes(f.bytes)}</td>
                  <td class="num"><button type="button" class="mini-open" data-reveal="${esc(f.path)}">Reveal</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`
      : `<p style="text-align:center;padding:24px;color:var(--apple-color-label-2);margin:0;">No heavy files (&ge;${sc.minHeavyMB || 1} MB) match the current filter.</p>`;

    container.innerHTML = `
      <div class="container">
        <div class="page-head">
          <div>
            <h1>Storage &amp; Disk Analyzer</h1>
            <p>${esc(sc.rootPath)} &middot; Scanned in ${(sc.durationMs / 1000).toFixed(1)}s${loading ? " · Refreshing…" : ""}</p>
          </div>
          <div class="head-controls">
            <div class="seg-pills" role="group" aria-label="Disk scope">
              ${[["home", "Home (~)"], ["downloads", "Downloads"], ["documents", "Documents"], ["desktop", "Desktop"]].map(([id, lbl]) =>
                `<button type="button" data-dscope="${id}" aria-pressed="${!ui.customPath && ui.scope === id}" class="${!ui.customPath && ui.scope === id ? "active" : ""}">${lbl}</button>`
              ).join("")}
            </div>
            ${sc.parentPath ? `<button type="button" class="btn btn-tinted" id="st-up" data-drill="${esc(sc.parentPath)}">← Up</button>` : ""}
            <button type="button" class="btn btn-tinted" id="st-open-root" data-reveal="${esc(sc.rootPath)}">Open Folder</button>
            <button type="button" class="btn btn-filled" id="st-refresh" ${loading ? "disabled" : ""}>${loading ? "Scanning…" : "Rescan Disk"}</button>
          </div>
        </div>

        <!-- macOS System Volume Bar -->
        <div class="card" style="margin-bottom:var(--apple-space-5)">
          <div class="card-title" style="margin-bottom:10px">
            <h3>System Disk Capacity (${esc(vol.mount || "/")})</h3>
            <span style="font-variant-numeric:tabular-nums;font-weight:600;color:${volColor}">
              ${fmtBytes(vol.usedBytes)} of ${fmtBytes(vol.totalBytes)} used · ${fmtBytes(vol.availBytes)} free (${pct}%)
            </span>
          </div>
          <div class="vol-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Disk capacity used">
            <div class="vol-bar-fill" style="width:${pct}%;background:${volColor}"></div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Disk Used</div>
            <div class="kpi-val" style="color:${volColor}">${pct}<span class="kpi-unit">%</span></div>
            <div class="kpi-sub">${fmtBytes(vol.availBytes)} available on volume</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Scanned Scope</div>
            <div class="kpi-val">${fmtBytes(sc.totalBytes)}</div>
            <div class="kpi-sub">${sc.folderCount} top-level entries in ${esc(sc.rootName)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Dev Caches &amp; Bloat</div>
            <div class="kpi-val" style="color:var(--apple-color-orange)">${fmtBytes(bloat.totalBytes)}</div>
            <div class="kpi-sub">${bloat.count} rebuildable cache/dependency folders</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Heaviest File</div>
            <div class="kpi-val">${heavyFiles[0] ? fmtBytes(heavyFiles[0].bytes) : "—"}</div>
            <div class="kpi-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${heavyFiles[0] ? esc(heavyFiles[0].name) : "No files >= threshold"}</div>
          </div>
        </div>

        <div class="dash-split">
          <div class="card">
            <div class="card-title">
              <h3>What Occupies What (Click a Folder to Drill Down)</h3>
              <span style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-label-2)">${topFolders.length} heaviest entries</span>
            </div>
            ${foldersHtml}
          </div>

          <div>
            <div class="card">
              <div class="card-title">
                <h3>Space by Category</h3>
              </div>
              ${renderCategoryDonut(categories, sc.totalBytes)}
            </div>

            <div class="card">
              <div class="card-title">
                <h3>Dev Caches &amp; Bloat</h3>
                <span style="font-size:var(--apple-type-caption-1-size);color:var(--apple-color-orange);font-weight:600">${fmtBytes(bloat.totalBytes)}</span>
              </div>
              ${bloatHtml}
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:var(--apple-space-6)">
          <div class="card-title">
            <h3>Heavy Files (${filteredFiles.length} &ge; ${sc.minHeavyMB || 1} MB)</h3>
          </div>
          <div class="filter-bar">
            <label class="sr-only" for="st-file-search">Search heavy files</label>
            <input id="st-file-search" class="search-input" type="search" placeholder="Filter by filename, extension, or folder path…" value="${esc(ui.fileSearch)}">
            <div class="seg-pills" role="group" aria-label="Filter heavy files by category">
              ${fileCats.slice(0, 6).map((c) =>
                `<button type="button" data-fcat="${esc(c)}" aria-pressed="${ui.fileCat === c}" class="${ui.fileCat === c ? "active" : ""}">${c === "all" ? "All" : esc(c.split(" ")[0])}</button>`
              ).join("")}
            </div>
          </div>
          ${filesTableHtml}
        </div>
      </div>
    `;

    // Wire events
    container.querySelectorAll("[data-dscope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.scope = btn.dataset.dscope;
        ui.customPath = null;
        ui.fileCat = "all";
        onLoadDisk({ scope: ui.scope, path: null, refresh: false });
      });
    });

    container.querySelectorAll("[data-drill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.customPath = btn.dataset.drill;
        ui.fileCat = "all";
        onLoadDisk({ scope: "path", path: ui.customPath, refresh: false });
      });
    });

    container.querySelector("#st-refresh")?.addEventListener("click", () => {
      onLoadDisk({ scope: ui.scope, path: ui.customPath, refresh: true });
    });

    container.querySelectorAll("[data-reveal]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onOpenFolder(btn.dataset.reveal);
      });
    });

    const fSearch = container.querySelector("#st-file-search");
    if (fSearch) {
      fSearch.addEventListener("input", () => {
        ui.fileSearch = fSearch.value;
        const pos = fSearch.selectionStart;
        render({ diskData, loading, error });
        const next = container.querySelector("#st-file-search");
        if (next) { next.focus(); next.setSelectionRange(pos, pos); }
      });
    }

    container.querySelectorAll("[data-fcat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.fileCat = btn.dataset.fcat;
        render({ diskData, loading, error });
      });
    });
  }

  return { render };
}
