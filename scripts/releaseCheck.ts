/**
 * Release gate: `npm run check:release`. Read-only. Exit code 1 while anything blocks the release.
 * Checks the files git would publish (tracked + new, honoring .gitignore).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_AUDIO_CONFIG, selectAudioPack } from "../src/audio/publicAudio";
import { PLAYABLE_POSES } from "../src/game/poseRegistry";

const root = process.cwd();
const blockers: string[] = [];
const ok: string[] = [];
const notes: string[] = [];
const check = (pass: boolean, line: string) => (pass ? ok : blockers).push(line);

let files: string[] = [];
try {
  files = execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  blockers.push("git: not a git repository");
}
const published = new Set(files);

// 1. Pose cards: every playable pose's image is published
for (const p of PLAYABLE_POSES) {
  const f = `public/${p.publicCard}`;
  check(existsSync(f) && published.has(f), `pose card ${p.displayName.padEnd(22)} ${f}`);
}

// 2. Audio: every released sound effect is published; the background music file is not
const pack = selectAudioPack(false, "");
for (const url of new Set(Object.values(pack.sounds).flatMap((s) => s.clips.map((c) => c.url)))) {
  const f = `public${url}`;
  check(existsSync(f) && published.has(f), `audio ${f}`);
}
check(pack === RELEASE_AUDIO_CONFIG ? pack.music.url === "" : true, "audio: production requests no background music file");

// 3. Nothing local-only, private or oversized is published
const localOnly = files.filter(
  (f) => f.startsWith("dev-reference/") || f.endsWith("thriller.mp3") || f.startsWith("docs/screenshots/") || /(^|\/)\.env/.test(f),
);
check(localOnly.length === 0, `local-only files${localOnly.length ? `: ${localOnly.join(", ")}` : ": none published"}`);
const big = files.filter((f) => existsSync(f) && statSync(f).size > 5 * 1024 * 1024);
check(big.length === 0, `large files (> 5 MB)${big.length ? `: ${big.join(", ")}` : ": none"}`);

// 4. Secrets
const text = files.filter((f) => /\.(ts|js|mjs|json|html|css|md|txt|yml|yaml)$|(^|\/)\.[a-z]+$/i.test(f) && existsSync(f));
const secretPattern = /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["'])/i;
const secrets = text.filter((f) => secretPattern.test(readFileSync(f, "utf8")));
check(secrets.length === 0, `secrets / API keys${secrets.length ? `: ${secrets.join(", ")}` : ": none found"}`);

// 5. Required third-party attribution, license, disclaimer
const read = (f: string) => readFileSync(resolve(root, f), "utf8");
const readme = read("README.md");
const credits = read("docs/CREDITS.md");
for (const [name, s] of [["README.md", readme], ["docs/CREDITS.md", credits]] as const)
  check(s.includes("MrLOCKiDY") && s.includes("CC-BY-4.0") && s.includes("MediaPipe") && /three\.js/i.test(s), `credits in ${name}: 3D model (MrLOCKiDY, CC-BY-4.0), MediaPipe, three.js`);
const license = read("LICENSE");
check(/Copyright \(c\) 2026 Reda Balkhity/.test(license) && license.startsWith("MIT License"), "LICENSE: MIT, Copyright (c) 2026 Reda Balkhity");
check(/not affiliated with or endorsed by/i.test(readme), "README: fan-project disclaimer");
if (readme.includes("YOUR-DEPLOYMENT-URL")) notes.push("README live demo link: placeholder until the site is deployed");

for (const line of ok) console.log(`  ok       ${line}`);
for (const line of notes) console.log(`  note     ${line}`);
for (const line of blockers) console.log(`  BLOCKER  ${line}`);
console.log(blockers.length ? `\n${blockers.length} item(s) block the release.` : "\nReady to release.");
process.exit(blockers.length ? 1 : 0);
