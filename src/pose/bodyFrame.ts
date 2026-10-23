import { POSE_CONFIG } from "./poseConfig";
import {
  bodyScale,
  clamp,
  distance,
  isLandmarkReliable,
  jointAngle,
  lerp,
  midpoint,
  normalizedDistance,
  outwardAngle,
} from "./poseGeometry";
import {
  ARM_LANDMARKS,
  LM,
  type ArmMetrics,
  type BodyFrame,
  type HeadRegion,
  type LegMetrics,
  type Point2,
  type PoseFrame,
  type Side,
  type TrackedLandmark,
} from "./poseTypes";

/** Nose, inner eyes, mouth corners, ears: averaged into a rough head center. */
const HEAD_LANDMARKS = [0, 2, 5, 9, 10, 7, 8] as const;

export type BodyAnalysis = { ok: true; body: BodyFrame } | { ok: false; feedback: string };

/**
 * Builds the body-relative reference frame (scale, shoulder/hip centers) and
 * measures both arms. Pose-independent; every pose classifier starts here.
 * The original three poses use the upper body only; torso lean, legs and the
 * wrist gap are extra measurements for the newer poses (legs only when visible).
 */
export function analyzeBody(frame: PoseFrame, cfg = POSE_CONFIG): BodyAnalysis {
  const lms = frame.landmarks;
  if (!lms) return { ok: false, feedback: "Move into frame" };

  const ls = lms[LM.leftShoulder];
  const rs = lms[LM.rightShoulder];
  if (!isLandmarkReliable(ls, cfg.minVisibility) || !isLandmarkReliable(rs, cfg.minVisibility)) {
    return { ok: false, feedback: "Move into frame" };
  }
  if (distance(ls, rs) / frame.width > cfg.maxShoulderWidthFraction) {
    return { ok: false, feedback: "Step back" };
  }

  const lh = lms[LM.leftHip];
  const rh = lms[LM.rightHip];
  const scale = bodyScale(ls, rs, lh, rh, cfg.minVisibility, cfg.shoulderToTorsoRatio);
  const shoulderMid = midpoint(ls, rs);
  const hipsVisible = isLandmarkReliable(lh, cfg.minVisibility) && isLandmarkReliable(rh, cfg.minVisibility);
  const hipMid = hipsVisible ? midpoint(lh, rh) : { x: shoulderMid.x, y: shoulderMid.y + scale };

  const head = headRegion(lms, shoulderMid, scale, cfg);
  const partial = { scale, shoulderMid, hipMid, hipsEstimated: !hipsVisible, head };
  const arms = {
    left: measureArm("left", lms, partial),
    right: measureArm("right", lms, partial),
  };
  const lw = lms[LM.leftWrist];
  const rw = lms[LM.rightWrist];
  const shoulderTiltDeg = (Math.atan2(ls.y - rs.y, ls.x - rs.x) * 180) / Math.PI;
  const body: BodyFrame = {
    ...partial,
    arms,
    torso: {
      leanDeg: hipsVisible ? (Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y) * 180) / Math.PI : shoulderTiltDeg,
      leanEstimated: !hipsVisible,
      shoulderTiltDeg,
    },
    legs: hipsVisible ? measureLegs(lms, hipMid, scale, cfg) : null,
    wristGap:
      isLandmarkReliable(lw, cfg.minVisibility) && isLandmarkReliable(rw, cfg.minVisibility)
        ? normalizedDistance(lw, rw, scale)
        : null,
  };
  return { ok: true, body };
}

