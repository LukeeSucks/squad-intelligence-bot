// Downloads files from the website (used when the bot can't see the website's
// folder, e.g. on eUKhost where it runs in its own container).
//
// Some hosts don't let an app reach its own server's public address from
// inside the container. If the normal route fails, this tries the usual
// "this is the host server" addresses a container has, with the same name and
// certificate, and remembers whichever works. SITE_IP forces an address.
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import { config } from "./config.js";

const TIMEOUT = 15_000;
// Shorter wait when just trying out a route
const PROBE_TIMEOUT = 6_000;
// After every route failed, don't try again for this long (keeps the status
// page quick)
const RETRY_AFTER = 60_000;
const HEADERS = { "User-Agent": "SquadIntelligenceBot (+https://squadintelligence.com)", "Cache-Control": "no-cache" };

// The container's gateway: the host server, seen from inside the container
function gateway() {
  try {
    const line = fs
      .readFileSync("/proc/net/route", "utf8")
      .split("\n")
      .map((row) => row.trim().split(/\s+/))
      .find((cols) => cols[1] === "00000000" && cols[2] && cols[2] !== "00000000");
    if (!line) return null;
    // Stored back to front in hex: 0100A8C0 → 192.168.0.1
    return line[2].match(/../g).reverse().map((h) => parseInt(h, 16)).join(".");
  } catch {
    return null;
  }
}

// Names and addresses containers commonly use for "the host server"
const HOST_NAMES = ["host.containers.internal", "host.docker.internal", "gateway.containers.internal"];
const HOST_IPS = ["169.254.1.2", "10.0.2.2", "172.17.0.1"];

// Ways to reach the website, in order: null = the normal address
let routes = null;
async function getRoutes() {
  if (routes) return routes;
  if (config.siteIp) return (routes = [config.siteIp]);
  const named = await Promise.all(
    HOST_NAMES.map((name) => dns.promises.lookup(name, { family: 4 }).then((a) => a.address, () => null)),
  );
  const site = await dns.promises.lookup(new URL(config.siteUrl).hostname).then((a) => a.address, () => null);
  const found = [...named, gateway(), ...HOST_IPS].filter((ip) => ip && ip !== site);
  return (routes = [null, ...new Set(found)]);
}

let working = undefined;
let lastProblem = null;
let failedAt = 0;

// What the container's network looks like (logged once, to help the host)
let networkLogged = false;
function logNetwork() {
  if (networkLogged) return;
  networkLogged = true;
  const addresses = Object.entries(os.networkInterfaces())
    .map(([name, list]) => `${name} ${list.map((a) => a.cidr || a.address).join(" ")}`)
    .join("; ");
  let hosts = "";
  try {
    hosts = fs.readFileSync("/etc/hosts", "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).join("; ");
  } catch {}
  console.error(`Network: ${addresses} | default gateway ${gateway() || "none"} | hosts: ${hosts}`);
}

const fixedLookup = (ip) => (hostname, options, callback) => {
  const family = ip.includes(":") ? 6 : 4;
  if (options?.all) callback(null, [{ address: ip, family }]);
  else callback(null, ip, family);
};

const describe = (error) => {
  const cause = error.cause || error;
  const message = cause.message || String(error);
  return cause.code && !message.includes(cause.code) ? `${cause.code} ${message}` : message;
};

function request(url, ip, timeout = TIMEOUT, redirects = 3) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "http:" ? http : https;
    const req = lib.request(
      target,
      { headers: HEADERS, timeout, ...(ip && { lookup: fixedLookup(ip), servername: target.hostname }) },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, target);
          resolve(request(next.href, next.hostname === target.hostname ? ip : null, timeout, redirects - 1));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error(`no answer after ${timeout / 1000}s`), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });
}

const routeName = (ip) => (ip ? `via ${ip}` : "normal address");

// Gets a file from the website as { status, body }. Throws if the website
// can't be reached at all (a missing file is a 404, not an error).
export async function fromSite(sitePath) {
  const url = new URL(sitePath, `${config.siteUrl}/`).href;
  if (working === undefined && lastProblem && Date.now() - failedAt < RETRY_AFTER) {
    throw new Error(`can't reach ${config.siteUrl} (${lastProblem})`);
  }
  const all = await getRoutes();
  const order = working === undefined ? all : [working, ...all.filter((r) => r !== working)];
  const failures = [];
  for (const ip of order) {
    try {
      const res = await request(url, ip, ip === working ? TIMEOUT : PROBE_TIMEOUT);
      if (working !== ip) console.log(`Website reached (${routeName(ip)})`);
      working = ip;
      lastProblem = null;
      return res;
    } catch (error) {
      failures.push(`${routeName(ip)}: ${describe(error)}`);
    }
  }
  // Add what the name looks up to, which helps spot DNS problems
  const host = new URL(config.siteUrl).hostname;
  const looked = await dns.promises.lookup(host, { all: true }).then(
    (all) => all.map((a) => a.address).join(", "),
    (error) => describe(error),
  );
  lastProblem = `${host} → ${looked}. ${failures.join(" | ")}`;
  failedAt = Date.now();
  working = undefined;
  logNetwork();
  throw new Error(`can't reach ${config.siteUrl} (${lastProblem})`);
}

// For the status page
export const siteStatus = () => ({
  route: working === undefined ? null : routeName(working),
  problem: lastProblem,
});
