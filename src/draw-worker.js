// Draws cards in a separate thread, so drawing never holds up the bot's
// answers to Discord (Discord only waits 3 seconds for each one).
import { parentPort } from "node:worker_threads";
import { renderCard, renderCompare } from "./render.js";

parentPort.on("message", async ({ id, job, args }) => {
  try {
    const png = job === "compare" ? await renderCompare(...args) : await renderCard(...args);
    parentPort.postMessage({ id, png }, [png.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: error.stack || String(error) });
  }
});
