// ─────────────────────────────────────────────────────────────
//  Renders the scanned tree to a self-contained animated SVG,
//  for embedding in a README. No scripts — GitHub strips those —
//  so every motion here is declarative SMIL, which renders inside
//  an <img>.
//
//  The layout mirrors public/index.html. Kept deliberately small:
//  this is a portrait of the map, not the map.
// ─────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const COL = { active: "#f2a93b", steady: "#e8e4d8", dormant: "none" };
const STROKE = { active: "#f2a93b", steady: "#e8e4d8", dormant: "#5c6274" };
const BG = "#191c28";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const f = (n) => Number(n).toFixed(2);

export function renderDemo(tree, { size = 1000, turnSeconds = 90, leaves = true } = {}) {
  const D = tree.domains;
  const HUB = 210, RING = 105, GAP = 0.14;

  const countLeaves = (n) => (n.children?.length ? n.children.reduce((s, c) => s + countLeaves(c), 0) : 1);
  const depthOf = (n) => (n.children?.length ? 1 + Math.max(...n.children.map(depthOf)) : 0);

  const counts = D.map(countLeaves);
  const grand = counts.reduce((a, b) => a + b, 0);
  const spans = counts.map((c) => (c / grand) * TAU * (1 - GAP));
  const gutter = (TAU * GAP) / D.length;

  const nodes = [], links = [];
  let edge = -Math.PI / 2 - spans[0] / 2 - gutter / 2;

  D.forEach((dom, i) => {
    const span = spans[i], total = counts[i];
    edge += gutter;
    let cursor = edge;
    edge += span;

    const place = (node, depth) => {
      let a;
      if (!node.children?.length) { a = cursor + span / total / 2; cursor += span / total; }
      else {
        const as = node.children.map((c) => place(c, depth + 1));
        a = (Math.min(...as) + Math.max(...as)) / 2;
      }
      const r = HUB + depth * RING;
      Object.assign(node, { _a: a, _r: r, _x: Math.cos(a) * r, _y: Math.sin(a) * r, _d: depth, _dom: dom });
      nodes.push(node);
      node.children?.forEach((c) => links.push([node, c]));
      return a;
    };

    dom.children.forEach((c) => place(c, 1));
    const as = dom.children.map((c) => c._a);
    const a = (Math.min(...as) + Math.max(...as)) / 2;
    Object.assign(dom, { _a: a, _r: HUB, _x: Math.cos(a) * HUB, _y: Math.sin(a) * HUB, _d: 0, _dom: dom, _span: span });
    nodes.push(dom);
    dom.children.forEach((c) => links.push([dom, c]));
  });

  const outer = HUB + Math.max(...D.map(depthOf)) * RING;
  const longest = Math.max(...nodes.filter((n) => n._d && !n.children?.length).map((n) => n.name.length), 0);
  const LABEL_R = outer + 34 + (leaves ? longest * 6.4 : 0);
  const view = LABEL_R + 78;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-view} ${-view} ${view * 2} ${view * 2}" width="${size}" height="${size}" role="img" aria-label="${esc(tree.title)}">`);
  out.push(`<rect x="${-view}" y="${-view}" width="${view * 2}" height="${view * 2}" fill="${BG}"/>`);

  // starfield — deterministic, so regenerating doesn't churn the diff
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = [];
  for (let i = 0; i < 320; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * view;
    stars.push(`<circle cx="${f(Math.cos(a) * r)}" cy="${f(Math.sin(a) * r)}" r="${f(rnd() * .9 + .2)}" fill="#fff" fill-opacity="${f(rnd() * .35 + .05)}"/>`);
  }
  out.push(`<g>${stars.join("")}</g>`);

  // core cluster, turning against the wheel
  const core = nodes.filter((n) => !n.children?.length).map((n) => {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 80;
    return `<circle cx="${f(Math.cos(a) * r)}" cy="${f(Math.sin(a) * r)}" r="1.8" fill="hsl(${n._dom.hue} 60% 62%)" fill-opacity=".75"/>`;
  }).join("");
  out.push(`<g>${core}<animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="${turnSeconds * 2}s" repeatCount="indefinite"/></g>`);

  // ── the wheel ──────────────────────────────────────────────
  const spin = `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${turnSeconds}s" repeatCount="indefinite"/>`;
  out.push(`<g>${spin}`);

  const paths = [];
  links.forEach(([p, c], i) => {
    const mid = p._r + (c._r - p._r) * 0.55;
    const d = `M${f(p._x)},${f(p._y)} L${f(Math.cos(p._a) * mid)},${f(Math.sin(p._a) * mid)} ` +
      `A${f(mid)},${f(mid)} 0 0 ${c._a > p._a ? 1 : 0} ${f(Math.cos(c._a) * mid)},${f(Math.sin(c._a) * mid)} ` +
      `L${f(c._x)},${f(c._y)}`;
    paths.push(`<path id="l${i}" d="${d}" fill="none" stroke="#5c6274" stroke-width="1" stroke-opacity="${c.status === "dormant" ? .3 : .55}"/>`);
  });
  out.push(paths.join(""));

  // pulses travel only the branches that are actually live
  const live = links.map(([p, c], i) => [c, i]).filter(([c]) => c.status === "active");
  out.push(live.map(([c, i], k) =>
    `<circle r="2.4" fill="hsl(${c._dom.hue} 85% 70%)">` +
    `<animateMotion dur="${(7 + (k % 5)).toFixed(0)}s" begin="${(k * 0.6).toFixed(1)}s" repeatCount="indefinite" rotate="auto">` +
    `<mpath href="#l${i}"/></animateMotion>` +
    `<animate attributeName="fill-opacity" values="0;.95;0" dur="${(7 + (k % 5)).toFixed(0)}s" begin="${(k * 0.6).toFixed(1)}s" repeatCount="indefinite"/>` +
    `</circle>`).join(""));

  // nodes
  nodes.forEach((n) => {
    if (n._d === 0) {
      out.push(`<circle cx="${f(n._x)}" cy="${f(n._y)}" r="26" fill="hsl(${n.hue} 70% 55%)" fill-opacity=".10"/>`);
      out.push(`<circle cx="${f(n._x)}" cy="${f(n._y)}" r="19" fill="#20242f" stroke="hsl(${n.hue} 75% 62%)" stroke-width="1.4"/>`);
      out.push(`<text x="${f(n._x)}" y="${f(n._y + 6)}" text-anchor="middle" font-size="16" fill="hsl(${n.hue} 75% 66%)">${esc(n.glyph || "◈")}</text>`);
      return;
    }
    const r = n._d === 1 ? 6.5 : 4.5;
    if (n.status === "active") {
      out.push(`<circle cx="${f(n._x)}" cy="${f(n._y)}" r="${r + 3}" fill="${COL.active}" fill-opacity=".2">` +
        `<animate attributeName="r" values="${r + 2};${r + 8};${r + 2}" dur="3.2s" begin="${f(n._a % 3)}s" repeatCount="indefinite"/>` +
        `<animate attributeName="fill-opacity" values=".28;.02;.28" dur="3.2s" begin="${f(n._a % 3)}s" repeatCount="indefinite"/></circle>`);
    }
    out.push(`<circle cx="${f(n._x)}" cy="${f(n._y)}" r="${r}" fill="${COL[n.status] === "none" ? BG : COL[n.status]}" stroke="${STROKE[n.status]}" stroke-width="1.2"/>`);
  });

  // Labels orbit with the wheel but counter-rotate about their own anchor,
  // so they stay upright the whole way round instead of going upside down.
  const counter = `<animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="${turnSeconds}s" repeatCount="indefinite"/>`;

  nodes.filter((n) => n._d === 1).forEach((n) => {
    out.push(`<g transform="translate(${f(n._x)},${f(n._y)})"><g>${counter}` +
      `<text y="-11" text-anchor="middle" font-size="12.5" fill="#f0eee7" ` +
      `font-family="ui-sans-serif,system-ui,sans-serif" paint-order="stroke" stroke="${BG}" stroke-width="3.5" stroke-linejoin="round">${esc(n.name)}</text></g></g>`);
  });

  D.forEach((dom) => {
    const x = Math.cos(dom._a) * LABEL_R, y = Math.sin(dom._a) * LABEL_R;
    const room = Math.min(1.0, dom._span / 2 * 0.94) * 2 * LABEL_R;
    const fs = Math.max(13, Math.min(26, room / (dom.name.length * 0.86)));
    out.push(`<g transform="translate(${f(x)},${f(y)})"><g>${counter}` +
      `<text text-anchor="middle" font-size="${f(fs)}" fill="#f2efe6" letter-spacing="4" ` +
      `font-family="Iowan Old Style,Palatino,Georgia,serif" paint-order="stroke" stroke="${BG}" stroke-width="4" stroke-linejoin="round">${esc(dom.name)}</text>` +
      `<text y="19" text-anchor="middle" font-size="10.5" fill="#8a8f9e" letter-spacing="1.5" ` +
      `font-family="ui-sans-serif,system-ui,sans-serif" paint-order="stroke" stroke="${BG}" stroke-width="3" stroke-linejoin="round">${esc(dom.blurb || "")}</text></g></g>`);
  });

  out.push(`</g>`);   // end wheel

  const legend = [["active", COL.active], ["steady", COL.steady], ["dormant", null]];
  legend.forEach(([label, c], i) => {
    const y = view - 74 + i * 20;
    out.push(c
      ? `<circle cx="${-view + 34}" cy="${f(y - 4)}" r="4.5" fill="${c}"/>`
      : `<circle cx="${-view + 34}" cy="${f(y - 4)}" r="4.5" fill="none" stroke="#5c6274"/>`);
    out.push(`<text x="${-view + 48}" y="${f(y)}" font-size="13" fill="#8a8f9e" font-family="ui-sans-serif,system-ui,sans-serif">${label}</text>`);
  });

  out.push(`</svg>`);
  return out.join("\n");
}
