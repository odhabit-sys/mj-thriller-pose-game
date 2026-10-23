import * as THREE from "three";
import { MichaelCharacter } from "../arena/characters/michaelCharacter";
import { mjPoseFrame } from "../arena/characters/mjPoseProbe";
import { POSE_REGISTRY, type PoseDefinition } from "../game/poseRegistry";
import { difficultyWeights } from "../game/poseSelector";
import type { PoseFrame } from "../pose/poseTypes";

/**
 * DEV-ONLY Pose Gallery (/gallery.html with `npm run dev`).
 * MJ performing every gameplay pose side by side, with name, difficulty and a
 * LIVE recognition check: MJ's skeleton is projected into a webcam-style frame
 * and every real classifier runs on it (and on its mirror image), so the
 * gallery shows whether each demonstration is recognized as exactly that pose.
 */
if (!import.meta.env.DEV) throw new Error("Pose gallery is development-only");

const CSS = `
  :root { color-scheme: dark; --bg:#0b0b10; --card:#15151d; --fg:#f4f4f6; --muted:#9a9aa8; --ok:#00e676; --bad:#ff5252; --accent:#ffc400; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { padding:20px; max-width:1500px; margin:0 auto; }
  h1 { margin:0 0 4px; letter-spacing:.06em; }
  .sub { color:var(--muted); margin:0 0 16px; font-size:14px; }
  .summary { display:flex; flex-wrap:wrap; gap:16px; margin-bottom:18px; font-size:13px; color:var(--muted); }
  .summary b { color:var(--fg); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }
  .card { background:var(--card); border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:6px; border:2px solid transparent; }
  .card.bad { border-color:var(--bad); }
  .views { display:grid; grid-template-columns:2fr 1fr; gap:6px; }
  .views canvas { width:100%; border-radius:8px; background:radial-gradient(ellipse at 50% 38%,#2b2740 0%,#14131d 70%); }
  .name { font-weight:800; letter-spacing:.05em; }
  .meta { display:flex; gap:6px; align-items:center; font-size:12px; color:var(--muted); }
  .badge { padding:2px 8px; border-radius:999px; font-weight:700; font-size:11px; letter-spacing:.06em; }
  .easy { background:#0e3b26; color:#6dffb0; } .medium { background:#3b330e; color:#ffd86b; } .hard { background:#3b0e16; color:#ff8a9b; }
  .instr { font-size:12px; color:var(--muted); min-height:2.4em; }
  .status { font-size:12px; font-weight:700; }
  .status.ok { color:var(--ok); } .status.bad { color:var(--bad); }
  details { font-size:11px; color:var(--muted); } pre { margin:4px 0 0; white-space:pre-wrap; }
  table { border-collapse:collapse; font-size:12px; } td,th { padding:2px 8px; text-align:right; } th:first-child,td:first-child { text-align:left; }
`;

const W = 300;
const H = 380;

function mirrorFrame(f: PoseFrame): PoseFrame {
  const pairs = [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [2, 5], [7, 8], [9, 10]] as const;
  const lm = f.landmarks!.map((p) => ({ ...p, x: f.width - p.x }));
  for (const [a, b] of pairs) [lm[a], lm[b]] = [lm[b]!, lm[a]!];
  return { ...f, landmarks: lm };
}

function recognition(frame: PoseFrame, pose: PoseDefinition) {
  const hits = POSE_REGISTRY.filter((p) => p.classifier.evaluate(frame).matched).map((p) => p.id);
  const own = pose.classifier.evaluate(frame);
  return { hits, own, ok: hits.length === 1 && hits[0] === pose.id };
}

function main(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const root = document.getElementById("gallery-root")!;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xb7c3ff, 0x2a2233, 1.5));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(-3, 5, 6);
  const rim = new THREE.DirectionalLight(0x9a8cff, 1.4);
  rim.position.set(2, 4, -5);
  scene.add(key, rim);
  const mj = new MichaelCharacter();
  scene.add(mj.root);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);

  const snapshot = (yawDeg: number): HTMLCanvasElement => {
    const a = (yawDeg * Math.PI) / 180;
    const d = 8.2;
    camera.position.set(Math.sin(a) * d, 1.75, Math.cos(a) * d);
    camera.lookAt(0, 1.5, 0);
    renderer.render(scene, camera);
    const c = document.createElement("canvas");
    c.width = renderer.domElement.width;
    c.height = renderer.domElement.height;
    c.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
    return c;
  };

  const weights = [1, 2, 3, 4, 5].map((w) => ({ w, ...difficultyWeights(w) }));
  const count = (d: string) => POSE_REGISTRY.filter((p) => p.difficulty === d).length;
  root.innerHTML = `
    <h1>POSE GALLERY</h1>
    <p class="sub">Development only. MJ performs every gameplay pose; the real classifiers check his projected skeleton (normal and mirrored).</p>
    <div class="summary">
      <span><b>${POSE_REGISTRY.length}</b> poses</span>
      <span><b>${count("easy")}</b> easy · <b>${count("medium")}</b> medium · <b>${count("hard")}</b> hard</span>
      <span id="overall"></span>
      <table><tr><th>wave</th><th>easy</th><th>medium</th><th>hard</th></tr>
      ${weights.map((r) => `<tr><td>${r.w}${r.w === 5 ? "+" : ""}</td><td>${r.easy}</td><td>${r.medium}</td><td>${r.hard}</td></tr>`).join("")}
      </table>
    </div>
    <div class="grid" id="grid"></div>`;
  const grid = document.getElementById("grid")!;

  let allOk = true;
  for (const pose of POSE_REGISTRY) {
    mj.setPose(pose.id);
    mj.update(0);
    const front = snapshot(0);
    const quarter = snapshot(40);
    const frame = mjPoseFrame(mj);
    const r = recognition(frame, pose);
    const m = recognition(mirrorFrame(frame), pose);
    const ok = r.ok && m.ok;
    allOk &&= ok;
    const others = (h: string[]) => h.filter((id) => id !== pose.id);
    const statusText = ok
      ? "✓ recognized as itself (and mirrored), no conflicts"
      : [
          !r.hits.includes(pose.id) ? `✗ not recognized: ${r.own.feedback}` : "",
          others(r.hits).length ? `✗ also matches ${others(r.hits).join(", ")}` : "",
          !m.ok ? `✗ mirrored: [${m.hits.join(", ") || "none"}]` : "",
        ]
          .filter(Boolean)
          .join(" · ");
    const card = document.createElement("div");
    card.className = `card${ok ? "" : " bad"}`;
    card.innerHTML = `
      <div class="views"></div>
      <div class="name">${pose.displayName}</div>
      <div class="meta"><span class="badge ${pose.difficulty}">${pose.difficulty.toUpperCase()}</span><span>${pose.id}</span></div>
      <div class="instr">${pose.instruction}</div>
      <div class="status ${ok ? "ok" : "bad"}">${statusText}</div>
      <details><summary>conditions</summary><pre>${r.own.conditions
        .map((c) => `${c.pass ? "✓" : "✗"} ${c.id.padEnd(22)} ${c.value.toFixed(2)}  [${c.min ?? ""}…${c.max ?? ""}]`)
        .join("\n")}</pre></details>`;
    card.querySelector(".views")!.append(front, quarter);
    grid.append(card);
  }
  document.getElementById("overall")!.innerHTML = allOk
    ? `<b style="color:var(--ok)">all poses recognized uniquely</b>`
    : `<b style="color:var(--bad)">recognition problems: see red cards</b>`;
  mj.setPose(null);
  renderer.dispose();
}

main();
