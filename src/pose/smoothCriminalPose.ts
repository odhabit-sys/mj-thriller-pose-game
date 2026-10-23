import { analyzeBody } from "./bodyFrame";
import { checkCondition } from "./poseConditions";
import { SMOOTH_CRIMINAL_CONFIG as C } from "./poseConfig";
import { isLandmarkReliable, midpoint } from "./poseGeometry";
import {
  LM,
  type ArmMetrics,
  type ConditionResult,
  type Point2,
  type PoseClassifier,
  type PoseEvaluation,
  type PoseFrame,
  type Side,
  type TrackedLandmark,
} from "./poseTypes";

/**
 * SMOOTH CRIMINAL LEAN: the whole body leaning sideways as one unit, arms hanging.
 *
 * The identity of the pose is the BODY LINE, not the arms:
 *   - TORSO lean (hip center → shoulder center) of at least `minTorsoLean` degrees, either way;
 *   - the LEGS lean the same way when visible (ankles, or knees when the feet are out of frame),
 *     so a bend at the waist alone doesn't count;
 *   - the body stays roughly straight (torso vs legs differ by at most `maxBend`).
 * Arms only rule out other poses: every reliably tracked arm must hang down; one arm may be
 * hidden (side-on, the far arm is often lost) as long as MediaPipe's estimate isn't raised.
 *
 * Hips must be visible: without them a dropped shoulder or head tilt looks like a lean.
 * Feet are optional. Leaning left or right, mirrored or not, are all the same (absolute angles,
 * the legs checked in the torso's direction).
 */
export const smoothCriminalPose: PoseClassifier = {
  id: "SMOOTH_CRIMINAL",
  name: "Smooth Criminal lean",
  description: "Lean your whole body to one side, straight like a plank, arms hanging down.",
  primaryRole: "hang",
  evaluate,
};

const DEG = 180 / Math.PI;
/** Signed lean of the line from `low` up to `high` (deg, + = top shifted toward raw +x). */
const leanOf = (low: Point2, high: Point2) => Math.atan2(high.x - low.x, low.y - high.y) * DEG;

interface Legs {
  /** Leg lean (hip center vs ankle or knee center), signed like the torso. */
  lean: number;
  from: "ankles" | "knees";
}

function measureLegs(lms: TrackedLandmark[], hipMid: Point2, minVis: number): Legs | null {
  const pair = (a: number, b: number) =>
    isLandmarkReliable(lms[a], minVis) && isLandmarkReliable(lms[b], minVis) && lms[a]!.inFrame && lms[b]!.inFrame
      ? midpoint(lms[a]!, lms[b]!)
      : null;
  const ankles = pair(LM.leftAnkle, LM.rightAnkle);
  if (ankles) return { lean: leanOf(ankles, hipMid), from: "ankles" };
  const knees = pair(LM.leftKnee, LM.rightKnee);
  if (knees) return { lean: leanOf(knees, hipMid), from: "knees" };
  return null;
}

