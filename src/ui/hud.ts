import { POSE_CONFIG } from "../pose/poseConfig";
import type {
  ArmMetrics,
  ArmRole,
  ConditionResult,
  PoseClassifier,
  PoseEvaluation,
  PoseState,
  Side,
} from "../pose/poseTypes";

const ROLE_LABEL: Record<ArmRole, string> = {
  extended: "EXTENDED",
  center: "CENTER / WAIST",
  face: "FACE",
  low: "LOW",
  diagonal: "DIAGONAL",
  chest: "CHEST",
  up: "UP",
  down: "DOWN",
  wing: "WING",
  claw: "CLAW",
  overhead: "OVERHEAD",
  raised: "RAISED",
  fist: "FIST",
  hang: "HANG",
  cross: "CROSS",
  out: "OUT",
  high: "HIGH",
  across: "ACROSS",
};
const ROLE_SHORT: Record<ArmRole, string> = {
  extended: "EXT",
  center: "CTR",
  face: "FACE",
  low: "LOW",
  diagonal: "DIAG",
  chest: "CHST",
  up: "UP",
  down: "DOWN",
  wing: "WING",
  claw: "CLAW",
  overhead: "OVHD",
  raised: "RAISED",
  fist: "FIST",
  hang: "HANG",
  cross: "CROS",
  out: "OUT",
  high: "HIGH",
  across: "ACRS",
};

export type TrackingStatus = "loading" | "no-person" | "tracking" | "lost";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

/** All DOM text/indicators. Kept outside the mirrored stage so text reads normally. */
export class Hud {
  private readonly intro = el("intro");
  private readonly viewer = el("viewer");
  private readonly errorBox = el("error");
  private readonly errorMessage = el("error-message");
  private readonly status = el("status");
  private readonly trackingChip = el("tracking-chip");
  private readonly stateChip = el("state-chip");
  private readonly countChip = el("count-chip");
  private readonly progressFill = el("progress-fill");
  private readonly banner = el("matched-banner");
  private readonly debug = el("debug");
  private readonly debugText = el("debug-text");
  private readonly targetDesc = el("target-desc");
  private readonly poseSelect = el("pose-select");
  private readonly gamePanel = el("game-panel");
  private bannerUntil = 0;
  private matches = 0;

  readonly enableButton = el<HTMLButtonElement>("enable-camera");
  readonly retryButton = el<HTMLButtonElement>("retry");

  /** debug = ?debug=true mode: show the measurements panel; otherwise show the game panel. */
  constructor(private readonly debugMode: boolean) {}

  private setSessionVisible(visible: boolean): void {
    this.viewer.classList.toggle("hidden", !visible);
    this.debug.classList.toggle("hidden", !visible || !this.debugMode);
    this.gamePanel.classList.toggle("hidden", !visible || this.debugMode);
  }

