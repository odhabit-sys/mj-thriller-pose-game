import * as THREE from "three";
import {
  buildHair,
  buildHand,
  buildHeadParts,
  buildLoafer,
  line,
  loft,
  merge,
  placed,
  ringAt,
  smoothstep,
  surfaceRibbon,
  type Ring,
} from "./mjGeometry";

/**
 * An imported visual (e.g. the GLB MJ) that follows this rig. While one is attached the
 * procedural meshes are hidden but the rig keeps running: it stays the single source of
 * poses, transitions, timing and the recognizer-check skeleton.
 */
export interface MJVisual {
  readonly root: THREE.Object3D;
  sync(src: { joints: Readonly<Record<Joint, THREE.Object3D>> }): void;
  setFlash(f: number): void;
}

/**
 * STYLIZED THRILLER-ERA MICHAEL JACKSON: original low-poly character generated
 * procedurally (no external model, see mjGeometry.ts). Curly black hair, sculpted
 * face, cropped red leather jacket with black V stripes and structured shoulders,
 * dark shirt, slim black trousers, white socks, black loafers, one white glove.
 *
 * Rig: grouped meshes with independently rotatable joints. Feet stay planted;
 * only the spine, neck/head and arms animate. Every visible part is parented to
 * the joint it moves with, so poses never detach geometry.
 *
 * Poses are authored as "where the hands go" in CHEST space and solved with a
 * two-bone arm IK once at startup into per-joint quaternions. Animation is just
 * quaternion slerp between those poses.
 *
 * Coordinates: the character faces +Z (toward the gameplay camera); his LEFT is +X.
 */

// ---------------------------------------------------------------------------
// Dimensions (character units before HERO_SCALE; ~1.85 tall incl. hair)
// ---------------------------------------------------------------------------
const HERO_SCALE = 1.5; // exaggerated for readability at gameplay distance

const HIP_Y = 0.92; // hip joint height
const THIGH = 0.44;
const SHIN = 0.42;
const SPINE_Y = 1.0; // chest pivot (world, unscaled)
const SHOULDER = new THREE.Vector3(0.235, 0.46, 0); // in chest space (mirrored for right)
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const HEAD_Y = 0.71; // head center in chest space

// ---------------------------------------------------------------------------
// Animation timing
// ---------------------------------------------------------------------------
export const MJ_ANIMATION = {
  /** Snap into the pose (s). Fast so it lands with the aura. */
  transitionIn: 0.14,
  /** Hold the pose (s). */
  hold: 0.38,
  /** Ease back to neutral (s). */
  transitionOut: 0.32,
  /** Overshoot on the way in (0 = none). Gives the snap a confident "hit". */
  overshoot: 1.25,
  /** Emissive highlight decay per second. */
  flashDecay: 3.2,
};

// ---------------------------------------------------------------------------
// Pose authoring
// ---------------------------------------------------------------------------
type V3 = [number, number, number];

interface ArmTarget {
  /** Wrist target in chest space. */
  hand: V3;
  /** Direction the elbow should point toward (chest space point, used as IK pole). */
  elbow: V3;
  /** Extra wrist rotation (deg, XYZ) for hand attitude. */
  wrist?: V3;
}

interface PoseDef {
  left: ArmTarget;
  right: ArmTarget;
  /** Chest rotation relative to the hips (deg, XYZ): x = lean forward, y = twist toward his left, z = side lean toward his right. */
  spine: V3;
  /** Head rotation relative to the chest (deg, XYZ): x = look down, y = turn toward his left. */
  head: V3;
  /** Extra outward spread of each leg (deg). Feet stay flat; the body drops to keep them on the floor. */
  legs?: number;
  /**
   * Whole-body lean (deg, XYZ): x = toward the camera (about the feet), z = + toward his right.
   * The sideways part is a parallelogram: both legs tilt at the ankles, the hips shift over and
   * the chest tilts with them, so the body stays one straight line and BOTH feet stay planted.
   */
  lean?: V3;
}

/** Relaxed, composed stance. */
const NEUTRAL: PoseDef = {
  left: { hand: [0.3, 0.0, 0.06], elbow: [0.6, 0.25, -0.4] },
  right: { hand: [-0.3, 0.0, 0.06], elbow: [-0.6, 0.25, -0.4] },
  spine: [2, 0, 0],
  head: [6, 0, 0],
};

/**
 * The three gameplay poses, keyed by the existing pose IDs.
 * The single glove is on his RIGHT hand, which leads SIDE_POINT and DIAGONAL_REACH
 * and is the low arm in FACE_COVER (as in the references).
 */
