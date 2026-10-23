import { PoseHoldStateMachine, type HoldSnapshot } from "../pose/poseStateMachine";
import type { PoseEvaluation } from "../pose/poseTypes";
import { GAME_CONFIG, type GameConfig } from "./gameConfig";
import type { PoseDefinition } from "./poseRegistry";
import { difficultyWeights, selectPose, UNIFORM_WEIGHTS } from "./poseSelector";

/**
 * READY ──start()──▶ TARGET_ACTIVE ⇄ TARGET_MATCHING ──hold done──▶ TARGET_CONFIRMED (emits once)
 *                         ▲                                              │ hitDisplayMs
 *                         └──── transitionMs ◀── TRANSITION (new target) ◀┘
 *
 * Pausing (tracking lost / tab hidden) is orthogonal: the game clock stops,
 * hold progress is discarded, and the same target resumes afterwards.
 *
 * Pose detection answers "does the body match X?" (classifiers, locked).
 * This controller answers "which pose should the player be doing?" and turns a
 * held match of THAT pose into exactly one POSE_CONFIRMED event.
 */
export type GamePhase = "READY" | "TARGET_ACTIVE" | "TARGET_MATCHING" | "TARGET_CONFIRMED" | "TRANSITION";
export type PauseReason = "tracking" | "hidden";

export interface PoseConfirmedEvent {
  poseId: string;
  /** performance.now() time of the confirmation. */
  timestamp: number;
  /** Running count of hits (temporary, not the final score). */
  hits: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  target: PoseDefinition | null;
  /** Hold progress 0..1 for the current target. */
  progress: number;
  hits: number;
  paused: PauseReason | null;
}

export interface GameUpdate {
  now: number;
  /**
   * Evaluation of the CURRENT target's classifier this frame (null if none ran).
   * A body-less evaluation (no person / shoulders not visible) counts as tracking loss.
   */
  evaluation: PoseEvaluation | null;
}

export class GameController {
  private phase: GamePhase = "READY";
  private target: PoseDefinition | null = null;
  private hold: PoseHoldStateMachine | null = null;
  private holdSnap: HoldSnapshot = { state: "SEARCHING", progress: 0 };
  private hits = 0;

  /** Game clock: advances only while running (not paused), in ms. */
  private clock = 0;
  private lastNow: number | null = null;
  private phaseStartedAt = 0;
  private lastTrackedAt = 0;
  private hidden = false;
  private paused: PauseReason | null = null;
  private pendingConfirm = false;
  /** Recent target ids (newest last) so prompts don't repeat within a few selections. */
  private recent: string[] = [];

  private readonly listeners = new Set<(e: PoseConfirmedEvent) => void>();

  constructor(
    private readonly poses: readonly PoseDefinition[],
    private readonly random: () => number = Math.random,
    private readonly cfg: GameConfig = GAME_CONFIG,
    /** Current wave (for difficulty). Without it every pose is equally likely. */
    private readonly wave: (() => number) | null = null,
  ) {
    if (poses.length < 2) throw new Error("GameController needs at least 2 poses");
  }

