/**
 * PURE zombie visuals logic (no Three.js):
 *   - deterministic visual variants from a seed
 *   - gameplay state → animation pose (joint angles)
 *
 * The gameplay Zombie is READ-ONLY here. World position, timing and every
 * gameplay decision stay in the combat simulation; this only decides how the
 * body looks while in that state. No root motion.
 */
import { COMBAT_CONFIG } from "../../combat/combatConfig";
import type { Zombie } from "../../combat/combatSystem";
import { SURVIVAL_CONFIG } from "../../survival/survivalConfig";

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
export type Outfit = "suit" | "casual" | "formal" | "worker";
export type HairStyle = "messy" | "balding" | "stringy" | "bald";
export type ArmStyle = "reach" | "hang" | "mixed";
export type Side = "L" | "R";

export const OUTFITS: readonly Outfit[] = ["suit", "casual", "formal", "worker"];
export const HAIR_STYLES: readonly HairStyle[] = ["messy", "balding", "stringy", "bald"];

/** Palette sizes (zombieCharacter.ts owns the actual colors). */
export const PALETTE_SIZES = { skin: 4, shirt: 5, jacket: 5, pants: 4, hair: 3 } as const;

export interface ZombieVariant {
  seed: number;
  /** Short label for debug, e.g. "suit/messy/s2". */
  id: string;
  outfit: Outfit;
  hair: HairStyle;
  arms: ArmStyle;
  skin: number;
  shirt: number;
  jacket: number;
  pants: number;
  hairColor: number;
  /** Uniform visual scale (gameplay is unaffected). */
  scale: number;
  /** Extra width at the shoulders. */
  shoulderWidth: number;
  /** Forward hunch (rad). */
  hunch: number;
  /** Sideways head tilt (rad). */
  headTilt: number;
  /** Jaw: width scale and crooked roll. */
  jawWidth: number;
  jawRoll: number;
  /** Which leg drags in the walk. */
  dragLeg: Side;
  /** Which arm strikes. */
  strikeArm: Side;
  /** Clothing damage. */
  tornSleeve: Side | null;
  shortTrouser: Side | null;
  crookedCollar: number;
  /** Walk-cycle speed multiplier (purely visual cadence). */
  gait: number;
}

/** Small deterministic RNG (mulberry32). */
function rng(seed: number): () => number {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same seed → same look. Visual only. */
export function makeZombieVariant(seed: number): ZombieVariant {
  const r = rng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length]!;
  const int = (n: number) => Math.floor(r() * n) % n;
  const range = (a: number, b: number) => a + r() * (b - a);
  const side = (): Side => (r() < 0.5 ? "L" : "R");

  const outfit = pick(OUTFITS);
  const hair = pick(HAIR_STYLES);
  const arms = pick<ArmStyle>(["reach", "hang", "mixed"]);
  const skin = int(PALETTE_SIZES.skin);
  return {
    seed,
    id: `${outfit}/${hair}/${arms}/s${skin}`,
    outfit,
    hair,
    arms,
    skin,
    shirt: int(PALETTE_SIZES.shirt),
    jacket: int(PALETTE_SIZES.jacket),
    pants: int(PALETTE_SIZES.pants),
    hairColor: int(PALETTE_SIZES.hair),
    scale: range(0.93, 1.07),
    shoulderWidth: range(0.95, 1.12),
    hunch: range(0.22, 0.42),
    headTilt: range(0.12, 0.32) * (r() < 0.5 ? -1 : 1),
    jawWidth: range(0.85, 1.15),
    jawRoll: range(-0.18, 0.18),
    dragLeg: side(),
    strikeArm: side(),
    tornSleeve: r() < 0.55 ? side() : null,
    shortTrouser: r() < 0.45 ? side() : null,
    crookedCollar: range(-0.35, 0.35),
    gait: range(0.85, 1.15),
  };
}

// ---------------------------------------------------------------------------
// State → animation
// ---------------------------------------------------------------------------
export type ZombieAnim =
  | "walk"
  | "idle"
  | "ready"
  | "windup"
  | "strike"
  | "recover"
  | "knockback"
  | "dazed"
  | "rise"
  | "defeated"
  | "dissolve"
  | "hidden";

/**
 * Joint angles in radians. Arm "Out" values are positive = away from the body
 * (the view applies the side sign). X rotations: negative = forward for thighs
 * and shoulders, positive = forward lean for the spine/neck/head, knees bend
 * positive, elbows curl negative.
 */
