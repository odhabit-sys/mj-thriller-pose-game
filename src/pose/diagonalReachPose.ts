import { analyzeBody } from "./bodyFrame";
import { checkCondition } from "./poseConditions";
import { DIAGONAL_REACH_CONFIG } from "./poseConfig";
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
 * DIAGONAL_REACH (upper body only)
 *
 *   DIAGONAL arm: up AND out from the shoulder, moderate elbow bend OK, forearm keeps rising.
 *   CHEST arm:    bent, elbow out to the side, wrist near the upper chest / shoulder area.
 *
 * Either arm may take either role; both assignments are tried every frame and
 * the better one is used, so the mirrored version counts automatically.
 * Legs and fingers are never used.
 */
export const diagonalReachPose: PoseClassifier = {
  id: "DIAGONAL_REACH",
  name: "Diagonal reach",
  description: "One arm reaching up and out diagonally, other hand at your chest.",
  primaryRole: "diagonal",
  evaluate,
};

const OTHER: Record<Side, Side> = { left: "right", right: "left" };

interface Assignment {
  diagonal: Side;
  chest: Side;
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
      poseId: diagonalReachPose.id,
      matched: false,
      stillInPose: false,
      feedback: analysis.feedback,
      roles: { diagonal: null, chest: null },
      conditions: [],
      body: null,
      zones: [],
    };
  }
  const body = analysis.body;

  const options = (["left", "right"] as const).map((d) => evaluateAssignment(d, OTHER[d], body));
  const best = pickBest(options, body);

  let feedback: string;
  if (best.blocker) feedback = best.blocker;
  else if (best.matched) feedback = "HOLD...";
  else feedback = best.conditions.find((c) => !c.pass)?.message ?? "Match the pose";

  const groupPass = (prefix: string) =>
    best.conditions.length > 0 && best.conditions.filter((c) => c.id.startsWith(prefix)).every((c) => c.pass);

  return {
    poseId: diagonalReachPose.id,
    matched: best.matched,
    stillInPose: options.some((o) => o.loose),
    feedback,
    roles: { diagonal: best.diagonal, chest: best.chest },
    conditions: best.conditions,
    body,
    zones: [chestZone(best.chest, body)],
    notes: [
      `DIAGONAL arm satisfies UP + OUT: ${groupPass("diag.") ? "YES" : "no"}`,
      `CHEST wrist inside chest region: ${groupPass("chest.level") && groupPass("chest.centerline") ? "YES" : "no"}` +
        `   (wrist ↔ chest center ${body.arms[best.chest]?.wristToChest.toFixed(2) ?? "—"})`,
    ],
  };
}

function evaluateAssignment(diagonal: Side, chest: Side, body: BodyFrame): Assignment {
  const d = body.arms[diagonal];
  const c = body.arms[chest];
  const base = { diagonal, chest, conditions: [], passCount: -1, matched: false, loose: false };

  if (!d || !c || !d.reliable || !c.reliable) {
    const cropped = (d?.cropped ?? true) || (c?.cropped ?? true);
    return { ...base, blocker: cropped ? "Step back so both arms are in view" : "Keep both arms visible" };
  }

  const conditions = [...diagonalArmConditions(d), ...chestArmConditions(c)];
  const passCount = conditions.filter((x) => x.pass).length;
  return {
    diagonal,
    chest,
    conditions,
    blocker: null,
    passCount,
    matched: passCount === conditions.length,
    loose: conditions.every((x) => x.loosePass),
  };
}

