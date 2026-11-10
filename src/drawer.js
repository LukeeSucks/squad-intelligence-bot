// Sends card drawing to the drawing thread (src/draw-worker.js) and waits for
// the picture. If the thread ever crashes, the next card starts a new one.
import { Worker } from "node:worker_threads";

let worker = null;
let nextId = 1;
const waiting = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./draw-worker.js", import.meta.url));
  worker.on("message", ({ id, png, error }) => {
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  });
  const fail = (error) => {
    worker = null;
    for (const job of waiting.values()) job.reject(error);
    waiting.clear();
  };
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`drawing thread stopped (${code})`)));
  return worker;
}

function draw(job, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, job, args });
  });
}

export const drawCard = (type, card, tabIndex, game) => draw("card", [type, card, tabIndex, game]);
export const drawCompare = (kind, items, game) => draw("compare", [kind, items, game]);
