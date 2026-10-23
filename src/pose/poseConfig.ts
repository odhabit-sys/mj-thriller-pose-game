/**
 * All tunable numbers live here. Change values, save, and Vite hot-reloads.
 *
 * Units:
 *  - angles are in degrees
 *  - "body units" are distances divided by the body scale (≈ torso length,
 *    see poseGeometry.bodyScale), so they don't depend on camera distance.
 *    Rough guide: shoulder width ≈ 0.8, full arm (shoulder→wrist) ≈ 1.0.
 *  - heights are "+ = above", e.g. wristVsElbow 0.1 = wrist slightly above elbow
 *  - times are in milliseconds
 */

export const DETECTOR_CONFIG = {
  /** Official MediaPipe model. Swap "full" for "lite" (faster, less accurate) or "heavy". */
  modelAssetPath:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  /** WASM runtime, copied from node_modules into public/ by scripts/copy-mediapipe-wasm.mjs. */
  wasmBasePath: `${import.meta.env.BASE_URL}mediapipe/wasm`,
  /** Inference rate. Rendering stays on requestAnimationFrame; detection is throttled to this. */
  targetDetectionsPerSecond: 20,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  /** No person detected for this long → "Tracking lost". */
  trackingLostAfterMs: 600,
} as const;

/** Shared by every pose: tracking quality, body scale, hold/release timing. */
export const POSE_CONFIG = {
  /** min(visibility, presence) a landmark needs to count as reliable. */
  minVisibility: 0.5,
  /** Landmarks within this fraction of the frame edge are treated as cropped. */
  frameMargin: 0.01,
  /** Shoulder width wider than this fraction of the frame → too close, "Step back". */
  maxShoulderWidthFraction: 0.55,
  /**
   * When hips are not visible we estimate torso length from shoulder width
   * (torso ≈ shoulderWidth / ratio) and place the hips straight below the shoulders.
   */
  shoulderToTorsoRatio: 0.8,
  /**
   * Rough head region (used only for "hand near face" checks). Face landmarks
   * need this confidence; a hand over the face lowers it, so it's lenient.
   * If none qualify, the head is placed this far above the shoulder midpoint (body units).
   */
  headMinVisibility: 0.3,
  headHeightAboveShoulders: 0.55,
  /** Rough chest center, as a torso level below the shoulder line (0 = shoulders, 1 = hips). */
  chestLevel: 0.25,

  /** Pose must be held this long to confirm. */
  holdDuration: 400,
  /** Brief tracking jitter shorter than this doesn't reset hold progress. */
  holdGraceMs: 120,
  /** After a confirmation, the pose must be clearly left for this long before re-arming. */
  releaseDuration: 300,

  matchedBannerMs: 1200,
} as const;

export type PoseConfig = typeof POSE_CONFIG;

/**
 * Pose: SIDE_POINT, upper body only. Either arm can take either role (mirrored version counts).
 *   EXTENDED arm: out to the side around shoulder height, mostly straight, wrist dropping a little.
 *   CENTER arm:   bent, elbow down, wrist at the lower-center torso / waist.
 * Forgiving by design. Difficulty will come from the game, not from strict recognition.
 */
export const SIDE_POINT_CONFIG = {
  extended: {
    /** Wrist horizontal distance OUTWARD from its shoulder (body units). Straight out ≈ 0.9–1.1. */
    minReach: 0.5,
    /** Shoulder→elbow direction. 0 = straight out to the side, + = up, − = down. */
    upperArmAngleMin: -40,
    upperArmAngleMax: 35,
    /** Elbow angle, 180 = straight. A slight bend and a dropping forearm are fine. */
    minElbowAngle: 120,
    /** Wrist may be at most this much ABOVE the elbow (it should drop or stay level). */
    maxWristAboveElbow: 0.12,
    /** Wrist height relative to its shoulder. */
    wristVsShoulderMin: -0.75,
    wristVsShoulderMax: 0.35,
  },
  center: {
    /** Elbow must be bent at least this much (angle at most this). Hanging arm ≈ 160–180. */
    maxElbowAngle: 150,
    /** Elbow height relative to shoulder must be at most this (i.e. elbow below the shoulder). */
    maxElbowVsShoulder: -0.1,
    /** Wrist horizontal distance from the torso centerline (body units). Half shoulder width ≈ 0.4. */
    maxWristFromCenterline: 0.45,
    /** Wrist vertical level within the torso: 0 = shoulder line, 1 = hip line. */
    wristTorsoLevelMin: 0.35,
    wristTorsoLevelMax: 1.4,
    /** Wrist must be at least this far INWARD of its elbow (forearm points toward the body). */
    minWristInwardOfElbow: 0.05,
  },
  /**
   * Release hysteresis: after a match, the player counts as "still in the pose"
   * until a condition fails by more than this slack. Prevents wobbles from re-arming.
   */
  releaseSlack: {
    angle: 15,
    distance: 0.15,
    level: 0.2,
  },
} as const;

