// ─────────────────────────────────────────────────────────────
//  PandaOrbit System Disk & Heavy Files Analyzer.
//
//  Fast, APFS-accurate storage intelligence (zero npm deps):
//   - Real disk volume stats via `df -k`
//   - Parallel per-folder `du -sk` sizing across ALL children
//     (never truncates alphabetically at dot-folders!)
//   - Safe non-TCC ~/Library cache inspection (Caches, Developer)
//   - Top 50 heaviest individual files via parallel `find` + `lstat`
//   - Reclaimable Dev Caches & Bloat detector
//   - File-category breakdown & drill-down into any folder in ~
// ─────────────────────────────────────────────────────────────

import { readdir, lstat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, platform } from "node:os";
import { join, extname, basename, relative, resolve, sep } from "node:path";

const OS = platform();

const SKIP_AT_HOME = new Set([".Trash", "Library"]);
const SAFE_LIBRARY_SUBS = ["Caches", "Developer", "Application Support/Docker", "Application Support/Code", "Logs"];

const BLOAT_NAMES = new Set([
  "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
  "target", "dist", "build", ".next", ".nuxt", ".turbo", ".parcel-cache",
  ".cache", ".npm", ".pnpm-store", ".yarn", ".bun", ".cargo",
  ".conda", ".docker", ".gradle", ".m2", "DerivedData", "Pods",
  "Caches", "Developer"
]);

function classifyExt(name, relPath = "") {
  const lowerPath = String(relPath).toLowerCase();
  if (/(^|\/)(node_modules|\.venv|venv|\.cache|\.npm|\.pnpm|\.yarn|\.bun|\.cargo|\.conda|\.docker|caches|deriveddata|__pycache__|target)\//.test(lowerPath)) {
    return "Dev Caches & Deps";
  }
  const ext = extname(name).toLowerCase();
  if ([".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".flac", ".m4a", ".png", ".jpg", ".jpeg", ".heic", ".gif", ".psd", ".tiff", ".raw"].includes(ext)) {
    return "Media & Video";
  }
  if ([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".dmg", ".iso", ".pkg", ".whl"].includes(ext)) {
    return "Archives & Installers";
  }
  if ([".pt", ".pth", ".ckpt", ".safetensors", ".onnx", ".gguf", ".bin", ".h5", ".hdf5", ".parquet", ".csv", ".tsv", ".npy", ".npz", ".xtc", ".trr", ".tpr", ".gro", ".pdb", ".cif", ".dcd", ".db", ".sqlite", ".sqlite3", ".duckdb", ".fastq", ".bam", ".vcf", ".h5ad", ".rds", ".rdata"].includes(ext)) {
    return "Models & Scientific Data";
  }
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".c", ".cpp", ".h", ".java", ".swift", ".kt", ".sh", ".html", ".css", ".json", ".yaml", ".yml", ".toml", ".sql"].includes(ext)) {
    return "Code & Config";
  }
  if ([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".key", ".pages", ".numbers", ".md", ".txt", ".epub"].includes(ext)) {
    return "Documents";
  }
  return "Other";
}

function classifyFolder(name) {
  if (BLOAT_NAMES.has(name) || name.startsWith("Library/")) return "Dev Caches & Deps";
  if (["Pictures", "Movies", "Music"].includes(name)) return "Media & Video";
  if (["Downloads"].includes(name)) return "Archives & Installers";
  if (["Documents"].includes(name)) return "Documents";
  return "Workspaces & Projects";
}

export function getVolumeStats(targetDir = homedir()) {
  return new Promise((ok) => {
    execFile("df", ["-k", targetDir], { encoding: "utf8", timeout: 2500 }, (err, stdout) => {
      if (err || !stdout) {
        return ok({ mount: targetDir, totalBytes: 0, usedBytes: 0, availBytes: 0, capacityPct: 0 });
      }
      const lines = stdout.trim().split("\n");
      const row = (lines[lines.length - 1] || "").trim().split(/\s+/);
      const totalK = Number(row[1]) || 0;
      const usedK = Number(row[2]) || 0;
      const availK = Number(row[3]) || 0;
      const pctMatch = (row[4] || "").match(/(\d+)%/);
      const mount = row[row.length - 1] || targetDir;
      const totalBytes = totalK * 1024;
      const usedBytes = usedK * 1024;
      const availBytes = availK * 1024;
      const capacityPct = pctMatch
        ? Number(pctMatch[1])
        : (totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0);
      ok({ mount, totalBytes, usedBytes, availBytes, capacityPct });
    });
  });
}

function duOne(target, timeout = 3200) {
  return new Promise((ok) => {
    execFile("du", ["-sk", target], { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, out) => {
      const m = (out || "").trim().match(/^(\d+)\s+/);
      ok({ bytes: m ? Number(m[1]) * 1024 : 0, timedOut: Boolean(err?.killed) });
    });
  });
}