  /** The gameplay event. Later: MJ animation + hee-hee + aura + knockback. */
  onPoseConfirmed(listener: (e: PoseConfirmedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(now: number): void {
    this.hits = 0;
    this.clock = 0;
    this.lastNow = now;
    this.lastTrackedAt = 0;
    this.paused = null;
    this.recent = [];
    this.setTarget(this.pickTarget(null));
    this.enter("TARGET_ACTIVE");
  }

  /** Tab visibility. While hidden nothing progresses and nothing can confirm. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.pause("hidden");
    // Don't count the hidden time as a frame gap on return.
    this.lastNow = null;
  }

  update({ now, evaluation }: GameUpdate): GameSnapshot {
    if (this.phase === "READY") return this.snapshot();

    const dt = this.lastNow === null ? 0 : Math.min(Math.max(0, now - this.lastNow), this.cfg.maxFrameDtMs);
    this.lastNow = now;

    // --- Pause handling (clock frozen while paused) ---
    if (this.hidden) {
      this.pause("hidden");
      return this.snapshot();
    }
    const tracked = !!evaluation?.body;
    if (tracked) this.lastTrackedAt = this.clock + dt;
    const lostFor = this.clock + dt - this.lastTrackedAt;
    if (!tracked && (this.paused === "tracking" || lostFor > this.cfg.trackingLostGraceMs)) {
      this.pause("tracking");
      return this.snapshot();
    }
    if (this.paused) {
      this.paused = null;
      this.lastTrackedAt = this.clock;
    }

    this.clock += dt;
    const inPhase = this.clock - this.phaseStartedAt;

    switch (this.phase) {
      case "TARGET_ACTIVE":
      case "TARGET_MATCHING":
        this.feedHold(evaluation, now);
        break;

      case "TARGET_CONFIRMED":
        if (inPhase >= this.cfg.hitDisplayMs) {
          this.setTarget(this.pickTarget(this.target!.id));
          this.enter("TRANSITION");
        }
        break;

      case "TRANSITION":
        // New target is shown but input doesn't count yet; residual body position can't confirm it.
        if (inPhase >= this.cfg.transitionMs) this.enter("TARGET_ACTIVE");
        break;
    }
    return this.snapshot();
  }

  snapshot(): GameSnapshot {
    const holding = this.phase === "TARGET_ACTIVE" || this.phase === "TARGET_MATCHING";
    return {
      phase: this.phase,
      target: this.target,
      progress: this.phase === "TARGET_CONFIRMED" ? 1 : holding && !this.paused ? this.holdSnap.progress : 0,
      hits: this.hits,
      paused: this.paused,
    };
  }

  private feedHold(evaluation: PoseEvaluation | null, now: number): void {
    const target = this.target!;
    // Only the requested pose counts, even if some other classifier's result is passed in.
    const ev = evaluation && evaluation.poseId === target.classifier.id ? evaluation : null;
    const matched = ev?.matched ?? false;
    const side = ev?.roles[target.classifier.primaryRole] ?? null;

    this.pendingConfirm = false;
    this.holdSnap = this.hold!.update(matched, ev?.stillInPose ?? false, side, this.clock);

    if (this.pendingConfirm) {
      this.hits++;
      this.enter("TARGET_CONFIRMED");
      const event: PoseConfirmedEvent = { poseId: target.id, timestamp: now, hits: this.hits };
      this.listeners.forEach((l) => l(event));
    } else {
      this.phase = this.holdSnap.state === "MATCHING" ? "TARGET_MATCHING" : "TARGET_ACTIVE";
    }
  }

  /** Fresh hold state machine per target: no stale progress or release state carries over. */
  private setTarget(pose: PoseDefinition): void {
    this.target = pose;
    this.hold = new PoseHoldStateMachine(pose.id);
    this.hold.onConfirmed(() => (this.pendingConfirm = true));
    this.holdSnap = { state: "SEARCHING", progress: 0 };
  }

  private pickTarget(previousId: string | null): PoseDefinition {
    if (previousId && this.recent[this.recent.length - 1] !== previousId) this.recent.push(previousId);
    const weights = this.wave ? difficultyWeights(Math.max(1, this.wave())) : UNIFORM_WEIGHTS;
    const pose = selectPose(this.poses, this.recent, weights, this.random);
    this.recent.push(pose.id);
    if (this.recent.length > 8) this.recent.shift();
    return pose;
  }

  private pause(reason: PauseReason): void {
    if (this.paused === reason) return;
    this.paused = reason;
    // Discard partial hold progress so nothing can confirm from before the pause.
    this.hold?.reset();
    this.holdSnap = { state: "SEARCHING", progress: 0 };
    if (this.phase === "TARGET_MATCHING") this.phase = "TARGET_ACTIVE";
  }

  private enter(phase: GamePhase): void {
    this.phase = phase;
    this.phaseStartedAt = this.clock;
  }
}
