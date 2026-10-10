// VENDORED - do not edit. Transpiled from Fieldcraft framework webview/src/diagram-renderer.ts
// (https://github.com/manykarim/fieldcraft, commit c2b53ba) with esbuild; logic unmodified.
// MIT License, Copyright (c) 2026 Fieldcraft contributors - see LICENSE.fieldcraft.txt.
// @ts-nocheck
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const SANS = "system-ui,'Helvetica Neue',Helvetica,Arial,sans-serif";
function tw(s, size, { mono = false, bold = false } = {}) {
  const f = mono ? 0.62 : bold ? 0.56 : 0.52;
  return s.length * size * f;
}
function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const num = (v) => typeof v === "number" ? Math.round(v * 100) / 100 : v;
function attrs(o) {
  let out = "";
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === void 0 || v === "") continue;
    out += ` ${k}="${esc(num(v))}"`;
  }
  return out;
}
function rect(x, y, w, h, rx, st, extra = {}) {
  return `<rect${attrs({
    x,
    y,
    width: w,
    height: h,
    rx,
    fill: st.fill,
    stroke: st.stroke === "none" ? null : st.stroke,
    "stroke-width": st.stroke === "none" ? null : st.sw,
    "stroke-dasharray": st.dash,
    ...extra
  })}/>`;
}
function text(x, y, s, { size = 12, fill = "var(--fc-fg)", anchor, bold, italic, mono, opacity } = {}) {
  return `<text${attrs({
    x,
    y,
    "text-anchor": anchor ?? null,
    "font-size": size,
    "font-weight": bold ? 700 : null,
    "font-style": italic ? "italic" : null,
    fill,
    opacity: opacity ?? null,
    style: mono ? `font-family:${MONO}` : null
  })}>${esc(s)}</text>`;
}
const GLYPHS = {
  folder: (x, y, c) => `<path d="M${x} ${y + 3} h11 l4 5 h13 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-28 a3 3 0 0 1 -3 -3 v-15 a3 3 0 0 1 3 -3 z" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  file: (x, y, c) => `<path d="M${x} ${y} h11 l7 7 v19 a2.5 2.5 0 0 1 -2.5 2.5 h-15.5 a2.5 2.5 0 0 1 -2.5 -2.5 v-23.5 a2.5 2.5 0 0 1 2.5 -2.5 z M${x + 11} ${y} v7 h7" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  gear: (x, y, c) => {
    const cx = x + 11, cy = y + 13;
    let ticks = "";
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 4 * i;
      const x1 = cx + Math.cos(a) * 8, y1 = cy + Math.sin(a) * 8;
      const x2 = cx + Math.cos(a) * 11.5, y2 = cy + Math.sin(a) * 11.5;
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="1.6"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="5.5" fill="none" stroke="${c}" stroke-width="1.6"/>${ticks}`;
  },
  doc: (x, y, c) => `<path d="M${x} ${y} h16 a2.5 2.5 0 0 1 2.5 2.5 v22 a2.5 2.5 0 0 1 -2.5 2.5 h-16 a2.5 2.5 0 0 1 -2.5 -2.5 v-22 a2.5 2.5 0 0 1 2.5 -2.5 z M${x + 2} ${y + 8} h12 M${x + 2} ${y + 14} h12 M${x + 2} ${y + 20} h8" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  robot: (x, y, c) => `<path d="M${x + 2} ${y + 8} h18 a2.5 2.5 0 0 1 2.5 2.5 v11 a2.5 2.5 0 0 1 -2.5 2.5 h-18 a2.5 2.5 0 0 1 -2.5 -2.5 v-11 a2.5 2.5 0 0 1 2.5 -2.5 z M${x + 11} ${y + 8} v-5 M${x + 11} ${y + 1.5} a1.5 1.5 0 1 1 .01 0" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="${x + 7}" cy="${y + 15}" r="1.8" fill="${c}"/><circle cx="${x + 15}" cy="${y + 15}" r="1.8" fill="${c}"/>`
};
const GLYPH_W = 34;
const TYPES = ["tree", "stack", "sequence", "pipeline", "hub"];
const LABEL_MAX = 40;
const ELEMENT_KEYWORDS = /* @__PURE__ */ new Set(["node", "layer", "band", "step", "stage", "spoke", "item"]);
const VARIANTS = /* @__PURE__ */ new Set(["accent", "muted", "dashed", "outline", "pass", "mono", "sans", "solid"]);
class DiagramError extends Error {
}
function fail(msg, lineNo) {
  throw new DiagramError(`${msg} (line ${lineNo})`);
}
function tokenizeLine(line, lineNo, warnings) {
  const out = { words: [], variants: /* @__PURE__ */ new Set(), glyph: null, step: null, sub: null };
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const j2 = line.indexOf('"', i + 1);
      if (j2 < 0) fail("unterminated quoted string", lineNo);
      out.words.push(line.slice(i + 1, j2));
      i = j2 + 1;
      continue;
    }
    if (line.startsWith("--", i)) {
      let rest = line.slice(i + 2).trim();
      if (rest.startsWith('"') && rest.endsWith('"') && rest.length > 1) rest = rest.slice(1, -1);
      out.sub = rest;
      break;
    }
    if (c === ":") {
      const m = /^:([A-Za-z][\w-]*)/.exec(line.slice(i));
      if (!m) fail(`expected a variant name after ':'`, lineNo);
      if (!VARIANTS.has(m[1])) warnings.push(`line ${lineNo}: unknown variant ":${m[1]}" ignored`);
      else out.variants.add(m[1]);
      i += m[0].length;
      continue;
    }
    if (c === "#") {
      const m = /^#([A-Za-z][\w-]*)/.exec(line.slice(i));
      if (!m) fail(`expected a glyph name after '#'`, lineNo);
      if (!GLYPHS[m[1]]) warnings.push(`line ${lineNo}: unknown glyph "#${m[1]}" ignored`);
      else out.glyph = m[1];
      i += m[0].length;
      continue;
    }
    if (c === "@") {
      const m = /^@(\d*)/.exec(line.slice(i));
      out.step = m[1] === "" ? "auto" : parseInt(m[1], 10);
      i += m[0].length;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(line[j])) j++;
    out.words.push(line.slice(i, j));
    i = j;
  }
  return out;
}
function parseDiagram(src) {
  const warnings = [];
  const ast = { type: "tree", title: "", items: [], notes: [], legend: [], warnings };
  const stack = [ast.items];
  const lines = src.split(/\r?\n/);
  let headerSeen = false;
  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    let line = lines[li].trim();
    if (!line || line.startsWith("//")) continue;
    if (!headerSeen) {
      const m = /^([a-z]+)(?:\s+"([^"]*)")?\s*$/.exec(line);
      if (!m || !TYPES.includes(m[1]))
        fail(`first line must be a diagram type (${TYPES.join(" | ")}) with an optional "Title"`, lineNo);
      ast.type = m[1];
      ast.title = m[2] || "";
      headerSeen = true;
      continue;
    }
    if (line === "}") {
      if (stack.length === 1) fail(`unmatched '}'`, lineNo);
      stack.pop();
      continue;
    }
    let opensBlock = false;
    if (line.endsWith("{")) {
      opensBlock = true;
      line = line.slice(0, -1).trim();
    }
    const tok = tokenizeLine(line, lineNo, warnings);
    let kind = "node";
    if (tok.words.length && ELEMENT_KEYWORDS.has(tok.words[0])) tok.words.shift();
    else if (tok.words[0] === "note") {
      tok.words.shift();
      kind = "note";
    } else if (tok.words[0] === "legend") {
      tok.words.shift();
      kind = "legend";
    } else if (tok.words[0] === "arrow") {
      tok.words.shift();
      kind = "arrow";
    }
    const label = tok.words.join(" ");
    if (kind === "note") {
      if (opensBlock) fail(`'note' cannot open a block`, lineNo);
      ast.notes.push(label + (tok.sub ? ` ${tok.sub}` : ""));
      continue;
    }
    if (kind === "legend") {
      if (opensBlock) fail(`'legend' cannot open a block`, lineNo);
      ast.legend.push({ variants: tok.variants, label });
      continue;
    }
    if (kind === "arrow") {
      if (opensBlock) fail(`'arrow' cannot open a block`, lineNo);
      stack[stack.length - 1].push({ kind: "arrow", label });
      continue;
    }
    if (!label) fail("element needs a label", lineNo);
    if (label.length > LABEL_MAX)
      warnings.push(`line ${lineNo}: label "${label.slice(0, 24)}\u2026" is long (${label.length} chars) \u2014 may clip; shorten it or move detail into a -- sublabel`);
    const item = {
      kind: "node",
      label,
      sub: tok.sub,
      variants: tok.variants,
      glyph: tok.glyph,
      step: tok.step,
      children: [],
      line: lineNo
    };
    stack[stack.length - 1].push(item);
    if (opensBlock) stack.push(item.children);
  }
  if (!headerSeen) fail("empty diagram source", 1);
  if (stack.length > 1) fail(`unclosed '{' block`, lines.length);
  let auto = 0;
  const number = (items) => {
    for (const it of items) {
      if (it.kind !== "node") continue;
      if (it.step === "auto" || ast.type === "sequence" && it.step === null) it.step = ++auto;
      else if (typeof it.step === "number") auto = Math.max(auto, it.step);
      number(it.children);
    }
  };
  number(ast.items);
  return ast;
}
function styleFor(v, d) {
  const st = {
    fill: d.fill,
    stroke: d.stroke,
    sw: 1.5,
    dash: null,
    fg: "var(--fc-fg)",
    sub: "var(--fc-fg-muted)",
    subOp: null,
    labelFill: d.labelFill || null
  };
  if (v.has("outline")) {
    st.fill = d.outlineFill || "var(--fc-surface)";
    st.stroke = "var(--fc-accent-deep)";
  }
  if (v.has("pass")) st.stroke = "var(--fc-pass)";
  if (v.has("muted")) {
    st.stroke = "var(--fc-fg-muted)";
    st.sw = 1.3;
    st.fg = "var(--fc-fg-muted)";
    st.labelFill = "var(--fc-fg-muted)";
  }
  if (v.has("dashed")) st.dash = "7 5";
  if (v.has("accent")) {
    st.fill = "var(--fc-accent)";
    st.stroke = "none";
    st.fg = "var(--fc-on-accent)";
    st.sub = "var(--fc-on-accent)";
    st.subOp = 0.78;
    st.labelFill = "var(--fc-on-accent)";
  }
  return st;
}
const isMono = (v, defMono) => v.has("mono") || defMono && !v.has("sans");
function stepAttrs(it) {
  return typeof it.step === "number" ? ` class="fc-step" data-step="${it.step}"` : "";
}
function drawExtras(ast, x, y, maxW) {
  let body = "", cy = y;
  for (const n of ast.notes) {
    cy += 18;
    body += text(x + maxW / 2, cy, n, { size: 11.5, italic: true, fill: "var(--fc-fg-muted)", anchor: "middle" });
  }
  if (ast.legend.length) cy += 10;
  for (const l of ast.legend) {
    cy += 24;
    const st = styleFor(l.variants, { fill: "var(--fc-bg)", stroke: "var(--fc-accent)" });
    body += rect(x, cy - 11, 26, 14, 4, st);
    body += text(x + 34, cy, l.label, { size: 11.5, fill: "var(--fc-fg-muted)" });
  }
  return { body, h: cy - y };
}
function arrowDefs(id) {
  return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--fc-fg-muted)"/></marker></defs>`;
}
function layoutTree(ast) {
  const PAD = 26, TITLE_H = 52, GAP = 16, LEAF_PAD = 24;
  function measure(it) {
    const mono = isMono(it.variants, true);
    const kids = it.children.filter((c) => c.kind === "node");
    if (!kids.length) {
      const gw = it.glyph ? GLYPH_W : 0;
      const w3 = Math.max(240, LEAF_PAD + gw + Math.max(tw(it.label, 15, { mono }), tw(it.sub || "", 12)) + LEAF_PAD);
      const h2 = it.sub ? 70 : 50;
      return it._m = { w: w3, h: h2 };
    }
    const km = kids.map(measure);
    const innerW = Math.max(...km.map((k) => k.w));
    const titleW = 20 + (it.glyph ? GLYPH_W : 0) + tw(it.label, 16, { mono, bold: true }) + 10 + tw(it.sub || "", 12.5) + 20;
    const w2 = Math.max(titleW, innerW + PAD * 2);
    const h = TITLE_H + km.reduce((a, k) => a + k.h, 0) + GAP * (kids.length - 1) + PAD;
    return it._m = { w: w2, h };
  }
  function draw(it, x, y, w2, depth) {
    const mono = isMono(it.variants, true);
    const kids = it.children.filter((c) => c.kind === "node");
    let body2 = "";
    if (!kids.length) {
      const st2 = styleFor(it.variants, { fill: "var(--fc-bg)", stroke: "var(--fc-accent)" });
      const h = it._m.h;
      body2 += `<g${stepAttrs(it)}>` + rect(x, y, w2, h, 10, st2, { class: "box" });
      if (it.glyph) {
        body2 += GLYPHS[it.glyph](x + LEAF_PAD, y + (h - 29) / 2 + 1, st2.stroke === "none" ? st2.fg : st2.stroke);
        const tx2 = x + LEAF_PAD + GLYPH_W;
        body2 += text(tx2, y + (it.sub ? 33 : h / 2 + 5), it.label, { size: 15, fill: st2.fg, mono });
        if (it.sub) body2 += text(tx2, y + 54, it.sub, { size: 12, fill: st2.sub, opacity: st2.subOp });
      } else {
        body2 += text(x + w2 / 2, y + (it.sub ? 31 : h / 2 + 5), it.label, { size: 15, fill: st2.fg, anchor: "middle", mono });
        if (it.sub) body2 += text(x + w2 / 2, y + 54, it.sub, { size: 12, fill: st2.sub, anchor: "middle", opacity: st2.subOp });
      }
      return body2 + "</g>";
    }
    const st = styleFor(it.variants, {
      fill: depth === 0 ? "var(--fc-surface)" : "var(--fc-surface-2)",
      stroke: "var(--fc-accent)"
    });
    body2 += `<g${stepAttrs(it)}>` + rect(x, y, w2, it._m.h, depth === 0 ? 14 : 12, st, { class: "box" });
    let tx = x + 20;
    const labelFill = st.labelFill || "var(--fc-accent)";
    if (it.glyph) {
      body2 += GLYPHS[it.glyph](tx, y + 16, labelFill);
      tx += GLYPH_W + 4;
    }
    body2 += text(tx, y + 34, it.label, { size: 16, bold: true, fill: labelFill, mono });
    if (it.sub) body2 += text(tx + tw(it.label, 16, { mono, bold: true }) + 10, y + 34, it.sub, { size: 12.5, fill: st.sub, opacity: st.subOp });
    let cy2 = y + TITLE_H;
    for (const k of kids) {
      body2 += draw(k, x + PAD, cy2, w2 - PAD * 2, depth + 1);
      cy2 += k._m.h + GAP;
    }
    return body2 + "</g>";
  }
  const roots = ast.items.filter((i) => i.kind === "node");
  roots.forEach(measure);
  const w = Math.max(...roots.map((r) => r._m.w));
  let body = "", cy = 16;
  for (const r of roots) {
    body += draw(r, 16, cy, w, 0);
    cy += r._m.h + 20;
  }
  cy -= 20;
  const ex = drawExtras(ast, 16, cy + 6, w);
  return { body: body + ex.body, w: w + 32, h: cy + ex.h + 22 };
}
function layoutStack(ast, mid) {
  const items = ast.items;
  const bands = items.filter((i) => i.kind === "node");
  const W = Math.max(300, ...bands.map((b) => Math.max(tw(b.label, 15.5, { bold: true, mono: isMono(b.variants, false) }), tw(b.sub || "", 11.5)) + 44));
  const x = 30, cx = x + W / 2, ARROW = 38;
  let body = "", y = 16;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "arrow") continue;
    const mono = isMono(it.variants, false);
    const h = it.sub ? 76 : 56;
    const st = styleFor(it.variants, { fill: "var(--fc-surface-2)", stroke: "var(--fc-border)" });
    body += `<g${stepAttrs(it)}>` + rect(x, y, W, h, 10, st, { class: "box" });
    body += text(cx, y + (it.sub ? 34 : h / 2 + 5.5), it.label, { size: 15.5, bold: true, fill: st.fg, anchor: "middle", mono });
    if (it.sub) body += text(cx, y + 55, it.sub, { size: 11.5, fill: st.sub, anchor: "middle", opacity: st.subOp });
    body += "</g>";
    y += h;
    let arrowLabel = null, hasNext = false;
    for (let j = i + 1; j < items.length; j++) {
      const nx = items[j];
      if (nx.kind === "arrow" && arrowLabel === null) arrowLabel = nx.label;
      if (nx.kind === "node") {
        hasNext = true;
        break;
      }
    }
    if (hasNext) {
      body += `<line x1="${cx}" y1="${y + 2}" x2="${cx}" y2="${y + ARROW - 4}" stroke="var(--fc-fg-muted)" stroke-width="1.6" marker-end="url(#${mid})"/>`;
      if (arrowLabel) body += text(cx + 12, y + ARROW / 2 + 4, arrowLabel, { size: 11.5, italic: true, fill: "var(--fc-fg-muted)" });
      y += ARROW;
    }
  }
  const ex = drawExtras(ast, x, y + 4, W);
  return { body: body + ex.body, w: W + 60, h: y + ex.h + 16 };
}
function layoutSequence(ast, mid) {
  const flat = [];
  (function walk(items, depth) {
    for (const it of items) {
      if (it.kind !== "node") continue;
      flat.push({ it, depth });
      walk(it.children, depth + 1);
    }
  })(ast.items, 0);
  const X0 = 58, INDENT = 34, GAP = 26, BADGE_R = 12;
  let body = "", y = 18, maxR = 0;
  const pos = [];
  for (const { it, depth } of flat) {
    const mono = isMono(it.variants, true);
    const h = it.sub ? 60 : 44;
    const w = Math.max(170, tw(it.label, 14.5, { mono }) + 40, tw(it.sub || "", 11.5) + 32);
    const x = X0 + depth * INDENT;
    pos.push({ it, x, y, w, h });
    maxR = Math.max(maxR, x + w);
    y += h + GAP;
  }
  y -= GAP;
  for (let i = 0; i < pos.length - 1; i++) {
    const a = pos[i], b = pos[i + 1];
    const x1 = a.x + 28, x2 = b.x + 28;
    const y1 = a.y + a.h, y2 = b.y - 2;
    if (Math.abs(x1 - x2) < 1) {
      body += `<line x1="${x1}" y1="${y1 + 2}" x2="${x2}" y2="${y2 - 3}" stroke="var(--fc-fg-muted)" stroke-width="1.5" marker-end="url(#${mid})"/>`;
    } else {
      body += `<path d="M${x1} ${y1 + 2} C ${x1} ${y1 + 14}, ${x2} ${y2 - 14}, ${x2} ${y2 - 3}" fill="none" stroke="var(--fc-fg-muted)" stroke-width="1.5" marker-end="url(#${mid})"/>`;
    }
  }
  for (const p of pos) {
    const { it } = p;
    const mono = isMono(it.variants, true);
    const st = styleFor(it.variants, { fill: "var(--fc-surface)", stroke: "var(--fc-border)" });
    let g = `<g${stepAttrs(it)}>`;
    g += rect(p.x, p.y, p.w, p.h, 10, st, { class: "box" });
    const tx = p.x + 20;
    g += text(tx, p.y + (it.sub ? 26 : p.h / 2 + 5), it.label, { size: 14.5, fill: st.fg, mono });
    if (it.sub) g += text(tx, p.y + 46, it.sub, { size: 11.5, fill: st.sub, opacity: st.subOp });
    if (typeof it.step === "number") {
      const bx = p.x - 24, by = p.y + p.h / 2;
      g += `<g class="badge"><circle cx="${bx}" cy="${by}" r="${BADGE_R}" fill="var(--fc-surface)" stroke="var(--fc-accent)" stroke-width="1.5"/>` + text(bx, by + 4, String(it.step), { size: 11, bold: true, fill: "var(--fc-accent)", anchor: "middle" }) + "</g>";
    }
    body += g + "</g>";
  }
  const ex = drawExtras(ast, 20, y + 6, maxR - 20);
  return { body: body + ex.body, w: maxR + 24, h: y + ex.h + 18 };
}
function layoutPipeline(ast, mid) {
  const items = ast.items;
  const stages = items.filter((i) => i.kind === "node");
  const anySub = stages.some((s) => s.sub);
  const H = anySub ? 76 : 56, GAPW = 56, Y = 26;
  let body = "", x = 16;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "arrow") continue;
    const mono = isMono(it.variants, false);
    const w = Math.max(118, tw(it.label, 14.5, { bold: true, mono }) + 36, tw(it.sub || "", 11.5) + 28);
    const st = styleFor(it.variants, { fill: "var(--fc-surface-2)", stroke: "var(--fc-border)" });
    body += `<g${stepAttrs(it)}>` + rect(x, Y, w, H, 10, st, { class: "box" });
    const cx = x + w / 2;
    body += text(cx, Y + (it.sub ? 33 : H / 2 + 5), it.label, { size: 14.5, bold: true, fill: st.fg, anchor: "middle", mono });
    if (it.sub) body += text(cx, Y + 54, it.sub, { size: 11.5, fill: st.sub, anchor: "middle", opacity: st.subOp });
    body += "</g>";
    x += w;
    let arrowLabel = null, hasNext = false;
    for (let j = i + 1; j < items.length; j++) {
      const nx = items[j];
      if (nx.kind === "arrow" && arrowLabel === null) arrowLabel = nx.label;
      if (nx.kind === "node") {
        hasNext = true;
        break;
      }
    }
    if (hasNext) {
      const ymid = Y + H / 2;
      body += `<line x1="${x + 4}" y1="${ymid}" x2="${x + GAPW - 6}" y2="${ymid}" stroke="var(--fc-fg-muted)" stroke-width="1.6" marker-end="url(#${mid})"/>`;
      if (arrowLabel) body += text(x + GAPW / 2, ymid - 10, arrowLabel, { size: 11.5, italic: true, fill: "var(--fc-fg-muted)", anchor: "middle" });
      x += GAPW;
    }
  }
  const ex = drawExtras(ast, 16, Y + H + 6, x - 32);
  return { body: body + ex.body, w: x + 16, h: Y + H + ex.h + 20 };
}
function layoutHub(ast, _mid) {
  const nodes = ast.items.filter((i) => i.kind === "node");
  if (!nodes.length) return { body: "", w: 100, h: 60 };
  const center = nodes[0], spokes = nodes.slice(1);
  const cMono = isMono(center.variants, false);
  const cw = Math.max(150, tw(center.label, 15.5, { bold: true, mono: cMono }) + (center.glyph ? GLYPH_W : 0) + 44);
  const ch = center.sub ? 72 : 54;
  const sBoxes = spokes.map((s) => {
    const mono = isMono(s.variants, true);
    return { s, w: Math.max(120, tw(s.label, 13.5, { mono }) + 32), h: 38, mono };
  });
  const maxSW = Math.max(0, ...sBoxes.map((b) => b.w));
  const rx = cw / 2 + maxSW / 2 + 74;
  const ry = ch / 2 + 19 + 70;
  const CX = rx + maxSW / 2 + 20, CY = ry + 19 + 26;
  let lines = "", boxes = "";
  sBoxes.forEach((b, i) => {
    const a = -Math.PI / 2 + 2 * Math.PI * i / sBoxes.length;
    const sx = Math.round(CX + Math.cos(a) * rx), sy = Math.round(CY + Math.sin(a) * ry);
    lines += `<line x1="${num(CX)}" y1="${num(CY)}" x2="${sx}" y2="${sy}" stroke="var(--fc-border)" stroke-width="1.4"/>`;
    const st = styleFor(b.s.variants, { fill: "var(--fc-surface)", stroke: "var(--fc-border)" });
    boxes += `<g${stepAttrs(b.s)}>` + rect(sx - b.w / 2, sy - b.h / 2, b.w, b.h, 19, st, { class: "box" }) + text(sx, sy + 4.5, b.s.label, { size: 13.5, fill: st.fg, anchor: "middle", mono: b.mono }) + "</g>";
  });
  const cst = styleFor(center.variants, { fill: "var(--fc-surface-2)", stroke: "var(--fc-accent)" });
  let cbody = rect(CX - cw / 2, CY - ch / 2, cw, ch, 12, cst, { class: "box" });
  const ctx = CX - cw / 2 + 22;
  if (center.glyph) {
    cbody += GLYPHS[center.glyph](ctx, CY - 13, cst.labelFill || cst.fg);
    cbody += text(ctx + GLYPH_W, CY + (center.sub ? -2 : 5.5), center.label, { size: 15.5, bold: true, fill: cst.fg, mono: cMono });
    if (center.sub) cbody += text(ctx + GLYPH_W, CY + 18, center.sub, { size: 11.5, fill: cst.sub, opacity: cst.subOp, mono: cMono });
  } else {
    cbody += text(CX, CY + (center.sub ? -2 : 5.5), center.label, { size: 15.5, bold: true, fill: cst.fg, anchor: "middle", mono: cMono });
    if (center.sub) cbody += text(CX, CY + 18, center.sub, { size: 11.5, fill: cst.sub, anchor: "middle", opacity: cst.subOp });
  }
  const w = CX * 2, h = CY * 2;
  const ex = drawExtras(ast, 24, h - 14, w - 48);
  return { body: lines + boxes + `<g${stepAttrs(center)}>${cbody}</g>` + ex.body, w, h: h + ex.h + 6 };
}
const LAYOUTS = {
  tree: (ast) => layoutTree(ast),
  stack: layoutStack,
  sequence: layoutSequence,
  pipeline: layoutPipeline,
  hub: layoutHub
};
function describe(ast) {
  const parts = [`${ast.type} diagram`];
  if (ast.notes.length) parts.push(ast.notes.join(". "));
  return parts.join(". ");
}
function renderDiagram(src) {
  try {
    const ast = parseDiagram(src);
    const mid = `fc-arrow-${hashId(ast.type + "|" + ast.title + "|" + src.length)}`;
    const { body, w, h } = LAYOUTS[ast.type](ast, mid);
    const needsMarker = body.includes(`url(#${mid})`);
    const titleId = `fc-d-t-${mid}`, descId = `fc-d-d-${mid}`;
    const svg = `<svg viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descId}" font-family="${SANS}"><title id="${titleId}">${esc(ast.title || `${ast.type} diagram`)}</title><desc id="${descId}">${esc(describe(ast))}</desc>` + (needsMarker ? arrowDefs(mid) : "") + body + `</svg>`;
    return { svg, warnings: ast.warnings };
  } catch (e) {
    const msg = e instanceof DiagramError ? e.message : `could not render diagram: ${String(e)}`;
    return { svg: "", warnings: [], error: msg };
  }
}
export {
  parseDiagram,
  renderDiagram
};
