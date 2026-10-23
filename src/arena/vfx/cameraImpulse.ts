/**
 * Visual camera impulse: a short, decaying offset ADDED to the fixed gameplay
 * camera pose each frame. It never stores or modifies the base transform.
 * Deterministic (no random) so it reads as a "thump", not jitter.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class CameraImpulse {
  private strength = 0;
  private left = 0;
  private duration = 0.12;

  constructor(
    private readonly maxKick = 0.14,
    private readonly enabled = true,
  ) {}

  /** Add a kick (strongest kick within the window wins, plus a little stacking). */
  kick(amount: number, durationMs: number): void {
    if (!this.enabled || amount <= 0) return;
    const active = this.left > 0 ? this.strength * (this.left / this.duration) : 0;
    this.strength = Math.min(this.maxKick, Math.max(active, amount) + Math.min(active, amount) * 0.3);
    this.duration = durationMs / 1000;
    this.left = this.duration;
  }

  update(dt: number): void {
    this.left = Math.max(0, this.left - dt);
  }

  /** Current offset (zero when idle). */
  offset(out: Vec3Like): Vec3Like {
    if (this.left <= 0) {
      out.x = out.y = out.z = 0;
      return out;
    }
    const t = 1 - this.left / this.duration; // 0 → 1
    const env = (1 - t) * (1 - t);
    const s = this.strength * env;
    // Downward thump + small lateral wobble (two fixed frequencies).
    out.x = Math.sin(t * 38) * s * 0.6;
    out.y = -Math.abs(Math.cos(t * 26)) * s;
    out.z = Math.sin(t * 29 + 1.3) * s * 0.35;
    return out;
  }

  get active(): boolean {
    return this.left > 0;
  }

  reset(): void {
    this.left = 0;
    this.strength = 0;
  }
}
