import * as THREE from "three";
import { loadGlbMichael, type GlbMichael } from "../arena/characters/glbMichael";
import { MichaelCharacter } from "../arena/characters/michaelCharacter";
import { POSE_REGISTRY } from "../game/poseRegistry";

/**
 * DEV-ONLY model viewer (/model-viewer.html with `npm run dev`).
 * Inspect the imported GLB MJ from any side, with its skeleton, and switch
 * between all 12 gameplay poses using the game's own transitions.
 */
if (!import.meta.env.DEV) throw new Error("Model viewer is development-only");

const CSS = `
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0b10; color:#f4f4f6; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { display:grid; grid-template-columns:260px 1fr; height:100vh; }
  aside { padding:14px; overflow:auto; border-right:1px solid #22222c; display:flex; flex-direction:column; gap:10px; }
  h1 { font-size:16px; letter-spacing:.08em; margin:0; }
  .group { display:flex; flex-wrap:wrap; gap:6px; }
  .label { font-size:11px; color:#9a9aa8; letter-spacing:.08em; }
  button { background:#1c1c26; color:#f4f4f6; border:1px solid #33333f; border-radius:6px; padding:5px 9px; font-size:12px; cursor:pointer; }
  button.on { background:#ffc400; color:#111; border-color:#ffc400; }
  #stats { font-size:11px; color:#9a9aa8; white-space:pre-wrap; }
  canvas { width:100%; height:100%; display:block; }
`;

const VIEWS: [string, number][] = [
  ["front", 0],
  ["3/4", 40],
  ["left", 90],
  ["back", 180],
  ["right", -90],
];

async function main(): Promise<void> {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const root = document.getElementById("viewer-root")!;
  root.innerHTML = `
    <aside>
      <h1>MJ MODEL VIEWER</h1>
      <div class="label">VIEW</div><div class="group" id="views"></div>
      <div class="label">POSE (game transitions)</div><div class="group" id="poses"></div>
      <div class="label">DISPLAY</div><div class="group" id="toggles"></div>
      <div id="stats">loading…</div>
    </aside>
    <div id="stage"></div>`;
  const stage = document.getElementById("stage")!;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1826);
  scene.add(new THREE.HemisphereLight(0xb7c3ff, 0x2a2233, 1.4));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.0);
  key.position.set(-3, 5, 6);
  const back = new THREE.DirectionalLight(0x9a8cff, 1.3);
  back.position.set(2, 4, -5);
  scene.add(key, back);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ color: 0x3a3a52, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, new THREE.GridHelper(4, 8, 0x55556a, 0x2c2c3a));

  const mj = new MichaelCharacter();
  scene.add(mj.root);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  let yaw = 0;
  const placeCamera = () => {
    const a = (yaw * Math.PI) / 180;
    camera.position.set(Math.sin(a) * 8.6, 1.9, Math.cos(a) * 8.6);
    camera.lookAt(0, 1.45, 0);
  };
  placeCamera();

  const t0 = performance.now();
  let glb: GlbMichael | null = null;
  let helper: THREE.SkeletonHelper | null = null;
  const stats = document.getElementById("stats")!;
  try {
    glb = await loadGlbMichael(MichaelCharacter.LEG_LENGTH);
    mj.attachVisual(glb);
    helper = new THREE.SkeletonHelper(glb.mesh);
    helper.visible = false;
    scene.add(helper);
    const g = glb.mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position!.count) / 3;
    const map = (glb.mesh.material as THREE.MeshStandardMaterial).map?.image as { width?: number; height?: number } | undefined;
    stats.textContent =
      `GLB loaded + rigged in ${Math.round(performance.now() - t0)} ms\n` +
      `triangles ${tris}, vertices ${g.attributes.position!.count}\n` +
      `bones ${glb.mesh.skeleton.bones.length}\n` +
      `texture ${map?.width}×${map?.height}`;
  } catch (e) {
    stats.textContent = `GLB failed: ${String(e)}\n(showing the procedural fallback)`;
  }

  const btn = (parent: string, text: string, on: () => void) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.onclick = on;
    document.getElementById(parent)!.append(b);
    return b;
  };
  for (const [name, deg] of VIEWS)
    btn("views", name, () => {
      yaw = deg;
      placeCamera();
    });
  btn("poses", "NEUTRAL", () => mj.transitionTo(null));
  for (const p of POSE_REGISTRY) btn("poses", p.displayName, () => mj.transitionTo(p.id));
  btn("poses", "▶ attack (play)", () => mj.playPose(POSE_REGISTRY[Math.floor(Math.random() * POSE_REGISTRY.length)]!.id));
  const toggle = (text: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = btn("toggles", text, () => {
      set(!get());
      b.classList.toggle("on", get());
    });
    b.classList.toggle("on", get());
  };
  toggle("skeleton", () => !!helper?.visible, (v) => helper && (helper.visible = v));
  toggle("wireframe", () => !!glb && (glb.mesh.material as THREE.MeshStandardMaterial).wireframe, (v) => {
    if (glb) (glb.mesh.material as THREE.MeshStandardMaterial).wireframe = v;
  });
  toggle("procedural fallback", () => !mj.hasImportedVisual, (v) => mj.attachVisual(v ? null : glb));

  // Console hooks for scripted inspection.
  (window as unknown as Record<string, unknown>).__viewer = {
    view: (deg: number) => {
      yaw = deg;
      placeCamera();
    },
    pose: (id: string | null) => mj.setPose(id),
    to: (id: string | null) => mj.transitionTo(id),
    mj,
  };

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  let last = performance.now();
  const loop = (now: number) => {
    mj.update(Math.min(0.05, (now - last) / 1000));
    last = now;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
