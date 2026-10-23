import { POSE_CONFIG, type PoseConfig } from "./poseConfig";
import type { PoseState, Side } from "./poseTypes";

export interface PoseConfirmedEvent {
  poseId: string;
  side: Side | null;
  timestamp: number;
}

export interface HoldSnapshot {
  state: PoseState;
  /** 0..1 hold progress (only meaningful while MATCHING). */
  progress: number;
}

/**
 * SEARCHING ──match──▶ MATCHING ──held holdDuration──▶ CONFIRMED (emits once)
 *     ▲                   │ lost for > holdGraceMs           │ next update
 *     │                   ▼                                  ▼
 *     └──────────────── SEARCHING        WAITING_FOR_RELEASE
 *     ▲                                                      │
 *     └──── pose clearly left (loose check) for releaseDuration
 *
 * Exactly one confirmation per hold; the player must leave the pose to re-arm.
 * Later, the game subscribes to onConfirmed() to trigger MJ's attack.
 */
export class PoseHoldStateMachine {
  private state: PoseState = "SEARCHING";
  private holdStart = 0;
  private lastMatchAt = 0;
  private releaseStart: number | null = null;
  private listeners = new Set<(e: PoseConfirmedEvent) => void>();

  constructor(
    private readonly poseId: string,
    private readonly cfg: PoseConfig = POSE_CONFIG,
  ) {}

  onConfirmed(listener: (e: PoseConfirmedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * @param matched strict pose match this frame
   * @param stillInPose loose match this frame (hysteresis for release)
   */
  update(matched: boolean, stillInPose: boolean, side: Side | null, now: number): HoldSnapshot {
    switch (this.state) {
      case "SEARCHING":
        if (matched) {
          this.state = "MATCHING";
          this.holdStart = now;
          this.lastMatchAt = now;
        }
        break;

      case "MATCHING":
        if (matched) {
          this.lastMatchAt = now;
          if (now - this.holdStart >= this.cfg.holdDuration) {
            this.state = "CONFIRMED";
            const event: PoseConfirmedEvent = { poseId: this.poseId, side, timestamp: now };
            this.listeners.forEach((l) => l(event));
          }
        } else if (now - this.lastMatchAt > this.cfg.holdGraceMs) {
          this.state = "SEARCHING";
        }
        break;

      case "CONFIRMED":
        this.state = "WAITING_FOR_RELEASE";
        this.releaseStart = null;
        break;

      case "WAITING_FOR_RELEASE":
        if (stillInPose) {
          this.releaseStart = null;
        } else {
          this.releaseStart ??= now;
          if (now - this.releaseStart >= this.cfg.releaseDuration) this.state = "SEARCHING";
        }
        break;
    }
    return { state: this.state, progress: this.progress(now) };
  }

  reset(): void {
    this.state = "SEARCHING";
    this.releaseStart = null;
  }

  private progress(now: number): number {
    if (this.state === "MATCHING") return Math.min(1, (now - this.holdStart) / this.cfg.holdDuration);
    if (this.state === "CONFIRMED") return 1;
    return 0;
  }
}
