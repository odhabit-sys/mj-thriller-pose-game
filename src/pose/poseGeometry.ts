import type { Point2, TrackedLandmark } from "./poseTypes";

const RAD_TO_DEG = 180 / Math.PI;

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Distance between two points divided by a body scale (e.g. torso length). */
export function normalizedDistance(a: Point2, b: Point2, scale: number): number {
  return scale > 0 ? distance(a, b) / scale : 0;
}

/**
 * Angle at joint `b` formed by a–b–c, in degrees (0..180).
 * 180 = the three points are in a straight line (e.g. a straight arm).
 */
export function jointAngle(a: Point2, b: Point2, c: Point2): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const len = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (len === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / len));
  return Math.acos(cos) * RAD_TO_DEG;
}

/**
 * Direction of the vector from → to, in degrees, in standard math orientation
 * (0 = +x, 90 = UP on screen). Image y points down, so y is flipped here.
 */
export function angleBetweenPoints(from: Point2, to: Point2): number {
  return Math.atan2(from.y - to.y, to.x - from.x) * RAD_TO_DEG;
}

/**
 * Direction of from → to relative to the BODY, in degrees:
 * 0 = straight outward (away from the midline), 90 = up, −90 = down,
 * ±180 = across the body. `outwardSign` is +1 if outward is +x in the raw
 * image, −1 otherwise, so one rule works for either arm.
 */
export function outwardAngle(from: Point2, to: Point2, outwardSign: number): number {
  return Math.atan2(from.y - to.y, (to.x - from.x) * outwardSign) * RAD_TO_DEG;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function isLandmarkReliable(lm: TrackedLandmark | undefined, minConfidence: number): lm is TrackedLandmark {
  return !!lm && lm.inFrame && lm.confidence >= minConfidence;
}

/**
 * Body scale ≈ torso length (mid-shoulder → mid-hip), used to normalize
 * distances so detection doesn't depend on how far the player stands.
 * Falls back to shoulder width when hips are not visible (e.g. sitting close).
 */
export function bodyScale(
  leftShoulder: TrackedLandmark,
  rightShoulder: TrackedLandmark,
  leftHip: TrackedLandmark | undefined,
  rightHip: TrackedLandmark | undefined,
  minConfidence: number,
  shoulderToTorsoRatio: number,
): number {
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const fromShoulders = shoulderWidth / shoulderToTorsoRatio;
  if (isLandmarkReliable(leftHip, minConfidence) && isLandmarkReliable(rightHip, minConfidence)) {
    const torso = distance(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
    // Shoulder width shrinks when turned sideways, torso length shrinks when leaning;
    // the larger of the two is the more trustworthy estimate.
    return Math.max(torso, fromShoulders * 0.75);
  }
  return fromShoulders;
}
