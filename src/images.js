// Loads the website's pictures (.webp) and turns them into small PNGs the card
// renderer can use. Everything here is plain JavaScript/WebAssembly, so it
// runs on any host with Node (no native add-ons to compile).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import decode, { init as initWebp } from "@jsquash/webp/decode.js";
import { encode } from "fast-png";
import { config } from "./config.js";
import { fromSite } from "./site.js";

const require = createRequire(import.meta.url);
let ready = null;
const start = () =>
  (ready ||= (async () => {
    const wasm = fs.readFileSync(require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm"));
    await initWebp(await WebAssembly.compile(wasm));
  })());

// Reads a picture from the website folder, or downloads it from the website
async function readPicture(sitePath) {
  const clean = decodeURI(sitePath.split("?")[0]);
  if (config.siteDir) {
    const file = path.join(config.siteDir, clean);
    // Never read outside the website folder
    if (!file.startsWith(path.resolve(config.siteDir))) return null;
    return fs.promises.readFile(file).catch(() => null);
  }
  const res = await fromSite(encodeURI(clean.replace(/^\//, ""))).catch(() => null);
  return res?.status === 200 ? res.body : null;
}

// Crops away see-through edges (vehicle renders have a lot of empty space)
function trim(img) {
  const { width, height, data } = img;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return img;
  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w === width && h === height) return img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = ((top + y) * width + left) * 4;
    out.set(data.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

// Shrinks to fit inside maxW × maxH by averaging blocks of pixels (weighted by
// how see-through they are, so edges don't go dark)
function shrink(img, maxW, maxH) {
  const scale = Math.max(img.width / maxW, img.height / maxH, 1);
  if (scale === 1) return img;
  const w = Math.max(1, Math.round(img.width / scale));
  const h = Math.max(1, Math.round(img.height / scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const src = img.data;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * img.width + xx) * 4;
          const al = src[i + 3];
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
          n += 1;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = a ? r / a : 0;
      out[o + 1] = a ? g / a : 0;
      out[o + 2] = a ? b / a : 0;
      out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

// Recently used pictures, so popular cards don't decode the same file again
const cache = new Map();
const CACHE_SIZE = 60;

// Returns { src: "data:image/png;base64,...", width, height } or null
export async function picture(sitePath, maxW, maxH, { crop = false } = {}) {
  if (!sitePath) return null;
  const key = `${sitePath}|${maxW}|${maxH}|${crop}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  await start();
  const file = await readPicture(sitePath);
  if (!file) return null;
  let img;
  try {
    // Already a PNG? (e.g. a picture added later in another format)
    if (file[0] === 0x89 && file[1] === 0x50) {
      const result = { src: `data:image/png;base64,${file.toString("base64")}`, width: maxW, height: maxH };
      cache.set(key, result);
      return result;
    }
    img = await decode(file);
  } catch {
    return null;
  }
  if (crop) img = trim(img);
  img = shrink(img, maxW, maxH);
  const png = encode({ width: img.width, height: img.height, data: img.data, channels: 4 });
  const result = {
    src: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    width: img.width,
    height: img.height,
  };
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return result;
}