  /** DEV: renders the pose selector buttons. */
  renderPoseSelector(poses: readonly PoseClassifier[], onSelect: (id: string) => void): void {
    for (const pose of poses) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pose-option";
      b.dataset.poseId = pose.id;
      b.textContent = pose.name.toUpperCase();
      b.addEventListener("click", () => onSelect(pose.id));
      this.poseSelect.append(b);
    }
  }

  setPose(pose: PoseClassifier): void {
    this.targetDesc.textContent = pose.description;
    for (const b of this.poseSelect.querySelectorAll<HTMLButtonElement>(".pose-option")) {
      const active = b.dataset.poseId === pose.id;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    }
    this.matches = 0;
    this.countChip.textContent = "Matches: 0";
    this.bannerUntil = 0;
    this.banner.classList.add("hidden");
  }

  showIntro(): void {
    this.intro.classList.remove("hidden");
    this.setSessionVisible(false);
    this.errorBox.classList.add("hidden");
    this.enableButton.disabled = false;
  }

  showViewer(): void {
    this.intro.classList.add("hidden");
    this.errorBox.classList.add("hidden");
    this.setSessionVisible(true);
  }

  showError(message: string): void {
    this.intro.classList.add("hidden");
    this.setSessionVisible(false);
    this.errorMessage.textContent = message;
    this.errorBox.classList.remove("hidden");
  }

  setLoading(message: string): void {
    this.status.textContent = message;
    this.status.className = "status";
    this.setTracking("loading");
  }

  setTracking(status: TrackingStatus): void {
    const text: Record<TrackingStatus, string> = {
      loading: "Starting…",
      "no-person": "No person",
      tracking: "Tracking",
      lost: "Tracking lost",
    };
    this.trackingChip.textContent = text[status];
    this.trackingChip.dataset.status = status;
  }

  flashMatched(now: number): void {
    this.matches++;
    this.countChip.textContent = `Matches: ${this.matches}`;
    this.bannerUntil = now + POSE_CONFIG.matchedBannerMs;
    this.banner.classList.remove("hidden");
    // restart the CSS animation
    this.banner.style.animation = "none";
    void this.banner.offsetWidth;
    this.banner.style.animation = "";
  }

  update(evaluation: PoseEvaluation, state: PoseState, progress: number, now: number, tracking: TrackingStatus): void {
    this.stateChip.textContent = state;
    this.stateChip.dataset.state = state;
    this.progressFill.style.width = `${Math.round(progress * 100)}%`;
    this.progressFill.dataset.state = state;

    if (now > this.bannerUntil) this.banner.classList.add("hidden");

    let text: string;
    let cls = "";
    if (tracking === "lost") {
      text = "Tracking lost — move into frame";
    } else if (state === "CONFIRMED") {
      text = "POSE MATCHED";
      cls = "matched";
    } else if (state === "WAITING_FOR_RELEASE") {
      text = now < this.bannerUntil ? "POSE MATCHED" : "Leave the pose to go again";
      cls = now < this.bannerUntil ? "matched" : "release";
    } else if (state === "MATCHING") {
      text = `HOLD... ${Math.round(progress * 100)}%`;
      cls = "hold";
    } else {
      text = evaluation.feedback;
      if (evaluation.matched) cls = "hold";
    }
    this.status.textContent = text;
    this.status.className = `status ${cls}`;
  }

  updateDebug(evaluation: PoseEvaluation | null, fps: number, delegate: string, res: string): void {
    const ev = evaluation;
    const roleEntries = Object.entries(ev?.roles ?? {}) as [ArmRole, Side | null][];
    const role = (side: Side) => roleEntries.find(([, s]) => s === side)?.[0];
    const roleLabel = (side: Side) => {
      const r = role(side);
      return r ? ROLE_LABEL[r] : "—";
    };
    const n = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—").padStart(6);
    const arm = (a: ArmMetrics | null) =>
      !a
        ? "  —"
        : [
            `  reliable ${a.reliable ? "yes" : "NO"}${a.cropped ? "  (cropped)" : ""}`,
            `  elbow angle          ${n(a.elbowAngle, 0)}°`,
            `  upper-arm direction  ${n(a.upperArmAngle, 0)}°   (0 out, 90 up, -90 down)`,
            `  forearm direction    ${n(a.forearmAngle, 0)}°`,
            `  wrist vs shoulder    ${n(a.wristVsShoulder)}    (+ above)`,
            `  wrist vs elbow       ${n(a.wristVsElbow)}    (+ above)`,
            `  elbow vs shoulder    ${n(a.elbowVsShoulder)}    (+ above)`,
            `  reach outward        ${n(a.reach)}`,
            `  wrist ↔ torso center ${n(a.wristFromCenterline)}`,
            `  wrist torso level    ${n(a.wristTorsoLevel)}    (0 shoulders, 1 hips)`,
            `  wrist ↔ hip center   ${n(a.wristToHipCenter)}`,
            `  wrist inward of elbow${n(a.wristInwardOfElbow)}`,
            `  shoulder→wrist dir   ${n(a.armDirection, 0)}°   (-90 straight down)`,
            `  wrist ↔ head         ${n(a.wristToHead)}`,
            `  elbow ↔ head         ${n(a.elbowToHead)}`,
            `  wrist ↔ chest center ${n(a.wristToChest)}`,
            `  wrist off bottom     ${a.wristOffBottom ? "YES" : "no"}`,
          ].join("\n");
    const range = (c: ConditionResult) =>
      c.min !== undefined && c.max !== undefined
        ? `${c.min} … ${c.max}`
        : c.min !== undefined
          ? `≥ ${c.min}`
          : `≤ ${c.max}`;
    const cond = (c: ConditionResult) =>
      `  ${c.pass ? "✓" : c.loosePass ? "~" : "✗"} ${ROLE_SHORT[c.role].padEnd(5)}${c.label.padEnd(32)}${n(c.value, c.unit ? 0 : 2)}${c.unit.padEnd(2)} need ${range(c)}`;

    this.debugText.textContent = [
      `pose ${ev?.poseId ?? "—"}   detections/s ${fps.toFixed(1)}   delegate ${delegate}   video ${res}`,
      `matched ${ev?.matched ? "Y" : "n"}   stillInPose ${ev?.stillInPose ? "Y" : "n"}   ` +
        `body scale ${ev?.body ? ev.body.scale.toFixed(0) + " px" : "—"}   hips ${ev?.body ? (ev.body.hipsEstimated ? "ESTIMATED" : "visible") : "—"}` +
        `   head ${ev?.body ? (ev.body.head.estimated ? "ESTIMATED" : "visible") : "—"}`,
      roleEntries.length
        ? roleEntries.map(([r, s]) => `${ROLE_LABEL[r]} arm: ${s?.toUpperCase() ?? "—"}`).join("    ")
        : "roles: —",
      `why: ${ev?.matched ? "all conditions pass" : (ev?.feedback ?? "—")}`,
      ...(ev?.notes ?? []),
      "",
      "Conditions (in coaching order)   ✓ pass  ~ only within release slack  ✗ fail",
      ...(ev?.conditions.length ? ev.conditions.map(cond) : ["  —"]),
      "",
      `LEFT arm (player's left, on screen left): ${roleLabel("left")}`,
      arm(ev?.body?.arms.left ?? null),
      "",
      `RIGHT arm (player's right, on screen right): ${roleLabel("right")}`,
      arm(ev?.body?.arms.right ?? null),
    ].join("\n");
  }
}