/** Stance measurements; null unless both ankles are confidently in frame. */
function measureLegs(lms: TrackedLandmark[], hipMid: Point2, scale: number, cfg = POSE_CONFIG): LegMetrics | null {
  const la = lms[LM.leftAnkle];
  const ra = lms[LM.rightAnkle];
  if (!isLandmarkReliable(la, cfg.minVisibility) || !isLandmarkReliable(ra, cfg.minVisibility)) return null;
  const knee = (hip: number, k: number, a: TrackedLandmark) => {
    const h = lms[hip];
    const kn = lms[k];
    return isLandmarkReliable(h, cfg.minVisibility) && isLandmarkReliable(kn, cfg.minVisibility) ? jointAngle(h, kn, a) : null;
  };
  const ankleMid = midpoint(la, ra);
  return {
    ankleSpread: Math.abs(la.x - ra.x) / scale,
    hipOverAnkles: (hipMid.x - ankleMid.x) / scale,
    kneeAngle: { left: knee(LM.leftHip, LM.leftKnee, la), right: knee(LM.rightHip, LM.rightKnee, ra) },
  };
}

/** Rough, forgiving head center. Not face recognition, just "where the head roughly is". */
function headRegion(lms: TrackedLandmark[], shoulderMid: Point2, scale: number, cfg = POSE_CONFIG): HeadRegion {
  const pts = HEAD_LANDMARKS.map((i) => lms[i]).filter(
    (l): l is TrackedLandmark => !!l && l.inFrame && l.confidence >= cfg.headMinVisibility,
  );
  if (pts.length === 0) {
    return { center: { x: shoulderMid.x, y: shoulderMid.y - cfg.headHeightAboveShoulders * scale }, estimated: true };
  }
  const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return { center: { x, y }, estimated: false };
}

function measureArm(
  side: Side,
  lms: TrackedLandmark[],
  body: Pick<BodyFrame, "scale" | "shoulderMid" | "hipMid" | "head">,
  cfg = POSE_CONFIG,
): ArmMetrics | null {
  const idx = ARM_LANDMARKS[side];
  const s = lms[idx.shoulder];
  const e = lms[idx.elbow];
  const w = lms[idx.wrist];
  if (!s || !e || !w) return null;

  const { scale, shoulderMid, hipMid, head } = body;
  // "Outward" = away from the body midline, whichever arm this is.
  const outwardSign = Math.sign(s.x - shoulderMid.x) || 1;

  const torsoHeight = Math.max(1, hipMid.y - shoulderMid.y);
  const wristTorsoLevel = (w.y - shoulderMid.y) / torsoHeight;
  // Torso centerline at the wrist's height (handles a slightly leaning torso).
  const centerX = lerp(shoulderMid.x, hipMid.x, clamp(wristTorsoLevel, 0, 1));

  return {
    side,
    reliable:
      isLandmarkReliable(s, cfg.minVisibility) &&
      isLandmarkReliable(e, cfg.minVisibility) &&
      isLandmarkReliable(w, cfg.minVisibility),
    cropped: !e.inFrame || !w.inFrame,
    elbowAngle: jointAngle(s, e, w),
    upperArmAngle: outwardAngle(s, e, outwardSign),
    forearmAngle: outwardAngle(e, w, outwardSign),
    wristVsShoulder: (s.y - w.y) / scale,
    wristVsElbow: (e.y - w.y) / scale,
    elbowVsShoulder: (s.y - e.y) / scale,
    reach: ((w.x - s.x) * outwardSign) / scale,
    wristFromCenterline: Math.abs(w.x - centerX) / scale,
    wristTorsoLevel,
    wristToHipCenter: normalizedDistance(w, hipMid, scale),
    wristInwardOfElbow: ((e.x - w.x) * outwardSign) / scale,
    armDirection: outwardAngle(s, w, outwardSign),
    wristToHead: normalizedDistance(w, head.center, scale),
    elbowToHead: normalizedDistance(e, head.center, scale),
    upperReliable: isLandmarkReliable(s, cfg.minVisibility) && isLandmarkReliable(e, cfg.minVisibility),
    wristOffBottom: !w.inFrame && w.y > e.y,
    wristToChest: normalizedDistance(
      w,
      { x: lerp(shoulderMid.x, hipMid.x, cfg.chestLevel), y: shoulderMid.y + cfg.chestLevel * torsoHeight },
      scale,
    ),
  };
}
