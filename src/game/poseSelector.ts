import type { PoseDefinition, PoseDifficulty } from "./poseRegistry";

/**
 * Chooses the next pose prompt: weighted by difficulty for the current wave,
 * never one of the last few poses, and still random so no two games match.
 */
export const POSE_SELECTION = {
  /** A pose isn't requested again within this many prompts (if the library allows). */
  avoidRecent: 3,
} as const;

/**
 * Difficulty weights by wave. Wave 1: almost all easy; wave 2: easy + medium;
 * wave 3: medium-heavy with the first hard poses; wave 5+: the full library.
 */
export function difficultyWeights(wave: number): Record<PoseDifficulty, number> {
  if (wave <= 1) return { easy: 1, medium: 0.12, hard: 0 };
  if (wave === 2) return { easy: 1, medium: 0.6, hard: 0 };
  if (wave === 3) return { easy: 0.8, medium: 1, hard: 0.3 };
  if (wave === 4) return { easy: 0.6, medium: 1, hard: 0.65 };
  return { easy: 0.5, medium: 0.9, hard: 1 };
}

/** Uniform weights: used when no wave information is available. */
export const UNIFORM_WEIGHTS: Record<PoseDifficulty, number> = { easy: 1, medium: 1, hard: 1 };

/**
 * @param recent most recent target ids, newest last
 */
export function selectPose(
  poses: readonly PoseDefinition[],
  recent: readonly string[],
  weights: Record<PoseDifficulty, number>,
  random: () => number,
  avoidRecent: number = POSE_SELECTION.avoidRecent,
): PoseDefinition {
  const last = recent[recent.length - 1];
  // Short history, scaled to the pool so a small library still leaves a real choice (6 poses → 2).
  const historyLen = Math.max(1, Math.min(avoidRecent, Math.floor((poses.length - 1) / 2)));
  const blocked = new Set(recent.slice(-historyLen));
  const weighted = (list: readonly PoseDefinition[]) => list.map((p) => ({ p, w: weights[p.difficulty] })).filter((x) => x.w > 0);
  // Prefer fresh poses at allowed difficulties; relax step by step, but never repeat the last pose.
  let pool = weighted(poses.filter((p) => !blocked.has(p.id)));
  if (pool.length === 0) pool = weighted(poses.filter((p) => p.id !== last));
  if (pool.length === 0) pool = poses.filter((p) => p.id !== last).map((p) => ({ p, w: 1 }));
  const total = pool.reduce((s, x) => s + x.w, 0);
  let r = random() * total;
  for (const x of pool) {
    r -= x.w;
    if (r < 0) return x.p;
  }
  return pool[pool.length - 1]!.p;
}
