import { analyzeBody } from "./bodyFrame";
import { checkCondition } from "./poseConditions";
import { FACE_COVER_CONFIG } from "./poseConfig";
import type {
  ArmMetrics,
  BodyFrame,
  ConditionResult,
  PoseClassifier,
  PoseEvaluation,
  PoseFrame,
  Side,
} from "./poseTypes";

/**
 * FACE_COVER (upper body only)
 *
 *   FACE arm: strongly bent, wrist up near the face/head (hand near face is enough).
 *   LOW arm:  down, mostly straight, wrist well below the shoulder, a little outward.
 *
 * Either arm may take either role; both assignments are tried every frame and
 * the better one is used, so the mirrored version counts automatically.
 * The "head" is a rough, forgiving region (see bodyFrame.headRegion).
 * Legs, head tilt, hat and fingers are never used.
 */
export const faceCoverPose: PoseClassifier = {
  id: "FACE_COVER",
  name: "Face cover",
  description: "One hand up near your face, other arm down and slightly out.",
  primaryRole: "face",
  evaluate,
};

const OTHER: Record<Side, Side> = { left: "right", right: "left" };

interface Assignment {
  face: Side;
  low: Side;
  conditions: ConditionResult[];
  blocker: string | null;
  passCount: number;
  matched: boolean;
  loose: boolean;
}

function evaluate(frame: PoseFrame): PoseEvaluation {
  const analysis = analyzeBody(frame);
  if (!analysis.ok) {
    return {
      poseId: faceCoverPose.id,
      matched: false,
      stillInPose: false,
      feedback: analysis.feedback,
      roles: { face: null, low: null },
      conditions: [],
      body: null,
      zones: [],
    };
  }
  const body = analysis.body;

  const options = (["left", "right"] as const).map((face) => evaluateAssignment(face, OTHER[face], body));
  const best = pickBest(options, body);

  let feedback: string;
  if (best.blocker) feedback = best.blocker;
  else if (best.matched) feedback = "HOLD...";
  else feedback = best.conditions.find((c) => !c.pass)?.message ?? "Match the pose";

  return {
    poseId: faceCoverPose.id,
    matched: best.matched,
    stillInPose: options.some((o) => o.loose),
    feedback,
    roles: { face: best.face, low: best.low },
    conditions: best.conditions,
    body,
    zones: [
      {
        shape: "circle",
        label: "face zone",
        role: "face",
        x: body.head.center.x,
        y: body.head.center.y,
        r: FACE_COVER_CONFIG.face.maxWristToHead * body.scale,
      },
    ],
  };
}

function evaluateAssignment(face: Side, low: Side, body: BodyFrame): Assignment {
  const f = body.arms[face];
  const l = body.arms[low];
  const base = { face, low, conditions: [], passCount: -1, matched: false, loose: false };

  if (!f || !f.reliable) {
    return { ...base, blocker: f?.cropped ? "Step back so your raised hand is in view" : "Keep both arms visible" };
  }
  // The low arm may hang off the bottom of the frame when sitting close; then judge it by the elbow.
  const lowUsable = !!l && (l.reliable || (l.upperReliable && l.wristOffBottom));
  if (!l || !lowUsable) {
    return { ...base, blocker: "Keep both arms visible" };
  }

  const conditions = [...faceArmConditions(f), ...lowArmConditions(l)];
  const passCount = conditions.filter((x) => x.pass).length;
  return {
    face,
    low,
    conditions,
    blocker: null,
    passCount,
    matched: passCount === conditions.length,
    loose: conditions.every((x) => x.loosePass),
  };
}

