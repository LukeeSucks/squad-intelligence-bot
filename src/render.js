// Draws a card (described in the website's bot data) as a PNG picture, in the
// website's "Night Ops" style. The website build decides WHAT is on a card;
// this file only decides how it looks, so new data never needs changes here.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { BOT_DIR } from "./config.js";
import { picture } from "./images.js";

const require = createRequire(import.meta.url);

export const W = 1200;
export const H = 700;
const PAD_X = 44;
const PAD_Y = 34;
const BODY_H = 444; // height left for the middle part
const BODY_W = W - PAD_X * 2;
const GAP = 16;

const C = {
  bg: "#0b0e0d",
  surface: "#131816",
  surface2: "#1a201e",
  line: "#232a27",
  lineStrong: "#2c3531",
  text: "#e9eeeb",
  text2: "#b9c3be",
  muted: "#8c9892",
  accent: "#ff3b3b",
  ok: "#4ade80",
};

let fonts = null;
let wasmReady = null;
const ready = () =>
  (wasmReady ||= (async () => {
    await initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const font = (file) => fs.readFileSync(path.join(BOT_DIR, "fonts", file));
    fonts = [
      { name: "Inter Tight", data: font("inter-tight-latin-400-normal.woff"), weight: 400 },
      { name: "Inter Tight", data: font("inter-tight-latin-600-normal.woff"), weight: 600 },
      { name: "Inter Tight", data: font("inter-tight-latin-800-normal.woff"), weight: 800 },
      { name: "JetBrains Mono", data: font("jetbrains-mono-latin-500-normal.woff"), weight: 500 },
    ];
  })());

// Tiny element builder: h("div", { style }, ...children)
const h = (type, props, ...children) => {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== "");
  return { type, props: { ...props, children: kids.length <= 1 ? kids[0] : kids } };
};
const box = (style, ...children) =>
  h("div", { style: { display: "flex", boxSizing: "border-box", ...style } }, ...children);
const text = (style, value) =>
  h("div", { style: { display: "flex", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...style } }, String(value));