/** Feedback-priority order: big silhouette first. */
function diagonalArmConditions(d: ArmMetrics): ConditionResult[] {
  const D = DIAGONAL_REACH_CONFIG.diagonal;
  const S = DIAGONAL_REACH_CONFIG.releaseSlack;
  return [
    checkCondition({
      id: "diag.direction",
      role: "diagonal",
      label: "shoulder→wrist direction",
      value: d.armDirection,
      min: D.directionMin,
      max: D.directionMax,
      slack: S.angle,
      unit: "°",
      tooLow: "Raise your arm diagonally",
      tooHigh: "Angle your arm outward",
    }),
    checkCondition({
      id: "diag.reach",
      role: "diagonal",
      label: "reach outward",
      value: d.reach,
      min: D.minReach,
      slack: S.distance,
      tooLow: "Reach farther outward",
    }),
    checkCondition({
      id: "diag.wristVsShoulder",
      role: "diagonal",
      label: "wrist above shoulder",
      value: d.wristVsShoulder,
      min: D.minWristVsShoulder,
      slack: S.distance,
      tooLow: "Raise your diagonal hand higher",
    }),
    checkCondition({
      id: "diag.elbow",
      role: "diagonal",
      label: "elbow angle",
      value: d.elbowAngle,
      min: D.minElbowAngle,
      slack: S.angle,
      unit: "°",
      tooLow: "Open your diagonal arm a little",
    }),
    checkCondition({
      id: "diag.upperArm",
      role: "diagonal",
      label: "upper-arm direction",
      value: d.upperArmAngle,
      min: D.upperArmAngleMin,
      max: D.upperArmAngleMax,
      slack: S.angle,
      unit: "°",
      tooLow: "Raise your arm diagonally",
      tooHigh: "Angle your arm outward",
    }),
    checkCondition({
      id: "diag.wristVsElbow",
      role: "diagonal",
      label: "wrist above elbow",
      value: d.wristVsElbow,
      min: D.minWristAboveElbow,
      slack: S.distance,
      tooLow: "Raise your diagonal hand higher",
    }),
  ];
}

function chestArmConditions(c: ArmMetrics): ConditionResult[] {
  const C = DIAGONAL_REACH_CONFIG.chest;
  const S = DIAGONAL_REACH_CONFIG.releaseSlack;
  return [
    checkCondition({
      id: "chest.level",
      role: "chest",
      label: "wrist level (0 sh, 1 hip)",
      value: c.wristTorsoLevel,
      min: C.wristTorsoLevelMin,
      max: C.wristTorsoLevelMax,
      slack: S.level,
      tooLow: "Lower your other hand to your chest",
      tooHigh: "Bring your other hand toward your chest",
    }),
    checkCondition({
      id: "chest.centerline",
      role: "chest",
      label: "wrist ↔ torso center",
      value: c.wristFromCenterline,
      max: C.maxWristFromCenterline,
      slack: S.distance,
      tooHigh: "Bring your other hand toward your chest",
    }),
    checkCondition({
      id: "chest.elbow",
      role: "chest",
      label: "elbow angle",
      value: c.elbowAngle,
      max: C.maxElbowAngle,
      slack: S.angle,
      unit: "°",
      tooHigh: "Bend your chest arm",
    }),
    checkCondition({
      id: "chest.inward",
      role: "chest",
      label: "wrist inward of elbow",
      value: c.wristInwardOfElbow,
      min: C.minWristInwardOfElbow,
      slack: S.distance,
      tooLow: "Point your chest-arm elbow outward",
    }),
    checkCondition({
      id: "chest.elbowVsShoulder",
      role: "chest",
      label: "elbow above shoulder",
      value: c.elbowVsShoulder,
      max: C.maxElbowVsShoulder,
      slack: S.distance,
      tooHigh: "Lower your chest-arm elbow",
    }),
  ];
}

function pickBest(options: Assignment[], body: BodyFrame): Assignment {
  const matched = options.find((o) => o.matched);
  if (matched) return matched;
  return [...options].sort((a, b) => {
    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
    // Tie: the higher wrist is the diagonal arm.
    return (body.arms[b.diagonal]?.wristVsShoulder ?? -Infinity) - (body.arms[a.diagonal]?.wristVsShoulder ?? -Infinity);
  })[0]!;
}

/** Approximate chest target for the chest hand, for the debug overlay. */
function chestZone(chestSide: Side, body: BodyFrame): DebugZone {
  const C = DIAGONAL_REACH_CONFIG.chest;
  const { shoulderMid, hipMid, scale } = body;
  const torsoH = hipMid.y - shoulderMid.y;
  const halfW = C.maxWristFromCenterline * scale;
  const top = shoulderMid.y + C.wristTorsoLevelMin * torsoH;
  const bottom = shoulderMid.y + C.wristTorsoLevelMax * torsoH;
  const cx = shoulderMid.x + (hipMid.x - shoulderMid.x) * 0.2;
  return { label: `${chestSide} hand`, role: "chest", x: cx - halfW, y: top, w: halfW * 2, h: bottom - top };
}
