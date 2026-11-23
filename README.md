<div align="center">

<img src="docs/panda-orbit.svg" width="840" alt="PandaOrbit — Personal Workspace, Focus Telemetry, and Storage Command Center">

# PandaOrbit

**Your repositories, live focus telemetry, and system storage — unified in one local command center.**

Zero npm dependencies · Node 18+ · 100% local &amp; private.

</div>

---

## Four Unified Views

Switch seamlessly from the top segmented bar (or press `1`, `2`, `3`, `4`, or `⌘K` from anywhere):

1. **Dashboard** — System-wide workspace overview across every git repository on your machine (`~`). Includes a Daily Focus Goal Ring, Domain health cards, searchable/sortable Project Explorer (Cards &amp; Table), Today's Activity split, and automatic **Focus by Project** correlation.
2. **Orbit HUD** — A holographic tactical constellation with multi-shell anti-collision orbital rings, counter-rotating Arc-Reactor core, rotating lidar sweep, and four optical modes (`JARVIS`, `NVG`, `FLIR`, `CRT`). Clicking any node smoothly flies in and unfurls an interactive 360° schematic branch showing live subfolders (click to drill deeper), files with in-HUD Quick-Look preview, git commit timeline, README/notes plate, inline status pinning, and 1-click 25m Focus Sprints.
3. **Habits & Live Telemetry** — Real-time Server-Sent Events (SSE) Focus Signal Oscilloscope, interactive command terminal (`panda@orbit:~$`), 28-Day Focus Consistency Heatmap, Category Donut, 7-Day Trend, 24-Hour Focus Rhythm, live Category Rules editor, CSV/JSON export, and a **Work Summary & Google Docs Publisher**.
4. **Storage** — System-wide APFS-accurate **Disk & Heavy Files Analyzer** showing volume usage, drillable heaviest folders ("what occupies what"), category breakdown donut, reclaimable **Dev Caches & Bloat** (`node_modules`, `.venv`, `.cache`, `.npm`, `Library/Caches`, `target`, etc.), and a searchable **Top 50 Heavy Files** table with 1-click Reveal in Finder.

---

## Quick Start

```bash
# Auto-discover all git repos across ~ and launch PandaOrbit with live activity tracking
node bin/panda-orbit.mjs --track --open

# Or target specific workspace folders
node bin/panda-orbit.mjs ~/code ~/Documents/research --track --open
```

### Auto-Start on Login & Double-Click macOS App (No Terminal Required)

```bash
# 1. Run silently in the background automatically on every login (macOS LaunchAgent / Linux systemd)
node bin/panda-orbit.mjs autostart on
node bin/panda-orbit.mjs autostart status
node bin/panda-orbit.mjs autostart off

# 2. Build a double-clickable PandaOrbit.app in ~/Applications (Spotlight & Dock ready)
node bin/panda-orbit.mjs create-app
```

---

## CLI Reference

```bash
panda-orbit [paths...]                     # auto-discover all repos system-wide (or scan given paths)
panda-orbit discover                       # list all git repositories discovered across ~
panda-orbit disk [path]                    # inspect disk space, heaviest folders, files & dev bloat
panda-orbit scan [paths...]                # rescan repositories only, without serving
panda-orbit init [paths...]                # write a starter panda-orbit.config.json
panda-orbit track                          # run standalone foreground window activity tracker
panda-orbit summary [paths...]             # generate Daily/Weekly Work Summary (.md / Google Docs)
panda-orbit autostart on|off|status        # manage background auto-start on login
panda-orbit create-app                     # create native macOS PandaOrbit.app launcher
panda-orbit demo [paths...] -o orbit.svg   # render an animated SVG constellation
```

