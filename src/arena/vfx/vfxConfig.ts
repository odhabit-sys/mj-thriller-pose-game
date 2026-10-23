/**
 * Attack / impact VFX tuning. VISUAL ONLY: nothing here affects gameplay timing,
 * hits, damage or score. Palette: warm white, gold, amber, a hint of arena purple.
 */
export const VFX_CONFIG = {
  enabled: true,

  palette: {
    warmWhite: 0xfff3d6,
    gold: 0xffcf5a,
    amber: 0xff9a3c,
    purple: 0x9a6cff,
  },

  /** Pooled capacities (fixed; nothing is allocated during play). */
  capacity: { particles: 640, streaks: 120, rings: 4, decals: 6 },

  /** MJ power charge (overlaps the start of the attack; never delays it). */
  charge: { durationMs: 150, motes: 20, sparkles: 10, lightPeak: 34 },

  shockwave: {
    /** Ring thickness (world units). */
    thickness: 0.34,
    /** Secondary ring sits at this fraction of the main radius. */
    trailingRing: 0.78,
    /** Ground glow under MJ. */
    groundGlowMs: 420,
    outwardParticles: 26,
    /** Per zombie hit by this attack (combo), up to comboMax. */
    comboBoost: 0.16,
    comboMax: 5,
  },

  impact: {
    sparks: 10,
    streaks: 5,
    defeatSparks: 20,
    defeatStreaks: 10,
    defeatEmbers: 8,
    residueMs: 750,
  },

  camera: {
    enabled: true,
    durationMs: 120,
    /** Impulse size (world units) for the blast, per first-hit and per defeat; capped. */
    blastKick: 0.05,
    perHit: 0.015,
    perDefeat: 0.035,
    maxKick: 0.14,
  },

  /** Visual "punch": brief scene brightening when the blast connects. */
  punch: { durationMs: 80, hemisphereBoost: 0.4 },

  /** Visual-only hit stop: VFX animation slows briefly on impact. Simulation untouched. */
  hitStop: { durationMs: 55, timeScale: 0.25 },
} as const;
