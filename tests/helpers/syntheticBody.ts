/** Synthetic skeletons for tests (no webcam). Shared by pose and gameplay tests. */
import type { PoseFrame, TrackedLandmark } from "../../src/pose/poseTypes";

// ---------------------------------------------------------------------------
// Synthetic body builder
//
// Raw (unmirrored) 1280×720 image. Player's LEFT shoulder at x=720 (outward = +x),
// RIGHT shoulder at x=560 (outward = −x). Shoulder line y=300, hips y=500.
// Body scale = 200 px (torso length). Head center ≈ (640, 195).
// Arms are given in BODY terms as [outward, down] pixel offsets from the
// shoulder, and are flipped per side, so one arm definition works for both arms.
// ---------------------------------------------------------------------------
export const W = 1280;
export const H = 720;
export type P = [number, number];
export type Arm = [elbow: P, wrist: P];

export interface BodyOpts {
  hipsHidden?: boolean;
  faceHidden?: boolean;
  /** Half the shoulder width in px (default 80). Smaller = torso turned toward a side. */
  shoulderHalf?: number;
  /** Visible legs with this half ankle spread in px (default: legs not visible). */
  legs?: number;
  /** Whole-body sideways lean in degrees, rotating about the ankles (+ = toward raw +x). */
  lean?: number;
  /** Sideways bend at the waist only (upper body rotates about the hips), degrees. */
  waistBend?: number;
  /** Arm length multiplier (different body proportions). */
  armScale?: number;
  /** Whole figure scale about the frame center + offset (camera distance / position). */
  scale?: number;
  offset?: [number, number];
}

export function body(left: Arm, right: Arm, opts: BodyOpts = {}): PoseFrame {
  const lm: TrackedLandmark[] = Array.from({ length: 33 }, () => ({ x: 640, y: 650, confidence: 0.05, inFrame: true }));
  const set = (i: number, x: number, y: number, confidence = 0.95) =>
    (lm[i] = { x, y, confidence, inFrame: x > 13 && x < W - 13 && y > 7 && y < H - 7 });

  const face = opts.faceHidden ? 0.1 : 0.95;
  set(0, 640, 195, face); // nose
  set(2, 625, 180, face); // eyes
  set(5, 655, 180, face);
  set(9, 630, 215, face); // mouth
  set(10, 650, 215, face);
  set(7, 605, 190, face); // ears
  set(8, 675, 190, face);

  const half = opts.shoulderHalf ?? 80;
  const ls = 640 + half;
  const rs = 640 - half;
  set(11, ls, 300);
  set(12, rs, 300);
  const hip = opts.hipsHidden ? 0.1 : 0.95;
  set(23, 700, 500, hip);
  set(24, 580, 500, hip);

  const k = opts.armScale ?? 1;
  const arm = (shoulderX: number, dir: 1 | -1, a: Arm, ei: number, wi: number) => {
    set(ei, shoulderX + dir * a[0][0] * k, 300 + a[0][1] * k);
    const wx = shoulderX + dir * a[1][0] * k;
    const wy = 300 + a[1][1] * k;
    const inFrame = wx > 13 && wx < W - 13 && wy > 7 && wy < H - 7;
    set(wi, wx, wy, inFrame ? 0.95 : 0.2); // off-screen landmarks have low visibility in MediaPipe too
  };
  arm(ls, 1, left, 13, 15);
  arm(rs, -1, right, 14, 16);

  if (opts.legs !== undefined) {
    set(25, 640 + opts.legs * 0.6 + 4, 595); // knees
    set(26, 640 - opts.legs * 0.6 - 4, 595);
    set(27, 640 + opts.legs, 690); // ankles
    set(28, 640 - opts.legs, 690);
  }

  const rotate = (deg: number, cx: number, cy: number, filter: (i: number) => boolean) => {
    const t = (deg * Math.PI) / 180;
    lm.forEach((p, i) => {
      if (!filter(i)) return;
      const dx = p.x - cx;
      const dy = p.y - cy;
      lm[i] = { ...p, x: cx + dx * Math.cos(t) - dy * Math.sin(t), y: cy + dx * Math.sin(t) + dy * Math.cos(t) };
    });
  };
  const LEGS = new Set([25, 26, 27, 28]);
  if (opts.waistBend) rotate(opts.waistBend, 640, 500, (i) => !LEGS.has(i) && i !== 23 && i !== 24);
  if (opts.lean) rotate(opts.lean, 640, 690, () => true);
  if (opts.scale || opts.offset) {
    const s = opts.scale ?? 1;
    const [ox, oy] = opts.offset ?? [0, 0];
    lm.forEach((p, i) => (lm[i] = { ...p, x: 640 + (p.x - 640) * s + ox, y: 360 + (p.y - 360) * s + oy }));
  }
  return { landmarks: lm, width: W, height: H, timestamp: 0 };
}
export const mirror = (l: Arm, r: Arm, o?: BodyOpts) => body(r, l, o);

