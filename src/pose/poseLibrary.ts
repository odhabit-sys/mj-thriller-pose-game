import { POSE_LIBRARY_CONFIG as C } from "./poseConfig";
import type { PoseClassifier } from "./poseTypes";
import { createRuleClassifier, type ArmRule, type BodyRule } from "./ruleClassifier";

/**
 * The expanded MJ-inspired pose library: nine rule-based poses that join the
 * three hand-written ones (SIDE_POINT, FACE_COVER, DIAGONAL_REACH). Each is
 * recognised from skeletal geometry only (no fingers, face, clothing or props),
 * either arm may take either role (the mirrored pose counts), and legs are
 * checked only when the ankles are visible.
 */

// ---- Reusable rule builders -------------------------------------------------
const direction = (min: number, max: number, tooLow: string, tooHigh: string): ArmRule => ({
  id: "direction",
  label: "arm direction (0 out, 90 up)",
  value: (a) => a.armDirection,
  min,
  max,
  slack: "angle",
  tooLow,
  tooHigh,
});
const elbowMin = (min: number, msg: string): ArmRule => ({
  id: "elbow",
  label: "elbow angle",
  value: (a) => a.elbowAngle,
  min,
  slack: "angle",
  tooLow: msg,
});
const reachMin = (min: number, msg: string): ArmRule => ({
  id: "reach",
  label: "wrist reach outward",
  value: (a) => a.reach,
  min,
  slack: "distance",
  tooLow: msg,
});
const wristAbove = (min: number | undefined, max: number | undefined, tooLow: string, tooHigh = tooLow): ArmRule => ({
  id: "wristVsShoulder",
  label: "wrist above shoulder",
  value: (a) => a.wristVsShoulder,
  min,
  max,
  slack: "distance",
  tooLow,
  tooHigh,
});
const stance = (min: number, msg: string): BodyRule => ({
  id: "stance",
  role: "down",
  label: "ankle spread (legs, if visible)",
  value: (b) => b.legs?.ankleSpread ?? null,
  min,
  slack: "distance",
  tooLow: msg,
});

// ---- Reference poses ----------------------------------------------------------

/**
 * Reference 3: both hands meeting above the head, elbows slightly bent, wide stance.
 * LEAD arm: fully overhead. SUPPORT arm: raised at least to head height, forearm pointing up,
 * converging on the lead hand. (In the reference photo the second arm is partly hidden behind
 * the head, and MediaPipe often places its wrist beside the ear; a player's two raised arms pass
 * either way.) Both role assignments are tried, so the mirrored pose counts.
 */
export const armsOverheadPose: PoseClassifier = createRuleClassifier({
  id: "ARMS_OVERHEAD",
  name: "Arms overhead",
  description: "Raise both arms over your head, hands together, feet wide.",
  roles: ["overhead", "raised"],
  arms: {
    overhead: [
      wristAbove(C.ARMS_OVERHEAD.minWristVsShoulder, undefined, "Raise both hands above your head"),
      {
        id: "elbowUp",
        label: "elbow above shoulder",
        value: (a) => a.elbowVsShoulder,
        min: C.ARMS_OVERHEAD.minElbowVsShoulder,
        slack: "distance",
        tooLow: "Lift your elbows up",
      },
      elbowMin(C.ARMS_OVERHEAD.minElbowAngle, "Open your arms a little"),
    ],
    raised: [
      wristAbove(C.ARMS_OVERHEAD.supportMinWristVsShoulder, undefined, "Raise both hands above your head"),
      {
        id: "elbowUp",
        label: "elbow above shoulder",
        value: (a) => a.elbowVsShoulder,
        min: C.ARMS_OVERHEAD.supportMinElbowVsShoulder,
        slack: "distance",
        tooLow: "Lift your elbows up",
      },
      {
        id: "forearmUp",
        label: "wrist above elbow",
        value: (a) => a.wristVsElbow,
        min: C.ARMS_OVERHEAD.supportMinWristAboveElbow,
        slack: "distance",
        tooLow: "Raise both hands above your head",
      },
    ],
  },
  body: [
    {
      id: "wristGap",
      role: "overhead",
      label: "hands apart",
      value: (b) => b.wristGap,
      max: C.ARMS_OVERHEAD.maxWristGap,
      slack: "distance",
      tooHigh: "Bring your hands together above your head",
    },
    { ...stance(C.ARMS_OVERHEAD.minAnkleSpread, "Spread your feet wide"), role: "overhead" },
  ],
});

