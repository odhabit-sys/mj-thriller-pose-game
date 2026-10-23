/** Gameplay-loop timing. Pose recognition thresholds live in pose/poseConfig.ts (locked). */
export const GAME_CONFIG = {
  /** "POSE HIT!" is shown this long after a confirmation. */
  hitDisplayMs: 400,
  /** The next pose is shown this long before input counts ("NEXT POSE"). */
  transitionMs: 350,
  /** Body missing for longer than this pauses the game ("Move into frame"). */
  trackingLostGraceMs: 300,
  /** Frame gaps longer than this (stalls, tab switches) don't advance the game clock. */
  maxFrameDtMs: 250,
} as const;

export type GameConfig = typeof GAME_CONFIG;
