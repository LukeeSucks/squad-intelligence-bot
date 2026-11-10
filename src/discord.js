// Talking to Discord: checking requests really come from Discord, editing
// replies (with the card picture attached) and registering the commands.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { COMMANDS } from "./commands.js";

// (DISCORD_API is only for testing against a pretend Discord)
const API = process.env.DISCORD_API || "https://discord.com/api/v10";

// Discord signs every request; anything without a valid signature is refused
let publicKey = null;
export function verify(signature, timestamp, body) {
  if (!signature || !timestamp || !config.publicKey) return false;
  try {
    publicKey ||= crypto.createPublicKey({
      // An Ed25519 public key in the format Node expects (fixed prefix + key)
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(config.publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), body]), publicKey, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// Waits and tries again if Discord says "slow down" (rare: these requests use
// the reply's own token, which has generous limits)
async function call(url, init, tries = 3) {
  const res = await fetch(url, init);
  if (res.status === 429 && tries > 1) {
    const body = await res.json().catch(() => ({}));
    await new Promise((r) => setTimeout(r, Math.ceil((body.retry_after || 1) * 1000)));
    return call(url, init, tries - 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

// Replaces the bot's reply with `message`, plus an optional picture
// file = { name, data (Buffer), description (alt text) }
export async function editReply(token, message, file = null) {
  const url = `${API}/webhooks/${config.applicationId}/${token}/messages/@original`;
  if (!file) {
    return call(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [], ...message }),
    });
  }
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      ...message,
      attachments: [{ id: 0, filename: file.name, description: (file.description || "").slice(0, 1000) }],
    }),
  );
  form.append("files[0]", new Blob([file.data], { type: file.type || "image/png" }), file.name);
  return call(url, { method: "PATCH", body: form });
}

// Adds/updates the slash commands, but only when they've changed since last
// time (needs DISCORD_TOKEN)
export async function registerCommands({ force = false } = {}) {
  if (!config.token || !config.applicationId) return "skipped (no DISCORD_TOKEN or DISCORD_APPLICATION_ID)";
  const body = JSON.stringify(COMMANDS);
  const hash = crypto.createHash("md5").update(body).digest("hex");
  const stamp = path.join(config.cacheDir, "commands-version.txt");
  if (!force && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === hash) return "up to date";
  await call(`${API}/applications/${config.applicationId}/commands`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bot ${config.token}` },
    body,
  });
  fs.mkdirSync(config.cacheDir, { recursive: true });
  fs.writeFileSync(stamp, hash);
  return `registered ${COMMANDS.length} commands`;
}