/** Reference 1: upright, squared, both fists down and held a little off the hips, elbows only slightly bent. */
export const historyStancePose: PoseClassifier = createRuleClassifier({
  id: "HISTORY_STANCE",
  name: "History stance",
  description: "Stand tall, feet apart, both fists down and held a little away from your hips.",
  roles: ["fist", "fist"],
  arms: {
    fist: [
      wristAbove(undefined, C.HISTORY_STANCE.maxWristVsShoulder, "Bring your fists down by your hips"),
      reachMin(C.HISTORY_STANCE.minReach, "Hold your fists a little away from your body"),
      direction(C.HISTORY_STANCE.directionMin, C.HISTORY_STANCE.directionMax, "Hold your fists out from your body", "Bring your fists down"),
      elbowMin(C.HISTORY_STANCE.minElbowAngle, "Straighten your arms a little"),
    ],
  },
  body: [
    {
      id: "totalReach",
      role: "fist",
      label: "both fists out from the body",
      value: (b, { a, b: o }) => (b.arms[a]?.reach ?? NaN) + (b.arms[o]?.reach ?? NaN),
      min: C.HISTORY_STANCE.minTotalReach,
      slack: "distance",
      tooLow: "Hold your fists a little away from your body",
    },
    {
      id: "upright",
      role: "fist",
      label: "body lean (deg)",
      value: (b) => Math.abs(b.torso.leanDeg),
      max: C.HISTORY_STANCE.maxLean,
      slack: "angle",
      tooHigh: "Stand up straight",
    },
    { ...stance(C.HISTORY_STANCE.minAnkleSpread, "Plant your feet apart"), role: "fist" },
  ],
});

// ---- MJ-inspired poses --------------------------------------------------------

/** Classic sky point: one arm straight up, the other down at the side. */
export const skyPointPose: PoseClassifier = createRuleClassifier({
  id: "SKY_POINT",
  name: "Sky point",
  description: "Point one arm straight up to the sky, other arm down by your side.",
  roles: ["up", "down"],
  arms: {
    up: [
      direction(C.SKY_POINT.upDirectionMin, C.SKY_POINT.upDirectionMax, "Point straight up", "Point straight up"),
      wristAbove(C.SKY_POINT.upMinWristVsShoulder, undefined, "Reach higher"),
      elbowMin(C.SKY_POINT.upMinElbowAngle, "Straighten your raised arm"),
    ],
    down: [
      wristAbove(undefined, C.SKY_POINT.downMaxWristVsShoulder, "Keep your other arm down"),
      direction(C.SKY_POINT.downDirectionMin, C.SKY_POINT.downDirectionMax, "Keep your other arm at your side", "Keep your other arm down"),
      elbowMin(C.SKY_POINT.downMinElbowAngle, "Relax your other arm straight down"),
      reachMin(C.SKY_POINT.downMinReach, "Keep your other arm at your side"),
    ],
  },
  body: [stance(C.SKY_POINT.minAnkleSpread, "Step your feet apart")],
});

/** Double side extension: both arms straight out to the sides. */
export const doubleSidePose: PoseClassifier = createRuleClassifier({
  id: "DOUBLE_SIDE",
  name: "Double side",
  description: "Stretch both arms straight out to the sides.",
  roles: ["wing", "wing"],
  arms: {
    wing: [
      reachMin(C.DOUBLE_SIDE.minReach, "Stretch both arms out to the sides"),
      direction(C.DOUBLE_SIDE.directionMin, C.DOUBLE_SIDE.directionMax, "Raise your arms to shoulder height", "Lower your arms to shoulder height"),
      elbowMin(C.DOUBLE_SIDE.minElbowAngle, "Straighten both arms"),
    ],
  },
});

/** Thriller claw: elbows out at shoulder height, forearms up, hands beside the head. */
export const thrillerClawPose: PoseClassifier = createRuleClassifier({
  id: "THRILLER_CLAW",
  name: "Thriller claw",
  description: "Elbows out at shoulder height, forearms up, hands clawed beside your head.",
  roles: ["claw", "claw"],
  arms: {
    claw: [
      {
        id: "upperArm",
        label: "upper-arm direction",
        value: (a) => a.upperArmAngle,
        min: C.THRILLER_CLAW.upperArmMin,
        max: C.THRILLER_CLAW.upperArmMax,
        slack: "angle",
        tooLow: "Lift your elbows to shoulder height",
        tooHigh: "Lower your elbows to shoulder height",
      },
      {
        id: "elbow",
        label: "elbow angle",
        value: (a) => a.elbowAngle,
        min: C.THRILLER_CLAW.minElbowAngle,
        max: C.THRILLER_CLAW.maxElbowAngle,
        slack: "angle",
        tooLow: "Open your elbows a little",
        tooHigh: "Bend your elbows: forearms up",
      },
      {
        id: "forearmUp",
        label: "wrist above elbow",
        value: (a) => a.wristVsElbow,
        min: C.THRILLER_CLAW.minWristAboveElbow,
        slack: "distance",
        tooLow: "Raise your hands up like claws",
      },
      wristAbove(C.THRILLER_CLAW.minWristVsShoulder, undefined, "Hands up beside your head"),
      reachMin(C.THRILLER_CLAW.minReach, "Keep your elbows out to the sides"),
    ],
  },
  body: [
    {
      id: "wristGap",
      role: "claw",
      label: "hands apart",
      value: (b) => b.wristGap,
      min: C.THRILLER_CLAW.minWristGap,
      slack: "distance",
      tooLow: "Keep your hands apart, beside your head",
    },
  ],
});