export interface ZombiePose {
  anim: ZombieAnim;
  visible: boolean;
  /** Local body offsets (no root motion: the root follows the simulation). */
  bodyY: number;
  bodyTiltX: number;
  bodyRollZ: number;
  bodyTwistY: number;
  scale: number;
  sink: number;
  pelvisZ: number;
  spineX: number;
  spineY: number;
  spineZ: number;
  neckX: number;
  headX: number;
  headY: number;
  headZ: number;
  shoulderLX: number;
  shoulderLOut: number;
  elbowLX: number;
  shoulderRX: number;
  shoulderROut: number;
  elbowRX: number;
  thighLX: number;
  kneeLX: number;
  thighRX: number;
  kneeRX: number;
}

export function createPose(): ZombiePose {
  return {
    anim: "idle",
    visible: true,
    bodyY: 0,
    bodyTiltX: 0,
    bodyRollZ: 0,
    bodyTwistY: 0,
    scale: 1,
    sink: 0,
    pelvisZ: 0,
    spineX: 0,
    spineY: 0,
    spineZ: 0,
    neckX: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    shoulderLX: 0,
    shoulderLOut: 0,
    elbowLX: 0,
    shoulderRX: 0,
    shoulderROut: 0,
    elbowRX: 0,
    thighLX: 0,
    kneeLX: 0,
    thighRX: 0,
    kneeRX: 0,
  };
}