function evaluate(frame: PoseFrame): PoseEvaluation {
  const base = { poseId: smoothCriminalPose.id, roles: { hang: null }, zones: [] };
  const analysis = analyzeBody(frame);
  if (!analysis.ok) {
    return { ...base, matched: false, stillInPose: false, feedback: analysis.feedback, conditions: [], body: null };
  }
  const body = analysis.body;
  if (body.hipsEstimated) {
    return {
      ...base,
      matched: false,
      stillInPose: false,
      feedback: "Step back so your hips are in view",
      conditions: [],
      body,
      notes: ["SMOOTH CRIMINAL: hips not visible. The lean is measured hips → shoulders, so the hips must be in view."],
    };
  }

  const torso = leanOf(body.hipMid, body.shoulderMid);
  const dir = Math.sign(torso) || 1;
  const legs = measureLegs(frame.landmarks!, body.hipMid, C.minVisibility);
  const legLean = legs ? legs.lean * dir : null; // + = legs lean the same way as the torso
  const bend = legLean === null ? null : Math.abs(torso) - legLean;

  // ---- Arms: each tracked arm hangs; at most one hidden, and its estimate isn't raised ----
  const arms = (["left", "right"] as const).map((s) => ({ side: s, arm: body.arms[s] }));
  const visible = arms.filter((a) => a.arm?.reliable);
  const hidden = arms.filter((a) => !a.arm?.reliable);
  const cropped = arms.some((a) => !a.arm || a.arm.cropped);

  const conditions: ConditionResult[] = [];
  for (const { side, arm } of visible) armConditions(side, arm!).forEach((c) => conditions.push(c));
  for (const { side, arm } of hidden) {
    if (!arm) continue;
    conditions.push(
      checkCondition({
        id: `${side[0]!.toUpperCase()}.hiddenArmDown`,
        role: "hang",
        label: `${side} arm (hidden): not raised`,
        value: Number.isFinite(arm.wristVsShoulder) ? arm.wristVsShoulder : Infinity,
        max: C.hiddenArmMaxWristVsShoulder,
        slack: C.slack.distance,
        tooHigh: "Let your arms hang down by your sides",
      }),
    );
  }
  const lean = checkCondition({
    id: "body.lean",
    role: "hang",
    label: "body lean (torso, either side)",
    value: Math.abs(torso),
    min: C.minTorsoLean,
    slack: C.slack.lean,
    unit: "°",
    tooLow: Math.abs(torso) < C.almostLean ? "Lean your whole body to the left or right" : "Lean a little farther",
  });
  conditions.push(lean);
  if (legLean !== null) {
    conditions.push(
      checkCondition({
        id: "body.legsLean",
        role: "hang",
        label: `legs lean with the body (${legs!.from})`,
        value: legLean,
        min: C.minLegLean,
        slack: C.slack.legs,
        unit: "°",
        tooLow: "Don't bend at the waist: shift your hips the same way",
      }),
      checkCondition({
        id: "body.straight",
        role: "hang",
        label: "body straight (torso vs legs)",
        value: bend!,
        max: C.maxBend,
        slack: C.slack.bend,
        unit: "°",
        tooHigh: "Keep your body straight",
      }),
    );
  }

  const blocker =
    visible.length === 0
      ? cropped
        ? "Step back so both arms are in view"
        : "Keep at least one arm in view"
      : cropped && hidden.length > 0
        ? "Step back so both arms are in view"
        : null;
  const matched = !blocker && conditions.every((c) => c.pass);
  const stillInPose = !blocker && conditions.every((c) => c.loosePass);
  const firstFail = conditions.find((c) => !c.pass);
  // Coaching order: body line first (the identity of the pose), then the arms.
  const bodyFail = conditions.find((c) => !c.pass && c.id.startsWith("body."));
  const feedback = blocker ?? (matched ? "GOOD — HOLD IT" : (bodyFail ?? firstFail)?.message ?? "Match the pose");

  const pass = (ok: boolean) => (ok ? "PASS" : "FAIL");
  const armLine = visible.length
    ? visible
        .map(({ side, arm }) => `${side} ${pass(armConditions(side, arm!).every((c) => c.pass))} (wrist ${arm!.wristVsShoulder.toFixed(2)} vs shoulder, dir ${arm!.armDirection.toFixed(0)}°)`)
        .join(", ")
    : "NONE TRACKED";
  const hiddenLine = hidden.length
    ? hidden
        .map(({ side, arm }) =>
          !arm
            ? `${side} missing`
            : `${side} ${conditions.find((c) => c.id === `${side[0]!.toUpperCase()}.hiddenArmDown`)?.pass ? "ACCEPTABLE" : "RAISED (blocks)"} (est. wrist ${arm.wristVsShoulder.toFixed(2)})`,
        )
        .join(", ")
    : "none (both arms tracked)";
  const zone = Math.abs(torso) < C.almostLean ? "standing" : Math.abs(torso) < C.minTorsoLean ? "ALMOST" : "lean OK";

  return {
    ...base,
    roles: { hang: visible[0]?.side ?? null },
    matched,
    stillInPose,
    feedback,
    conditions,
    body,
    notes: [
      `BODY LEAN: ${Math.abs(torso).toFixed(1)}° ${torso === 0 ? "" : torso > 0 ? "(toward screen right)" : "(toward screen left)"}   required ≥ ${C.minTorsoLean}°  [${zone}; <${C.almostLean}° = standing]`,
      legLean === null
        ? "BODY STRAIGHTNESS: legs not visible: torso only (feet optional)"
        : `BODY STRAIGHTNESS: legs ${legLean.toFixed(1)}° with the lean (need ≥ ${C.minLegLean}°), bend ${bend!.toFixed(1)}° (need ≤ ${C.maxBend}°)  ${pass(conditions.filter((c) => c.id === "body.legsLean" || c.id === "body.straight").every((c) => c.pass))}`,
      `VISIBLE ARM: ${armLine}`,
      `HIDDEN ARM: ${hiddenLine}`,
      `FEET / ANKLES: ${legs?.from === "ankles" ? "visible" : legs?.from === "knees" ? "not visible (using knees)" : "not visible (optional)"}`,
      `RESULT: ${blocker ?? (matched ? "MATCH, hold it" : (bodyFail ?? firstFail)?.message ?? "—")}`,
    ],
  };
}

function armConditions(side: Side, arm: ArmMetrics): ConditionResult[] {
  const id = (k: string) => `${side[0]!.toUpperCase()}.${k}`;
  return [
    checkCondition({
      id: id("wristVsShoulder"),
      role: "hang",
      label: `${side} wrist below shoulder`,
      value: arm.wristVsShoulder,
      max: C.maxWristVsShoulder,
      slack: C.slack.distance,
      tooHigh: "Let your arms hang down by your sides",
    }),
    checkCondition({
      id: id("direction"),
      role: "hang",
      label: `${side} arm points down`,
      value: arm.armDirection,
      min: C.armDirectionMin,
      max: C.armDirectionMax,
      slack: C.slack.angle,
      unit: "°",
      tooLow: "Let your arms hang down by your sides",
      tooHigh: "Let your arms hang down by your sides",
    }),
  ];
}

