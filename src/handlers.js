// What the bot does with each slash command, button click and autocomplete.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { CARD_COMMANDS, COMPARE_KINDS } from "./commands.js";
import { current, fresh, getCard, resolve, search } from "./data.js";
import { editReply } from "./discord.js";
import { drawCard, drawCompare } from "./drawer.js";
import { fromSite } from "./site.js";
import { count } from "./usage.js";

// Interaction and response types (see Discord's docs)
const PING = 1, COMMAND = 2, COMPONENT = 3, AUTOCOMPLETE = 4;
const PONG = 1, REPLY = 4, THINKING = 5, UPDATING = 6, CHOICES = 8;
const ONLY_YOU = 64; // message flag: only the person who asked sees it

const TYPE_LABEL = {
  vehicle: "Vehicle",
  weapon: "Weapon",
  kit: "Kit",
  faction: "Faction",
  map: "Map",
  layer: "Layer",
  emplacement: "Emplacement",
};

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const reply = (content, hidden = true) => ({ type: REPLY, data: { content, flags: hidden ? ONLY_YOU : 0 } });

// ---------- card pictures (kept on disk until the website's data changes) ----------

let cacheVersion = null;
function cachePath(version, name) {
  const dir = path.join(config.cacheDir, "cards", version);
  if (cacheVersion !== version) {
    cacheVersion = version;
    fs.mkdirSync(dir, { recursive: true });
    // Pictures from older data are out of date: remove them
    for (const old of fs.readdirSync(path.join(config.cacheDir, "cards"))) {
      if (old !== version) fs.rmSync(path.join(config.cacheDir, "cards", old), { recursive: true, force: true });
    }
  }
  return path.join(dir, `${name.replace(/[^A-Za-z0-9_.-]+/g, "_")}.png`);
}

async function cached(name, make) {
  const { version } = current();
  const file = cachePath(version, name);
  try {
    return await fs.promises.readFile(file);
  } catch {
    const started = Date.now();
    const png = await make();
    console.log(`Drew ${name} in ${Date.now() - started} ms`);
    fs.promises.writeFile(file, png).catch(() => {});
    return png;
  }
}

// Text version of a card, for screen readers (Discord's image description)
function altText(card, tab) {
  const parts = [`${card.name}. ${card.sub}.`, `${tab.label}:`];
  (tab.stats || []).forEach(([l, v]) => parts.push(`${l} ${v};`));
  (tab.rows || []).slice(0, 25).forEach((r) => parts.push(`${r.filter(Boolean).join(", ")};`));
  [].concat(tab.note || []).forEach((n) => parts.push(n));
  return parts.join(" ");
}

// Tab buttons plus a link to the full page on the website
function buttons(type, id, card, tabIndex) {
  const row = [];
  if (card.tabs.length > 1) {
    card.tabs.slice(0, 4).forEach((tab, i) => {
      const customId = `t|${type}|${id}|${i}`;
      if (customId.length > 100) return;
      row.push({ type: 2, style: i === tabIndex ? 1 : 2, label: tab.label, custom_id: customId, disabled: i === tabIndex });
    });
  }
  row.push({ type: 2, style: 5, label: "Open on website", url: `${config.siteUrl}${card.path}` });
  return [{ type: 1, components: row }];
}

async function sendCard(token, type, id, tabIndex = 0) {
  const card = getCard(type, id);
  const tab = card.tabs[tabIndex] || card.tabs[0];
  const png = await cached(`${type}-${id}-${tabIndex}`, () => drawCard(type, card, tabIndex, current().meta.game));
  await editReply(
    token,
    { content: "", components: buttons(type, id, card, card.tabs.indexOf(tab)) },
    { name: `${type}-${tab.id}.png`, data: png, description: altText(card, tab) },
  );
}

// Runs the slow part after Discord has been told "working on it", and turns
// any failure into a message instead of leaving "thinking..." forever
function later(token, work) {
  work().catch(async (error) => {
    console.error(error);
    await editReply(token, {
      content: "Sorry, something went wrong making that card. Please try again in a moment.",
      components: [],
    }).catch(() => {});
  });
}