/** Visual timing constants (seconds). Gameplay timing is read from the configs, never changed. */
export const ZOMBIE_ANIM = {
  /** Visible wind-up starts this long before the simulated strike. */
  windup: 0.38,
  strike: 0.15,
  recover: 0.32,
  /** Defeat: reaction, then shrink/dissolve, finishing before the simulation removes it. */
  dissolveStart: 0.55,
  dissolveEnd: 1.0,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/** Which animation a gameplay state maps to (exported for tests and debug). */
export function animFor(z: Readonly<Zombie>): ZombieAnim {
  if (z.active === false) return "hidden";
  switch (z.state) {
    case "APPROACHING":
      return z.atTarget ? "idle" : "walk";
    case "ATTACKING": {
      const since = z.strikeAge ?? 10;
      const until = z.attackTimer ?? 10;
      if (since < ZOMBIE_ANIM.strike) return "strike";
      if (since < ZOMBIE_ANIM.strike + ZOMBIE_ANIM.recover) return "recover";
      return until <= ZOMBIE_ANIM.windup ? "windup" : "ready";
    }
    case "KNOCKBACK":
      return "knockback";
    case "RECOVERING":
      return z.stateTime * 1000 < COMBAT_CONFIG.recovery.dazedMs ? "dazed" : "rise";
    case "DEFEATED":
      return z.stateTime < ZOMBIE_ANIM.dissolveStart ? "defeated" : "dissolve";
  }
}

/**
 * Compute the pose for this frame into `out` (preallocated; no allocation).
 * `time` is the arena animation clock (s), frozen while the game is paused.
 */
export function computeZombiePose(z: Readonly<Zombie>, v: ZombieVariant, time: number, out: ZombiePose): ZombiePose {
  const anim = animFor(z);
  out.anim = anim;
  out.visible = anim !== "hidden";
  if (!out.visible) return out;

  // ---- Base undead posture (asymmetric, from the variant) ----
  const strikeL = v.strikeArm === "L";
  out.bodyY = 0;
  out.bodyTiltX = 0;
  out.bodyRollZ = 0;
  out.bodyTwistY = 0;
  out.scale = 1;
  out.sink = 0;
  out.pelvisZ = 0.03 * (v.dragLeg === "L" ? 1 : -1);
  out.spineX = v.hunch;
  out.spineY = 0;
  out.spineZ = v.headTilt * 0.25;
  out.neckX = 0.12;
  // Undead lean forward but the face still seeks the target: counter the hunch.
  out.headX = -v.hunch * 0.9;
  out.headY = 0;
  out.headZ = v.headTilt;
  out.thighLX = -0.08;
  out.thighRX = 0.06;
  out.kneeLX = 0.18;
  out.kneeRX = 0.22;
  setArmsRest(out, v, 0);

  const p = time * 4.2 * v.gait * (0.7 + z.speed * 0.45) + z.phase;

  switch (anim) {
    case "walk":
      walk(out, v, p, 1);
      break;

    case "idle":
      // Swaying at MJ, clawing.
      out.spineZ += Math.sin(time * 1.7 + z.phase) * 0.06;
      out.headZ += Math.sin(time * 1.3 + z.phase) * 0.05;
      setArmsReach(out, Math.sin(time * 4 + z.phase) * 0.18);
      break;

    case "ready":
    case "windup":
    case "strike":
    case "recover":
      attack(out, z, v, strikeL, time);
      break;

    case "knockback": {
      const speed = Math.hypot(z.vx, z.vz);
      knocked(out, v, clamp01(speed / 9 + z.y * 0.25), z.y, z.phase, z.stateTime, 1);
      break;
    }

    case "dazed": {
      // Stumbling, limp arms, wobbling head; settles over the dazed time.
      const t = z.stateTime;
      const decay = Math.max(0, 1 - t / (COMBAT_CONFIG.recovery.dazedMs / 1000));
      out.spineX = v.hunch + 0.25 * decay;
      out.spineZ += Math.sin(t * 9 + z.phase) * 0.22 * decay;
      out.headZ += Math.sin(t * 7 + 1) * 0.3 * decay;
      out.headX = 0.45 * decay - v.hunch * 0.9 * (1 - decay);
      setArmsRest(out, v, 0.2 * decay);
      out.shoulderLX = 0.05;
      out.shoulderRX = 0.1;
      out.kneeLX = 0.35;
      out.kneeRX = 0.25;
      break;
    }

    case "rise": {
      // Walking again with the simulated speed ramp: amplitude follows it.
      const R = COMBAT_CONFIG.recovery;
      const ramp = clamp01((z.stateTime * 1000 - R.dazedMs) / R.rampMs);
      walk(out, v, p, 0.35 + 0.65 * ramp);
      break;
    }

    case "defeated": {
      // Strong backward reaction, limbs going loose, tumbling with the throw.
      const t = z.stateTime;
      knocked(out, v, 1, z.y, z.phase, t, 1.4);
      const loose = Math.sin(t * 14) * Math.exp(-t * 3);
      out.shoulderLOut += 0.5 * loose;
      out.shoulderROut -= 0.4 * loose;
      out.elbowLX = -0.2 + 0.6 * loose;
      out.elbowRX = -0.3 - 0.5 * loose;
      out.kneeLX = 0.6 + 0.4 * loose;
      out.headX = -0.9 + 0.3 * loose;
      out.bodyTiltX -= t * 2.6; // tumble
      break;
    }

    case "dissolve": {
      // Limp, collapsing, shrinking into the ground (no gore).
      const t = clamp01((z.stateTime - ZOMBIE_ANIM.dissolveStart) / (ZOMBIE_ANIM.dissolveEnd - ZOMBIE_ANIM.dissolveStart));
      knocked(out, v, 1 - t * 0.5, z.y, z.phase, 1, 0);
      out.bodyTiltX = -1.3 - t * 0.3;
      out.scale = 1 - ease(t);
      out.sink = 0.5 * t;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
function setArmsRest(o: ZombiePose, v: ZombieVariant, swing: number): void {
  // "reach": classic arms-forward; "hang": limp; "mixed": one of each.
  const reachX = -1.35;
  const hangX = -0.25;
  const l = v.arms === "reach" || (v.arms === "mixed" && v.strikeArm === "L");
  const r = v.arms === "reach" || (v.arms === "mixed" && v.strikeArm === "R");
  o.shoulderLX = (l ? reachX : hangX) + swing;
  o.shoulderRX = (r ? reachX : hangX) - swing;
  o.shoulderLOut = l ? 0.12 : 0.1;
  o.shoulderROut = r ? 0.16 : 0.08;
  o.elbowLX = l ? -0.35 : -0.25;
  o.elbowRX = r ? -0.45 : -0.2;
}

function setArmsReach(o: ZombiePose, claw: number): void {
  o.shoulderLX = -1.45 + claw;
  o.shoulderRX = -1.35 - claw;
  o.shoulderLOut = 0.15;
  o.shoulderROut = 0.2;
  o.elbowLX = -0.45 - claw;
  o.elbowRX = -0.35 + claw;
}

/** Uneven, dragging undead walk. amp 0..1. */
function walk(o: ZombiePose, v: ZombieVariant, p: number, amp: number): void {
  const s = Math.sin(p);
  const c = Math.cos(p);
  const dragL = v.dragLeg === "L";
  // The dragging leg swings less and lags.
  const swingL = (dragL ? 0.28 : 0.48) * amp;
  const swingR = (dragL ? 0.48 : 0.28) * amp;
  o.thighLX = -s * swingL - 0.05;
  o.thighRX = s * swingR - 0.05;
  o.kneeLX = 0.15 + Math.max(0, c) * (dragL ? 0.25 : 0.65) * amp;
  o.kneeRX = 0.15 + Math.max(0, -c) * (dragL ? 0.65 : 0.25) * amp;
  // Lurching body: bob, rock, twist, shoulder sway, head bob.
  o.bodyY = Math.abs(s) * 0.045 * amp;
  o.pelvisZ += s * 0.07 * amp;
  o.spineZ += -s * 0.1 * amp;
  o.spineY = s * 0.14 * amp;
  o.spineX = v.hunch + Math.abs(c) * 0.06 * amp;
  o.headX = -v.hunch * 0.9 + Math.sin(p * 2) * 0.06 * amp;
  o.headZ += s * 0.06 * amp;
  // Arms counter-swing (limp) or bob (reaching).
  setArmsRest(o, v, 0);
  o.shoulderLX += s * (v.arms === "reach" ? 0.08 : 0.3) * amp;
  o.shoulderRX -= s * (v.arms === "reach" ? 0.08 : 0.3) * amp;
}

/**
 * Attack, synchronized to the simulation's own timers:
 *   attackTimer = seconds until the next strike, strikeAge = seconds since the last one.
 */
function attack(o: ZombiePose, z: Readonly<Zombie>, v: ZombieVariant, strikeL: boolean, time: number): void {
  const A = ZOMBIE_ANIM;
  const since = z.strikeAge ?? 10;
  const until = z.attackTimer ?? 10;

  // Stance: wide, braced, other arm reaching.
  o.thighLX = -0.2;
  o.thighRX = 0.15;
  o.kneeLX = 0.3;
  o.kneeRX = 0.35;
  setArmsReach(o, Math.sin(time * 4 + z.phase) * 0.12);

  // Key poses for the striking arm/torso.
  const side = strikeL ? 1 : -1;
  const look = -v.hunch * 0.9;
  const READY = { sx: -1.4, out: 0.2, el: -0.4, spineX: v.hunch, spineY: 0, headX: look };
  const WIND = { sx: -2.75, out: 0.55, el: -1.25, spineX: v.hunch - 0.28, spineY: -0.4 * side, headX: look - 0.1 };
  const HIT = { sx: -0.75, out: 0.05, el: -0.15, spineX: v.hunch + 0.45, spineY: 0.35 * side, headX: look + 0.35 };

  let from = READY;
  let to = READY;
  let t = 0;
  if (since < A.strike) {
    from = WIND;
    to = HIT;
    t = since / A.strike;
  } else if (since < A.strike + A.recover) {
    from = HIT;
    to = READY;
    t = ease((since - A.strike) / A.recover);
  } else if (until <= A.windup) {
    from = READY;
    to = WIND;
    t = ease(1 - until / A.windup);
  }

  const sx = lerp(from.sx, to.sx, t);
  const out = lerp(from.out, to.out, t);
  const el = lerp(from.el, to.el, t);
  if (strikeL) {
    o.shoulderLX = sx;
    o.shoulderLOut = out;
    o.elbowLX = el;
  } else {
    o.shoulderRX = sx;
    o.shoulderROut = out;
    o.elbowRX = el;
  }
  o.spineX = lerp(from.spineX, to.spineX, t);
  o.spineY = lerp(from.spineY, to.spineY, t);
  o.headX = lerp(from.headX, to.headX, t);
}

/**
 * Thrown back by the aura. k 0..1 = how violently (from current velocity).
 * `since` = seconds since the hit: the torso/head snap first (a short overshoot),
 * the limbs catch up a beat later so they trail. `snapScale` > 1 for killing hits.
 */
function knocked(o: ZombiePose, v: ZombieVariant, k: number, y: number, phase: number, since: number, snapScale: number): void {
  const snap = Math.exp(-since * 16) * snapScale; // 1 at the hit, ~0.2 after 0.1 s
  const lag = since >= 0.1 ? 1 : since / 0.1; // limbs trail the body
  const twistSign = Math.sin(phase * 3.7) >= 0 ? 1 : -1;
  o.bodyTiltX = -0.38 * k - y * 0.18;
  o.bodyRollZ = 0.22 * k * twistSign;
  o.bodyTwistY = 0.3 * k * twistSign;
  o.spineX = v.hunch * (1 - k) - 0.55 * k - 0.35 * snap; // snaps backward
  o.spineY = 0;
  o.neckX = 0.22 - 0.5 * k - 0.2 * snap;
  o.headX = -0.6 * k - 0.45 * snap; // whips back first
  // Arms fling outward and up, a beat behind the torso.
  const ka = k * lag;
  o.shoulderLX = lerp(-1.2, -2.1, ka);
  o.shoulderRX = lerp(-1.1, -1.8, ka);
  o.shoulderLOut = 0.2 + 1.1 * ka;
  o.shoulderROut = 0.2 + 0.95 * ka;
  o.elbowLX = -0.2;
  o.elbowRX = -0.35;
  // Legs trail toward MJ (the feet lag behind the thrown body).
  o.thighLX = -0.55 * k * lag;
  o.thighRX = -0.3 * k * lag;
  o.kneeLX = 0.25 + 0.3 * k;
  o.kneeRX = 0.4 + 0.2 * k;
}

/** Strike cadence (read-only; for docs/tests). */
export const ATTACK_TIMING = {
  windupMs: SURVIVAL_CONFIG.zombieAttackWindup,
  cooldownMs: SURVIVAL_CONFIG.zombieAttackCooldown,
};