// --- Arm shapes (body terms) ---
export const DOWN: Arm = [[10, 110], [15, 210]]; // relaxed hanging arm
export const HORIZONTAL: Arm = [[105, 0], [210, 0]];
// SIDE_POINT
export const EXT: Arm = [[105, 15], [185, 55]]; // out at shoulder height, forearm dropping
export const WAIST: Arm = [[25, 120], [-70, 195]]; // elbow down/out, wrist at lower-center torso
// FACE_COVER (left shoulder x=720; head center ≈ x 640 → "−80 outward")
export const FACE: Arm = [[5, 85], [-70, -80]]; // elbow below shoulder, wrist at chin
export const FACE_SALUTE: Arm = [[90, 10], [-60, -90]]; // elbow out to the side, wrist at forehead
export const FACE_OFFSET: Arm = [[15, 90], [-20, -50]]; // wrist beside the jaw, not centered
export const LOW: Arm = [[15, 105], [35, 205]]; // down, slightly out
export const LOW_WIDE: Arm = [[35, 100], [85, 190]]; // down, more outward
export const LOW_OFFSCREEN: Arm = [[15, 105], [35, 440]]; // wrist below the frame (sitting close)
export const CHEST: Arm = [[20, 110], [-60, 50]]; // bent, wrist at chest
export const FLEX: Arm = [[90, 10], [90, -100]]; // "biceps flex": wrist beside, not near, the head
// DIAGONAL_REACH
export const DIAG: Arm = [[95, -30], [155, -115]]; // upper arm out+up, moderate bend, forearm rising (~37°)
export const DIAG_HIGH: Arm = [[70, -60], [110, -150]]; // steeper (~54°)
export const DIAG_LOW: Arm = [[100, -10], [180, -75]]; // flatter (~23°)
export const DIAG_STRAIGHT: Arm = [[75, -60], [150, -120]]; // straight arm (~39°)
export const DIAG_BENT: Arm = [[100, -10], [120, -110]]; // more bend (~107° elbow)
export const CHEST_HAND: Arm = [[40, 90], [-40, 40]]; // elbow out/down, wrist at upper chest
export const CHEST_OFFSET: Arm = [[50, 100], [10, 70]]; // wrist lower, near own side of the chest

// --- Expanded library (body terms) ---
export const OVERHEAD: Arm = [[60, -105], [-60, -215]]; // elbow up/out, wrist above the head toward the midline
export const UP: Arm = [[10, -110], [15, -215]]; // straight up
export const WING: Arm = [[105, -5], [208, -12]]; // straight out to the side
export const CLAW: Arm = [[100, 10], [110, -95]]; // elbow out at shoulder height, forearm raised
export const UP_DIAG: Arm = [[75, -60], [150, -125]]; // straight, diagonally up-out (~40°)
export const DOWN_DIAG: Arm = [[80, 60], [150, 125]]; // straight, diagonally down-out (~−40°)
export const FIST_STRAIGHT: Arm = [[25, 110], [45, 215]]; // down, fist held off the thigh
export const FIST_BENT: Arm = [[20, 105], [90, 165]]; // down, bent ~140°, fist out
// HISTORY_STANCE as measured by MediaPipe on the actual military photo
export const HISTORY_FIST_WIDE: Arm = [[5, 100], [42, 198]]; // elbow ~162°, reach 0.21, direction −78°
export const HISTORY_FIST_CLOSE: Arm = [[-2, 100], [20, 200]]; // elbow ~166°, reach 0.10, direction −84°
export const CROSS: Arm = [[60, 90], [-150, 40]]; // hand across the chest to the other shoulder
export const OUT: Arm = [[105, 0], [210, 10]]; // straight out, level
export const HIGH: Arm = [[5, -110], [-20, -215]]; // straight up, slightly over the head
export const ACROSS_LOW: Arm = [[-30, 100], [-120, 195]]; // reaching down across the body
