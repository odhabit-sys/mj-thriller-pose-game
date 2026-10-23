import type { GameSnapshot } from "../game/gameController";
import type { PoseDefinition } from "../game/poseRegistry";
import type { PoseEvaluation } from "../pose/poseTypes";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

/** Game-mode panel: the requested pose (big), hold progress, status, temporary hit counter. */
export class GameHud {
  private readonly card = el("game-card");
  private readonly img = el<HTMLImageElement>("game-ref");
  private readonly fallback = el("game-ref-fallback");
  private readonly name = el("game-pose-name");
  private readonly fill = el("game-progress-fill");
  private readonly status = el("game-status");
  private readonly hint = el("game-hint");
  private readonly hits = el("game-hits");
  private shownTargetId: string | null = null;

  render(s: GameSnapshot, evaluation: PoseEvaluation | null): void {
    if (s.target && s.target.id !== this.shownTargetId) this.showTarget(s.target);

    this.fill.style.width = `${Math.round(s.progress * 100)}%`;
    this.fill.dataset.phase = s.phase;
    this.hits.textContent = `POSES HIT: ${s.hits}`;
    this.card.dataset.phase = s.phase;

    let text: string;
    let hint = "";
    if (s.paused === "hidden") {
      text = "PAUSED";
    } else if (s.paused === "tracking") {
      text = evaluation?.feedback === "Step back" ? "Step back" : "Move into frame";
    } else {
      switch (s.phase) {
        case "READY":
          text = "GET READY";
          break;
        case "TARGET_ACTIVE":
          text = "MATCH THE POSE";
          if (evaluation && !evaluation.matched && evaluation.body) hint = evaluation.feedback;
          break;
        case "TARGET_MATCHING":
          text = "HOLD...";
          break;
        case "TARGET_CONFIRMED":
          text = "POSE HIT!";
          break;
        case "TRANSITION":
          text = "NEXT POSE";
          break;
      }
    }
    this.status.textContent = text;
    this.status.dataset.phase = s.paused ? "PAUSED" : s.phase;
    this.hint.textContent = hint;
  }

  private showTarget(pose: PoseDefinition): void {
    this.shownTargetId = pose.id;
    this.name.textContent = pose.displayName;
    this.fallback.textContent = pose.instruction;
    if (pose.referenceImage) {
      this.img.onerror = () => {
        this.img.classList.add("hidden");
        this.fallback.classList.remove("hidden");
      };
      this.img.src = pose.referenceImage;
      this.img.alt = pose.referenceImageAlt;
      this.img.style.objectPosition = pose.referenceImagePosition;
      this.img.style.transform = pose.referenceImageScale === 1 ? "" : `scale(${pose.referenceImageScale})`;
      this.img.classList.remove("hidden");
      this.fallback.classList.add("hidden");
    } else {
      // No image for this pose: the written instruction is the card.
      this.img.removeAttribute("src");
      this.img.classList.add("hidden");
      this.fallback.classList.remove("hidden");
    }
  }
}
