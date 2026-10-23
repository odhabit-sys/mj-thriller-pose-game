import type { PoseFrame, TrackedLandmark } from "../../pose/poseTypes";
import type { MichaelCharacter } from "./michaelCharacter";

/**
 * "What would the webcam see if MJ stood in front of it?" Projects MJ's skeleton
 * (front orthographic view) into a raw, unmirrored camera frame with MediaPipe
 * landmark indices, so the REAL pose classifiers can judge MJ's demonstration.
 * Used by tests and the dev pose gallery to prove that every pose MJ shows the
 * player is recognized as exactly that pose.
 *
 * MJ faces +Z (the camera); his left (+X) appears on the right of the raw image,
 * exactly like a real person facing a webcam.
 */
export function mjPoseFrame(mj: MichaelCharacter, width = 1280, height = 720): PoseFrame {
  const s = mj.skeleton();
  // Fit ~3.1 world units (MJ incl. raised arms) into the frame height.
  const k = (height - 40) / 3.15;
  const base = height - 22;
  const lm: TrackedLandmark[] = Array.from({ length: 33 }, () => ({ x: width / 2, y: height - 5, confidence: 0.05, inFrame: true }));
  const set = (i: number, x: number, y: number) => {
    const px = width / 2 + x * k;
    const py = base - y * k;
    lm[i] = { x: px, y: py, confidence: 0.95, inFrame: px > 13 && px < width - 13 && py > 7 && py < height - 7 };
  };
  const v = (i: number, p: { x: number; y: number }) => set(i, p.x, p.y);

  // Face points around the head center (nose slightly forward/down; eyes, ears, mouth).
  const h = s.head;
  const n = s.nose;
  v(0, n);
  set(2, h.x - 0.035, h.y + 0.04);
  set(5, h.x + 0.035, h.y + 0.04);
  set(7, h.x - 0.11, h.y + 0.01);
  set(8, h.x + 0.11, h.y + 0.01);
  set(9, n.x - 0.03, n.y - 0.07);
  set(10, n.x + 0.03, n.y - 0.07);

  v(11, s.shoulder.left);
  v(12, s.shoulder.right);
  v(13, s.elbow.left);
  v(14, s.elbow.right);
  v(15, s.wrist.left);
  v(16, s.wrist.right);
  v(23, s.hip.left);
  v(24, s.hip.right);
  v(25, s.knee.left);
  v(26, s.knee.right);
  v(27, s.ankle.left);
  v(28, s.ankle.right);
  return { landmarks: lm, width, height, timestamp: 0 };
}
