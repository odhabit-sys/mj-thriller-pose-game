import { POSE_REGISTRY, type PoseDefinition } from "../game/poseRegistry";
import { PoseHoldStateMachine } from "../pose/poseStateMachine";
import type { SkeletonOverlay } from "../ui/debugOverlay";
import type { Hud } from "../ui/hud";
import type { AppMode, FrameContext } from "./appMode";

const POSE_STORAGE_KEY = "mj-pose-test:pose";

/**
 * DEBUG MODE (?debug=true): manually pick one pose, see every measurement and
 * failure reason. This is the pose-testing UI from the recognition milestones.
 */
export class DebugMode implements AppMode {
  // One hold/release state machine per pose; only the selected one is updated.
  private readonly holdMachines = new Map(POSE_REGISTRY.map((p) => [p.id, new PoseHoldStateMachine(p.id)]));
  private active: PoseDefinition = POSE_REGISTRY[0]!;

  constructor(
    private readonly hud: Hud,
    private readonly overlay: SkeletonOverlay,
  ) {
    for (const machine of this.holdMachines.values()) {
      machine.onConfirmed((e) => {
        console.info("[debug] pose matched", e);
        this.hud.flashMatched(performance.now());
      });
    }
    hud.renderPoseSelector(
      POSE_REGISTRY.map((p) => p.classifier),
      (id) => this.select(id),
    );
    this.select(readStoredPoseId() ?? this.active.id);
  }

  start(): void {
    this.holdMachines.get(this.active.id)!.reset();
  }

  onFrame({ frame, landmarks, now, tracking, fps, delegate }: FrameContext): void {
    const pose = this.active.classifier;
    const evaluation = pose.evaluate(frame);
    const side = evaluation.roles[pose.primaryRole] ?? null;
    const snap = this.holdMachines.get(this.active.id)!.update(evaluation.matched, evaluation.stillInPose, side, now);

    this.overlay.draw(landmarks, evaluation, snap.state);
    this.hud.setTracking(tracking);
    this.hud.update(evaluation, snap.state, snap.progress, now, tracking);
    this.hud.updateDebug(evaluation, fps, delegate, `${frame.width}×${frame.height}`);
  }

  private select(id: string): void {
    const pose = POSE_REGISTRY.find((p) => p.id === id);
    if (!pose) return;
    this.active = pose;
    this.holdMachines.get(pose.id)!.reset();
    this.hud.setPose(pose.classifier);
    showReference(pose);
    try {
      localStorage.setItem(POSE_STORAGE_KEY, pose.id);
    } catch {
      // storage unavailable, selection just won't persist
    }
  }
}

function readStoredPoseId(): string | null {
  try {
    return localStorage.getItem(POSE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** DEV ONLY reference photo beside the webcam (null in production builds). */
function showReference(pose: PoseDefinition): void {
  const panel = document.getElementById("reference");
  const img = document.getElementById("reference-img") as HTMLImageElement | null;
  if (!panel || !img) return;
  panel.classList.add("hidden");
  if (!pose.referenceImage) return;
  img.onload = () => panel.classList.remove("hidden");
  img.onerror = () => panel.classList.add("hidden");
  img.src = pose.referenceImage;
}
