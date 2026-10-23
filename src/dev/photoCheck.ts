import { analyzeBody } from "../pose/bodyFrame";
import { DETECTOR_CONFIG } from "../pose/poseConfig";
import { PoseDetector } from "../pose/poseDetector";
import { PoseHoldStateMachine } from "../pose/poseStateMachine";
import type { PoseFrame } from "../pose/poseTypes";
import { POSE_REGISTRY } from "../game/poseRegistry";

/**
 * DEV-ONLY real-photo recognition check (import from the browser console on the dev server):
 *
 *   const { checkPhoto } = await import("/src/dev/photoCheck.ts");
 *   await checkPhoto("arms-overhead.webp", "ARMS_OVERHEAD");
 *
 * Each framing (photo size / position / scale / mirrored, 16:9 and 4:3 "webcams") is fed to
 * the real MediaPipe detector as ~1.5 s of video at the game's detection rate, through the
 * game's own hold state machine. A framing CONFIRMS exactly when the game would confirm.
 */
if (!import.meta.env.DEV) throw new Error("Photo check is development-only");

export interface Framing {
  pad: number;
  flip?: boolean;
  ox?: number;
  scale?: number;
  /** Canvas = photo size × (1 + 2·pad) instead of a webcam-sized frame. */
  native?: boolean;
  W?: number;
  H?: number;
}

export const FRAMINGS: Framing[] = [];
for (const pad of [0.05, 0.1, 0.15, 0.2, 0.3]) for (const flip of [false, true]) FRAMINGS.push({ native: true, pad, flip });
for (const flip of [false, true])
  for (const f of [{ pad: 0.1 }, { pad: 0.2 }, { pad: 0.1, ox: -0.12 }, { pad: 0.1, ox: 0.12 }, { pad: 0.1, scale: 0.85 }, { pad: 0.05, W: 960, H: 720 }])
    FRAMINGS.push({ ...f, flip });

const images = new Map<string, HTMLImageElement>();
const load = (file: string) =>
  images.get(file) ??
  new Promise<HTMLImageElement>((res) => {
    const im = new Image();
    im.onload = () => (images.set(file, im), res(im));
    im.src = `/dev-reference/${file}`;
  });

let detector: PoseDetector | null = null;
let ts = 1e6;
const STEP_MS = 1000 / DETECTOR_CONFIG.targetDetectionsPerSecond; // the game's detection rate

function canvasFor(img: HTMLImageElement, f: Framing): HTMLCanvasElement {
  const W = f.native ? Math.round(img.width * (1 + 2 * f.pad)) : (f.W ?? 1280);
  const H = f.native ? Math.round(img.height * (1 + 2 * f.pad)) : (f.H ?? 720);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, W, H);
  const s = (f.native ? 1 : Math.min(W / (img.width * (1 + 2 * f.pad)), H / (img.height * (1 + 2 * f.pad)))) * (f.scale ?? 1);
  if (f.flip) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  g.drawImage(img, (W - img.width * s) / 2 + (f.ox ?? 0) * W, (H - img.height * s) / 2, img.width * s, img.height * s);
  return Object.assign(cv, { videoWidth: W, videoHeight: H });
}

/**
 * Run one framing as ~1.5 s of video at the game's detection rate, through the game's own
 * PoseHoldStateMachine for EVERY pose (400 ms hold, 120 ms dropout grace).
 * `others[id]`: 2 = that pose would CONFIRM (a real false positive), 1 = matched on some frames only.
 */
export async function checkFraming(file: string, poseId: string, f: Framing, frames = 30) {
  detector ??= await PoseDetector.create();
  const cv = canvasFor(await load(file), f);
  const blank = canvasFor(await load(file), { ...f, scale: 0.0001 }); // empty frame: drop tracking from the previous clip
  for (let i = 0; i < 5; i++) detector.detect(blank as unknown as HTMLVideoElement, (ts += STEP_MS));
  const machines = new Map(POSE_REGISTRY.map((p) => [p.id, new PoseHoldStateMachine(p.id)]));
  const confirmedIds = new Set<string>();
  for (const [id, m] of machines) m.onConfirmed(() => confirmedIds.add(id));
  const others: Record<string, number> = {};
  let none = 0;
  let last: PoseFrame | null = null;
  for (let i = 0; i < frames; i++) {
    const now = (ts += STEP_MS);
    const lm = detector.detect(cv as unknown as HTMLVideoElement, now);
    if (lm) last = { landmarks: lm, width: cv.width, height: cv.height, timestamp: now };
    else none++;
    for (const p of POSE_REGISTRY) {
      const e = lm ? p.classifier.evaluate(last!) : null;
      machines.get(p.id)!.update(!!e?.matched, !!e?.stillInPose, null, now);
      if (p.id !== poseId && e?.matched) others[p.id] = Math.max(others[p.id] ?? 0, 1);
    }
  }
  for (const id of confirmedIds) if (id !== poseId) others[id] = 2;
  const own = last ? POSE_REGISTRY.find((p) => p.id === poseId)?.classifier.evaluate(last) : undefined;
  const body = last ? analyzeBody(last) : null;
  return {
    confirmed: confirmedIds.has(poseId),
    detected: none < frames,
    others,
    feedback: own?.feedback,
    fails: own?.conditions.filter((c) => !c.pass).map((c) => `${c.id}=${c.value.toFixed(2)}`) ?? [],
    lean: body?.ok ? +body.body.torso.leanDeg.toFixed(1) : null,
    wristGap: body?.ok && body.body.wristGap !== null ? +body.body.wristGap.toFixed(2) : null,
  };
}

const label = (f: Framing) =>
  `${f.flip ? "M" : " "} ${f.native ? "photo" : f.W ? "4:3" : "16:9"} pad${f.pad}${f.ox ? ` x${f.ox}` : ""}${f.scale ? ` s${f.scale}` : ""}`;

/** All framings for one photo. `poseId` = the pose it should confirm (or null: should confirm nothing). */
export async function checkPhoto(file: string, poseId: string | null) {
  let confirmed = 0;
  let detected = 0;
  /** Other poses that would CONFIRM (matched 400 ms in a row) in a framing. */
  const falsePositives: Record<string, number> = {};
  /** Other poses that matched only for a few isolated frames (can't confirm). */
  const blips: Record<string, number> = {};
  const rows: string[] = [];
  for (const f of FRAMINGS) {
    const r = await checkFraming(file, poseId ?? "__none__", f);
    if (r.confirmed) confirmed++;
    if (r.detected) detected++;
    for (const [k, run] of Object.entries(r.others)) {
      const into = run === 2 ? falsePositives : blips;
      into[k] = (into[k] ?? 0) + 1;
    }
    rows.push(
      `${label(f)} ${!r.detected ? "NO PERSON" : r.confirmed ? "CONFIRM" : "miss"} lean ${r.lean} gap ${r.wristGap} ${
        Object.keys(r.others).length ? `ALSO ${JSON.stringify(r.others)} (2 = confirms, 1 = frames only)` : ""
      } ${r.confirmed ? "" : `${r.feedback ?? ""} ${r.fails.join(",")}`}`,
    );
  }
  return { file, poseId, confirmed, detected, total: FRAMINGS.length, falsePositives, blips, rows };
}