const POSES: Record<string, PoseDef> = {
  // Right arm out to the side at shoulder height, forearm/hand dropping; left hand at the waist.
  SIDE_POINT: {
    right: { hand: [-0.76, 0.36, 0.1], elbow: [-0.5, 0.9, -0.3], wrist: [0, 0, 25] },
    left: { hand: [0.04, 0.02, 0.2], elbow: [0.7, 0.15, -0.25] },
    spine: [4, -10, 4],
    head: [14, -28, 0],
  },
  // Left hand up in front of the face; right arm low and out.
  FACE_COVER: {
    // Elbow out to the side so the forearm reads as a clear diagonal across the face;
    // hand in front of the brow.
    left: { hand: [0.02, 0.76, 0.24], elbow: [0.75, 0.3, 0.25], wrist: [-35, 0, 0] },
    right: { hand: [-0.52, -0.06, 0.08], elbow: [-0.7, 0.3, -0.4], wrist: [0, 0, -15] },
    spine: [10, 10, -3],
    head: [24, 8, 0],
  },
  // Right arm reaching up and out diagonally (slight bend); left hand at the upper chest.
  DIAGONAL_REACH: {
    right: { hand: [-0.64, 0.86, 0.12], elbow: [-0.3, 0.3, -0.5], wrist: [0, 0, 10] },
    left: { hand: [0.1, 0.36, 0.19], elbow: [0.7, 0.1, -0.1] },
    spine: [-5, -12, -5],
    head: [6, -22, 0],
  },

  // ---- Reference images ----
  // HISTORY: squared, upright; both fists down and held a little off the thighs, arms nearly straight
  // (as in the reference photo); feet apart.
  HISTORY_STANCE: {
    right: { hand: [-0.33, -0.1, 0.05], elbow: [-0.6, 0.2, -0.3], wrist: [0, 0, -8] },
    left: { hand: [0.36, -0.07, 0.08], elbow: [0.6, 0.2, -0.3], wrist: [0, 0, 10] },
    spine: [-3, 0, 0],
    head: [-2, 28, 0],
    legs: 7,
  },
  // SMOOTH CRIMINAL: the whole body leans as one straight line (sideways for the webcam, a touch forward),
  // arms hanging.
  SMOOTH_CRIMINAL: {
    right: { hand: [-0.27, -0.08, 0.1], elbow: [-0.6, 0.2, -0.3] },
    left: { hand: [0.3, -0.08, -0.04], elbow: [0.6, 0.2, -0.3] },
    spine: [0, 0, 0],
    head: [4, 12, 0],
    lean: [8, 0, 17],
  },
  // ARMS OVERHEAD: both hands meet above the head, elbows out, wide stance.
  ARMS_OVERHEAD: {
    right: { hand: [-0.04, 0.95, 0.07], elbow: [-0.7, 0.85, 0], wrist: [0, 0, 20] },
    left: { hand: [0.05, 0.93, 0.07], elbow: [0.7, 0.85, 0], wrist: [0, 0, -20] },
    spine: [-4, 0, 0],
    head: [12, 18, 0],
    legs: 13,
  },

  // ---- MJ-inspired library ----
  // SKY POINT: gloved hand straight up, other arm down and slightly out, feet apart.
  SKY_POINT: {
    right: { hand: [-0.27, 1.01, 0.04], elbow: [-0.6, 0.6, -0.3] },
    left: { hand: [0.33, -0.08, 0.06], elbow: [0.7, 0.2, -0.3] },
    spine: [-3, 0, 4],
    head: [-14, -8, 0],
    legs: 8,
  },
  // DOUBLE SIDE: both arms straight out, the gloved one a touch higher (MJ asymmetry), head turned to it.
  DOUBLE_SIDE: {
    right: { hand: [-0.79, 0.5, 0.0], elbow: [-0.5, 0.9, -0.2], wrist: [0, 0, -12] },
    left: { hand: [0.79, 0.43, 0.0], elbow: [0.5, 0.9, -0.2], wrist: [0, 0, 18] },
    spine: [0, 0, 0],
    head: [0, -28, 0],
    legs: 6,
  },
  // THRILLER CLAW: elbows out at shoulder height, forearms up, hands clawed beside the head, hunched.
  THRILLER_CLAW: {
    right: { hand: [-0.5, 0.86, 0.1], elbow: [-1.0, 0.4, -0.15], wrist: [-45, 0, 0] },
    left: { hand: [0.5, 0.86, 0.1], elbow: [1.0, 0.4, -0.15], wrist: [-45, 0, 0] },
    spine: [10, 0, 0],
    head: [10, 0, 0],
    legs: 6,
  },
  // POWER STANCE: gloved arm diagonally up-out, other arm diagonally down-out, both straight, wide stance.
  POWER_STANCE: {
    right: { hand: [-0.64, 0.86, 0.06], elbow: [-0.5, 0.7, -0.4] },
    left: { hand: [0.62, 0.06, 0.06], elbow: [0.5, 0.3, -0.4] },
    spine: [0, 0, -5],
    head: [-4, -18, 0],
    legs: 12,
  },
  // CROSS BODY: left hand across the chest to the right shoulder, gloved arm straight out.
  CROSS_BODY: {
    left: { hand: [-0.16, 0.38, 0.2], elbow: [0.5, 0.25, 0.4] },
    right: { hand: [-0.79, 0.46, 0.02], elbow: [-0.5, 0.9, -0.2], wrist: [0, 0, -10] },
    spine: [0, 10, 0],
    head: [0, -24, 0],
  },
  // OVERHEAD DIAGONAL: gloved arm high over the head, other arm reaching down across the body.
  OVERHEAD_DIAGONAL: {
    right: { hand: [-0.12, 1.0, 0.02], elbow: [-0.6, 0.8, -0.2], wrist: [0, 0, 15] },
    left: { hand: [-0.18, -0.06, 0.2], elbow: [0.4, 0.3, 0.3] },
    spine: [0, -10, 7],
    head: [-8, -14, 0],
    legs: 6,
  },
};

/** Fallback for unknown pose ids: a generic power pose. */
const GENERIC: PoseDef = {
  left: { hand: [0.55, 0.85, 0.05], elbow: [0.6, 0.4, -0.4] },
  right: { hand: [-0.55, 0.85, 0.05], elbow: [-0.6, 0.4, -0.4] },
  spine: [-4, 0, 0],
  head: [-6, 0, 0],
};

