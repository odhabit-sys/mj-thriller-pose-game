import { analyzeBody } from "./bodyFrame";
import { checkCondition } from "./poseConditions";
import { SIDE_POINT_CONFIG } from "./poseConfig";
import type {
  ArmMetrics,
  BodyFrame,
  ConditionResult,
  DebugZone,
  PoseClassifier,
  PoseEvaluation,
  PoseFrame,
  Side,
} from "./poseTypes";

/**
 * SIDE_POINT (upper body only)
 *
 *   EXTENDED arm: out to the side ~shoulder height, mostly straight, wrist dropping a little.
 *   CENTER arm:   bent, elbow down, wrist at the lower-center torso / waist.
 *
 * Either arm may take either role; both assignments are tried every frame and
 * the better one is used, so the mirrored version counts automatically.
 * Legs are never used.
 */
export const sidePointPose: PoseClassifier = {
  id: "SIDE_POINT",
  name: "Side point",
  description: "One arm out to the side at shoulder height, other hand at your waist.",
  primaryRole: "extended",
  evaluate,
};

const OTHER: Record<Side, Side> = { left: "right", right: "left" };

interface Assignment {
  extended: Side;
  center: Side;
  conditions: ConditionResult[];
  /** Set when the arms can't be evaluated (cropped / low confidence). */
  blocker: string | null;
  passCount: number;
  matched: boolean;
  loose: boolean;
}

function evaluate(frame: PoseFrame): PoseEvaluation {
  const analysis = analyzeBody(frame);
  if (!analysis.ok) {
    return {
      poseId: sidePointPose.id,
      matched: false,
      stillInPose: false,
      feedback: analysis.feedback,
      roles: { extended: null, center: null },
      conditions: [],
      body: null,
      zones: [],
    };
  }
  const body = analysis.body;

  const options = (["left", "right"] as const).map((ext) => evaluateAssignment(ext, OTHER[ext], body));
  const best = pickBest(options, body);

  let feedback: string;
  if (best.blocker) feedback = best.blocker;
  else if (best.matched) feedback = "HOLD...";
  else feedback = best.conditions.find((c) => !c.pass)?.message ?? "Match the pose";

  return {
    poseId: sidePointPose.id,
    matched: best.matched,
    // Hysteresis: either assignment still loosely holding counts as "in the pose".
    stillInPose: options.some((o) => o.loose),
    feedback,
    roles: { extended: best.extended, center: best.center },
    conditions: best.conditions,
    body,
    zones: [waistZone(best.center, body)],
  };
}

function evaluateAssignment(extended: Side, center: Side, body: BodyFrame): Assignment {
  const e = body.arms[extended];
  const c = body.arms[center];
  const base = { extended, center, conditions: [], passCount: -1, matched: false, loose: false };

  if (!e || !c || !e.reliable || !c.reliable) {
    const cropped = (e?.cropped ?? true) || (c?.cropped ?? true);
    return { ...base, blocker: cropped ? "Step back so both arms are in view" : "Keep both arms visible" };
  }

  const conditions = sidePointConditions(e, c);
  const passCount = conditions.filter((x) => x.pass).length;
  return {
    extended,
    center,
    conditions,
    blocker: null,
    passCount,
    matched: passCount === conditions.length,
    loose: conditions.every((x) => x.loosePass),
  };
}

