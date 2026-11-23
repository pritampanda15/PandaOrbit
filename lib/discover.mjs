// ─────────────────────────────────────────────────────────────
//  PandaOrbit System-Wide Repository Discovery.
//
//  Scans the user's home directory safely and quickly (skipping
//  OS/TCC-protected and package/cache directories) to find all
//  git repositories across the machine, grouping them by their
//  parent workspace roots.
// ─────────────────────────────────────────────────────────────

import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";

const SKIP_DIRS = new Set([
  "Library", "Applications", "Movies", "Music", "Pictures", "Public", "Sites",
  "node_modules", "venv", ".venv", "env", "__pycache__", "site-packages",
  "dist", "build", "target", "vendor", "coverage", "out",
  "miniconda", "miniconda3", "anaconda", "anaconda3", "miniforge3", "mambaforge",
  "micromamba", "opt", "go", "Android", "Xcode", "DerivedData", "Pods"
]);

export function discoverSystemRepos({
  baseDir = homedir(),
  maxDepth = 4,
  maxRepos = 250
} = {}) {
  const start = Date.now();
  const home = resolve(baseDir);
  const repos = [];
  let scannedDirs = 0;

  function walk(dir, depth) {
    if (depth > maxDepth || repos.length >= maxRepos) return;
    scannedDirs++;

    // If this folder itself is a git repo (at depth >= 1), record it and stop descending into it
    if (depth >= 1 && existsSync(join(dir, ".git"))) {
      repos.push(dir);
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission denied or unreadable
    }

    for (const ent of entries) {
      if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
      const name = ent.name;
      if (name.startsWith(".") || SKIP_DIRS.has(name) || name.endsWith(".app") || name.endsWith(".photoslibrary")) {
        continue;
      }
      walk(join(dir, name), depth + 1);
      if (repos.length >= maxRepos) break;
    }
  }

  walk(home, 0);

  // Group discovered repos by their immediate parent directory (= workspace roots)
  const parentCounts = new Map();
  for (const r of repos) {
    const parent = dirname(r);
    parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
  }

  // Sort roots: workspaces with the most repos first, excluding bare home unless needed
  const roots = [...parentCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([root]) => root);

  return {
    baseDir: home,
    roots,
    repos,
    repoCount: repos.length,
    rootCount: roots.length,
    scannedDirs,
    durationMs: Date.now() - start
  };
}
