/** One canonical synthetic skeleton per pose (the "reference" body), plus a neutral stance. */
import type { PoseFrame } from "../../src/pose/poseTypes";
import {
  ACROSS_LOW,
  body,
  CHEST_HAND,
  CLAW,
  CROSS,
  DIAG,
  DOWN,
  DOWN_DIAG,
  EXT,
  FACE,
  HIGH,
  HISTORY_FIST_CLOSE,
  HISTORY_FIST_WIDE,
  LOW,
  OUT,
  OVERHEAD,
  UP,
  UP_DIAG,
  WAIST,
  WING,
  type BodyOpts,
} from "./syntheticBody";

export const POSE_REFERENCES: Record<string, (o?: BodyOpts) => PoseFrame> = {
  SIDE_POINT: (o) => body(EXT, WAIST, o),
  FACE_COVER: (o) => body(FACE, LOW, o),
  DIAGONAL_REACH: (o) => body(DIAG, CHEST_HAND, o),
  HISTORY_STANCE: (o) => body(HISTORY_FIST_WIDE, HISTORY_FIST_CLOSE, { legs: 60, ...o }), // the photo, measured
  SMOOTH_CRIMINAL: (o) => body(LOW, LOW, { legs: 30, lean: 15, ...o }),
  ARMS_OVERHEAD: (o) => body(OVERHEAD, OVERHEAD, { legs: 120, ...o }),
  SKY_POINT: (o) => body(LOW, UP, { legs: 70, ...o }),
  DOUBLE_SIDE: (o) => body(WING, WING, o),
  THRILLER_CLAW: (o) => body(CLAW, CLAW, o),
  POWER_STANCE: (o) => body(DOWN_DIAG, UP_DIAG, { legs: 110, ...o }),
  CROSS_BODY: (o) => body(CROSS, OUT, o),
  OVERHEAD_DIAGONAL: (o) => body(ACROSS_LOW, HIGH, o),
};

/** Relaxed standing: arms hanging, feet slightly apart. Must match nothing. */
export const NEUTRAL_STANCE = (o?: BodyOpts) => body(DOWN, DOWN, { legs: 40, ...o });