| Flag | Description |
|---|---|
| `--system` | Auto-discover all git repositories across `~` (default when no paths are passed) |
| `--cwd` | Scan only the current working directory |
| `--port <n>` | Port to serve on (default `4173`) |
| `--out <dir>` | Local data directory for `data.js`, `overrides.json`, `activity_tracker.db`, and `reports/` (default `~/.panda-orbit`) |
| `--config <file>` | Custom config file (`panda-orbit.config.json`) |
| `--categories <file>` | Custom activity `categories.json` |
| `--db <file>` | Custom SQLite activity database path |
| `--range <r>` | Summary range: `today` \| `7d` \| `30d` \| `all` |
| `--save` | Save generated summary to `<out>/reports/` |
| `--gdocs` | Publish generated summary directly to Google Docs |
| `--track` | Start foreground window tracking on server boot |
| `--seed-habits` | Seed 7-day sample activity sessions if the database is empty |
| `--open` | Open PandaOrbit in your default browser |

---

## Work Summaries & Google Docs Integration

From **Habits → Work Summary & Google Docs** (or via `panda-orbit summary` / `⌘K`):

- **Copy for Google Docs**: Copies rich formatted HTML + plain text to clipboard so pasting (`⌘V`) into `docs.new` preserves headings, tables, and bullets.
- **Save Local Docs**: Saves timestamped Markdown reports into `~/.panda-orbit/reports/`.
- **Automated Google Docs Push**: Deploy the included 35-line Apps Script [docs/google-docs-bridge.gs](docs/google-docs-bridge.gs) at `script.google.com` as a Web App and paste the URL in **Settings** — or set `PANDA_ORBIT_GDOCS_TOKEN` to use the Google Docs REST API v1 directly.

---

## Project Structure

```text
├── bin/
│   └── panda-orbit.mjs               # CLI entrypoint
├── lib/
│   ├── config.mjs                    # Config & categories loader
│   ├── discover.mjs                  # System-wide git repository discovery
│   ├── scan.mjs                      # Filesystem & git metadata scanner
│   ├── disk.mjs                      # Disk usage, heavy files & dev bloat analyzer
│   ├── habits.mjs                    # SQLite activity & focus analytics engine
│   ├── tracker.mjs                   # Cross-platform foreground window tracker
│   ├── summary.mjs                   # Daily/weekly Work Summary generator
│   ├── gdocs.mjs                     # Google Docs webhook & REST API publisher
│   ├── service.mjs                   # macOS LaunchAgent / Linux systemd / .app builder
│   ├── server.mjs                    # Local HTTP + SSE server
│   ├── demo.mjs                      # Animated SVG portrait renderer
│   └── syntax-check.mjs              # Frontend & backend syntax checker
├── tracker/
│   └── backend.py                    # Optional standalone Python window tracker (macOS/Linux X11)
├── public/
│   ├── index.html                    # Unified SPA shell & ⌘K Command Palette
│   ├── styles.css                    # Light/Dark semantic token system & HUD styles
│   └── js/
│       ├── app.js                    # Controller, SSE bus, ⌘K palette, Focus Sprint timer
│       ├── dashboard.js              # Dashboard view
│       ├── orbit.js                  # Holographic Orbit HUD & 360° branch expansion
│       ├── habits.js                 # Live telemetry, analytics & Work Summary view
│       ├── storage.js                # Disk & heavy files analyzer view
│       └── telemetry.js              # Real-time signal oscilloscope & interactive terminal
├── docs/
│   ├── panda-orbit.svg               # Animated hero emblem
│   └── google-docs-bridge.gs         # Google Apps Script bridge for Google Docs
├── categories.json                   # Default activity categorization rules
├── panda-orbit.config.example.json   # Starter domain & habit config
└── LICENSE
```

---

## Security & Privacy

- Binds strictly to `127.0.0.1` — nothing leaves your machine unless you explicitly trigger a Google Docs publish.
- `POST /open`, `GET /api/inspect`, `GET /api/preview`, and `GET /api/disk` resolve symlinks via `realpath` and enforce strict containment inside your allowed workspace / home directory.
- Activity logs, personal notes, and reports stay 100% local in `~/.panda-orbit/`.

---

## License

MIT