function findHeavyInDir(dir, minMB = 25, maxDepth = 6, timeout = 2600) {
  return new Promise((ok) => {
    execFile(
      "find",
      [dir, "-maxdepth", String(maxDepth), "-type", "f", "-size", `+${minMB}M`],
      { timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, out) => {
        const paths = (out || "").split("\n").map((s) => s.trim()).filter(Boolean);
        ok(paths);
      }
    );
  });
}

function findBloatDirs(dir, timeout = 2200) {
  return new Promise((ok) => {
    execFile(
      "find",
      [
        dir, "-maxdepth", "4", "-type", "d",
        "(",
        "-name", "node_modules", "-o",
        "-name", ".venv", "-o",
        "-name", "venv", "-o",
        "-name", "target", "-o",
        "-name", "dist", "-o",
        "-name", "__pycache__",
        ")",
        "-prune"
      ],
      { timeout, maxBuffer: 2 * 1024 * 1024 },
      (err, out) => {
        ok((out || "").split("\n").map((s) => s.trim()).filter(Boolean));
      }
    );
  });
}

async function runPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const cur = i++;
      out[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return out;
}

export async function analyzeDisk({
  targetPath = homedir(),
  topFilesLimit = 50,
  topFoldersLimit = 24
} = {}) {
  const home = resolve(homedir());
  const root = await realpath(resolve(targetPath));
  if (root !== home && !root.startsWith(home + sep)) {
    throw new Error(`refusing to analyze outside ${home}`);
  }

  const isHome = root === home;
  const start = Date.now();
  const volume = await getVolumeStats(root);

  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    throw new Error(`cannot read ${root}: ${e.message}`);
  }

  // Build candidate entries for sizing
  const dirTargets = [];
  const rootFiles = [];

  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    if (isHome && SKIP_AT_HOME.has(ent.name)) continue;
    const full = join(root, ent.name);
    if (ent.isDirectory()) {
      dirTargets.push({ name: ent.name, path: full, isDir: true });
    } else if (ent.isFile()) {
      rootFiles.push({ name: ent.name, path: full });
    }
  }

  // On macOS ~, also include safe non-TCC ~/Library cache/dev directories
  if (isHome && OS === "darwin") {
    for (const sub of SAFE_LIBRARY_SUBS) {
      const full = join(home, "Library", sub);
      if (existsSync(full)) {
        dirTargets.push({ name: `Library/${sub}`, path: full, isDir: true });
      }
    }
  }

  // 1. Parallel folder sizing via native `du -sk`
  const sizedDirs = await runPool(dirTargets, 8, async (d) => {
    const res = await duOne(d.path, isHome ? 3400 : 4000);
    return { ...d, bytes: res.bytes, partial: res.timedOut };
  });

  // Measure immediate files in root
  let rootFileBytes = 0;
  const directHeavy = [];
  for (const f of rootFiles) {
    try {
      const st = await lstat(f.path);
      const bytes = typeof st.blocks === "number" && st.blocks >= 0
        ? Math.min(st.size, st.blocks * 512) || st.size
        : st.size;
      rootFileBytes += bytes;
      directHeavy.push({
        name: f.name,
        path: f.path,
        relPath: f.name,
        bytes,
        ext: extname(f.name).toLowerCase(),
        category: classifyExt(f.name, f.name),
        mtimeMs: Math.round(st.mtimeMs)
      });
    } catch {}
  }

  const folderItems = [...sizedDirs.filter((d) => d.bytes > 0)];
  if (rootFileBytes > 0) {
    folderItems.push({ name: "(Files in this folder)", path: root, isDir: false, bytes: rootFileBytes, partial: false });
  }
  folderItems.sort((a, b) => b.bytes - a.bytes);

  const totalBytes = folderItems.reduce((s, f) => s + f.bytes, 0);

  // 2. Find Top Heavy Files across the heaviest folders (or entire drilled folder)
  const heavySearchDirs = isHome
    ? folderItems.filter((f) => f.isDir).slice(0, 18).map((f) => f.path)
    : [root];
  const minMB = isHome ? 25 : 1;

  const foundPathsNested = await runPool(heavySearchDirs, 6, (dir) =>
    findHeavyInDir(dir, minMB, isHome ? 6 : 8, 2500)
  );
  const uniquePaths = [...new Set(foundPathsNested.flat())].slice(0, 600);

  const heavyCandidates = [...directHeavy];
  await runPool(uniquePaths, 16, async (full) => {
    try {
      const st = await lstat(full);
      if (!st.isFile()) return;
      const bytes = typeof st.blocks === "number" && st.blocks >= 0
        ? Math.min(st.size, st.blocks * 512) || st.size
        : st.size;
      if (bytes <= 0) return;
      const name = basename(full);
      const relPath = relative(root, full) || name;
      heavyCandidates.push({
        name,
        path: full,
        relPath,
        bytes,
        ext: extname(name).toLowerCase(),
        category: classifyExt(name, relPath),
        mtimeMs: Math.round(st.mtimeMs)
      });
    } catch {}
  });

  // Deduplicate by path and pick top N
  const heavyMap = new Map();
  for (const h of heavyCandidates) heavyMap.set(h.path, h);
  const heavyFiles = [...heavyMap.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, topFilesLimit);

  // 3. Detect Dev Caches & Reclaimable Bloat
  const bloatCandidates = new Map();
  // Top-level bloat folders directly under root (e.g. ~/.cache, ~/.npm, ~/.conda, Library/Caches)
  for (const f of folderItems) {
    if (!f.isDir) continue;
    const base = basename(f.path);
    if (BLOAT_NAMES.has(base) || f.name.startsWith("Library/Caches") || f.name.startsWith("Library/Developer")) {
      if (f.bytes >= 10 * 1024 * 1024) {
        bloatCandidates.set(f.path, { name: f.name, path: f.path, relPath: f.name, bytes: f.bytes });
      }
    }
  }
  // Nested dev bloat inside top workspace folders (node_modules, .venv, target, dist, __pycache__)
  const workspaceScanDirs = folderItems
    .filter((f) => f.isDir && !bloatCandidates.has(f.path) && !["Pictures", "Movies", "Music"].includes(f.name))
    .slice(0, 10)
    .map((f) => f.path);

  const nestedBloatPaths = [...new Set((await runPool(workspaceScanDirs, 5, (d) => findBloatDirs(d, 2000))).flat())]
    .filter((p) => !bloatCandidates.has(p))
    .slice(0, 40);

  const sizedNestedBloat = await runPool(nestedBloatPaths, 8, async (p) => {
    const res = await duOne(p, 1800);
    return { name: basename(p), path: p, relPath: relative(root, p) || basename(p), bytes: res.bytes };
  });
  for (const b of sizedNestedBloat) {
    if (b.bytes >= 10 * 1024 * 1024) bloatCandidates.set(b.path, b);
  }

  const bloatItems = [...bloatCandidates.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 25);
  const totalBloatBytes = bloatItems.reduce((s, b) => s + b.bytes, 0);

  // 4. Category Allocation Breakdown (blending top-level folder roles + heavy file categories)
  const catMap = new Map();
  for (const f of folderItems) {
    const cat = f.isDir ? classifyFolder(f.name) : "Other";
    catMap.set(cat, (catMap.get(cat) || 0) + f.bytes);
  }
  // Refine with heavy file categories if drilled into a specific project folder
  if (!isHome && heavyFiles.length) {
    const fileCatMap = new Map();
    for (const hf of heavyFiles) {
      fileCatMap.set(hf.category, (fileCatMap.get(hf.category) || 0) + hf.bytes);
    }
    const heavySum = [...fileCatMap.values()].reduce((a, b) => a + b, 0);
    if (heavySum > totalBytes * 0.25) {
      catMap.clear();
      for (const [k, v] of fileCatMap.entries()) catMap.set(k, v);
      if (totalBytes > heavySum) catMap.set("Other", (catMap.get("Other") || 0) + (totalBytes - heavySum));
    }
  }

  const categories = [...catMap.entries()]
    .filter(([, b]) => b > 0)
    .map(([category, bytes]) => ({
      category,
      bytes,
      pct: totalBytes > 0 ? Math.round((bytes / totalBytes) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const topFolders = folderItems.slice(0, topFoldersLimit).map((f) => ({
    ...f,
    pct: totalBytes > 0 ? Math.round((f.bytes / totalBytes) * 1000) / 10 : 0
  }));

  return {
    volume,
    scanned: {
      rootPath: root,
      rootName: isHome ? "Home (~)" : (basename(root) || root),
      homePath: home,
      isHome,
      parentPath: !isHome ? dirnameSafe(root, home) : null,
      totalBytes,
      folderCount: folderItems.length,
      heavyCount: heavyFiles.length,
      minHeavyMB: minMB,
      durationMs: Date.now() - start,
      partialCount: folderItems.filter((f) => f.partial).length
    },
    topFolders,
    heavyFiles,
    categories,
    bloat: {
      totalBytes: totalBloatBytes,
      count: bloatItems.length,
      items: bloatItems
    }
  };
}

function dirnameSafe(p, home) {
  const parent = resolve(p, "..");
  if (parent === home || parent.startsWith(home + sep)) return parent;
  return null;
}