/** Listed in feedback-priority order: big silhouette first, fine details last. */
function sidePointConditions(e: ArmMetrics, c: ArmMetrics): ConditionResult[] {
  const X = SIDE_POINT_CONFIG.extended;
  const C = SIDE_POINT_CONFIG.center;
  const S = SIDE_POINT_CONFIG.releaseSlack;
  return [
    checkCondition({
      id: "ext.reach",
      role: "extended",
      label: "wrist reach outward",
      value: e.reach,
      min: X.minReach,
      slack: S.distance,
      tooLow: "Extend your arm farther out to the side",
    }),
    checkCondition({
      id: "ext.upperArm",
      role: "extended",
      label: "upper-arm direction",
      value: e.upperArmAngle,
      min: X.upperArmAngleMin,
      max: X.upperArmAngleMax,
      slack: S.angle,
      unit: "°",
      tooLow: "Raise your arm to shoulder height",
      tooHigh: "Lower your arm to shoulder height",
    }),
    checkCondition({
      id: "ctr.centerline",
      role: "center",
      label: "wrist ↔ torso center",
      value: c.wristFromCenterline,
      max: C.maxWristFromCenterline,
      slack: S.distance,
      tooHigh: "Bring your other hand toward your waist",
    }),
    checkCondition({
      id: "ctr.level",
      role: "center",
      label: "wrist level (0 sh, 1 hip)",
      value: c.wristTorsoLevel,
      min: C.wristTorsoLevelMin,
      max: C.wristTorsoLevelMax,
      slack: S.level,
      tooLow: "Lower your other hand to your waist",
      tooHigh: "Bring your other hand up to your waist",
    }),
    checkCondition({
      id: "ext.elbow",
      role: "extended",
      label: "elbow angle",
      value: e.elbowAngle,
      min: X.minElbowAngle,
      slack: S.angle,
      unit: "°",
      tooLow: "Straighten your extended arm",
    }),
    checkCondition({
      id: "ext.wristVsElbow",
      role: "extended",
      label: "wrist above elbow",
      value: e.wristVsElbow,
      max: X.maxWristAboveElbow,
      slack: S.distance,
      tooHigh: "Lower your wrist slightly",
    }),
    checkCondition({
      id: "ext.wristVsShoulder",
      role: "extended",
      label: "wrist above shoulder",
      value: e.wristVsShoulder,
      min: X.wristVsShoulderMin,
      max: X.wristVsShoulderMax,
      slack: S.distance,
      tooLow: "Raise your arm to shoulder height",
      tooHigh: "Lower your wrist slightly",
    }),
    checkCondition({
      id: "ctr.elbow",
      role: "center",
      label: "elbow angle",
      value: c.elbowAngle,
      max: C.maxElbowAngle,
      slack: S.angle,
      unit: "°",
      tooHigh: "Bend your other arm",
    }),
    checkCondition({
      id: "ctr.elbowDown",
      role: "center",
      label: "elbow above shoulder",
      value: c.elbowVsShoulder,
      max: C.maxElbowVsShoulder,
      slack: S.distance,
      tooHigh: "Point your other elbow down",
    }),
    checkCondition({
      id: "ctr.inward",
      role: "center",
      label: "wrist inward of elbow",
      value: c.wristInwardOfElbow,
      min: C.minWristInwardOfElbow,
      slack: S.distance,
      tooLow: "Bring your other hand toward your waist",
    }),
  ];
}

function pickBest(options: Assignment[], body: BodyFrame): Assignment {
  const matched = options.find((o) => o.matched);
  if (matched) return matched;
  return [...options].sort((a, b) => {
    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
    // Tie: treat the arm reaching farther out as the extended one.
    return (body.arms[b.extended]?.reach ?? 0) - (body.arms[a.extended]?.reach ?? 0);
  })[0]!;
}

/** Approximate waist target for the center hand, for the debug overlay. */
function waistZone(centerSide: Side, body: BodyFrame): DebugZone {
  const C = SIDE_POINT_CONFIG.center;
  const { shoulderMid, hipMid, scale } = body;
  const torsoH = hipMid.y - shoulderMid.y;
  const midLevel = (C.wristTorsoLevelMin + C.wristTorsoLevelMax) / 2;
  const cx = shoulderMid.x + (hipMid.x - shoulderMid.x) * Math.min(1, midLevel);
  const halfW = C.maxWristFromCenterline * scale;
  const top = shoulderMid.y + C.wristTorsoLevelMin * torsoH;
  const bottom = shoulderMid.y + C.wristTorsoLevelMax * torsoH;
  return { label: `${centerSide} hand`, x: cx - halfW, y: top, w: halfW * 2, h: bottom - top };
}
