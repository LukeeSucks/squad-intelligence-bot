// The website's bot data (bot-data/, made when the website is built).
// When the website is rebuilt and uploaded, version.json changes and the bot
// loads the new data by itself, no restart needed.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { fromSite } from "./site.js";

export const TYPES = ["vehicle", "weapon", "kit", "faction", "map", "layer", "emplacement"];

let state = { version: null, meta: null, index: [], cards: {} };
let lastCheck = 0;
let loading = null;

async function readJson(name) {
  if (config.siteDir) {
    return JSON.parse(await fs.promises.readFile(path.join(config.siteDir, "bot-data", name), "utf8"));
  }
  const res = await fromSite(`bot-data/${name}`);
  if (res.status !== 200) throw new Error(`${name}: the website answered ${res.status}`);
  return JSON.parse(res.body.toString("utf8"));
}

async function load() {
  const meta = await readJson("version.json");
  if (meta.version === state.version) return;
  const [index, ...cardFiles] = await Promise.all([
    readJson("index.json"),
    ...TYPES.map((type) => readJson(`${type}.json`)),
  ]);
  const cards = {};
  TYPES.forEach((type, i) => (cards[type] = cardFiles[i]));
  // Search entries: [type, id, name, detail, words], plus lower-case copies
  const entries = index.map(([type, id, name, detail, words]) => ({
    type,
    id,
    name,
    detail,
    lower: name.toLowerCase(),
    // Without spaces and dashes, so "ak74" finds "AK-74"
    flat: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    words: `${name} ${detail} ${words}`.toLowerCase(),
    // Words of the name and detail ("medic usa" → Medic · USA before L85A2 + SUSAT)
    wordStarts: `${name} ${detail}`.toLowerCase().split(/[\s·,+()/-]+/).filter(Boolean),
  }));
  state = { version: meta.version, meta, index: entries, cards };
  console.log(`Loaded bot data ${meta.version} (game ${meta.game})`);
}

// Makes sure the newest data is loaded (checks at most every 20 seconds, or
// every 5 minutes when it has to download it)
export async function fresh() {
  const wait = config.siteDir ? 20_000 : 300_000;
  if (state.version && Date.now() - lastCheck < wait) return state;
  lastCheck = Date.now();
  loading ||= load()
    .catch((error) => {
      console.error("Couldn't load bot data:", error.message);
      if (!state.version) throw error;
    })
    .finally(() => (loading = null));
  await loading;
  return state;
}

export const current = () => state;

export const getCard = (type, id) => state.cards[type]?.[id] || null;

// Best matches for what someone typed, optionally only some types
export function search(query, types = null, limit = 25) {
  const q = (query || "").toLowerCase().trim();
  const pool = types ? state.index.filter((e) => types.includes(e.type)) : state.index;
  if (!q) return pool.slice(0, limit);
  const parts = q.split(/\s+/);
  const flat = q.replace(/[^a-z0-9]+/g, "");
  const scored = [];
  for (const entry of pool) {
    let score;
    if (entry.lower === q) score = 0;
    else if (entry.lower.startsWith(q) || (flat && entry.flat.startsWith(flat))) score = 1;
    else if (entry.lower.split(/[\s\-/]+/).some((word) => word.startsWith(q))) score = 2;
    else if (entry.lower.includes(q) || (flat.length > 2 && entry.flat.includes(flat))) score = 3;
    else if (parts.every((part) => entry.wordStarts.some((w) => w.startsWith(part)))) score = 4;
    else if (parts.every((part) => entry.words.includes(part))) score = 5;
    else continue;
    scored.push([score, entry]);
  }
  scored.sort(
    (a, b) =>
      a[0] - b[0] ||
      a[1].name.length - b[1].name.length ||
      a[1].name.localeCompare(b[1].name) ||
      a[1].detail.localeCompare(b[1].detail) ||
      // Same name and detail (faction setups): the usual "LO" setup first
      Number(!a[1].id.includes("_LO_")) - Number(!b[1].id.includes("_LO_")) ||
      a[1].id.length - b[1].id.length,
  );
  return scored.slice(0, limit).map(([, entry]) => entry);
}

// The card for a website page ("/vehicles/BP_M1A2"), for link previews.
// Several cards can share a page (e.g. emplacement versions): the first wins.
let pathIndex = { version: null, map: new Map() };
export function cardForPath(pagePath) {
  if (pathIndex.version !== state.version) {
    const map = new Map();
    for (const type of TYPES) {
      for (const [id, card] of Object.entries(state.cards[type] || {})) {
        if (card.path && !map.has(card.path)) map.set(card.path, { type, id });
      }
    }
    pathIndex = { version: state.version, map };
  }
  return pathIndex.map.get(pagePath) || null;
}

// Works out what a command option means: an exact pick from the suggestions
// ("vehicle:BP_M1A2"), a known id, or just typed text (best match)
export function resolve(value, types) {
  if (!value) return null;
  const [maybeType, ...rest] = value.split(":");
  if (TYPES.includes(maybeType) && rest.length && (!types || types.includes(maybeType))) {
    const id = rest.join(":");
    if (getCard(maybeType, id)) return { type: maybeType, id };
  }
  for (const type of types || TYPES) {
    if (getCard(type, value)) return { type, id: value };
  }
  const best = search(value, types, 1)[0];
  return best ? { type: best.type, id: best.id } : null;
}
