import type { GamePhase, PauseReason, PoseConfirmedEvent } from "./gameController";

/**
 * Browser events between the gameplay controller and the 3D combat layer.
 * The 3D game only LISTENS; it never talks to MediaPipe or the controller.
 *
 *   POSE_CONFIRMED  detail: PoseConfirmedEvent   (exactly one per successful requested pose)
 *   GAME_STATE      detail: GameStateDetail      (sent when running/paused changes)
 */
export const POSE_CONFIRMED_EVENT = "POSE_CONFIRMED";
export const GAME_STATE_EVENT = "GAME_STATE";

export interface GameStateDetail {
  /** True while the pose loop is live (started, tracking OK, tab visible). */
  running: boolean;
  paused: PauseReason | null;
  phase: GamePhase;
}

export function emitPoseConfirmed(target: EventTarget, e: PoseConfirmedEvent): void {
  target.dispatchEvent(new CustomEvent<PoseConfirmedEvent>(POSE_CONFIRMED_EVENT, { detail: e }));
}

export function emitGameState(target: EventTarget, s: GameStateDetail): void {
  target.dispatchEvent(new CustomEvent<GameStateDetail>(GAME_STATE_EVENT, { detail: s }));
}

export function onPoseConfirmed(target: EventTarget, cb: (e: PoseConfirmedEvent) => void): () => void {
  const h = (ev: Event) => cb((ev as CustomEvent<PoseConfirmedEvent>).detail);
  target.addEventListener(POSE_CONFIRMED_EVENT, h);
  return () => target.removeEventListener(POSE_CONFIRMED_EVENT, h);
}

export function onGameState(target: EventTarget, cb: (s: GameStateDetail) => void): () => void {
  const h = (ev: Event) => cb((ev as CustomEvent<GameStateDetail>).detail);
  target.addEventListener(GAME_STATE_EVENT, h);
  return () => target.removeEventListener(GAME_STATE_EVENT, h);
}