/** Wide power stance: one arm diagonally up-out, the other diagonally down-out. */
export const powerStancePose: PoseClassifier = createRuleClassifier({
  id: "POWER_STANCE",
  name: "Power stance",
  description: "Feet wide. One arm diagonally up, the other diagonally down, both straight.",
  roles: ["up", "down"],
  arms: {
    up: [
      direction(C.POWER_STANCE.upDirectionMin, C.POWER_STANCE.upDirectionMax, "Raise one arm diagonally up", "Angle your raised arm out, not straight up"),
      elbowMin(C.POWER_STANCE.minElbowAngle, "Straighten your raised arm"),
      reachMin(C.POWER_STANCE.minReach, "Reach out to the side"),
    ],
    down: [
      direction(C.POWER_STANCE.downDirectionMin, C.POWER_STANCE.downDirectionMax, "Angle your low arm out to the side", "Point your other arm diagonally down"),
      elbowMin(C.POWER_STANCE.minElbowAngle, "Straighten your low arm"),
      reachMin(C.POWER_STANCE.minReach, "Reach your low arm out to the side"),
    ],
  },
  body: [stance(C.POWER_STANCE.minAnkleSpread, "Spread your feet wide")],
});

/** Cross-body: one hand across the chest, the other arm straight out to the side. */
export const crossBodyPose: PoseClassifier = createRuleClassifier({
  id: "CROSS_BODY",
  name: "Cross body",
  description: "One hand across your chest to the other shoulder, the other arm straight out.",
  roles: ["cross", "out"],
  arms: {
    cross: [
      {
        id: "across",
        label: "wrist reach (− = across)",
        value: (a) => a.reach,
        max: C.CROSS_BODY.crossMaxReach,
        slack: "distance",
        tooHigh: "Reach across your chest",
      },
      {
        id: "level",
        label: "wrist level (0 sh, 1 hip)",
        value: (a) => a.wristTorsoLevel,
        min: C.CROSS_BODY.crossLevelMin,
        max: C.CROSS_BODY.crossLevelMax,
        slack: "level",
        tooLow: "Lower that hand to your chest",
        tooHigh: "Bring that hand up to your chest",
      },
      {
        id: "elbow",
        label: "elbow angle",
        value: (a) => a.elbowAngle,
        max: C.CROSS_BODY.crossMaxElbowAngle,
        slack: "angle",
        tooHigh: "Bend the arm across your chest",
      },
    ],
    out: [
      reachMin(C.CROSS_BODY.outMinReach, "Stretch your other arm out to the side"),
      direction(C.CROSS_BODY.outDirectionMin, C.CROSS_BODY.outDirectionMax, "Raise your arm to shoulder height", "Lower your arm to shoulder height"),
      elbowMin(C.CROSS_BODY.outMinElbowAngle, "Straighten your extended arm"),
      {
        id: "wristLevel",
        label: "wrist above elbow",
        value: (a) => a.wristVsElbow,
        max: C.CROSS_BODY.outMaxWristAboveElbow,
        slack: "distance",
        tooHigh: "Keep your extended arm level",
      },
    ],
  },
});

/** Overhead diagonal: one arm high above the head, the other reaching down across the body. */
export const overheadDiagonalPose: PoseClassifier = createRuleClassifier({
  id: "OVERHEAD_DIAGONAL",
  name: "Overhead diagonal",
  description: "One arm high over your head, the other reaching down across your body.",
  roles: ["high", "across"],
  arms: {
    high: [
      wristAbove(C.OVERHEAD_DIAGONAL.highMinWristVsShoulder, undefined, "Raise one arm high over your head"),
      direction(C.OVERHEAD_DIAGONAL.highDirectionMin, C.OVERHEAD_DIAGONAL.highDirectionMax, "Raise that arm higher", "Raise that arm higher"),
      elbowMin(C.OVERHEAD_DIAGONAL.highMinElbowAngle, "Straighten your raised arm"),
    ],
    across: [
      {
        id: "level",
        label: "wrist level (0 sh, 1 hip)",
        value: (a) => a.wristTorsoLevel,
        min: C.OVERHEAD_DIAGONAL.acrossLevelMin,
        max: C.OVERHEAD_DIAGONAL.acrossLevelMax,
        slack: "level",
        tooLow: "Reach your other hand down low",
        tooHigh: "Reach your other hand down low",
      },
      {
        id: "across",
        label: "wrist reach (− = across)",
        value: (a) => a.reach,
        max: C.OVERHEAD_DIAGONAL.acrossMaxReach,
        slack: "distance",
        tooHigh: "Reach down across your body",
      },
      elbowMin(C.OVERHEAD_DIAGONAL.acrossMinElbowAngle, "Straighten your low arm"),
    ],
  },
});