// ---------------------------------------------------------------------------
// Two-bone IK (pure; exported for tests)
// ---------------------------------------------------------------------------
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/**
 * Solve a shoulder–elbow–wrist chain in its parent space.
 * Returns the shoulder rotation (bone rests along −Y, bends about local X toward +Z)
 * and the elbow curl angle (radians, about local X).
 */
export function solveArmIK(
  shoulder: THREE.Vector3,
  hand: THREE.Vector3,
  pole: THREE.Vector3,
  upper: number,
  fore: number,
): { shoulder: THREE.Quaternion; elbowAngle: number; elbowPos: THREE.Vector3 } {
  const toHand = tmpA.subVectors(hand, shoulder);
  const reach = upper + fore;
  const d = Math.min(Math.max(toHand.length(), Math.abs(upper - fore) + 1e-4), reach * 0.999);
  const dir = toHand.normalize();

  // Elbow lies in the plane of (dir, pole), offset toward the pole.
  const toPole = tmpB.subVectors(pole, shoulder);
  const perp = toPole.addScaledVector(dir, -toPole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, -1).addScaledVector(dir, -dir.z);
  perp.normalize();

  const cosA = (upper * upper + d * d - fore * fore) / (2 * upper * d);
  const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const elbowPos = new THREE.Vector3()
    .copy(shoulder)
    .addScaledVector(dir, Math.cos(a) * upper)
    .addScaledVector(perp, Math.sin(a) * upper);

  const handPos = tmpC.copy(shoulder).addScaledVector(dir, d);
  const bone = new THREE.Vector3().subVectors(elbowPos, shoulder).normalize(); // upper arm direction
  const fore3 = new THREE.Vector3().subVectors(handPos, elbowPos).normalize(); // forearm direction

  // Shoulder frame: local −Y along the bone, local +Z toward the bend.
  const yAxis = bone.clone().negate();
  const zAxis = fore3.clone().addScaledVector(bone, -fore3.dot(bone));
  if (zAxis.lengthSq() < 1e-8) zAxis.copy(perp);
  zAxis.normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  tmpM.makeBasis(xAxis, yAxis, zAxis);
  const q = new THREE.Quaternion().setFromRotationMatrix(tmpM);

  const bend = Math.acos(Math.min(1, Math.max(-1, bone.dot(fore3))));
  // Curl about local X; negative rotates the forearm toward local +Z.
  return { shoulder: q, elbowAngle: -bend, elbowPos };
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
const DEG = Math.PI / 180;
export type Joint =
  | "spine"
  | "head"
  | "shoulderL"
  | "elbowL"
  | "wristL"
  | "shoulderR"
  | "elbowR"
  | "wristR"
  | "lean"
  | "hipL"
  | "hipR"
  | "footL"
  | "footR";
const JOINTS: Joint[] = [
  "spine",
  "head",
  "shoulderL",
  "elbowL",
  "wristL",
  "shoulderR",
  "elbowR",
  "wristR",
  "lean",
  "hipL",
  "hipR",
  "footL",
  "footR",
];
/** Base hip splay (contrapposto) built into the neutral stance. */
const HIP_SPLAY = 0.035;
const LEG_LENGTH = THIGH + SHIN + 0.035;

/** Skeleton landmarks (world space) used to check MJ's poses against the recognizer. */
export interface MJSkeleton {
  head: THREE.Vector3;
  nose: THREE.Vector3;
  shoulder: Record<"left" | "right", THREE.Vector3>;
  elbow: Record<"left" | "right", THREE.Vector3>;
  wrist: Record<"left" | "right", THREE.Vector3>;
  hip: Record<"left" | "right", THREE.Vector3>;
  knee: Record<"left" | "right", THREE.Vector3>;
  ankle: Record<"left" | "right", THREE.Vector3>;
}
type SolvedPose = Record<Joint, THREE.Quaternion>;

type Phase = "idle" | "in" | "hold" | "out" | "static" | "to";

export class MichaelCharacter {
  readonly root = new THREE.Group();

  private readonly joints: Record<Joint, THREE.Object3D>;
  private readonly body = new THREE.Group();
  private readonly legParts: { hip: THREE.Object3D; knee: THREE.Object3D; ankle: THREE.Object3D }[] = [];
  private transitionSec = 0.45;
  private readonly chest = new THREE.Group();
  private readonly solved = new Map<string, SolvedPose>();
  private readonly neutral: SolvedPose;

  // Animation state (preallocated: no per-frame allocation)
  private readonly from = makeQuatSet();
  private target: SolvedPose;
  private phase: Phase = "idle";
  private phaseTime = 0;
  private time = 0;
  private flash = 0;
  private currentPoseId: string | null = null;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();
  private visual: MJVisual | null = null;

  /** Materials that light up on the attack, with their flash strength. */
  private readonly flashMaterials: [THREE.MeshStandardMaterial, number][];
  private readonly glove: THREE.MeshStandardMaterial;
  private readonly rim: RimUniforms;

  constructor() {
    const m = createMaterials();
    this.flashMaterials = [
      [m.jacket, 0.18],
      [m.shirt, 0.3],
    ];
    this.glove = m.glove;
    this.rim = m.rim;

    this.root.name = "michael";
    const body = this.body; // also the whole-body lean pivot (at the feet)
    this.root.add(body);
    this.root.scale.setScalar(HERO_SCALE);

    // ----- Legs (planted) -----
    for (const side of [1, -1] as const) {
      const leg = buildLeg(side, m);
      this.legParts.push(leg);
      body.add(leg.hip);
    }

    // ----- Pelvis + belt -----
    buildPelvis(body, m);

    // ----- Chest (spine pivot) -----
    this.chest.position.y = SPINE_Y;
    body.add(this.chest);
    buildTorso(this.chest, m);

    // Neck + head (sculpted face, curly hair)
    const neckPivot = new THREE.Group();
    neckPivot.position.y = 0.56;
    this.chest.add(neckPivot);
    const headGroup = new THREE.Group();
    headGroup.position.y = HEAD_Y - 0.56;
    buildHead(headGroup, neckPivot, m);
    neckPivot.add(headGroup);

    // Arms
    const armL = buildArm(1, m, m.skin);
    const armR = buildArm(-1, m, m.glove);
    this.chest.add(armL.shoulder, armR.shoulder);

    this.joints = {
      spine: this.chest,
      head: neckPivot,
      shoulderL: armL.shoulder,
      elbowL: armL.elbow,
      wristL: armL.wrist,
      shoulderR: armR.shoulder,
      elbowR: armR.elbow,
      wristR: armR.wrist,
      lean: body,
      hipL: this.legParts[0]!.hip,
      hipR: this.legParts[1]!.hip,
      footL: this.legParts[0]!.ankle,
      footR: this.legParts[1]!.ankle,
    };

    this.neutral = solvePose(NEUTRAL);
    for (const [id, def] of Object.entries(POSES)) this.solved.set(id, solvePose(def));
    this.solved.set("__generic", solvePose(GENERIC));
    this.target = this.neutral;
    this.applyInstant(this.neutral);
  }

  /** Hip-to-sole leg length (character units). */
  static readonly LEG_LENGTH = LEG_LENGTH;

  /** Show an imported visual instead of the procedural meshes (null = back to the procedural MJ). */
  attachVisual(visual: MJVisual | null): void {
    if (this.visual) this.root.remove(this.visual.root);
    this.visual = visual;
    this.body.visible = !visual;
    if (visual) {
      this.root.add(visual.root);
      this.syncVisual();
    }
  }

  get hasImportedVisual(): boolean {
    return this.visual !== null;
  }

  /** Pose IDs this character knows how to perform. */
  static readonly POSE_IDS: readonly string[] = Object.keys(POSES);

  /** Play a gameplay pose: quick transition → brief hold → return to neutral. Starts immediately. */
  playPose(poseId: string): void {
    this.captureCurrent();
    this.target = this.poseFor(poseId);
    this.currentPoseId = poseId;
    this.phase = "in";
    this.phaseTime = 0;
    this.flash = 1;
  }

  /** Hold a pose indefinitely (debug / inspection). `null` = neutral. */
  setPose(poseId: string | null): void {
    this.target = poseId ? this.poseFor(poseId) : this.neutral;
    this.currentPoseId = poseId;
    this.applyInstant(this.target);
    this.phase = poseId ? "static" : "idle";
    this.phaseTime = 0;
  }

  /**
   * Smoothly move into a pose and stay there (pose prompt preview). `null` = back
   * to neutral. Never snaps: blends from wherever the body currently is.
   */
  transitionTo(poseId: string | null, seconds = 0.45): void {
    this.captureCurrent();
    this.target = poseId ? this.poseFor(poseId) : this.neutral;
    this.currentPoseId = poseId;
    this.transitionSec = Math.max(0.01, seconds);
    this.phase = "to";
    this.phaseTime = 0;
  }

  /** Current skeleton landmarks in world space (for recognizer checks and the pose gallery). */
  skeleton(): MJSkeleton {
    this.root.updateMatrixWorld(true);
    const w = (o: THREE.Object3D, local?: THREE.Vector3) => (local ? o.localToWorld(local.clone()) : o.getWorldPosition(new THREE.Vector3()));
    const j = this.joints;
    const [legL, legR] = this.legParts as [(typeof this.legParts)[0], (typeof this.legParts)[0]];
    return {
      head: w(j.head, new THREE.Vector3(0, HEAD_Y - 0.56, 0)),
      nose: w(j.head, new THREE.Vector3(0, HEAD_Y - 0.56 - 0.01, 0.12)),
      shoulder: { left: w(j.shoulderL), right: w(j.shoulderR) },
      elbow: { left: w(j.elbowL), right: w(j.elbowR) },
      wrist: { left: w(j.wristL), right: w(j.wristR) },
      hip: { left: w(legL.hip), right: w(legR.hip) },
      knee: { left: w(legL.knee), right: w(legR.knee) },
      ankle: { left: w(legL.ankle), right: w(legR.ankle) },
    };
  }

  /** Back to neutral idle, no flash. */
  reset(): void {
    this.setPose(null);
    this.flash = 0;
    this.applyFlash();
  }

  /** World position of a hand (wrist joint). Useful for effects later (e.g. a glove sparkle). */
  getHandPosition(side: "left" | "right", out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.joints[side === "left" ? "wristL" : "wristR"].getWorldPosition(out);
  }

  /** World position of the head (neck pivot + head offset). */
  getHeadPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.joints.head.localToWorld(out.set(0, HEAD_Y - 0.56, 0));
  }

  get poseId(): string | null {
    return this.phase === "idle" ? null : this.currentPoseId;
  }

  update(dt: number): void {
    this.time += dt;
    this.phaseTime += dt;
    const A = MJ_ANIMATION;

    switch (this.phase) {
      case "in": {
        const t = Math.min(1, this.phaseTime / A.transitionIn);
        this.blend(this.from, this.target, easeOutBack(t, A.overshoot));
        if (t >= 1) this.enter("hold");
        break;
      }
      case "hold":
        this.blend(this.target, this.target, 1);
        if (this.phaseTime >= A.hold) {
          this.captureCurrent();
          this.enter("out");
        }
        break;
      case "out": {
        const t = Math.min(1, this.phaseTime / A.transitionOut);
        this.blend(this.from, this.neutral, easeInOut(t));
        if (t >= 1) this.enter("idle");
        break;
      }
      case "static":
        this.blend(this.target, this.target, 1);
        break;
      case "to": {
        const t = Math.min(1, this.phaseTime / this.transitionSec);
        this.blend(this.from, this.target, easeInOut(t));
        if (t >= 1) this.enter(this.currentPoseId ? "static" : "idle");
        break;
      }
      case "idle":
        this.blend(this.neutral, this.neutral, 1);
        break;
    }

    this.applyIdleLife();
    this.plantFeet();

    // Attack highlight: a short punch on the hit, glove flares brightest.
    this.flash = Math.max(0, this.flash - A.flashDecay * dt);
    this.applyFlash();
    const pulse = this.phase === "in" || (this.phase === "hold" && this.phaseTime < 0.1) ? 0.05 * this.flash : 0;
    this.root.scale.setScalar(HERO_SCALE * (1 + pulse));
    this.syncVisual();
  }

  private syncVisual(): void {
    if (!this.visual) return;
    this.visual.sync({ joints: this.joints });
    this.visual.setFlash(this.flash);
  }

  // -------------------------------------------------------------------------

  private poseFor(id: string): SolvedPose {
    return this.solved.get(id) ?? this.solved.get("__generic")!;
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  private captureCurrent(): void {
    for (const j of JOINTS) this.from[j].copy(this.joints[j].quaternion);
  }

  private blend(a: SolvedPose, b: SolvedPose, t: number): void {
    for (const j of JOINTS) this.joints[j].quaternion.slerpQuaternions(a[j], b[j], t);
  }

  private applyInstant(p: SolvedPose): void {
    for (const j of JOINTS) this.joints[j].quaternion.copy(p[j]);
    this.plantFeet();
    this.syncVisual();
  }

  /**
   * Keep the soles on the floor: spread legs lower the body, and a sideways lean (both legs
   * tilted the same way) shifts the hips over so the feet stay where they are.
   */
  private plantFeet(): void {
    const angle = (q: THREE.Quaternion) => 2 * Math.atan2(q.z, q.w);
    const l = angle(this.joints.hipL.quaternion) - HIP_SPLAY;
    const r = angle(this.joints.hipR.quaternion) + HIP_SPLAY;
    const tilt = (l + r) / 2;
    this.body.position.x = -LEG_LENGTH * Math.sin(tilt);
    this.body.position.y = -LEG_LENGTH * (1 - Math.max(Math.cos(l), Math.cos(r)));
  }

  /** Very subtle breathing and weight shift, layered on top of the pose. */
  private applyIdleLife(): void {
    const t = this.time;
    const breathe = Math.sin(t * 1.9);
    this.tmpE.set(breathe * 0.012, Math.sin(t * 0.6) * 0.02, Math.sin(t * 0.8) * 0.008);
    this.tmpQ.setFromEuler(this.tmpE);
    this.chest.quaternion.multiply(this.tmpQ);
    this.chest.scale.set(1 + breathe * 0.006, 1 + breathe * 0.01, 1 + breathe * 0.008);
  }

  private applyFlash(): void {
    const f = this.flash;
    this.rim.uRimColor.value.lerpColors(RIM.rest, RIM.hit, Math.min(1, f * 1.4));
    this.rim.uRimStrength.value = RIM.strength * (1 + f * 1.2);
    for (const [mat, k] of this.flashMaterials) mat.emissiveIntensity = f * k;
    this.glove.emissiveIntensity = 0.25 + f * 2.2;
  }
}

// ---------------------------------------------------------------------------
// Pose solving
// ---------------------------------------------------------------------------
function makeQuatSet(): SolvedPose {
  const o = {} as SolvedPose;
  for (const j of JOINTS) o[j] = new THREE.Quaternion();
  return o;
}

function eulerQuat(d: V3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(d[0] * DEG, d[1] * DEG, d[2] * DEG));
}