// ---------- commands ----------

const options = (interaction) => {
  let list = interaction.data.options || [];
  let sub = null;
  if (list[0]?.type === 1) {
    sub = list[0].name;
    list = list[0].options || [];
  }
  return { sub, values: Object.fromEntries(list.map((o) => [o.name, o.value])), list };
};

function cardCommand(interaction, name) {
  const { values } = options(interaction);
  const typed = values.name ?? values.search;
  const found = resolve(String(typed || ""), CARD_COMMANDS[name]);
  if (!found) {
    return reply(`Couldn't find **${cut(String(typed), 80)}**. Pick one of the suggestions as you type, or try \`/find\`.`);
  }
  count(name, `${found.type}:${found.id}`);
  later(interaction.token, () => sendCard(interaction.token, found.type, found.id));
  return { type: THINKING };
}

function compareCommand(interaction) {
  const { sub, values } = options(interaction);
  const kind = COMPARE_KINDS[sub];
  const picks = [values.first, values.second, values.third].filter(Boolean);
  const items = [];
  for (const value of picks) {
    const found = resolve(String(value), [kind]);
    if (!found) return reply(`Couldn't find **${cut(String(value), 80)}**. Pick from the suggestions as you type.`);
    const card = getCard(kind, found.id);
    if (!card.cmp) {
      return reply(`**${card.name}** can't be compared. Only guns with a damage curve can (the same as the website's compare page).`);
    }
    if (!items.some((i) => i.id === found.id)) items.push({ id: found.id, card });
  }
  if (items.length < 2) return reply("Pick two different things to compare.");
  count(`compare ${sub}`);
  const ids = items.map((i) => i.id);
  const link =
    kind === "weapon"
      ? `/compare?w=${ids.join(",")}`
      : kind === "faction"
        ? `/compare/factions?f=${ids.join(",")}`
        : null;
  later(interaction.token, async () => {
    const png = await cached(`compare-${kind}-${ids.join("-")}`, () => drawCompare(kind, items, current().meta.game));
    const rows = items.map((i) => ({ type: 2, style: 5, label: cut(i.card.name, 70), url: `${config.siteUrl}${i.card.path}` }));
    if (link) rows.unshift({ type: 2, style: 5, label: "Compare on website", url: `${config.siteUrl}${link}` });
    const text = `Comparing ${items.map((i) => i.card.name).join(", ")}. ${items[0].card.cmp
      .map(([label]) => `${label}: ${items.map((i) => {
        const c = i.card.cmp.find((x) => x[0] === label);
        return c && c[1] !== null ? `${c[1]}${c[2] ? ` ${c[2]}` : ""}` : "none";
      }).join(" vs ")}`)
      .join("; ")}`;
    await editReply(
      interaction.token,
      { content: "", components: [{ type: 1, components: rows.slice(0, 5) }] },
      { name: "compare.png", data: png, description: text },
    );
  });
  return { type: THINKING };
}

function controlsCommand(interaction) {
  count("controls");
  later(interaction.token, async () => {
    const file = config.siteDir
      ? await fs.promises.readFile(path.join(config.siteDir, "learn", "squad-controls.webp"))
      : (await fromSite("learn/squad-controls.webp")).body;
    await editReply(
      interaction.token,
      {
        content: "**Squad keyboard controls**",
        components: [{ type: 1, components: [{ type: 2, style: 5, label: "Learn Squad on the website", url: `${config.siteUrl}/learn#controls` }] }],
      },
      { name: "squad-controls.webp", data: file, type: "image/webp", description: "Squad's default keyboard controls" },
    );
  });
  return { type: THINKING };
}

function helpCommand() {
  count("help");
  const lines = [
    "**Squad Intelligence bot** — everything from squadintelligence.com, as a picture card.",
    "",
    "Start typing after a command and pick from the list:",
    "`/vehicle` `/weapon` `/kit` `/faction` `/map` `/layer` `/emplacement`",
    "`/find` searches all of them at once.",
    "`/compare weapons` · `/compare vehicles` · `/compare factions` — two or three side by side.",
    "`/controls` — the keyboard controls.  `/info` — about the bot.",
    "",
    "Use the buttons under a card to switch tabs (e.g. Weapons, Damage, Kits), or open the full page on the website.",
  ];
  return reply(lines.join("\n"));
}

