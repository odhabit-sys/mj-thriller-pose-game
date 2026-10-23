/**
 * Survival-game balancing. All difficulty comes from enemy pressure (count,
 * speed, damage). Pose recognition tolerances are NEVER changed by the game.
 */
export const SURVIVAL_CONFIG = {
  // --- MJ ---
  maxHealth: 100,

  // --- Zombie attacks ---
  zombieDamage: 10,
  /** Time between strikes while a zombie stays in range (ms). */
  zombieAttackCooldown: 1000,
  /** Delay between arriving at MJ and the first strike (ms): a beat to react. */
  zombieAttackWindup: 450,
  /** A zombie this close to MJ (units) switches to ATTACKING. Zombies stop at COMBAT_CONFIG.zombies.stopDistance. */
  zombieAttackDistance: 1.3,

  // --- Defeat ---
  hitsToDefeatZombie: 2,
  /** The defeating hit launches harder than a normal knockback. */
  defeatKnockbackMultiplier: 1.5,
  /** Upward launch speed on defeat (units/s). */
  defeatLift: 7,
  /** Defeated zombies fade out and are removed after this (ms). */
  defeatFadeMs: 1100,

  // --- Waves ---
  baseZombieCount: 3,
  zombiesAddedPerWave: 1,
  /** Walking speed for wave 1 (units/s). */
  baseZombieSpeed: 0.8,
  speedIncreasePerWave: 0.08,
  maxZombieSpeed: 1.8,
  /** ± fraction of random per-zombie speed variation. */
  speedJitter: 0.12,
  /** Never more than this many live zombies at once; the rest of the wave queues. */
  maxActiveZombies: 8,
  /** Delay between queued spawns (ms). */
  spawnIntervalMs: 900,

  // --- Score ---
  scorePerZombie: 100,
  waveClearBonus: 250,

  // --- Pacing ---
  /** Breathing room between waves: "WAVE COMPLETE" then "WAVE N" (ms). */
  waveTransitionDuration: 1800,
  /** Portion of the transition showing "WAVE COMPLETE" before "WAVE N" (ms). */
  waveCompleteBannerMs: 1000,
  /** "WAVE N" stays up this long after the wave starts (ms). */
  waveIntroMs: 1200,

  // --- Damage feedback (visual only) ---
  damageShake: { intensity: 0.06, durationMs: 130 },

  bestScoreKey: "mj-pose-game:best-score",
} as const;

/** Same shape with literal types widened, so variants (tests, future difficulty modes) typecheck. */
type Widen<T> = {
  readonly [K in keyof T]: T[K] extends number ? number : T[K] extends string ? string : Widen<T[K]>;
};
export type SurvivalConfig = Widen<typeof SURVIVAL_CONFIG>;
