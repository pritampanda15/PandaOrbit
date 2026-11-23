// ─────────────────────────────────────────────────────────────
//  PandaOrbit Config & Category Resolution.
//  Supports panda-orbit.config.json, pandaorbit.config.json,
//  and legacy orrery.config.json, plus HabitBoard categories.json.
// ─────────────────────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  name: "PandaOrbit",

  // Age buckets, in days.
  activeDays: 7,
  dormantDays: 30,

  // Folders that are plumbing rather than substance.
  skip: [
    "^\\.", "^__pycache__$", "^node_modules$", "^venv$", "^env$", "^\\.venv$",
    "^dist$", "^build$", "^target$", "^vendor$", "^coverage$",
    "\\.egg-info$", "^\\.pytest_cache$", "^xtb_cache$"
  ],

  // Top-level entries never treated as projects.
  ignore: ["docs", "node_modules", "tmp"],

  // How fast the orbital wheel turns, degrees per second. 0 stops it.
  spin: 0.15,

  // Default UI view on load: "dashboard" | "orbit" | "habits"
  defaultView: "dashboard",

  // HabitBoard analytics defaults.
  habits: {
    pollSeconds: 2,
    dailyGoalHours: 4,
    distractionCategories: ["Distraction & Leisure"],
    productiveCategories: ["Development", "Writing & Docs", "Web/Research"]
  },

  // Empty = one wedge per project, hues spread automatically.
  // Populate it to group projects into named domains.
  domains: []
};

export const DEFAULT_CATEGORIES = {
  "Development": [
    "VS Code", "Visual Studio Code", "Code", "Cursor", "Antigravity", "PyCharm",
    "IntelliJ", "WebStorm", "Xcode", "sublime_text", "Sublime Text", "jetbrains",
    "vim", "nvim", "Terminal", "iTerm2", "Warp", "kitty", "Alacritty",
    "gnome-terminal-server", "Git", "GitHub", "GitLab", "Bitbucket", "Jira", "Trello", "Docker"
  ],
  "Communication": [
    "Slack", "Zoom", "Thunderbird", "Gmail", "Mail", "Messages",
    "Microsoft Teams", "Discord", "Skype", "Outlook", "WhatsApp", "Telegram", "Calendar"
  ],
  "Writing & Docs": [
    "Google Docs", "Microsoft Word", "LibreOffice", "Notion", "Obsidian", "Confluence",
    "OneNote", "Evernote", "Notes", "Pages", "Keynote", "Markdown", "PDF", "Preview",
    "Acrobat", "Sheets", "Excel", "Presentation", "Figma"
  ],
  "Distraction & Leisure": [
    "Twitter", "X.com", "Reddit", "YouTube", "Netflix", "Spotify", "Twitch",
    "Facebook", "Instagram", "TikTok", "Game", "Steam", "Hulu"
  ],
  "Web/Research": [
    "firefox", "Firefox", "chrome", "Google Chrome", "Safari", "Arc", "Brave",
    "Google Search", "DuckDuckGo", "Bing", "Stack Overflow", "Wikipedia",
    "MDN Web Docs", "arXiv", "PubMed", "documentation", "tutorial"
  ],
  "System & Utilities": [
    "Finder", "nautilus", "System Settings", "settings", "Activity Monitor",
    "System Monitor", "gimp", "inkscape", "calculator", "disk usage"
  ]
};

export const CATEGORY_COLORS = {
  "Development": "#f2a93b",
  "Web/Research": "#6ea8fe",
  "Writing & Docs": "#63d297",
  "Communication": "#b58cff",
  "System & Utilities": "#5ec6c6",
  "Distraction & Leisure": "#f06e6e",
  "Uncategorized": "#8a8f9e"
};

const GLYPHS = ["◈", "◍", "◇", "⬡", "⟁", "◎", "◉", "✦", "⬢", "○", "◆", "❖"];

// Evenly spaced hues, offset so adjacent wedges never sit in the same family.
export const autoHue = (i, n) => Math.round((i * 360) / Math.max(n, 1) + 20) % 360;
export const autoGlyph = (i) => GLYPHS[i % GLYPHS.length];

export async function loadConfig(explicit, root, cwd = process.cwd()) {
  const candidates = [
    explicit,
    root && join(root, "panda-orbit.config.json"),
    root && join(root, "pandaorbit.config.json"),
    root && join(root, "orrery.config.json"),
    join(cwd, "panda-orbit.config.json"),
    join(cwd, "pandaorbit.config.json"),
    join(cwd, "orrery.config.json")
  ].filter(Boolean);

  const tried = [];
  for (const p of candidates) {
    if (tried.includes(p)) continue;
    tried.push(p);
    try {
      const raw = JSON.parse(await readFile(p, "utf8"));
      return {
        ...DEFAULTS,
        ...raw,
        habits: { ...DEFAULTS.habits, ...(raw.habits || {}) },
        _from: p
      };
    } catch (e) {
      if (e.code !== "ENOENT") throw new Error(`${p}: ${e.message}`);
    }
  }
  return { ...DEFAULTS, _from: null, _tried: tried };
}

export async function loadCategories(explicit, outDir, root, cwd = process.cwd()) {
  const candidates = [
    explicit,
    outDir && join(outDir, "categories.json"),
    root && join(root, "categories.json"),
    join(cwd, "categories.json"),
    join(PKG_ROOT, "categories.json")
  ].filter(Boolean);

  const tried = [];
  for (const p of candidates) {
    if (tried.includes(p)) continue;
    tried.push(p);
    try {
      const raw = JSON.parse(await readFile(p, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return { categories: raw, _from: p };
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw new Error(`${p}: ${e.message}`);
    }
  }
  return { categories: DEFAULT_CATEGORIES, _from: null };
}

// `match` entries are exact folder names or `prefix*` globs.
export const matches = (name, patterns = []) =>
  patterns.some((p) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : p === name));
