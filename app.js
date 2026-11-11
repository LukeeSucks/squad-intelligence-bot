// Squad Intelligence Discord bot.
//
// Discord sends each slash command, button click and autocomplete to this app
// as a web request (the "Interactions Endpoint URL" in the Discord Developer
// Portal), so it runs like a small website: cPanel's "Deploy a Node.js App" can
// host it next to squadintelligence.com, and it doesn't need to stay connected
// to Discord all the time. See README.md for setting it up.
import http from "node:http";
import { config } from "./src/config.js";
import { current, fresh } from "./src/data.js";
import { registerCommands, verify } from "./src/discord.js";
import { handle, pagePreview } from "./src/handlers.js";
import { getUsage } from "./src/usage.js";
import { siteStatus } from "./src/site.js";

const started = Date.now();
// Requests to /interactions: accepted (signed by Discord) and refused
const checks = { ok: 0, refused: 0 };
// Link preview pictures sent (since start)
let previews = 0;
// Website section → its share picture in /og/ (used when a page has no card)
const PREVIEW_SECTIONS = {
  vehicles: "vehicles",
  weapons: "weapons",
  roles: "roles",
  factions: "factions",
  maps: "maps",
  layers: "layers",
  emplacements: "emplacements",
};
const MAX_BODY = 1024 * 1024;

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

// A small page showing the bot is running (no secrets on it)
function statusPage(res) {
  const { version, meta } = current();
  const usage = getUsage();
  const today = usage.days[new Date().toISOString().slice(0, 10)] || 0;
  const total = Object.values(usage.commands).reduce((a, b) => a + b, 0);
  const top = Object.entries(usage.cards)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, n]) => `  ${k}  ${n}`)
    .join("\n");
  const site = siteStatus();
  const problems = [
    !config.publicKey && "DISCORD_PUBLIC_KEY is not set",
    config.publicKey &&
      !/^[0-9a-f]{64}$/.test(config.publicKey) &&
      `DISCORD_PUBLIC_KEY doesn't look right: it should be 64 letters and numbers, but it's ${config.publicKey.length} characters`,
    !config.applicationId && "DISCORD_APPLICATION_ID is not set",
    !version && "website data not loaded (check the site has been built and uploaded)",
    site.problem && `can't reach the website: ${site.problem}`,
  ].filter(Boolean);
  send(
    res,
    200,
    [
      "Squad Intelligence bot is running.",
      "",
      `Website data:  ${version || "not loaded"}${meta ? `  (Squad ${meta.game}, built ${meta.built})` : ""}`,
      `Reading from:  ${config.siteDir || `${config.siteUrl}${site.route ? ` (${site.route})` : ""}`}`,
      `Up for:        ${Math.round((Date.now() - started) / 60000)} min`,
      `Commands used: ${today} today, ${total} since ${usage.since.slice(0, 10)}`,
      `From Discord:  ${checks.ok} accepted, ${checks.refused} refused (since start)`,
      `Link previews: ${previews} sent (since start)`,
      problems.length ? `\nPROBLEMS:\n${problems.map((p) => `  - ${p}`).join("\n")}` : "",
      top ? `\nMost viewed cards:\n${top}` : "",
    ].join("\n"),
    "text/plain; charset=utf-8",
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  // The app may sit under a path like /bot, so only the end of the path matters
  if (req.method === "POST" && url.pathname.endsWith("/interactions")) {
    const arrived = Date.now();
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(chunk);
    });
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      if (!verify(req.headers["x-signature-ed25519"], req.headers["x-signature-timestamp"], body)) {
        // Discord sends some deliberately bad ones as a test, so a few of these are normal
        checks.refused += 1;
        console.log(`Request refused: signature didn't match (${checks.refused} so far, ${checks.ok} accepted)`);
        return send(res, 401, { error: "invalid request signature" });
      }
      checks.ok += 1;
      if (checks.ok === 1) console.log("First request from Discord accepted");
      try {
        const interaction = JSON.parse(body.toString("utf8"));
        const answer = await handle(interaction);
        send(res, 200, answer);
        // Log commands and button clicks (not every letter typed for suggestions).
        // Discord's ids contain the moment it was clicked, so this also shows
        // how long the click took to reach the bot (Discord allows 3 seconds in all).
        const ms = Date.now() - arrived;
        const clicked = interaction.id ? Number((BigInt(interaction.id) >> 22n) + 1420070400000n) : arrived;
        const travel = arrived - clicked;
        if (interaction.type === 2 || interaction.type === 3 || ms + travel > 1000) {
          const what = interaction.data?.custom_id || `/${interaction.data?.name || "ping"}`;
          const time = new Date().toISOString().slice(11, 19);
          const slow = ms + travel > 2500 ? "  << TOO SLOW for Discord" : "";
          console.log(`${time} ${what}: reached the bot ${travel} ms after the click, answered in ${ms} ms${slow}`);
        }
      } catch (error) {
        console.error(error);
        send(res, 200, { type: 4, data: { content: "Sorry, the bot hit a problem. Please try again.", flags: 64 } });
      }
    });
    return;
  }
  // Link preview pictures: /preview/vehicles/BP_M1A2.png is the card for
  // squadintelligence.com/vehicles/BP_M1A2 (the website's pages point here)
  const preview = url.pathname.match(/^\/preview(\/[a-z]+\/[^/]+)\.png$/);
  if (preview && (req.method === "GET" || req.method === "HEAD")) {
    let pagePath;
    try {
      pagePath = decodeURIComponent(preview[1]);
    } catch {
      pagePath = preview[1];
    }
    pagePreview(pagePath).then(
      (png) => {
        if (!png) {
          // No card for that page: the website's own picture for that section
          const section = pagePath.split("/")[1];
          res.writeHead(302, { Location: `${config.siteUrl}/og/${PREVIEW_SECTIONS[section] || "home"}.jpg` });
          res.end();
          return;
        }
        previews += 1;
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": png.length,
          // Sites that show link previews keep their own copy for a day
          "Cache-Control": "public, max-age=86400",
        });
        res.end(req.method === "HEAD" ? undefined : png);
      },
      (error) => {
        console.error("Link preview failed:", pagePath, error.message);
        send(res, 500, { error: "could not draw that card" });
      },
    );
    return;
  }
  if (req.method === "GET") {
    fresh()
      .catch(() => {})
      .then(() => statusPage(res));
    return;
  }
  send(res, 404, { error: "not found" });
});

// The host's web server passes requests on to the bot and reuses connections.
// Node normally closes an idle connection after 5 seconds; if that happens just
// as the host reuses it, the request (e.g. a button click) is lost and Discord
// says "didn't respond in time". So leave closing idle connections to the host.
server.keepAliveTimeout = 0;

server.listen(config.port, () => {
  console.log(`Bot listening on port ${config.port}`);
});

// Load the data straight away, and add/update the slash commands if they've changed
fresh().catch((error) => console.error("Data:", error.message));
registerCommands()
  .then((result) => console.log(`Slash commands: ${result}`))
  .catch((error) => console.error("Slash commands:", error.message));