/**
 * Pose: FACE_COVER, upper body only. Either arm can take either role (mirrored version counts).
 *   FACE arm: strongly bent, wrist up near the face/head, elbow below and away from the face.
 *   LOW arm:  hanging down, mostly straight, wrist well below the shoulder and a little outward.
 * Head tilt, hat, fingers and legs are NOT used.
 */
export const FACE_COVER_CONFIG = {
  face: {
    /** Wrist distance to the rough head center (body units). Head ≈ 0.3–0.4 wide. */
    maxWristToHead: 0.6,
    /** Beyond this the message is "Bring one hand toward your face" instead of "closer". */
    farFromHead: 1.0,
    /** Wrist height vs its shoulder (+ = above). Near the chin is ≈ +0.2…+0.4. */
    minWristVsShoulder: -0.1,
    /** Elbow angle must be at most this (strongly bent). */
    maxElbowAngle: 115,
    /** Wrist must be at least this far above its elbow. */
    minWristAboveElbow: 0.15,
    /** Elbow must stay at least this far from the head center (not up in front of the face). */
    minElbowToHead: 0.3,
  },
  low: {
    /** Wrist height vs shoulder must be at most this (well below the shoulder). Hanging ≈ −0.9…−1.1. */
    maxWristVsShoulder: -0.45,
    /**
     * Shoulder→wrist direction: −90 = straight down, −45 = diagonal out-and-down,
     * 0 = horizontal (SIDE_POINT territory), below −90 = crossing in front of the body.
     */
    directionMin: -115,
    directionMax: -40,
    /** Elbow angle must be at least this (mostly open). */
    minElbowAngle: 135,
    /** Wrist horizontal distance from the torso centerline (not crossing in front of the body). */
    minWristFromCenterline: 0.3,
    /**
     * If the low wrist is off the bottom of the frame (sitting close), judge the
     * arm from shoulder→elbow instead.
     */
    upperArmAngleMin: -120,
    upperArmAngleMax: -40,
    maxElbowVsShoulder: -0.3,
  },
  releaseSlack: {
    angle: 15,
    distance: 0.15,
  },
} as const;

/**
 * Pose: DIAGONAL_REACH, upper body only. Either arm can take either role (mirrored version counts).
 *   DIAGONAL arm: up AND out from the shoulder, moderate elbow bend is fine, forearm keeps rising.
 *   CHEST arm:    bent, elbow out to the side, wrist near the upper chest / shoulder area.
 *
 * Kept disjoint from the locked poses by construction:
 *   - vs SIDE_POINT: diagonal wrist must rise ≥ minWristAboveElbow (0.13) above the elbow;
 *     SIDE_POINT's extended arm allows at most 0.12.
 *   - vs FACE_COVER: chest elbow ≤ 130° while FACE_COVER's low arm needs ≥ 135°, and the
 *     diagonal wrist is above the shoulder where FACE_COVER's low wrist can't be.
 */