function solvePose(def: PoseDef): SolvedPose {
  const out = makeQuatSet();
  const lean = def.lean ?? [0, 0, 0];
  // Sideways lean: the chest tilts with the legs (parallelogram, see PoseDef.lean).
  out.spine.copy(eulerQuat([0, 0, lean[2]])).multiply(eulerQuat(def.spine));
  out.head.copy(eulerQuat(def.head));
  const spread = (def.legs ?? 0) * DEG;
  const side = lean[2] * DEG;
  out.lean.copy(eulerQuat([lean[0], 0, 0]));
  out.hipL.setFromAxisAngle(new THREE.Vector3(0, 0, 1), HIP_SPLAY + spread + side);
  out.hipR.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(HIP_SPLAY + spread) + side);
  // Feet stay flat: undo the leg spread and the body lean at the ankle.
  out.footL.setFromEuler(new THREE.Euler(-lean[0] * DEG, 0, -lean[2] * DEG - spread));
  out.footR.setFromEuler(new THREE.Euler(-lean[0] * DEG, 0, -lean[2] * DEG + spread));
  for (const [side, arm] of [
    ["L", def.left],
    ["R", def.right],
  ] as const) {
    const s = SHOULDER.clone();
    if (side === "R") s.x = -s.x;
    const r = solveArmIK(s, new THREE.Vector3(...arm.hand), new THREE.Vector3(...arm.elbow), UPPER_ARM, FOREARM);
    out[`shoulder${side}`].copy(r.shoulder);
    out[`elbow${side}`].setFromAxisAngle(new THREE.Vector3(1, 0, 0), r.elbowAngle);
    out[`wrist${side}`].copy(eulerQuat(arm.wrist ?? [0, 0, 0]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
/**
 * Fresnel rim light so the dark hair / pants / shoes separate from the dark
 * arena at gameplay distance. Cool purple at rest, shifts to gold on the attack
 * highlight. Strength is scaled per material (the red jacket gets a gentle one).
 */
const RIM = {
  rest: new THREE.Color(0x5852b8),
  hit: new THREE.Color(0xffd36b),
  strength: 0.75,
  power: 3.2,
};
/** Per-character rim uniforms (each MJ instance flashes independently: arena vs pose preview). */
function makeRimUniforms() {
  return {
    uRimColor: { value: RIM.rest.clone() },
    uRimStrength: { value: RIM.strength },
    uRimPower: { value: RIM.power },
  };
}
type RimUniforms = ReturnType<typeof makeRimUniforms>;

/** Fixed (non-flashing) rim for materials that must keep their colour identity on the attack (hair). */
const steadyRim = {
  uRimColor: { value: RIM.rest.clone() },
  uRimStrength: { value: RIM.strength },
  uRimPower: { value: RIM.power },
};

function withRim(
  mat: THREE.MeshStandardMaterial,
  rim: RimUniforms,
  scale = 1,
  glow = 0x000000,
  followFlash = true,
): THREE.MeshStandardMaterial {
  const uGlow = { value: new THREE.Color(glow) };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, followFlash ? rim : steadyRim, { uRimScale: { value: scale }, uGlow });
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nuniform float uRimScale;\nuniform vec3 uGlow;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float rim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += uRimColor * (pow(rim, uRimPower) * uRimStrength * uRimScale) + uGlow;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `mj-rim-${scale}-${glow}-${followFlash}`;
  return mat;
}

/**
 * Materials: each surface reads differently under the cold moonlight and the
 * gold attack light — matte skin, glossy curls, semi-matte red leather, soft
 * shirt/pants, bright cotton socks, polished loafers, satin glove.
 */
function createMaterials() {
  const rimUniforms = makeRimUniforms();
  const withRimU = (mat: THREE.MeshStandardMaterial, scale = 1, glow = 0x000000, followFlash = true) =>
    withRim(mat, rimUniforms, scale, glow, followFlash);
  const std = (color: number, roughness: number, metalness = 0, opts: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...opts });
  return {
    rim: rimUniforms,
    // Red leather: deep red, semi-matte so it never turns fluorescent; gold emissive only on the attack flash.
    // A faint constant warm self-light keeps the red reading as red under the blue moonlight.
    // On the attack it flashes HOTTER RED (not gold: gold on red washes out to beige).
    jacket: withRimU(std(0xb21d20, 0.5, 0.06, { emissive: 0xff3a1e }), 0.3, 0x2a0405, false),
    // Black leather trim (V stripes, piping, cuff bands).
    trim: withRimU(std(0x0d0d10, 0.34, 0.2, { side: THREE.DoubleSide }), 0.5),
    shirt: std(0x18181e, 0.85, 0, { flatShading: true, emissive: 0xffc35a }),
    pants: withRimU(std(0x111116, 0.62, 0.08, { flatShading: true })),
    belt: std(0x0a0a0d, 0.4, 0.3, { flatShading: true }),
    metal: std(0xc9ccd4, 0.25, 0.9, { flatShading: true }),
    sock: std(0xf4f4f2, 0.85, 0),
    shoe: withRimU(std(0x0a0a0c, 0.2, 0.35), 0.8),
    skin: std(0xa86f4d, 0.56, 0),
    skinFacet: std(0xa86f4d, 0.56, 0, { flatShading: true, side: THREE.DoubleSide }),
    // Steady cool rim: the curls stay black under the gold attack light (never "blond").
    hair: withRimU(std(0x130e0c, 0.5, 0.05), 0.45, 0x000000, false),
    eyes: std(0xbdb2a6, 0.45, 0),
    dark: std(0x1a100c, 0.6, 0),
    lips: std(0x6b3a30, 0.5, 0),
    glove: std(0xffffff, 0.2, 0.6, { emissive: 0xe8f0ff }),
  };
}
type Materials = ReturnType<typeof createMaterials>;

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geo, mat);
}

