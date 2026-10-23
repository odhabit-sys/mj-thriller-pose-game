import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { POSE_CONFIG } from "../pose/poseConfig";
import {
  ARM_LANDMARKS,
  LM,
  type ArmRole,
  type PoseEvaluation,
  type PoseState,
  type Side,
  type TrackedLandmark,
} from "../pose/poseTypes";

const KEY_LANDMARKS: readonly number[] = Object.values(LM);

const COLORS = {
  bone: "rgba(255, 255, 255, 0.85)",
  boneFaint: "rgba(255, 255, 255, 0.25)",
  joint: "#00e5ff",
  keyJoint: "#ffffff",
  // Role colors: first role of each pose yellow, second pink.
  extended: "#ffc400",
  center: "#ff4fd8",
  face: "#ffc400",
  low: "#ff4fd8",
  diagonal: "#ffc400",
  chest: "#ff4fd8",
  up: "#ffc400",
  down: "#ff4fd8",
  wing: "#ffc400",
  claw: "#ffc400",
  overhead: "#ffc400",
  raised: "#ffc400",
  fist: "#ffc400",
  hang: "#ffc400",
  cross: "#ff4fd8",
  out: "#ffc400",
  high: "#ffc400",
  across: "#ff4fd8",
  matched: "#00e676",
  zone: "rgba(255, 79, 216, 0.7)",
  zoneFace: "rgba(255, 196, 0, 0.8)",
  hipCenter: "#ff4fd8",
};

/**
 * Draws the skeleton on a canvas sized to the RAW video resolution, using raw
 * (unmirrored) pixel coordinates. The canvas is mirrored together with the
 * <video> by CSS, so the skeleton always lines up with the mirrored image.
 * Never draw text here, because it would appear mirrored. Text goes in the HUD.
 */
export class SkeletonOverlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(landmarks: TrackedLandmark[] | null, evaluation: PoseEvaluation | null, state: PoseState): void {
    this.clear();
    if (!landmarks) return;
    const ctx = this.ctx;
    const unit = Math.max(2, this.canvas.width / 320);
    const minConf = POSE_CONFIG.minVisibility;
    const done = state === "CONFIRMED" || state === "WAITING_FOR_RELEASE";

    // Target zone for the center hand + hip center (estimated or real).
    if (evaluation?.body) {
      ctx.setLineDash([unit * 3, unit * 2]);
      ctx.lineWidth = unit * 0.8;
      for (const z of evaluation.zones) {
        ctx.strokeStyle = z.role === "face" ? COLORS.zoneFace : COLORS.zone;
        if (z.shape === "circle") {
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(z.x, z.y, z.w, z.h);
        }
      }
      ctx.setLineDash([]);
      const hip = evaluation.body.hipMid;
      ctx.strokeStyle = COLORS.hipCenter;
      ctx.lineWidth = unit;
      ctx.beginPath();
      ctx.moveTo(hip.x - unit * 4, hip.y);
      ctx.lineTo(hip.x + unit * 4, hip.y);
      ctx.moveTo(hip.x, hip.y - unit * 4);
      ctx.lineTo(hip.x, hip.y + unit * 4);
      ctx.stroke();
    }

    ctx.lineCap = "round";
    for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!a || !b) continue;
      const good = a.confidence >= minConf && b.confidence >= minConf;
      ctx.strokeStyle = good ? COLORS.bone : COLORS.boneFaint;
      ctx.lineWidth = unit * 1.2;
      line(ctx, a, b);
    }

    // Highlight the arms in their evaluated roles.
    if (evaluation) {
      for (const [role, side] of Object.entries(evaluation.roles) as [ArmRole, Side | null][]) {
        if (!side) continue;
        const idx = ARM_LANDMARKS[side];
        const s = landmarks[idx.shoulder];
        const e = landmarks[idx.elbow];
        const w = landmarks[idx.wrist];
        if (!s || !e || !w) continue;
        ctx.strokeStyle = evaluation.matched || done ? COLORS.matched : COLORS[role];
        ctx.lineWidth = unit * 3;
        line(ctx, s, e);
        line(ctx, e, w);
      }
    }

    landmarks.forEach((lm, i) => {
      if (lm.confidence < minConf) return;
      const key = KEY_LANDMARKS.includes(i);
      ctx.fillStyle = key ? COLORS.keyJoint : COLORS.joint;
      ctx.beginPath();
      ctx.arc(lm.x, lm.y, key ? unit * 2.2 : unit * 1.2, 0, Math.PI * 2);
      ctx.fill();
      if (key) {
        ctx.strokeStyle = COLORS.joint;
        ctx.lineWidth = unit * 0.8;
        ctx.stroke();
      }
    });
  }
}

function line(ctx: CanvasRenderingContext2D, a: TrackedLandmark, b: TrackedLandmark): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