const cut = (value, max) => {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

// The site logo: a keypad with one red key
const logo = (size) =>
  h(
    "svg",
    { width: size, height: size, viewBox: "0 0 120 120" },
    ...[
      [42, 3],
      [81, 3],
      [42, 42],
      [3, 81],
      [42, 81],
    ].map(([x, y]) => h("rect", { x, y, width: 34, height: 34, rx: 4, fill: C.text })),
    h("rect", { x: 81, y: 81, width: 34, height: 34, rx: 4, fill: C.accent }),
  );

const TYPE_NAMES = {
  vehicle: "Vehicle",
  weapon: "Weapon",
  kit: "Kit",
  faction: "Faction",
  map: "Map",
  layer: "Layer",
  emplacement: "Emplacement",
  compare: "Compare",
};

// ---------- pieces ----------

function statTile(label, value, width, height, highlight = null) {
  const v = String(value);
  // As big as fits the tile (bold text is about 0.56 × its size per letter)
  const size = Math.max(20, Math.min(40, Math.floor((width - 44) / (v.length * 0.56))));
  return box(
    {
      width,
      height,
      flexDirection: "column",
      justifyContent: "center",
      padding: "0 20px",
      background: C.surface,
      border: `1px solid ${highlight ? highlight : C.line}`,
      borderRadius: 14,
    },
    text({ fontSize: 22, color: C.muted, marginBottom: 2 }, label),
    text({ fontSize: size, fontWeight: 800, color: highlight || C.text, letterSpacing: -0.5 }, cut(v, 34)),
  );
}

function statGrid(stats, width, height, columns = 2) {
  if (!stats?.length) return null;
  const rows = Math.ceil(stats.length / columns);
  const tileW = Math.floor((width - GAP * (columns - 1)) / columns);
  const tileH = Math.min(118, Math.floor((height - GAP * (rows - 1)) / rows));
  return box(
    { width, flexWrap: "wrap", gap: GAP, alignContent: "flex-start" },
    stats.map(([label, value]) => statTile(label, value, tileW, tileH)),
  );
}

function imagePanel(img, width, height, kind) {
  return box(
    {
      width,
      height,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      background: kind === "map" ? C.surface : `radial-gradient(circle at 50% 45%, #1d2622 0%, ${C.surface} 70%)`,
      border: `1px solid ${C.line}`,
      borderRadius: 16,
      overflow: "hidden",
    },
    img
      ? h("img", {
          src: img.src,
          width: img.fitW,
          height: img.fitH,
          style: { borderRadius: kind === "map" ? 10 : 0 },
        })
      : text({ fontSize: 24, color: C.muted }, "No picture"),
  );
}

// Fits a picture inside a box, keeping its shape
const fit = (img, maxW, maxH) => {
  if (!img) return null;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  return { ...img, fitW: Math.round(img.width * scale), fitH: Math.round(img.height * scale) };
};

// Rows of [left, right, small] in one or two columns.
//   group: the third value is a heading (e.g. the seat) shown above its rows
//   stack: the right-hand value goes under the name in small print (for long
//          values like "2000 rounds · 857 RPM", so names aren't cut short)
function rowList(rows, width, height, { columns = 2, group = false, stack = false } = {}) {
  const hasSmall = stack || (!group && rows.some((r) => r[2]));
  const sizes = [
    { font: 26, row: hasSmall ? 62 : 46, head: 40 },
    { font: 23, row: hasSmall ? 54 : 40, head: 36 },
    { font: 21, row: hasSmall ? 48 : 35, head: 32 },
  ];
  // Rows become lines (group headings are lines of their own)
  const makeLines = (list) => {
    const out = [];
    let lastGroup = null;
    list.forEach((r) => {
      if (group && r[2] && r[2] !== lastGroup) {
        out.push({ head: r[2] });
        lastGroup = r[2];
      }
      out.push({ row: r });
    });
    return out;
  };
  const heightOf = (line, s) => (line.head ? s.head : s.row);
  const sum = (list, s) => list.reduce((t, l) => t + heightOf(l, s), 0);

  // Splits lines into columns of about the same height (between groups where
  // possible); null if they don't fit
  const layout = (lines, s, cols) => {
    const total = sum(lines, s);
    if (cols === 1 || (total <= height && lines.length <= 4)) return total <= height ? [lines] : null;
    let best = null;
    let a = 0;
    for (let i = 1; i < lines.length; i += 1) {
      a += heightOf(lines[i - 1], s);
      if (lines[i - 1].head) continue; // never end a column on a heading
      const repeatHead = group && !lines[i].head && lines[i].row?.[2];
      const b = total - a + (repeatHead ? s.head : 0);
      if (a > height || b > height) continue;
      const score = Math.max(a, b) + (repeatHead ? 40 : 0);
      if (!best || score < best.score) best = { i, score, repeatHead };
    }
    if (!best) return null;
    const second = lines.slice(best.i);
    if (best.repeatHead) second.unshift({ head: lines[best.i].row[2] });
    return [lines.slice(0, best.i), second];
  };

  let lines = makeLines(rows);
  let size = sizes[0];
  let cols = null;
  for (const s of sizes) {
    size = s;
    cols = layout(lines, s, columns);
    if (cols) break;
  }
  if (!cols) {
    // Still too many: show what fits and say how many more there are
    let keep = rows.length - 1;
    while (keep > 0 && !cols) {
      lines = [...makeLines(rows.slice(0, keep)), { more: `+ ${rows.length - keep} more on the website` }];
      cols = layout(lines, size, columns);
      keep -= 1;
    }
    cols ||= [lines];
  }

  const colW = Math.floor((width - GAP * 2 * (columns - 1)) / columns);
  const renderLine = (line) => {
    if (line.more) {
      return text({ height: size.row, alignItems: "center", fontSize: size.font - 2, color: C.accent }, line.more);
    }
    if (line.head) {
      return box(
        { height: size.head, alignItems: "flex-end", paddingBottom: 6 },
        text({ fontSize: size.font - 6, color: C.accent, fontFamily: "JetBrains Mono", letterSpacing: 1 }, line.head.toUpperCase()),
      );
    }
    const [left, right, small] = line.row;
    const under = stack ? [right, group ? null : small].filter(Boolean).join(" · ") : small;
    return box(
      {
        height: size.row,
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid ${C.line}`,
      },
      box(
        { flexDirection: "column", flexShrink: 1, minWidth: 0, marginRight: 16 },
        text({ fontSize: size.font, color: C.text }, left),
        hasSmall && under ? text({ fontSize: size.font - 6, color: stack ? C.text2 : C.muted }, under) : null,
      ),
      !stack && right
        ? text({ fontSize: size.font, fontWeight: 600, color: C.text2, flexShrink: 0, maxWidth: colW * 0.62 }, right)
        : null,
    );
  };
  return box(
    { width, height, gap: GAP * 2 },
    cols.map((col) => box({ width: colW, flexDirection: "column" }, col.map(renderLine))),
  );
}

// About how tall a tab's list needs to be at the normal text size
function listHeight(tab) {
  const rows = tab.rows || [];
  const small = tab.stack || (!tab.group && rows.some((r) => r[2]));
  const rowH = small ? 62 : 46;
  const heads = tab.group ? new Set(rows.map((r) => r[2]).filter(Boolean)).size : 0;
  const total = rows.length * rowH + heads * 40;
  const lines = rows.length + heads;
  if (tab.wide || lines <= 4) return total + 4;
  // Two columns: about half, plus room for one more line and a repeated heading
  return Math.ceil(total / 2) + rowH + (tab.group ? 40 : 0);
}

const noteBlock = (note, width) => {
  const lines = [].concat(note || []).filter(Boolean);
  if (!lines.length) return null;
  return box(
    { width, flexDirection: "column", gap: 4 },
    lines.map((line) =>
      h("div", { style: { display: "flex", fontSize: 22, color: C.text2, lineHeight: 1.35 } }, cut(line, 190)),
    ),
  );
};
const noteHeight = (note) => [].concat(note || []).filter(Boolean).reduce((t, l) => t + (l.length > 90 ? 64 : 34), 0);

// ---------- damage chart ----------

const niceStep = (range, ticks) => {
  const rough = range / ticks;
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => rough <= s) || 10 * power;
};

// Line chart of one or more falloff curves (one value every 50 m)
function chart(series, width, height) {
  const STEP = 50;
  const maxDistance = Math.max(300, ...series.map((s) => (s.values.length - 1) * STEP));
  const maxValue = Math.max(...series.flatMap((s) => s.values));
  const yStep = niceStep(maxValue || 1, 4);
  const yMax = Math.ceil(((maxValue || 1) * 1.1) / yStep) * yStep;
  const xStep = niceStep(maxDistance, 6);
  const m = { top: 16, right: 20, bottom: 40, left: 64 };
  const pw = width - m.left - m.right;
  const ph = height - m.top - m.bottom;
  const x = (d) => m.left + (d / maxDistance) * pw;
  const y = (v) => m.top + ph - (v / yMax) * ph;
  const at = (values, d) => values[Math.min(values.length - 1, Math.floor(d / STEP))];
  const lines = series.map((s) => {
    let d = "";
    for (let dist = 0; dist <= maxDistance; dist += STEP) d += `${dist ? "L" : "M"}${x(dist).toFixed(1)},${y(at(s.values, dist)).toFixed(1)} `;
    return { ...s, d };
  });
  const grid = [];
  const labels = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    grid.push(h("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), stroke: C.line, strokeWidth: 2 }));
    labels.push(text({ position: "absolute", left: 0, top: y(v) - 15, width: m.left - 12, justifyContent: "flex-end", fontSize: 21, color: C.muted, fontFamily: "JetBrains Mono" }, String(Math.round(v * 10) / 10)));
  }
  for (let d = 0; d <= maxDistance + 1e-9; d += xStep) {
    labels.push(text({ position: "absolute", left: x(d) - 50, top: height - m.bottom + 8, width: 100, justifyContent: "center", fontSize: 21, color: C.muted, fontFamily: "JetBrains Mono" }, `${d}m`));
  }
  const svg = h(
    "svg",
    { width, height, viewBox: `0 0 ${width} ${height}` },
    ...grid,
    ...lines.flatMap((l) => [
      series.length === 1
        ? h("path", { d: `${l.d} L${x(maxDistance)},${y(0)} L${x(0)},${y(0)} Z`, fill: l.color, fillOpacity: 0.12 })
        : null,
      h("path", { d: l.d, fill: "none", stroke: l.color, strokeWidth: 5, strokeLinejoin: "round", strokeDasharray: l.dash || undefined }),
    ]).filter(Boolean),
  );
  return box({ position: "relative", width, height }, svg, ...labels);
}

// ---------- whole card ----------

function frame({ title, sub, type, icon, headImage, path: pagePath, tabs, tabIndex, game, bodyH = BODY_H }, body) {
  return box(
    {
      width: W,
      height: H - (BODY_H - bodyH),
      flexDirection: "column",
      padding: `${PAD_Y}px ${PAD_X}px`,
      background: `radial-gradient(circle at 80% 0%, #17201c 0%, ${C.bg} 60%)`,
      fontFamily: "Inter Tight",
      color: C.text,
    },
    // Header
    box(
      { height: 104, alignItems: "center", justifyContent: "space-between" },
      box(
        { alignItems: "center", flexShrink: 1, minWidth: 0 },
        icon ? h("img", { src: icon.src, width: icon.fitW, height: icon.fitH, style: { marginRight: 22 } }) : null,
        box(
          { flexDirection: "column", minWidth: 0 },
          text({ fontSize: 56, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05 }, cut(title, 40)),
          text({ fontSize: 26, color: C.text2, marginTop: 4 }, cut(sub, 80)),
        ),
      ),
      box(
        { flexDirection: "column", alignItems: "flex-end", flexShrink: 0, marginLeft: 24 },
        headImage ? h("img", { src: headImage.src, width: headImage.fitW, height: headImage.fitH, style: { marginBottom: 8 } }) : null,
        box(
          { alignItems: "center", padding: "6px 14px", border: `1px solid ${C.lineStrong}`, borderRadius: 999 },
          box({ width: 10, height: 10, borderRadius: 999, background: C.ok, marginRight: 10 }),
          text({ fontSize: 19, fontFamily: "JetBrains Mono", color: C.text2, letterSpacing: 1.5 }, (TYPE_NAMES[type] || type).toUpperCase()),
        ),
      ),
    ),
    // Middle
    box({ height: bodyH, marginTop: 22 }, body),
    // Footer
    box(
      { flex: 1, alignItems: "flex-end", justifyContent: "space-between" },
      box(
        { alignItems: "center" },
        logo(26),
        text({ fontSize: 21, fontWeight: 600, marginLeft: 12 }, "squadintelligence.com"),
        text({ fontSize: 19, color: C.muted, marginLeft: 6, fontFamily: "JetBrains Mono" }, cut(pagePath || "", 44)),
      ),
      box(
        { alignItems: "center" },
        tabs?.length > 1
          ? tabs.map((t, i) =>
              text(
                {
                  fontSize: 20,
                  marginLeft: 18,
                  color: i === tabIndex ? C.text : C.muted,
                  fontWeight: i === tabIndex ? 600 : 400,
                  borderBottom: i === tabIndex ? `3px solid ${C.accent}` : "3px solid transparent",
                  paddingBottom: 2,
                },
                t,
              ),
            )
          : game
            ? text({ fontSize: 19, color: C.muted, fontFamily: "JetBrains Mono" }, `Squad ${game}`)
            : null,
      ),
    ),
  );
}

async function toPng(element, height = H) {
  await ready();
  const svg = await satori(element, { width: W, height, fonts });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
}

// card: one entry from the bot data; tabIndex: which tab to draw
export async function renderCard(type, card, tabIndex = 0, game = null) {
  const tab = card.tabs[tabIndex] || card.tabs[0];
  const kind = card.kind;
  const hasRows = tab.rows?.length > 0;
  const hasStats = tab.stats?.length > 0;
  const note = tab.note;
  let body;
  let bodyH = BODY_H;
  let headImage = null;
  const icon = card.icon ? fit(await picture(card.icon, 72, 72), 72, 72) : null;

  if (tab.chart) {
    const chartW = 700;
    const nh = noteHeight(note);
    body = box(
      { width: BODY_W, gap: 28 },
      box(
        { width: chartW, flexDirection: "column", justifyContent: "space-between" },
        chart([{ values: tab.chart.values, color: C.accent }], chartW, BODY_H - nh - 10),
        noteBlock(note, chartW),
      ),
      statGrid(tab.stats, BODY_W - chartW - 28, BODY_H, 2),
    );
  } else if (hasStats && !hasRows && card.img) {
    // Picture on the left, numbers on the right
    const imgW = kind === "map" ? BODY_H : kind === "badge" ? 380 : 520;
    const img = fit(await picture(card.img, imgW * 1.5, BODY_H * 1.5, { crop: kind === "render" || kind === "icon" }), imgW - 40, BODY_H - 40);
    if (img && kind === "map") Object.assign(img, fit(img, imgW - 16, BODY_H - 16));
    // Small icons get blurry when blown up a lot
    if (img && kind !== "map" && img.fitW > img.width * 2) Object.assign(img, fit(img, img.width * 2, img.height * 2));
    const rightW = BODY_W - imgW - 28;
    const nh = noteHeight(note);
    body = box(
      { width: BODY_W, gap: 28 },
      imagePanel(img, imgW, BODY_H, kind),
      box(
        { width: rightW, flexDirection: "column", justifyContent: "space-between" },
        statGrid(tab.stats, rightW, BODY_H - (nh ? nh + 18 : 0), 2),
        noteBlock(note, rightW),
      ),
    );
  } else {
    // Lists (with the numbers along the top if there are any)
    if (card.img) headImage = fit(await picture(card.img, 420, 120, { crop: true }), 280, kind === "badge" ? 70 : 56);
    const statsH = hasStats ? 104 : 0;
    const nh = noteHeight(note);
    const roomForList = BODY_H - (statsH ? statsH + 22 : 0) - (nh ? nh + 14 : 0);
    // Short lists get a shorter card instead of a big empty space
    const listH = hasRows ? Math.min(roomForList, listHeight(tab)) : 0;
    bodyH = Math.max(150, BODY_H - (roomForList - listH));
    body = box(
      { width: BODY_W, flexDirection: "column", justifyContent: "space-between" },
      hasStats ? statGrid(tab.stats.slice(0, 4), BODY_W, statsH, Math.min(4, tab.stats.length)) : null,
      hasRows ? rowList(tab.rows, BODY_W, listH, { columns: tab.wide ? 1 : 2, group: tab.group, stack: tab.stack }) : null,
      noteBlock(note, BODY_W),
    );
  }

  return toPng(
    frame(
      {
        title: card.name,
        sub: card.sub,
        type,
        icon,
        headImage,
        path: card.path,
        tabs: card.tabs.map((t) => t.label),
        tabIndex: card.tabs.indexOf(tab),
        game,
        bodyH,
      },
      body,
    ),
    H - (BODY_H - bodyH),
  );
}

// Two (or three) things side by side: rows of numbers with the best one
// highlighted, plus their damage curves for guns
const SERIES = [
  { color: C.accent, dash: null },
  { color: "#5cc8ff", dash: null },
  { color: "#ffd166", dash: "14 8" },
];

export async function renderCompare(kind, items, game = null) {
  const names = items.map((it) => it.card.name);
  const labels = [];
  items.forEach((it) => it.card.cmp.forEach(([label]) => !labels.includes(label) && labels.push(label)));
  const rows = labels
    .map((label) => {
      const cells = items.map((it) => it.card.cmp.find((c) => c[0] === label) || [label, null, "", null]);
      if (cells.every((c) => c[1] === null || c[1] === undefined)) return null;
      const better = cells.find((c) => c[3])?.[3];
      const numbers = cells.map((c) => (typeof c[1] === "number" ? c[1] : null));
      let best = null;
      if (better && numbers.filter((n) => n !== null).length > 1 && new Set(numbers).size > 1) {
        const target = better === "high" ? Math.max(...numbers.filter((n) => n !== null)) : Math.min(...numbers.filter((n) => n !== null));
        best = numbers.map((n) => n === target);
      }
      return { label, cells, best };
    })
    .filter(Boolean);

  const curves = kind === "weapon" ? items.map((it, i) => it.card.curve && { values: it.card.curve, ...SERIES[i] }).filter(Boolean) : [];
  const chartW = curves.length ? 520 : 0;
  const tableW = BODY_W - (chartW ? chartW + 28 : 0);
  const labelW = Math.round(tableW * (items.length === 2 ? 0.36 : 0.3));
  const cellW = Math.floor((tableW - labelW) / items.length);
  const rowH = Math.min(46, Math.floor((BODY_H - 56) / Math.max(rows.length, 1)));
  const font = rowH >= 42 ? 25 : 22;
  const fmtCell = (c) =>
    c[1] === null || c[1] === undefined ? "–" : `${c[1]}${c[2] ? (c[2] === "%" ? "%" : ` ${c[2]}`) : ""}`;

  const table = box(
    { width: tableW, flexDirection: "column" },
    box(
      { height: 56, alignItems: "center", borderBottom: `2px solid ${C.lineStrong}` },
      text({ width: labelW, fontSize: 20, color: C.muted }, ""),
      ...items.map((it, i) =>
        box(
          { width: cellW, alignItems: "center", paddingRight: 10 },
          box({ width: 14, height: 14, borderRadius: 999, background: SERIES[i].color, marginRight: 10, flexShrink: 0 }),
          text({ fontSize: 24, fontWeight: 800 }, cut(it.card.name, 22)),
        ),
      ),
    ),
    ...rows.map((r) =>
      box(
        { height: rowH, alignItems: "center", borderBottom: `1px solid ${C.line}` },
        text({ width: labelW, fontSize: font - 2, color: C.text2 }, r.label),
        ...r.cells.map((c, i) =>
          text(
            {
              width: cellW,
              fontSize: font,
              fontWeight: r.best?.[i] ? 800 : 400,
              color: r.best?.[i] ? C.ok : C.text,
            },
            fmtCell(c),
          ),
        ),
      ),
    ),
  );
  const body = box(
    { width: BODY_W, gap: 28 },
    table,
    curves.length
      ? box(
          { width: chartW, flexDirection: "column" },
          text({ fontSize: 22, color: C.muted, marginBottom: 6 }, "Damage over distance"),
          chart(curves, chartW, BODY_H - 40),
        )
      : null,
  );
  const sub =
    kind === "weapon"
      ? items.map((it) => it.card.fire).filter(Boolean).join(" vs ")
      : items.map((it) => it.card.sub.split(" · ")[0]).join(" vs ");
  return toPng(
    frame(
      {
        title: names.join(" vs "),
        sub: `${sub} · green = better`,
        type: "compare",
        path: kind === "weapon" ? "/compare" : kind === "faction" ? "/compare/factions" : "",
        tabs: [],
        tabIndex: 0,
        game,
      },
      body,
    ),
  );
}
