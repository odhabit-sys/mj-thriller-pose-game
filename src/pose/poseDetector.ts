import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { DETECTOR_CONFIG, POSE_CONFIG } from "./poseConfig";
import type { TrackedLandmark } from "./poseTypes";

/**
 * Thin wrapper around MediaPipe Tasks Vision PoseLandmarker (VIDEO mode, 1 person).
 * Converts results to raw-pixel TrackedLandmarks (see poseTypes.ts for the convention).
 * Frames never leave the browser.
 */
export class PoseDetector {
  private lastTimestamp = -1;

  private constructor(
    private readonly landmarker: PoseLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {}

  static async create(): Promise<PoseDetector> {
    const fileset = await FilesetResolver.forVisionTasks(DETECTOR_CONFIG.wasmBasePath);
    const make = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: DETECTOR_CONFIG.modelAssetPath, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: DETECTOR_CONFIG.minPoseDetectionConfidence,
        minPosePresenceConfidence: DETECTOR_CONFIG.minPosePresenceConfidence,
        minTrackingConfidence: DETECTOR_CONFIG.minTrackingConfidence,
        outputSegmentationMasks: false,
      });
    try {
      return new PoseDetector(await make("GPU"), "GPU");
    } catch (gpuError) {
      console.warn("[pose] GPU delegate failed, falling back to CPU", gpuError);
      return new PoseDetector(await make("CPU"), "CPU");
    }
  }

  /** Synchronous; call at the throttled detection rate, not every animation frame. */
  detect(video: HTMLVideoElement, timestampMs: number): TrackedLandmark[] | null {
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const ts = Math.max(timestampMs, this.lastTimestamp + 1);
    this.lastTimestamp = ts;

    const result = this.landmarker.detectForVideo(video, ts);
    const pose = result.landmarks[0];
    if (!pose || pose.length === 0) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;
    const m = POSE_CONFIG.frameMargin;
    return pose.map((lm) => ({
      x: lm.x * w,
      y: lm.y * h,
      confidence: Math.min(lm.visibility ?? 1, lm.presence ?? 1),
      inFrame: lm.x >= m && lm.x <= 1 - m && lm.y >= m && lm.y <= 1 - m,
    }));
  }

  close(): void {
    this.landmarker.close();
  }
}
