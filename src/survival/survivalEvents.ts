import { onGameState, onPoseConfirmed } from "../game/gameEvents";
import type { SurvivalGame } from "./survivalGame";

export interface SurvivalHooks {
  /** Visual reaction (MJ pose, flash, shake). Only called when the attack actually happened. */
  onAttack?: (poseId: string) => void;
}

/**
 * Bridge from gameplay events to the survival game:
 *   POSE_CONFIRMED → one aura attack (only while PLAYING and running)
 *   GAME_STATE     → pause/resume on tracking loss or hidden tab
 */
export function bindSurvivalToGameEvents(target: EventTarget, survival: SurvivalGame, hooks: SurvivalHooks = {}): () => void {
  const offPose = onPoseConfirmed(target, (e) => {
    if (survival.handlePoseConfirmed(e.poseId)) hooks.onAttack?.(e.poseId);
  });
  const offState = onGameState(target, (s) => survival.setRunning(s.running));
  return () => {
    offPose();
    offState();
  };
}

/** Anything with a start(now) — the pose-prompt controller. */
export interface PoseLoop {
  start(now: number): void;
}

/**
 * RESTART without reloading: resets the survival run and starts a fresh pose
 * prompt. Deliberately takes no camera: the webcam stream keeps running and
 * permission is never requested again.
 */
export function restartSession(survival: SurvivalGame, poseLoop: PoseLoop, now: number): void {
  survival.restart();
  poseLoop.start(now);
}
