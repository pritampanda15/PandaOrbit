// ─────────────────────────────────────────────────────────────
//  Reads one or more directories of projects and builds the tree.
//
//  Everything here comes off the filesystem:
//    name      ← folder name
//    note      ← README heading + first prose line, commits, last touched
//    children  ← real subdirectories, noise filtered
//    status    ← newest of last commit / folder mtime / child mtime
//    meta      ← structured git & mtime metrics for the Dashboard view
//
//  The one thing it can't infer is taxonomy — which projects belong
//  together. That's config. Without it: one domain per root when you
//  give several, one wedge per project when you give one.
// ─────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { autoHue, autoGlyph, matches } from "./config.mjs";
import { discoverSystemRepos } from "./discover.mjs";

const DAY = 864e5;

export function scan(roots, cfg) {
  const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  if (!list.length) throw new Error("no directories to scan");
  for (const r of list) if (!existsSync(r)) throw new Error(`no such directory: ${r}`);

  const skip = cfg.skip.map((s) => new RegExp(s));
  const now = Date.now();
  const scanStart = now;

  // Roots get short labels. Two roots can share a basename (~/a/src and
  // ~/b/src), so disambiguate with the parent rather than silently
  // merging two different trees under one key.
  const labels = list.map((r) => basename(r));
  const roots_ = list.map((path, i) => {
    let label = labels[i];
    if (labels.filter((l) => l === label).length > 1) label = join(basename(join(path, "..")), label);
    return { path, label };
  });

  const dirs = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !skip.some((re) => re.test(e.name)))
        .map((e) => e.name)
        .sort();
    } catch { return []; }
  };

  const git = (p, args) => {
    try {
      return execFileSync("git", ["-C", p, ...args],
        { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { return ""; }
  };

  function gitInfo(p) {
    if (!existsSync(join(p, ".git"))) return { iso: "", msg: null, commits: 0, branch: null };
    const logLine = git(p, ["log", "-1", "--format=%cI%x1f%s"]);
    const [iso = "", msg = ""] = logLine ? logLine.split("\x1f") : [];
    const branch = git(p, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
    const commitsRaw = git(p, ["rev-list", "--count", "HEAD"]);
    return {
      iso,
      msg: msg || null,
      commits: commitsRaw ? Number(commitsRaw) || 0 : 0,
      branch
    };
  }

  function lastTouched(p, preloadedIso = null) {
    let t = 0;
    try { t = statSync(p).mtimeMs; } catch { return now; }
    if (preloadedIso) {
      const parsed = Date.parse(preloadedIso);
      if (!Number.isNaN(parsed)) t = Math.max(t, parsed);
    }
    for (const d of dirs(p)) { try { t = Math.max(t, statSync(join(p, d)).mtimeMs); } catch {} }
    return t;
  }

  const statusFor = (t) => {
    const age = (now - t) / DAY;
    return age <= cfg.activeDays ? "active" : age < cfg.dormantDays ? "steady" : "dormant";
  };

  function readme(p) {
    let f;
    try { f = readdirSync(p).find((n) => /^readme(\.md|\.rst|\.txt)?$/i.test(n)); } catch {}
    if (!f) return {};
    let lines;
    try { lines = readFileSync(join(p, f), "utf8").split("\n"); } catch { return {}; }
    let title, tagline;
    for (const raw of lines) {
      const l = raw.trim();
      if (!l || /^[-=*_]{3,}$/.test(l) || l.startsWith("<")) continue;
      if (!title && l.startsWith("# ")) { title = l.replace(/^#+\s*/, "").replace(/\*\*/g, ""); continue; }
      if (l.startsWith("#") || l.startsWith("|") || l.startsWith(">") || l.startsWith("```") || l.startsWith("![")) continue;
      tagline = l.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
      break;
    }
    if (tagline && tagline.length > 150) tagline = tagline.slice(0, 147).replace(/\s+\S*$/, "") + "…";
    return { title, tagline };
  }

  const pretty = (s) => s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Override keys are `<root label>/<relative path>`, stable across
  // machines and unique even when two roots hold a folder of the same name.
  function buildProject(root, label, name) {
    const p = join(root, name);
    const gi = gitInfo(p);
    const t = lastTouched(p, gi.iso);
    const { title, tagline } = readme(p);
    const { commits, branch, msg: lastCommitMsg } = gi;

    const bits = [`last touched ${new Date(t).toISOString().slice(0, 10)}`];
    if (commits) bits.push(`${commits} commit${commits === 1 ? "" : "s"}`);
    const heading = title && title.toLowerCase() !== name.toLowerCase() ? title : "";

    const subdirs = dirs(p);

    return {
      name,
      path: p,
      key: `${label}/${name}`,
      rootLabel: label,
      status: statusFor(t),
      lastTouchedMs: Math.round(t),
      lastTouched: new Date(t).toISOString(),
      ageDays: Math.max(0, Math.round(((now - t) / DAY) * 10) / 10),
      commits,
      branch,
      lastCommitMsg,
      readmeTitle: heading || null,
      tagline: tagline || null,
      note: [heading, tagline].filter(Boolean).join(" — ") + "\n" + bits.join(" · "),
      children: subdirs.map((d) => {
        const ct = lastTouched(join(p, d));
        return {
          name: pretty(d),
          rawName: d,
          path: join(p, d),
          key: `${label}/${name}/${d}`,
          rootLabel: label,
          status: statusFor(ct),
          lastTouchedMs: Math.round(ct),
          lastTouched: new Date(ct).toISOString(),
          ageDays: Math.max(0, Math.round(((now - ct) / DAY) * 10) / 10)
        };
      })
    };
  }

  // every project across every root, tagged with where it came from
  const found = [];
  for (const { path, label } of roots_) {
    for (const name of dirs(path).filter((d) => !cfg.ignore.includes(d))) {
      found.push({ root: path, label, name });
    }
  }
  if (!found.length) throw new Error(`no project folders found in ${list.join(", ")}`);

  const build = (p) => buildProject(p.root, p.label, p.name);
  let domains, unfiled = [];

  if (cfg.domains.length) {
    const claimed = new Set();
    domains = cfg.domains.map((d, i) => {
      // `match` may name a folder ("RevTS") or scope it to a root
      // ("Desktop/RevTS") when the same name exists in several places.
      const mine = found.filter((p) =>
        matches(p.name, d.match) || matches(`${p.label}/${p.name}`, d.match));
      mine.forEach((p) => claimed.add(p));
      return {
        name: d.name, blurb: d.blurb || "",
        hue: d.hue ?? autoHue(i, cfg.domains.length),
        glyph: d.glyph || autoGlyph(i),
        path: d.path || list[0],
        children: mine.map(build)
      };
    }).filter((d) => d.children.length);

    unfiled = found.filter((p) => !claimed.has(p));
    if (unfiled.length) {
      domains.push({
        name: "UNFILED", blurb: "not yet placed on the map", hue: 0, glyph: "○",
        path: list[0], children: unfiled.map(build)
      });
    }
  } else if (roots_.length > 1) {
    // Several roots and no taxonomy: the roots are the taxonomy.
    domains = roots_.map(({ path, label }, i) => ({
      name: label.toUpperCase().replace(/[_/-]/g, " "),
      blurb: path.replace(process.env.HOME || "~", "~"),
      hue: autoHue(i, roots_.length), glyph: autoGlyph(i), path,
      children: found.filter((p) => p.root === path).map(build)
    })).filter((d) => d.children.length);
  } else {
    // One root, no taxonomy: every project is its own wedge. It groups
    // nothing it wasn't told to group.
    domains = found.map((p, i) => {
      const proj = build(p);
      return {
        name: p.name.replace(/[_-]/g, " ").toUpperCase(),
        blurb: (proj.tagline || "").slice(0, 46),
        hue: autoHue(i, found.length), glyph: autoGlyph(i), path: proj.path,
        children: proj.children.length ? proj.children : [{ ...proj, children: [] }]
      };
    });
  }

  const brand = cfg.name || "PandaOrbit";
  return {
    tree: {
      title: `${brand} · ${roots_.map((r) => r.label).join(" + ")}`,
      brand,
      defaultView: cfg.defaultView || "dashboard",
      activeDays: cfg.activeDays,
      dormantDays: cfg.dormantDays,
      roots: roots_,
      spin: cfg.spin,
      generated: new Date().toISOString(),
      domains
    },
    stats: {
      projects: found.length,
      domains: domains.length,
      roots: roots_.length,
      scanMs: Date.now() - scanStart,
      unfiled: unfiled.map((p) => `${p.label}/${p.name}`)
    }
  };
}

export const serialise = (tree) =>
  `// Generated by PandaOrbit on ${tree.generated.slice(0, 10)}\n` +
  `// Roots: ${tree.roots.map((r) => r.path).join(", ")}\n` +
  `// Re-run \`panda-orbit scan\` to refresh. Hand edits here are overwritten —\n` +
  `// put yours in overrides.json instead.\n\n` +
  `const TREE = ${JSON.stringify(tree, null, 2)};\n`;

/**
 * System-Wide Scan: auto-discovers git repositories across the user's
 * entire home directory (~) and groups them cleanly by configured domains
 * or by their parent workspace directory — no junk non-repo folders included.
 */
export function scanSystem(cfg, { baseDir = homedir(), maxDepth = 4 } = {}) {
  const start = Date.now();
  const discovered = discoverSystemRepos({ baseDir, maxDepth });
  if (!discovered.repos.length) {
    throw new Error(`no git repositories discovered under ${baseDir}`);
  }

  const skip = cfg.skip.map((s) => new RegExp(s));
  const now = Date.now();
  const home = homedir();

  const dirs = (p) => {
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !skip.some((re) => re.test(e.name)))
        .map((e) => e.name)
        .sort();
    } catch { return []; }
  };

  const git = (p, args) => {
    try {
      return execFileSync("git", ["-C", p, ...args],
        { encoding: "utf8", timeout: 1200, stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { return ""; }
  };

  function readme(p) {
    let f;
    try { f = readdirSync(p).find((n) => /^readme(\.md|\.rst|\.txt)?$/i.test(n)); } catch {}
    if (!f) return {};
    let lines;
    try { lines = readFileSync(join(p, f), "utf8").split("\n"); } catch { return {}; }
    let title, tagline;
    for (const raw of lines) {
      const l = raw.trim();
      if (!l || /^[-=*_]{3,}$/.test(l) || l.startsWith("<")) continue;
      if (!title && l.startsWith("# ")) { title = l.replace(/^#+\s*/, "").replace(/\*\*/g, ""); continue; }
      if (l.startsWith("#") || l.startsWith("|") || l.startsWith(">") || l.startsWith("```") || l.startsWith("![")) continue;
      tagline = l.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
      break;
    }
    if (tagline && tagline.length > 150) tagline = tagline.slice(0, 147).replace(/\s+\S*$/, "") + "…";
    return { title, tagline };
  }

  const statusFor = (t) => {
    const age = (now - t) / DAY;
    return age <= cfg.activeDays ? "active" : age < cfg.dormantDays ? "steady" : "dormant";
  };

  const pretty = (s) => s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const items = discovered.repos.map((repoPath) => {
    const name = basename(repoPath);
    const parent = dirname(repoPath);
    const label = parent === home ? "Home" : basename(parent);
    const logLine = git(repoPath, ["log", "-1", "--format=%cI%x1f%s"]);
    const [iso = "", lastCommitMsg = ""] = logLine ? logLine.split("\x1f") : [];
    const branch = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]) || null;
    const commitsRaw = git(repoPath, ["rev-list", "--count", "HEAD"]);
    const commits = commitsRaw ? Number(commitsRaw) || 0 : 0;

    let t = 0;
    try { t = statSync(repoPath).mtimeMs; } catch { t = now; }
    if (iso) {
      const parsed = Date.parse(iso);
      if (!Number.isNaN(parsed)) t = Math.max(t, parsed);
    }

    const { title, tagline } = readme(repoPath);
    const heading = title && title.toLowerCase() !== name.toLowerCase() ? title : "";
    const bits = [`last touched ${new Date(t).toISOString().slice(0, 10)}`];
    if (commits) bits.push(`${commits} commit${commits === "1" ? "" : "s"}`);

    const subdirs = dirs(repoPath);

    return {
      root: parent,
      label,
      proj: {
        name,
        path: repoPath,
        key: `${label}/${name}`,
        rootLabel: label,
        status: statusFor(t),
        lastTouchedMs: Math.round(t),
        lastTouched: new Date(t).toISOString(),
        ageDays: Math.max(0, Math.round(((now - t) / DAY) * 10) / 10),
        commits,
        branch,
        lastCommitMsg: lastCommitMsg || null,
        readmeTitle: heading || null,
        tagline: tagline || null,
        note: [heading, tagline].filter(Boolean).join(" — ") + "\n" + bits.join(" · "),
        children: subdirs.slice(0, 12).map((d) => {
          let ct = t;
          try { ct = statSync(join(repoPath, d)).mtimeMs; } catch {}
          return {
            name: pretty(d),
            rawName: d,
            path: join(repoPath, d),
            key: `${label}/${name}/${d}`,
            rootLabel: label,
            status: statusFor(ct),
            lastTouchedMs: Math.round(ct),
            lastTouched: new Date(ct).toISOString(),
            ageDays: Math.max(0, Math.round(((now - ct) / DAY) * 10) / 10)
          };
        })
      }
    };
  });

  // Group by configured domains first, then group remaining repos cleanly by parent workspace folder
  const claimed = new Set();
  const domains = [];

  if (cfg.domains?.length) {
    cfg.domains.forEach((d, i) => {
      const mine = items.filter((it) =>
        matches(it.proj.name, d.match) || matches(`${it.label}/${it.proj.name}`, d.match)
      );
      if (!mine.length) return;
      mine.forEach((it) => claimed.add(it));
      domains.push({
        name: d.name,
        blurb: d.blurb || "",
        hue: d.hue ?? autoHue(i, cfg.domains.length + 4),
        glyph: d.glyph || autoGlyph(i),
        path: d.path || mine[0].root,
        children: mine.map((m) => m.proj)
      });
    });
  }

  const remaining = items.filter((it) => !claimed.has(it));
  const byParent = new Map();
  for (const it of remaining) {
    if (!byParent.has(it.root)) byParent.set(it.root, { label: it.label, root: it.root, list: [] });
    byParent.get(it.root).list.push(it.proj);
  }

  const groups = [...byParent.values()].sort((a, b) => b.list.length - a.list.length);
  groups.forEach((g, idx) => {
    const i = domains.length + idx;
    domains.push({
      name: g.label.toUpperCase().replace(/[_/-]/g, " "),
      blurb: g.root.replace(home, "~"),
      hue: autoHue(i, domains.length + groups.length),
      glyph: autoGlyph(i),
      path: g.root,
      children: g.list
    });
  });

  const rootsList = [...new Set(items.map((i) => i.root))].map((p) => ({
    path: p,
    label: p === home ? "Home" : basename(p)
  }));

  const brand = cfg.name || "PandaOrbit";
  return {
    tree: {
      title: `${brand} · System-Wide (${items.length} repos)`,
      brand,
      scanMode: "system",
      defaultView: cfg.defaultView || "dashboard",
      activeDays: cfg.activeDays,
      dormantDays: cfg.dormantDays,
      roots: rootsList,
      spin: cfg.spin,
      generated: new Date().toISOString(),
      domains
    },
    stats: {
      projects: items.length,
      domains: domains.length,
      roots: rootsList.length,
      scanMode: "system",
      scanMs: Date.now() - start,
      unfiled: []
    }
  };
}
