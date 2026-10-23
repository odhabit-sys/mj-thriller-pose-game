import type { PoseFrame, TrackedLandmark } from "../pose/poseTypes";
import type { TrackingStatus } from "../ui/hud";

/** One processed detection frame, handed from the camera/detector loop to the active mode. */
export interface FrameContext {
  frame: PoseFrame;
  landmarks: TrackedLandmark[] | null;
  now: number;
  tracking: TrackingStatus;
  fps: number;
  delegate: string;
}

/** Game mode (default) or debug mode (?debug=true). Both consume the same frames. */
export interface AppMode {
  /** Camera and model are ready; frames will start arriving. */
  start(now: number): void;
  onFrame(ctx: FrameContext): void;
}