// ---- Cross-sections (character units, before HERO_SCALE) --------------------

/** Cropped Thriller jacket around the chest pivot: narrow waist, broad structured shoulders. */
const JACKET: Ring[] = [
  { y: -0.03, rx: 0.158, rz: 0.118, n: 2.2 },
  { y: 0.05, rx: 0.15, rz: 0.11, n: 2.2 },
  { y: 0.16, rx: 0.168, rz: 0.118, n: 2.3 },
  { y: 0.28, rx: 0.198, rz: 0.127, n: 2.4 },
  { y: 0.38, rx: 0.224, rz: 0.13, n: 2.8 },
  { y: 0.455, rx: 0.248, rz: 0.122, n: 3.2 },
  { y: 0.505, rx: 0.216, rz: 0.11, n: 2.7 },
  { y: 0.545, rx: 0.13, rz: 0.09, n: 2.2 },
  { y: 0.565, rx: 0.085, rz: 0.072, n: 2 },
];
/**
 * Half-angle of the open jacket front. Defined as a fraction of the half-width
 * (nearly closed at the waist, opening into a V toward the collar) and converted
 * to an angle for the superellipse cross-section at that height.
 */
const jacketGap = (y: number) => {
  const f = 0.05 + 0.3 * smoothstep(0.15, 0.565, y) ** 1.3;
  const n = ringAt(JACKET, y).n ?? 2;
  return Math.asin(Math.min(1, f ** (n / 2)));
};
const TAU = Math.PI * 2;