/** Feedback-priority order: big silhouette first. */
function faceArmConditions(f: ArmMetrics): ConditionResult[] {
  const F = FACE_COVER_CONFIG.face;
  const S = FACE_COVER_CONFIG.releaseSlack;
  return [
    checkCondition({
      id: "face.wristToHead",
      role: "face",
      label: "wrist ↔ head",
      value: f.wristToHead,
      max: F.maxWristToHead,
      slack: S.distance,
      tooHigh: f.wristToHead > F.farFromHead ? "Bring one hand toward your face" : "Raise your hand closer to your face",
    }),
    checkCondition({
      id: "face.wristVsShoulder",
      role: "face",
      label: "wrist above shoulder",
      value: f.wristVsShoulder,
      min: F.minWristVsShoulder,
      slack: S.distance,
      tooLow: "Raise your hand closer to your face",
    }),
    checkCondition({
      id: "face.elbow",
      role: "face",
      label: "elbow angle",
      value: f.elbowAngle,
      max: F.maxElbowAngle,
      slack: S.angle,
      unit: "°",
      tooHigh: "Bend your face arm",
    }),
    checkCondition({
      id: "face.wristVsElbow",
      role: "face",
      label: "wrist above elbow",
      value: f.wristVsElbow,
      min: F.minWristAboveElbow,
      slack: S.distance,
      tooLow: "Raise your hand closer to your face",
    }),
    checkCondition({
      id: "face.elbowToHead",
      role: "face",
      label: "elbow ↔ head",
      value: f.elbowToHead,
      min: F.minElbowToHead,
      slack: S.distance,
      tooLow: "Lower your face-arm elbow",
    }),
  ];
}

function lowArmConditions(l: ArmMetrics): ConditionResult[] {
  const L = FACE_COVER_CONFIG.low;
  const S = FACE_COVER_CONFIG.releaseSlack;

  if (!l.reliable) {
    // Wrist off the bottom of the frame: judge the low arm by shoulder→elbow only.
    return [
      checkCondition({
        id: "low.upperArm",
        role: "low",
        label: "upper-arm dir (wrist off-screen)",
        value: l.upperArmAngle,
        min: L.upperArmAngleMin,
        max: L.upperArmAngleMax,
        slack: S.angle,
        unit: "°",
        tooLow: "Move your low arm slightly outward",
        tooHigh: "Lower your other arm",
      }),
      checkCondition({
        id: "low.elbowVsShoulder",
        role: "low",
        label: "elbow above shoulder",
        value: l.elbowVsShoulder,
        max: L.maxElbowVsShoulder,
        slack: S.distance,
        tooHigh: "Lower your other arm",
      }),
    ];
  }

  return [
    checkCondition({
      id: "low.wristVsShoulder",
      role: "low",
      label: "wrist above shoulder",
      value: l.wristVsShoulder,
      max: L.maxWristVsShoulder,
      slack: S.distance,
      tooHigh: "Lower your other arm",
    }),
    checkCondition({
      id: "low.direction",
      role: "low",
      label: "shoulder→wrist direction",
      value: l.armDirection,
      min: L.directionMin,
      max: L.directionMax,
      slack: S.angle,
      unit: "°",
      tooLow: "Move your low arm slightly outward",
      tooHigh: "Lower your other arm",
    }),
    checkCondition({
      id: "low.elbow",
      role: "low",
      label: "elbow angle",
      value: l.elbowAngle,
      min: L.minElbowAngle,
      slack: S.angle,
      unit: "°",
      tooLow: "Straighten your low arm",
    }),
    checkCondition({
      id: "low.centerline",
      role: "low",
      label: "wrist ↔ torso center",
      value: l.wristFromCenterline,
      min: L.minWristFromCenterline,
      slack: S.distance,
      tooLow: "Move your low arm slightly outward",
    }),
  ];
}

function pickBest(options: Assignment[], body: BodyFrame): Assignment {
  const matched = options.find((o) => o.matched);
  if (matched) return matched;
  return [...options].sort((a, b) => {
    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
    // Tie: the wrist closer to the head is the face arm.
    return (body.arms[a.face]?.wristToHead ?? Infinity) - (body.arms[b.face]?.wristToHead ?? Infinity);
  })[0]!;
}
