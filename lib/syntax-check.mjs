#!/usr/bin/env node
// Syntax-checks all frontend JS modules and inline scripts in public/.
// Cheap to check, catches broken browser code before launch.

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const JS_DIR = join(PUBLIC, "js");

let failed = 0;

// 1. Check inline scripts in public/index.html (if any)
const html = await readFile(join(PUBLIC, "index.html"), "utf8");
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (const [i, code] of blocks.entries()) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    console.log(`syntax-check: index.html inline block ${i + 1} ok (${code.split("\n").length} lines)`);
  } catch (e) {
    console.error(`syntax-check: index.html inline block ${i + 1} — ${e.message}`);
    failed++;
  }
}

// 2. Check all JS files in public/js/
try {
  const files = (await readdir(JS_DIR)).filter((f) => f.endsWith(".js")).sort();
  if (!files.length && !blocks.length) {
    console.error("syntax-check: no frontend scripts found");
    process.exit(1);
  }
  for (const file of files) {
    const full = join(JS_DIR, file);
    try {
      execFileSync(process.execPath, ["--check", full], { stdio: "pipe" });
      const lines = (await readFile(full, "utf8")).split("\n").length;
      console.log(`syntax-check: public/js/${file} ok (${lines} lines)`);
    } catch (e) {
      console.error(`syntax-check: public/js/${file} — ${e.stderr?.toString() || e.message}`);
      failed++;
    }
  }
} catch (e) {
  if (e.code !== "ENOENT") {
    console.error(`syntax-check: ${e.message}`);
    failed++;
  }
}

// 3. Check all backend .mjs files
for (const dir of ["lib", "bin"]) {
  const files = (await readdir(join(ROOT, dir))).filter((f) => f.endsWith(".mjs")).sort();
  for (const file of files) {
    const full = join(ROOT, dir, file);
    try {
      execFileSync(process.execPath, ["--check", full], { stdio: "pipe" });
      console.log(`syntax-check: ${dir}/${file} ok`);
    } catch (e) {
      console.error(`syntax-check: ${dir}/${file} — ${e.stderr?.toString() || e.message}`);
      failed++;
    }
  }
}

process.exit(failed ? 1 : 0);
