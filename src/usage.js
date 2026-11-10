// Counts how often each command and card is used (replaces the old bot's
// analytics database). Saved to cache/usage.json at most once a minute.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const file = path.join(config.cacheDir, "usage.json");
let usage = { since: new Date().toISOString(), commands: {}, cards: {}, days: {} };
try {
  usage = { ...usage, ...JSON.parse(fs.readFileSync(file, "utf8")) };
} catch {
  // first run
}
let dirty = false;

export function count(command, card = null) {
  const day = new Date().toISOString().slice(0, 10);
  usage.commands[command] = (usage.commands[command] || 0) + 1;
  usage.days[day] = (usage.days[day] || 0) + 1;
  if (card) usage.cards[card] = (usage.cards[card] || 0) + 1;
  dirty = true;
}

export const getUsage = () => usage;

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  // Keep the last 90 days
  const days = Object.keys(usage.days).sort();
  days.slice(0, Math.max(0, days.length - 90)).forEach((d) => delete usage.days[d]);
  fs.mkdirSync(config.cacheDir, { recursive: true });
  fs.writeFile(file, JSON.stringify(usage), () => {});
}, 60_000).unref();