const SHIRT: Ring[] = [
  { y: -0.06, rx: 0.14, rz: 0.104 },
  { y: 0.1, rx: 0.143, rz: 0.104 },
  { y: 0.3, rx: 0.18, rz: 0.113 },
  { y: 0.45, rx: 0.2, rz: 0.104 },
  { y: 0.53, rx: 0.11, rz: 0.08 },
  { y: 0.565, rx: 0.06, rz: 0.055 },
];

function buildLeg(side: 1 | -1, m: Materials): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group } {
  const hip = new THREE.Group();
  hip.position.set(0.095 * side, HIP_Y, 0);
  // Slight contrapposto: weight on the right leg, left knee relaxed.
  hip.rotation.z = side * HIP_SPLAY;
  // Slim fitted trousers: full at the hip, tapering to a defined knee.
  const thigh = loft(
    [
      { y: -THIGH - 0.01, rx: 0.053, rz: 0.055 },
      { y: -0.28, rx: 0.063, rz: 0.064 },
      { y: -0.12, rx: 0.076, rz: 0.075 },
      { y: 0, rx: 0.086, rz: 0.084 },
      { y: 0.07, rx: 0.09, rz: 0.088 },
    ],
    { segments: 10 },
  );
  const knee = new THREE.Group();
  knee.position.y = -THIGH;
  // Shin: knee → calf → high hem that shows the white socks.
  const shin = loft(
    [
      { y: -0.345, rx: 0.053, rz: 0.056 },
      { y: -0.31, rx: 0.047, rz: 0.049 },
      { y: -0.2, rx: 0.05, rz: 0.052 },
      { y: -0.08, rx: 0.057, rz: 0.06, cz: -0.004 },
      { y: 0.03, rx: 0.055, rz: 0.057 },
    ],
    { segments: 10 },
  );
  const sock = loft(
    [
      { y: -0.42, rx: 0.04, rz: 0.042 },
      { y: -0.33, rx: 0.042, rz: 0.044 },
    ],
    { segments: 12 },
  );
  const shoe = new THREE.Group();
  shoe.position.y = -SHIN - 0.02;
  shoe.add(mesh(buildLoafer(), m.shoe));
  knee.add(mesh(shin, m.pants), mesh(sock, m.sock), shoe);
  hip.add(mesh(thigh, m.pants), knee);
  // Keep the feet flat on the ground after the hip splay.
  knee.rotation.z = -side * HIP_SPLAY;
  return { hip, knee, ankle: shoe };
}

