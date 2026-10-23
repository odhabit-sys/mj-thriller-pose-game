import type { SurvivalSnapshot } from "../survival/survivalGame";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export interface SessionInfo {
  cameraReady: boolean;
  /** Body currently trackable (enables START GAME). */
  tracking: boolean;
}

/** Functional survival HUD: health / wave / score, banners, start and game-over panels. Not final UI. */
export class SurvivalHud {
  private readonly bar = el("survival-bar");
  private readonly healthFill = el("health-fill");
  private readonly healthText = el("health-text");
  private readonly waveText = el("wave-text");
  private readonly scoreText = el("score-text");
  private readonly bestText = el("best-text");
  private readonly banner = el("survival-banner");
  private readonly startPanel = el("start-panel");
  private readonly startButton = el<HTMLButtonElement>("start-game");
  private readonly startHint = el("start-hint");
  private readonly overPanel = el("gameover-panel");
  private readonly overScore = el("gameover-score");
  private readonly overBest = el("gameover-best");
  private readonly overWave = el("gameover-wave");
  private readonly restartButton = el<HTMLButtonElement>("restart-game");
  private lastHealth = -1;
  private session: SessionInfo = { cameraReady: false, tracking: false };

  /** Redraw every animation frame (independent of webcam detection timing). */
  startLoop(getSnapshot: () => SurvivalSnapshot): void {
    const tick = () => {
      this.render(getSnapshot(), this.session);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  setSession(info: SessionInfo): void {
    this.session = info;
  }

  onStart(cb: () => void): void {
    this.startButton.addEventListener("click", cb);
  }

  onRestart(cb: () => void): void {
    this.restartButton.addEventListener("click", cb);
  }

  render(s: SurvivalSnapshot, session: SessionInfo): void {
    const ready = s.state === "READY";
    this.bar.classList.toggle("hidden", ready);

    // Start panel: after the camera, enabled once the body is trackable.
    this.startPanel.classList.toggle("hidden", !(ready && session.cameraReady));
    this.startButton.disabled = !session.tracking;
    this.startHint.textContent = session.tracking
      ? "Ready when you are."
      : "Step back until your shoulders and arms are in the webcam view.";

    // Stats
    const pct = Math.max(0, Math.min(100, (s.health / s.maxHealth) * 100));
    this.healthFill.style.width = `${pct}%`;
    this.healthFill.dataset.level = pct <= 30 ? "low" : pct <= 60 ? "mid" : "high";
    if (s.health < this.lastHealth) {
      this.bar.classList.remove("hit");
      void this.bar.offsetWidth;
      this.bar.classList.add("hit");
    }
    this.lastHealth = s.health;
    this.healthText.textContent = `${s.health} / ${s.maxHealth}`;
    this.waveText.textContent = `WAVE ${s.wave}`;
    this.scoreText.textContent = `SCORE ${s.score}`;
    this.bestText.textContent = `BEST ${s.best}`;

    // Center banner: pause message wins, then wave banners.
    const text = s.paused ? "MOVE INTO FRAME" : s.banner;
    this.banner.textContent = text ?? "";
    this.banner.classList.toggle("hidden", !text || s.state === "GAME_OVER");
    this.banner.dataset.kind = s.paused ? "paused" : text === "WAVE COMPLETE" ? "complete" : "wave";

    // Game over
    const over = s.state === "GAME_OVER";
    this.overPanel.classList.toggle("hidden", !over);
    if (over) {
      this.overScore.textContent = `SCORE: ${s.score}`;
      this.overBest.textContent = `BEST: ${s.best}`;
      this.overWave.textContent = `WAVE: ${s.wave}`;
    }
  }
}