function infoCommand() {
  count("info");
  const { meta } = current();
  return {
    type: REPLY,
    data: {
      embeds: [
        {
          title: "Squad Intelligence Bot",
          url: config.siteUrl,
          color: 0xff3b3b,
          description:
            "Squad Intelligence Bot is developed by LukeeSucks & Willy Wanker. While we are partnered with Offworld, this is a fully community-driven project, so we follow their rules and terms.\n\n" +
            "Everything comes from data extracted directly from the Squad SDK, and the bot uses exactly the same data as squadintelligence.com, so they always match.\n\n" +
            `The bot is, and always will be, completely free. All the data is available for your own projects too. Join our [Discord](${config.discordInvite}) and talk to us or MJH1606, the main data extractor for this project.`,
          fields: [
            { name: "Game version", value: `Squad ${meta?.game || "?"}`, inline: true },
            { name: "Data updated", value: meta?.built ? `<t:${Math.floor(Date.parse(meta.built) / 1000)}:R>` : "?", inline: true },
            { name: "Developers", value: "LukeeSucks & Willy Wanker", inline: false },
            { name: "Data provider", value: "MJH1606", inline: true },
          ],
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "Website", url: config.siteUrl },
            { type: 2, style: 5, label: "Discord", url: config.discordInvite },
          ],
        },
      ],
    },
  };
}

// ---------- autocomplete ----------

function autocomplete(interaction) {
  const name = interaction.data.name;
  const { sub, list } = options(interaction);
  const focused = list.find((o) => o.focused);
  const types = name === "compare" ? [COMPARE_KINDS[sub]] : CARD_COMMANDS[name];
  let results = search(String(focused?.value || ""), types, 50);
  // Compare only offers things that can be compared
  if (name === "compare") results = results.filter((e) => getCard(e.type, e.id)?.cmp);
  return {
    type: CHOICES,
    data: {
      choices: results.slice(0, 25).map((e) => ({
        name: cut(`${e.name}${e.detail ? ` · ${e.detail}` : ""}${name === "find" ? ` (${TYPE_LABEL[e.type]})` : ""}`, 100),
        value: cut(`${e.type}:${e.id}`, 100),
      })),
    },
  };
}

// ---------- buttons ----------

function button(interaction) {
  const [kind, type, id, tab] = interaction.data.custom_id.split("|");
  if (kind !== "t") return { type: UPDATING };
  const card = getCard(type, id);
  if (!card) return reply("That isn't in the game data any more (the website has been updated). Run the command again.");
  count("tab", `${type}:${id}`);
  later(interaction.token, () => sendCard(interaction.token, type, id, Number(tab) || 0));
  return { type: UPDATING };
}

// ---------- entry point ----------

export async function handle(interaction) {
  if (interaction.type === PING) return { type: PONG };
  // Only wait for the website's data if there isn't any yet; otherwise check
  // for new data in the background so Discord gets its answer straight away
  if (!current().version) await fresh();
  else fresh().catch(() => {});
  if (interaction.type === AUTOCOMPLETE) return autocomplete(interaction);
  if (interaction.type === COMPONENT) return button(interaction);
  if (interaction.type !== COMMAND) return reply("Unknown interaction.");
  const name = interaction.data.name;
  if (name in CARD_COMMANDS) return cardCommand(interaction, name);
  if (name === "compare") return compareCommand(interaction);
  if (name === "controls") return controlsCommand(interaction);
  if (name === "help") return helpCommand();
  if (name === "info") return infoCommand();
  if (name === "ping") {
    count("ping");
    return reply(`Pong! Using website data ${current().version} (Squad ${current().meta?.game}).`);
  }
  return reply("I don't know that command any more. It may take a minute for Discord to update the list.");
}
