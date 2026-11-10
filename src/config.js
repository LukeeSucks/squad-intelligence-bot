// Settings, from environment variables (cPanel: Deploy a Node.js App → the
// app → App Env) or a .env file next to app.js. See README.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Reads KEY=value lines from .env (values already set elsewhere win)
try {
  fs.readFileSync(path.join(BOT_DIR, ".env"), "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
    });
} catch {
  // no .env file: fine
}

// Where the website's files are. On the host that's public_html in the home
// folder; when trying the bot locally it's the project's release/website folder.
// If none of these have the data (e.g. the app runs in its own container and
// can't see the website's folder), it downloads it from the website instead.
function findSiteDir() {
  const candidates = [
    process.env.SITE_DIR && path.resolve(process.env.SITE_DIR),
    path.join(os.homedir(), "public_html"),
    path.join(BOT_DIR, "..", "release", "website"),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, "bot-data", "version.json"))) || null;
}

export const config = {
  // Spaces and quote marks around pasted values are ignored
  publicKey: (process.env.DISCORD_PUBLIC_KEY || "").replace(/["'\s]/g, "").toLowerCase(),
  applicationId: process.env.DISCORD_APPLICATION_ID || "",
  // Only needed so the bot can add/update its slash commands by itself
  token: process.env.DISCORD_TOKEN || "",
  siteUrl: (process.env.SITE_URL || "https://squadintelligence.com").replace(/\/$/, ""),
  // Optional: the address to connect to for siteUrl (normally worked out by itself)
  siteIp: process.env.SITE_IP || "",
  // null = download the data and pictures from siteUrl instead
  siteDir: findSiteDir(),
  cacheDir: path.resolve(BOT_DIR, process.env.CACHE_DIR || "cache"),
  port: Number(process.env.PORT) || 3000,
  // Discord invite shown in /info
  discordInvite: process.env.DISCORD_INVITE || "https://discord.gg/38SZApC9Ur",
};
