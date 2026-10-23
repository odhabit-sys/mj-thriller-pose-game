/**
 * COORDINATE CONVENTION (used everywhere in src/pose):
 *
 *   All landmark math happens in RAW, UNMIRRORED camera image space, in PIXELS
 *   (x: 0..videoWidth left→right of the raw camera frame, y: 0..videoHeight, down).
 *
 *   - Pixels (not MediaPipe's 0..1 normalized coords) so angles are not
 *     distorted by the frame's aspect ratio.
 *   - Unmirrored because that's what MediaPipe sees. Left/right landmark names
 *     are the PLAYER'S anatomical left/right.
 *   - Mirroring is purely visual: the video and skeleton canvas are flipped
 *     together by one CSS transform (see .stage in styles.css). Nothing in the
 *     pose code ever flips x.
 *   - Directions that matter for poses ("outward", "inward") are measured
 *     relative to the body midline, so the same rule works for either arm.
 *
 *   In the mirrored selfie view, the player's left arm appears on the left side
 *   of the screen, exactly as in a mirror.
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface TrackedLandmark extends Point2 {
  /** min(visibility, presence) from MediaPipe, 0..1. */
  confidence: number;
  /** Inside the frame (with POSE_CONFIG.frameMargin). */
  inFrame: boolean;
}

export interface PoseFrame {
  /** 33 BlazePose landmarks in raw pixel space, or null when no person found. */
  landmarks: TrackedLandmark[] | null;
  width: number;
  height: number;
  timestamp: number;
}

export type Side = "left" | "right";

/** MediaPipe BlazePose landmark indices we care about. Legs are optional (used only when visible). */
export const LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export const ARM_LANDMARKS: Record<Side, { shoulder: number; elbow: number; wrist: number }> = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist },
};

/** Pose-independent measurements of one arm, in body units / degrees. */
export interface ArmMetrics {
  side: Side;
  /** Shoulder, elbow and wrist all confidently visible and in frame. */
  reliable: boolean;
  /** Elbow or wrist is outside the frame. */
  cropped: boolean;
  /** Shoulder–elbow–wrist angle. 180 = straight. */
  elbowAngle: number;
  /** Shoulder→elbow direction relative to the body. 0 = straight outward, 90 = up, −90 = down. */
  upperArmAngle: number;
  /** Elbow→wrist direction, same convention. */
  forearmAngle: number;
  /** + = wrist above shoulder. */
  wristVsShoulder: number;
  /** + = wrist above elbow. */
  wristVsElbow: number;
  /** + = elbow above shoulder. */
  elbowVsShoulder: number;
  /** Wrist horizontal distance outward from its own shoulder (− = across the body). */
  reach: number;
  /** Wrist horizontal distance from the torso centerline. */
  wristFromCenterline: number;
  /** Wrist level within the torso: 0 = shoulder line, 1 = hip line. */
  wristTorsoLevel: number;
  /** Straight-line wrist distance to the hip center. */
  wristToHipCenter: number;
  /** + = wrist is closer to the body midline than its elbow. */
  wristInwardOfElbow: number;
  /** Shoulder→wrist direction, same convention as upperArmAngle (−90 = straight down). */
  armDirection: number;
  /** Wrist distance to the rough head center (body units). */
  wristToHead: number;
  /** Elbow distance to the rough head center (body units). */
  elbowToHead: number;
  /** Shoulder and elbow are reliable (wrist may not be). */
  upperReliable: boolean;
  /** Wrist is off the bottom of the frame (e.g. arm hanging while sitting close). */
  wristOffBottom: boolean;
  /** Wrist distance to the rough chest center (body units). */
  wristToChest: number;
}

/** Rough head region from face landmarks, or estimated from the shoulders. */
export interface HeadRegion {
  center: Point2;
  estimated: boolean;
}

/**
 * Legs, measured only when both ankles (and hips) are reliably visible. Many
 * players frame only their upper body; leg conditions are then skipped, never failed.
 */
export interface LegMetrics {
  /** Horizontal distance between the ankles (body units). Shoulder width ≈ 0.8. */
  ankleSpread: number;
  /** Signed horizontal hip-center offset from the ankle center (body units, raw image +x). */
  hipOverAnkles: number;
  /** Knee angles (180 = straight), when the knees are visible. */
  kneeAngle: Record<Side, number | null>;
}

/** Torso orientation. */
export interface TorsoMetrics {
  /**
   * Sideways lean of the whole torso (deg, signed in raw image space: + = shoulders
   * shifted toward +x of the hips). Falls back to the shoulder-line tilt when the
   * hips aren't visible (a sideways lean tilts the shoulder line by about as much).
   */
  leanDeg: number;
  /** True when leanDeg came from the shoulder tilt fallback. */
  leanEstimated: boolean;
  /** Shoulder line tilt from horizontal (deg, signed). */
  shoulderTiltDeg: number;
}

/** Body reference frame shared by all poses. */
export interface BodyFrame {
  scale: number;
  shoulderMid: Point2;
  hipMid: Point2;
  /** Hips weren't reliably visible, so hipMid was estimated from the shoulders. */
  hipsEstimated: boolean;
  head: HeadRegion;
  arms: Record<Side, ArmMetrics | null>;
  torso: TorsoMetrics;
  /** null when the legs aren't reliably visible. */
  legs: LegMetrics | null;
  /** Distance between the two wrists (body units), when both are reliable. */
  wristGap: number | null;
}

/**
 * What each arm is doing in a pose. The original three: SIDE_POINT extended + center,
 * FACE_COVER face + low, DIAGONAL_REACH diagonal + chest. The rest belong to the
 * rule-based poses (see poseLibrary.ts).
 */
export type ArmRole =
  | "extended"
  | "center"
  | "face"
  | "low"
  | "diagonal"
  | "chest"
  | "up"
  | "down"
  | "wing"
  | "claw"
  | "overhead"
  | "raised"
  | "fist"
  | "hang"
  | "cross"
  | "out"
  | "high"
  | "across";

export interface ConditionResult {
  id: string;
  role: ArmRole;
  label: string;
  value: number;
  min?: number;
  max?: number;
  unit: string;
  pass: boolean;
  /** Passes with the release slack applied (hysteresis). */
  loosePass: boolean;
  /** Coaching message when failing, else null. */
  message: string | null;
}

export type DebugZone =
  | { shape?: "rect"; label: string; role?: ArmRole; x: number; y: number; w: number; h: number }
  | { shape: "circle"; label: string; role?: ArmRole; x: number; y: number; r: number };

export interface PoseEvaluation {
  poseId: string;
  /** Strict match this frame. Drives SEARCHING → MATCHING → CONFIRMED. */
  matched: boolean;
  /** Loose match this frame. Drives WAITING_FOR_RELEASE → SEARCHING. */
  stillInPose: boolean;
  /** Player-facing coaching message. */
  feedback: string;
  /** Which arm is being evaluated in which role (null if not evaluated). */
  roles: Partial<Record<ArmRole, Side | null>>;
  /** Conditions for the chosen role assignment, in feedback-priority order. */
  conditions: ConditionResult[];
  body: BodyFrame | null;
  /** Target regions drawn on the debug overlay (raw pixel space). */
  zones: DebugZone[];
  /** Optional pose-specific debug lines. */
  notes?: string[];
}

export interface PoseClassifier {
  id: string;
  name: string;
  description: string;
  /** The role whose side is reported with the confirmation event. */
  primaryRole: ArmRole;
  evaluate(frame: PoseFrame): PoseEvaluation;
}

export type PoseState = "SEARCHING" | "MATCHING" | "CONFIRMED" | "WAITING_FOR_RELEASE";