function buildPelvis(body: THREE.Group, m: Materials): void {
  const y0 = HIP_Y;
  const pelvis = loft(
    [
      { y: y0 - 0.1, rx: 0.13, rz: 0.092 },
      { y: y0, rx: 0.148, rz: 0.102 },
      { y: y0 + 0.08, rx: 0.144, rz: 0.1 },
      { y: y0 + 0.14, rx: 0.14, rz: 0.1 },
    ],
    { segments: 12, capBottom: true },
  );
  const belt = loft(
    [
      { y: y0 + 0.07, rx: 0.151, rz: 0.106 },
      { y: y0 + 0.1, rx: 0.15, rz: 0.105 },
    ],
    { segments: 14 },
  );
  const buckle = mesh(new THREE.BoxGeometry(0.045, 0.03, 0.012), m.metal);
  buckle.position.set(0, y0 + 0.085, 0.108);
  body.add(mesh(pelvis, m.pants), mesh(belt, m.belt), buckle);
}

function buildTorso(chest: THREE.Group, m: Materials): void {
  const jacket: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];

  // Open-front red leather shell (inside shows through the opening, so double-sided material isn't
  // needed: the dark shirt fills it).
  jacket.push(loft(JACKET, { segments: 26, arc: (y) => [jacketGap(y), TAU - jacketGap(y)] }));
  // Structured, slightly raised shoulder points.
  for (const s of [1, -1]) {
    jacket.push(placed(new THREE.SphereGeometry(1, 14, 10), { x: 0.24 * s, y: 0.47, z: 0 }, [0, 0, s * -0.18], [0.072, 0.052, 0.082]));
  }
  // Stand-up collar, open at the front.
  const COLLAR: Ring[] = [
    { y: 0.53, rx: 0.104, rz: 0.088 },
    { y: 0.6, rx: 0.098, rz: 0.084 },
    { y: 0.635, rx: 0.108, rz: 0.093 },
  ];
  jacket.push(loft(COLLAR, { segments: 16, arc: () => [0.62, TAU - 0.62] }));
  trim.push(surfaceRibbon(COLLAR, line(0.62, 0.634, TAU - 0.62, 0.634, 16), 0.012, 0.002));

  // Black leather V stripes across the chest (two per side) and a V across the back.
  for (const s of [1, -1]) {
    const edge = (y: number) => (s > 0 ? jacketGap(y) + 0.05 : TAU - jacketGap(y) - 0.05);
    const outer = (t: number) => (s > 0 ? t : TAU - t);
    trim.push(surfaceRibbon(JACKET, line(outer(1.3), 0.462, edge(0.27), 0.27, 10), 0.03));
    trim.push(surfaceRibbon(JACKET, line(outer(1.38), 0.39, edge(0.19), 0.19, 10), 0.022));
    trim.push(surfaceRibbon(JACKET, line(outer(1.8), 0.46, Math.PI, 0.24, 10), 0.03));
    trim.push(surfaceRibbon(JACKET, line(outer(1.75), 0.39, Math.PI, 0.17, 10), 0.022));
    // Piping along the open front edge.
    const pipe: [number, number][] = Array.from({ length: 12 }, (_, i) => {
      const y = -0.03 + (0.59 * i) / 11;
      return [s > 0 ? jacketGap(y) + 0.012 : TAU - jacketGap(y) - 0.012, y];
    });
    trim.push(surfaceRibbon(JACKET, pipe, 0.014));
    // Seam over the top of each shoulder (reads from the high gameplay camera).
    trim.push(surfaceRibbon(JACKET, line(outer(0.95), 0.53, outer(1.5), 0.46, 6), 0.016));
  }
  // Hem band.
  trim.push(surfaceRibbon(JACKET, line(jacketGap(-0.02) + 0.02, -0.015, TAU - jacketGap(-0.02) - 0.02, -0.015, 28), 0.024));

  chest.add(mesh(loft(SHIRT, { segments: 12 }), m.shirt), mesh(merge(jacket), m.jacket), mesh(merge(trim), m.trim));
}

