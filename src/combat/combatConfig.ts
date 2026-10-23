/**
 * Combat / arena tuning. World units ≈ meters. MJ stands at the origin.
 * Pose recognition and the pose loop are configured elsewhere (locked).
 */
export const COMBAT_CONFIG = {
  arenaRadius: 9,

  zombies: {
    count: 5,
    /** Spawn ring distance from MJ. */
    spawnRadiusMin: 7,
    spawnRadiusMax: 8.5,
    /** Walking speed range (units/s). */
    speedMin: 0.7,
    speedMax: 1.1,
    /** Zombies stop this far from MJ (no damage yet; they just crowd him). */
    stopDistance: 1.1,
  },

  attack: {
    /** Only zombies within this distance of MJ are knocked back. Shown as a ring on the ground. */
    attackRadius: 4,
    /** The aura ring grows from 0 to attackRadius in this time; zombies are hit as it passes them. */
    expandMs: 260,
    /** Total aura lifetime including fade-out. */
    durationMs: 520,
  },

  knockback: {
    /** Outward speed for a zombie at MJ's feet (units/s). */
    speedNear: 13,
    /** Outward speed for a zombie at the edge of the attack radius. */
    speedFar: 8,
    /** Upward launch speed (units/s); 0 disables the hop. */
    lift: 4.5,
    gravity: 18,
    /** Exponential horizontal damping per second while sliding. */
    damping: 3.2,
    /** Below this horizontal speed (and on the ground) the zombie starts recovering. */
    settleSpeed: 0.8,
  },

  recovery: {
    /** Dazed, not moving. */
    dazedMs: 700,
    /** After that, walking speed ramps from 0 back to normal over this time. */
    rampMs: 900,
  },

  cameraShake: {
    enabled: true,
    durationMs: 160,
    /** Max offset in world units. */
    intensity: 0.12,
  },

  /** Clamp per-frame delta time (s) so stalls/tab switches don't teleport anything. */
  maxDt: 0.1,
} as const;

export type CombatConfig = typeof COMBAT_CONFIG;
