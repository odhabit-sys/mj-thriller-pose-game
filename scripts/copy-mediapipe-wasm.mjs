// Copies the MediaPipe Tasks Vision WASM runtime from node_modules into
// public/ so it is served locally by Vite (no CDN, version always matches
// the installed npm package).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = resolve(root, "public/mediapipe/wasm");

if (!existsSync(src)) {
  console.error(`[copy-wasm] Missing ${src}. Run "npm install" first.`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-wasm] MediaPipe WASM copied to public/mediapipe/wasm");