function buildHead(head: THREE.Group, neckPivot: THREE.Group, m: Materials): void {
  // Neck: slim, smooth, rising out of the collar.
  const neck = loft(
    [
      { y: -0.04, rx: 0.05, rz: 0.047 },
      { y: 0.05, rx: 0.044, rz: 0.042 },
      { y: 0.13, rx: 0.042, rz: 0.04 },
    ],
    { segments: 12 },
  );
  neckPivot.add(mesh(neck, m.skin));
  const parts = buildHeadParts();
  head.add(
    mesh(parts.skin, m.skin),
    mesh(parts.nose, m.skinFacet),
    mesh(parts.eyes, m.eyes),
    mesh(parts.dark, m.dark),
    mesh(parts.lips, m.lips),
    mesh(buildHair(), m.hair),
  );
}

function buildArm(side: 1 | -1, m: Materials, handMat: THREE.Material) {
  const shoulder = new THREE.Group();
  shoulder.position.set(SHOULDER.x * side, SHOULDER.y, SHOULDER.z);
  // Upper sleeve: full at the shoulder, slim toward the elbow.
  const UPPER: Ring[] = [
    { y: -UPPER_ARM - 0.01, rx: 0.053, rz: 0.051 },
    { y: -0.2, rx: 0.057, rz: 0.055 },
    { y: -0.1, rx: 0.063, rz: 0.06 },
    { y: 0, rx: 0.07, rz: 0.066 },
    { y: 0.035, rx: 0.06, rz: 0.056 },
  ];
  const upperTrim = [-0.085, -0.125].map((y) => {
    const r = ringAt(UPPER, y);
    return loft(
      [
        { y: y - 0.008, rx: r.rx + 0.004, rz: r.rz + 0.004 },
        { y: y + 0.008, rx: r.rx + 0.004, rz: r.rz + 0.004 },
      ],
      { segments: 12 },
    );
  });
  const elbow = new THREE.Group();
  elbow.position.y = -UPPER_ARM;
  // Forearm sleeve with a leather cuff; the elbow ball keeps bent arms closed.
  const FORE: Ring[] = [
    { y: -0.262, rx: 0.052, rz: 0.05 },
    { y: -0.225, rx: 0.049, rz: 0.047 },
    { y: -0.12, rx: 0.05, rz: 0.048 },
    { y: -0.03, rx: 0.055, rz: 0.053 },
    { y: 0.01, rx: 0.056, rz: 0.054 },
  ];
  const foreRed = merge([loft(FORE, { segments: 12 }), placed(new THREE.SphereGeometry(1, 12, 10), { x: 0, y: 0, z: 0 }, [0, 0, 0], [0.056, 0.056, 0.054])]);
  const foreTrim = merge([
    loft(
      [
        { y: -0.264, rx: 0.056, rz: 0.054 },
        { y: -0.234, rx: 0.054, rz: 0.052 },
      ],
      { segments: 12 },
    ),
    loft(
      [
        { y: -0.14, rx: 0.054, rz: 0.052 },
        { y: -0.124, rx: 0.054, rz: 0.052 },
      ],
      { segments: 12 },
    ),
  ]);
  const wrist = new THREE.Group();
  wrist.position.y = -FOREARM;
  wrist.add(mesh(buildHand(side, handMat === m.glove), handMat));
  elbow.add(mesh(foreRed, m.jacket), mesh(foreTrim, m.trim), wrist);
  shoulder.add(mesh(loft(UPPER, { segments: 12 }), m.jacket), mesh(merge(upperTrim), m.trim), elbow);
  return { shoulder, elbow, wrist };
}

function easeOutBack(t: number, s: number): number {
  const c = s + 1;
  const x = t - 1;
  return 1 + c * x * x * x + s * x * x;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