export const DIAGONAL_REACH_CONFIG = {
  diagonal: {
    /**
     * Shoulder→wrist direction. 0 = straight out, 90 = straight up. The upward diagonal.
     * The reference photo measures 12–20° in MediaPipe depending on framing, so the floor
     * is 10°; the wrist-height and rising-forearm rules below still keep SIDE_POINT out.
     */
    directionMin: 10,
    directionMax: 75,
    /** Wrist horizontal distance OUTWARD from its shoulder (body units). */
    minReach: 0.3,
    /** Wrist height above its shoulder (body units). The reference photo measures 0.14–0.32. */
    minWristVsShoulder: 0.12,
    /** Elbow angle. 180 = straight; a moderate bend (as in the reference) is fine. */
    minElbowAngle: 100,
    /** Shoulder→elbow direction: upper arm must go out/up, not hang down. */
    upperArmAngleMin: -20,
    upperArmAngleMax: 80,
    /** Forearm must keep rising: wrist at least this far above the elbow. */
    minWristAboveElbow: 0.13,
  },
  chest: {
    /** Wrist level within the torso: 0 = shoulder line, 1 = hip line. Upper chest ≈ 0…0.4. */
    wristTorsoLevelMin: -0.2,
    wristTorsoLevelMax: 0.6,
    /** Wrist horizontal distance from the torso centerline. Own shoulder ≈ 0.4. */
    maxWristFromCenterline: 0.6,
    /** Elbow must be bent (angle at most this). */
    maxElbowAngle: 130,
    /** Wrist at least this far INWARD of its elbow (elbow sits out to the side). */
    minWristInwardOfElbow: 0.0,
    /** Elbow may be at most this far above the shoulder. */
    maxElbowVsShoulder: 0.15,
  },
  releaseSlack: {
    angle: 15,
    distance: 0.15,
    level: 0.2,
  },
} as const;

/**
 * The expanded MJ pose library (rule-based poses, see poseLibrary.ts).
 * Body units as above (torso length = 1, shoulder width ≈ 0.8, arm ≈ 1.0).
 * Directions: armDirection / upperArmAngle 0 = straight out, 90 = up, −90 = down,
 * beyond ±90 = toward/across the body. reach < 0 = wrist inward of its own shoulder
 * (≈ −0.4 is the body midline).
 *
 * Every pose is kept DISJOINT from every other pose by construction (noted per
 * pose) and verified pairwise in tests/poseLibrary.test.ts. Leg conditions apply
 * only when the ankles are visible, so upper-body-only framing never blocks a pose.
 */
