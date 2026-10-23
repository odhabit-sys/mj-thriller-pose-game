import { GAME_CONFIG } from "../game/gameConfig";
import { GameController, type GameSnapshot } from "../game/gameController";
import { emitGameState, emitPoseConfirmed } from "../game/gameEvents";
import { PLAYABLE_POSES } from "../game/poseRegistry";
import { analyzeBody } from "../pose/bodyFrame";
import type { PoseEvaluation, PoseState } from "../pose/poseTypes";
import { restartSession } from "../survival/survivalEvents";
import type { SurvivalGame } from "../survival/survivalGame";
import type { SkeletonOverlay } from "../ui/debugOverlay";
import type { GameHud } from "../ui/gameHud";
import type { Hud } from "../ui/hud";
import type { SurvivalHud } from "../ui/survivalHud";
import type { AppMode, FrameContext } from "./appMode";

/**
 * GAME MODE (default): webcam input → pose prompts → POSE_CONFIRMED.
 *
 * The pose-prompt controller (locked) runs unchanged. The survival game decides
 * when pose input may affect the world: outside PLAYING the controller still
 * sees the body (so tracking-loss pause keeps working) but can't match.
 */
export class GameMode implements AppMode {
  private readonly controller: GameController;
  private lastRunning: boolean | null = null;
  private cameraReady = false;
  private poseLoopStarted = false;

  constructor(
    private readonly hud: Hud,
    private readonly overlay: SkeletonOverlay,
    private readonly gameHud: GameHud,
    private readonly survival: SurvivalGame,
    private readonly survivalHud: SurvivalHud,
  ) {
    // Pose prompts get harder with the waves (easy first, the full library later).
    // Only poses with a real MJ reference photo are asked for.
    this.controller = new GameController(PLAYABLE_POSES, Math.random, GAME_CONFIG, () => survival.snapshot().wave);
    this.controller.onPoseConfirmed((e) => {
      console.info(`POSE_CONFIRMED: ${e.poseId}`, e);
      emitPoseConfirmed(window, e);
    });
    document.addEventListener("visibilitychange", () => {
      this.controller.setHidden(document.hidden);
      this.broadcastState(this.controller.snapshot());
    });
    survivalHud.onStart(() => this.startGame());
    survivalHud.onRestart(() => this.restartGame());
    survivalHud.startLoop(() => survival.snapshot());
    this.gameHud.render(this.controller.snapshot(), null);
    this.broadcastState(this.controller.snapshot());
  }

  /** Camera + model ready. The game itself waits for START GAME. */
  start(): void {
    this.cameraReady = true;
    this.survivalHud.setSession({ cameraReady: true, tracking: false });
  }

  onFrame({ frame, landmarks, now, tracking }: FrameContext): void {
    if (!this.poseLoopStarted) {
      // Before START GAME: only check that the body is trackable to enable the button.
      const trackable = analyzeBody(frame).ok;
      this.overlay.draw(landmarks, null, "SEARCHING");
      this.hud.setTracking(tracking);
      this.gameHud.render(this.controller.snapshot(), null);
      this.survivalHud.setSession({ cameraReady: this.cameraReady, tracking: trackable });
      return;
    }

    // Only the CURRENT target's classifier runs. Other poses can't advance the game.
    const target = this.controller.snapshot().target;
    const evaluation = target ? target.classifier.evaluate(frame) : null;
    const snap = this.controller.update({ now, evaluation: this.gateInput(evaluation) });

    this.overlay.draw(landmarks, evaluation, overlayState(snap));
    this.hud.setTracking(tracking);
    this.gameHud.render(snap, evaluation);
    this.broadcastState(snap);
  }

  private startGame(): void {
    if (this.poseLoopStarted) return;
    this.poseLoopStarted = true;
    this.survival.start();
    this.startPoseLoop(performance.now());
  }

  /** RESTART: no reload, camera untouched, fresh run + fresh pose prompt. */
  private restartGame(): void {
    restartSession(this.survival, { start: (now) => this.startPoseLoop(now) }, performance.now());
  }

  private startPoseLoop(now: number): void {
    this.controller.start(now);
    this.controller.setHidden(document.hidden);
    this.lastRunning = null;
    this.broadcastState(this.controller.snapshot());
  }

  /**
   * While not PLAYING (wave break, game over) pose input can't match, but the body
   * is still visible to the controller so tracking loss still pauses everything.
   */
  private gateInput(evaluation: PoseEvaluation | null): PoseEvaluation | null {
    if (!evaluation || this.survival.snapshot().state === "PLAYING") return evaluation;
    return { ...evaluation, matched: false, stillInPose: false };
  }

  /** Tell listeners (survival + arena) when the loop starts, pauses or resumes. */
  private broadcastState(s: GameSnapshot): void {
    const running = s.phase !== "READY" && s.paused === null;
    if (running === this.lastRunning) return;
    this.lastRunning = running;
    emitGameState(window, { running, paused: s.paused, phase: s.phase });
  }
}

function overlayState(s: GameSnapshot): PoseState {
  if (s.phase === "TARGET_CONFIRMED") return "CONFIRMED";
  if (s.phase === "TARGET_MATCHING") return "MATCHING";
  return "SEARCHING";
}
