import { COMBAT_CONFIG } from "../../combat/combatConfig";

/**
 * Thriller-graveyard environment. DECORATIVE ONLY: no collisions, no gameplay
 * coupling. The playable circle (COMBAT_CONFIG.arenaRadius) stays flat and clear.
 */
export const GRAVEYARD_CONFIG = {
  seed: 1983,
  /** Gameplay arena radius (read-only); scenery that could block stays outside this + margin. */
  arenaRadius: COMBAT_CONFIG.arenaRadius,
  /** Blocking scenery stays beyond arenaRadius + clearMargin (knockback clamps zombies at arenaRadius). */
  clearMargin: 0.75,

  ground: { size: 44, segments: 110, outsideRelief: 0.28, insideRelief: 0.015 },
  /** Curved night backdrop (sky, moon, distant hills). */
  backdrop: { radius: 19, height: 12, arcDeg: 230 },
  /** Moon on the backdrop, low behind the gate so it rises into the top of the gameplay frame. */
  moon: { angleDeg: -9, height: -0.35, radius: 1.5 },

  counts: { gravestones: 64, trees: 9, distantTrees: 16, grass: 240, rocks: 80, shards: 34, branches: 16, mushrooms: 26, leaves: 220, paving: 60 },

  fence: { radius: 15.2, fromDeg: -68, toDeg: 68, barSpacing: 0.24, postEvery: 2.6, gateHalfWidthDeg: 5 },

  /** Lighter cold haze: far graves and fence silhouette against moonlit mist. */
  fog: { color: 0x1b2145, near: 16, far: 34 },
  /**
   * Drifting ground mist (patch alphas). The shader scales everything inside the
   * playable circle by insideStrength so zombies, MJ and the attack ring stay clear.
   */
  groundFog: { ringPatches: 16, ringAlpha: 0.9, backPatches: 8, backAlpha: 0.95, insideAlpha: 0.5, insideStrength: 0.22 },
  /** Moon is behind the cemetery: soft shadows stretch toward the camera. */
  moonShadow: { yaw: 0.16, strength: 0.42 },

  palette: {
    sky: 0x070915,
    skyHaze: 0x241f45,
    hills: 0x0c0e1c,
    moon: 0xe9eefb,
    moonHalo: 0x8fa3d8,
    soil: 0x2a2629,
    soilWarm: 0x4d3b34,
    grassDead: 0x5f6a3c,
    grassCold: 0x3d5050,
    stonePatch: 0x4b4d59,
    path: 0x4d403e,
    stone: 0x7d8494,
    stoneDark: 0x575d6d,
    moss: 0x3e5048,
    bark: 0x2a2530,
    silhouette: 0x0e1022,
    iron: 0x1a1a22,
    rock: 0x3f4250,
    leaf: 0x4a3328,
    mushroom: 0xbfd2e6,
    fog: 0x8794c2,
    fogPurple: 0x8f7fb4,
  },
} as const;