export const POSE_LIBRARY_CONFIG = {
  releaseSlack: { angle: 15, distance: 0.15, level: 0.2 },

  /** Reference 3. Both hands together above the head, elbows up, wide stance. */
  ARMS_OVERHEAD: {
    // LEAD arm (fully overhead)
    minWristVsShoulder: 0.6, // wrist above the head (head center ≈ +0.55)
    minElbowVsShoulder: 0.05,
    minElbowAngle: 60,
    // SUPPORT arm (raised to the head and converging; the photo's second arm measures
    // wrist +0.21…+0.29, elbow −0.15…+0.05 vs shoulder when MediaPipe misplaces it)
    supportMinWristVsShoulder: 0.15,
    supportMinElbowVsShoulder: -0.25, // elbow up near shoulder height, not hanging
    supportMinWristAboveElbow: 0.05, // forearm pointing up
    maxWristGap: 0.9, // hands meet or converge (photo 0.17…0.84; vs THRILLER_CLAW ≥ 1.0 apart)
    minAnkleSpread: 0.85,
  },
  /** One arm straight up, other down at the side (vs DIAGONAL_REACH: up arm ≥ 76°, its diagonal ≤ 75°). */
  SKY_POINT: {
    upDirectionMin: 76,
    upDirectionMax: 115,
    upMinElbowAngle: 145,
    upMinWristVsShoulder: 0.75,
    downMaxWristVsShoulder: -0.45,
    downDirectionMin: -135,
    downDirectionMax: -30,
    downMinElbowAngle: 135, // vs DIAGONAL_REACH chest arm ≤ 130°
    downMinReach: -0.05, // not crossing (vs OVERHEAD_DIAGONAL ≤ −0.45)
    minAnkleSpread: 0.5,
  },
  /** Both arms out to the sides (T silhouette). */
  DOUBLE_SIDE: {
    directionMin: -25,
    directionMax: 30,
    minReach: 0.6,
    minElbowAngle: 145,
  },
  /** Thriller claw: elbows out at shoulder height, forearms raised, hands up beside the head. */
  THRILLER_CLAW: {
    upperArmMin: -35,
    upperArmMax: 40,
    minElbowAngle: 40,
    maxElbowAngle: 125, // vs DOUBLE_SIDE ≥ 145°
    minWristAboveElbow: 0.12,
    minWristVsShoulder: 0.25, // above the DIAGONAL_REACH chest band
    minReach: 0.15,
    minWristGap: 1.0, // vs ARMS_OVERHEAD ≤ 0.6
  },
  /** Wide power stance: one arm diagonally up-out, the other diagonally down-out, both straight. */
  POWER_STANCE: {
    upDirectionMin: 22,
    upDirectionMax: 70, // vs SKY_POINT ≥ 76°
    downDirectionMin: -70,
    downDirectionMax: -22,
    minElbowAngle: 140, // vs DIAGONAL_REACH chest arm ≤ 130°
    minReach: 0.4,
    minAnkleSpread: 0.8,
  },
  /**
   * Reference 1, measured with MediaPipe on the actual photo: both arms down and only
   * slightly bent (elbows 158–166°), fists 0.10–0.22 out from the shoulders
   * (0.28–0.34 together), direction −77…−85°, body lean 3–5°.
   * Relaxed hanging arms have the wrists roughly under the shoulders (together ≲ 0.15):
   * the combined fist reach is what separates the stance from plain standing.
   */
  HISTORY_STANCE: {
    maxWristVsShoulder: -0.55,
    minReach: 0.06, // each fist at least a little off the body
    minTotalReach: 0.22, // both fists together clearly held out (photo ≥ 0.28, relaxed ≈ 0.15)
    directionMin: -90,
    directionMax: -48,
    minElbowAngle: 130, // mostly straight; a slight or moderate bend is fine
    maxLean: 8, // vs SMOOTH_CRIMINAL torso lean ≥ 9°
    minAnkleSpread: 0.45,
  },
  /** One arm across the chest, the other straight out to the side. */
  CROSS_BODY: {
    crossMaxReach: -0.5, // wrist past the body midline
    crossLevelMin: -0.25,
    crossLevelMax: 0.3, // chest height (vs SIDE_POINT waist ≥ 0.35)
    crossMaxElbowAngle: 140,
    outDirectionMin: -40,
    outDirectionMax: 15,
    outMinReach: 0.55,
    outMinElbowAngle: 140,
    outMaxWristAboveElbow: 0.1, // vs DIAGONAL_REACH rising wrist ≥ 0.13
  },
  /** One arm high above the head, the other reaching down across the body. */
  OVERHEAD_DIAGONAL: {
    highMinWristVsShoulder: 0.65,
    highDirectionMin: 60,
    highDirectionMax: 140,
    highMinElbowAngle: 110,
    acrossLevelMin: 0.65, // vs DIAGONAL_REACH chest ≤ 0.6
    acrossLevelMax: 1.7,
    acrossMaxReach: -0.45,
    acrossMinElbowAngle: 110,
  },
} as const;

/**
 * Pose: SMOOTH_CRIMINAL (see smoothCriminalPose.ts). A SAFE, recognizable sideways lean of the
 * whole body, not MJ's shoe-assisted 45°. Angles in degrees, measured in the camera image.
 *
 *   torso lean  <  almostLean     → standing ("Lean your whole body to the left or right")
 *   almostLean … minTorsoLean     → ALMOST   ("Lean a little farther")
 *   ≥ minTorsoLean                → lean OK (the rest of the body shape decides)
 *
 * vs HISTORY_STANCE: its torso must stay ≤ 8° upright, so 8…9° is neither.
 */
export const SMOOTH_CRIMINAL_CONFIG = {
  minVisibility: 0.5,
  almostLean: 6,
  minTorsoLean: 9,
  /**
   * Legs (hip center vs ankle center, or knee center when the feet are out of frame) must lean
   * the same way: a sideways bend at the waist alone keeps the legs vertical (≈ 0°) or pushes
   * the hips the other way (< 0°).
   */
  minLegLean: 2.5,
  /** Torso lean minus leg lean: how much the body may fold at the hips and still read as one line. */
  maxBend: 20,
  /** Each tracked arm hangs down: wrist well below the shoulder, pointing down. */
  maxWristVsShoulder: -0.45,
  armDirectionMin: -140,
  armDirectionMax: -40,
  /** A hidden (low-confidence) arm is fine unless MediaPipe's estimate is raised (e.g. hand at the face). */
  hiddenArmMaxWristVsShoulder: -0.3,
  /** Release hysteresis only (re-arming after a confirmation). Kept small so the pose can be left. */
  slack: { lean: 3, legs: 1.5, bend: 5, angle: 15, distance: 0.15 },
} as const;
