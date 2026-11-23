// ─────────────────────────────────────────────────────────────
//  PandaOrbit Google Docs Connector (Zero Dependencies).
//
//  Supports two clean ways to write summaries into Google Docs:
//   1. Apps Script Web App Webhook (easiest — 60s setup, no GCP
//      project or OAuth client needed; see docs/google-docs-bridge.gs)
//   2. Direct Google Docs REST API v1 (OAuth Bearer token +
//      optional Document ID — creates or appends to a Google Doc)
//
//  Config lives locally in `<out>/docs-config.json` (never in git).
// ─────────────────────────────────────────────────────────────

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export async function loadDocsConfig(outDir) {
  const file = join(outDir, "docs-config.json");
  let saved = {};
  try { saved = JSON.parse(await readFile(file, "utf8")); } catch {}
  const webhookUrl = process.env.PANDA_ORBIT_GDOCS_WEBHOOK || saved.webhookUrl || "";
  const docId = process.env.PANDA_ORBIT_GDOCS_ID || saved.docId || "";
  const accessToken = process.env.PANDA_ORBIT_GDOCS_TOKEN || saved.accessToken || "";
  return {
    file,
    webhookUrl,
    docId,
    accessToken,
    publicInfo: {
      hasWebhook: Boolean(webhookUrl),
      webhookHost: webhookUrl ? (() => { try { return new URL(webhookUrl).host; } catch { return ""; } })() : "",
      hasApiToken: Boolean(accessToken),
      docId,
      reportsDir: join(outDir, "reports")
    }
  };
}

export async function saveDocsConfig(outDir, patch = {}) {
  const file = join(outDir, "docs-config.json");
  await mkdir(dirname(file), { recursive: true });
  let cur = {};
  try { cur = JSON.parse(await readFile(file, "utf8")); } catch {}

  if (typeof patch.webhookUrl === "string") {
    const v = patch.webhookUrl.trim();
    if (v && !/^https:\/\/script\.google\.com\//i.test(v) && !/^https:\/\//i.test(v)) {
      throw new Error("Webhook URL must be an https:// URL (e.g. https://script.google.com/macros/s/.../exec)");
    }
    if (v) cur.webhookUrl = v;
    else delete cur.webhookUrl;
  }
  if (typeof patch.docId === "string") {
    const v = patch.docId.trim();
    if (v) cur.docId = v;
    else delete cur.docId;
  }
  if (typeof patch.accessToken === "string") {
    const v = patch.accessToken.trim();
    if (v) cur.accessToken = v;
    else delete cur.accessToken;
  }

  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(cur, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
  return loadDocsConfig(outDir);
}

export async function publishToGoogleDocs({ outDir, summary, docIdOverride = null }) {
  const cfg = await loadDocsConfig(outDir);
  const targetDocId = (docIdOverride || cfg.docId || "").trim();

  // Mode 1: Google Apps Script Bridge Webhook
  if (cfg.webhookUrl) {
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: summary.title,
        dateIso: summary.dateIso,
        range: summary.range,
        docId: targetDocId || undefined,
        markdown: summary.markdown,
        plainText: summary.plainText,
        html: summary.html
      }),
      redirect: "follow"
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Google Docs webhook returned HTTP ${res.status}`);
    }
    return {
      ok: true,
      mode: "webhook",
      docId: data.docId || targetDocId || null,
      docUrl: data.docUrl || (data.docId ? `https://docs.google.com/document/d/${data.docId}/edit` : null)
    };
  }

  // Mode 2: Direct Google Docs REST API v1 (Bearer OAuth token)
  if (cfg.accessToken) {
    let docId = targetDocId;
    if (!docId) {
      const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
        method: "POST",
        headers: {
          "authorization": `Bearer ${cfg.accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ title: summary.title })
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error?.message || `Google Docs API create failed (${createRes.status})`);
      docId = created.documentId;
    }

    const batchRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${cfg.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              endOfSegmentLocation: { segmentId: "" },
              text: `\n\n${summary.plainText}\n`
            }
          }
        ]
      })
    });
    const updated = await batchRes.json();
    if (!batchRes.ok) throw new Error(updated.error?.message || `Google Docs API update failed (${batchRes.status})`);

    return {
      ok: true,
      mode: "google-docs-api",
      docId,
      docUrl: `https://docs.google.com/document/d/${docId}/edit`
    };
  }

  throw new Error("Google Docs is not connected yet. Add an Apps Script webhook URL (see docs/google-docs-bridge.gs) or set PANDA_ORBIT_GDOCS_TOKEN.");
}
