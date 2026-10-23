import { onGameState, onPoseConfirmed } from "../game/gameEvents";
import type { CombatSystem } from "./combatSystem";

export interface CombatHooks {
  /** Visual reactions (MJ pose, flash, shake). Called once per POSE_CONFIRMED, after the attack starts. */
  onAttack?: (poseId: string) => void;
  onRunningChange?: (running: boolean) => void;
}

/**
 * The ONLY bridge from gameplay to combat: one POSE_CONFIRMED event → one attack.
 * Raw pose matching never reaches this code.
 */
export function bindCombatToGameEvents(target: EventTarget, combat: CombatSystem, hooks: CombatHooks = {}): () => void {
  const offPose = onPoseConfirmed(target, (e) => {
    combat.attack(e.poseId);
    hooks.onAttack?.(e.poseId);
  });
  const offState = onGameState(target, (s) => hooks.onRunningChange?.(s.running));
  return () => {
    offPose();
    offState();
  };
}
