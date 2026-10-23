import { isAlive } from "../combat/combatSystem";
import { onGameState, onPoseConfirmed } from "../game/gameEvents";
import type { SurvivalGame } from "../survival/survivalGame";
import { AUDIO_CONFIG, type SoundId } from "./audioConfig";
import type { AudioSink } from "./audioSink";

interface ActiveVoice {
  handle: number;
  kind: SoundId;
  endsAt: number;
  zombieId?: number;
}

/**
 * Decides WHEN sounds play. Listens only to existing gameplay events (it never
 * changes pose recognition, combat or the survival rules):
 *
 *   attack actually started (POSE_CONFIRMED that produced a new attack) → hee-hee + aura, music duck
 *   survival "damage"   (a zombie strike that cost health)                → player hit (capped)
 *   survival "gameOver" (fires once per run)                              → music fade, groans stop
 *   survival "restart" / "waveStart"                                      → clean reset, one music loop
 *   GAME_STATE running=false / tab hidden                                 → everything suspended
 *   tick()                                                                → occasional groans from living zombies
 */
export class GameAudio {
  private voices: ActiveVoice[] = [];
  private readonly offs: (() => void)[] = [];
  private lastAttackId = 0;
  private lastHitAt = -Infinity;
  private hitVariation = 0;
  private nextGroanAt = 0;
  private lastGroanVariation = -1;
  private gameOverPlayed = false;
  private musicOn = false;
  private running = true;
  private tabHidden = false;
  private disposed = false;

  constructor(
    private readonly sink: AudioSink,
    private readonly survival: SurvivalGame,
    target: EventTarget,
    private readonly now: () => number = () => performance.now(),
    private readonly random: () => number = Math.random,
    private readonly cfg = AUDIO_CONFIG,
  ) {
    this.lastAttackId = this.maxAttackId();
    // Check after ALL listeners of this POSE_CONFIRMED ran (the survival binding
    // decides whether it became an attack), so listener order never matters.
    this.offs.push(onPoseConfirmed(target, () => queueMicrotask(() => this.checkNewAttacks())));
    this.offs.push(onGameState(target, (s) => this.setRunning(s.running)));
    this.offs.push(survival.on("damage", () => this.onDamage()));
    this.offs.push(survival.on("gameOver", () => this.onGameOver()));
    this.offs.push(survival.on("restart", () => this.onRestart()));
    this.offs.push(survival.on("waveStart", () => this.ensureMusic()));
    this.offs.push(survival.on("defeated", ({ zombie }) => this.stopGroansFor((id) => id === zombie.id)));
  }

  /** Tracking OK and the pose loop live (GAME_STATE). */
  setRunning(running: boolean): void {
    this.running = running;
    this.updateSuspended();
  }

  setTabHidden(hidden: boolean): void {
    this.tabHidden = hidden;
    this.updateSuspended();
  }

  /** Groan scheduler + voice bookkeeping. Call every ~200 ms. */
  tick(): void {
    if (this.disposed) return;
    const t = this.now();
    this.prune(t);
    // Zombies that are gone (defeated / cleared) must not keep groaning.
    const live = this.survival.combat.zombies.filter(isAlive);
    const liveIds = new Set(live.map((z) => z.id));
    this.stopGroansFor((id) => !liveIds.has(id));

    if (!this.groansAllowed() || live.length === 0) return;
    if (t < this.nextGroanAt) return;
    const L = this.cfg.limits;
    const G = this.cfg.groans;
    const n = this.sink.variations("groan");
    // Next attempt: random gap, a little shorter in bigger crowds (never below minGap).
    const crowd = Math.min(1, live.length / 8);
    this.nextGroanAt = t + G.minGapMs + this.random() * (G.maxGapMs - G.minGapMs) * (1 - 0.4 * crowd);
    if (n === 0 || this.count("groan") >= L.groanVoices) return;
    const groaning = new Set(this.voices.filter((v) => v.kind === "groan").map((v) => v.zombieId));
    const candidates = live.filter((z) => !groaning.has(z.id));
    if (candidates.length === 0) return;
    const z = candidates[Math.floor(this.random() * candidates.length)]!;
    let variation = Math.floor(this.random() * n);
    if (n > 1 && variation === this.lastGroanVariation) variation = (variation + 1) % n;
    this.lastGroanVariation = variation;
    const R = 9;
    const dist = Math.hypot(z.x, z.z);
    const gain = 0.55 + 0.45 * Math.max(0, 1 - dist / R); // nearer = a bit louder
    const pan = Math.max(-0.8, Math.min(0.8, z.x / R));
    this.start("groan", { gain, pan, variation }, z.id);
  }

  /** Leaving gameplay (camera stopped, page hidden for good). */
  stopAll(): void {
    for (const v of this.voices) this.sink.stop(v.handle, 0.05);
    this.voices = [];
    if (this.musicOn) this.sink.stopMusic();
    this.musicOn = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopAll();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.disposed = true;
  }

  /** For tests / debug: live voices by kind. */
  count(kind?: SoundId): number {
    this.prune(this.now());
    return kind ? this.voices.filter((v) => v.kind === kind).length : this.voices.length;
  }

  get isMusicOn(): boolean {
    return this.musicOn;
  }

  // ---------------------------------------------------------------------------

  private checkNewAttacks(): void {
    if (this.disposed) return;
    for (const a of this.survival.combat.attacks) {
      if (a.done || a.id <= this.lastAttackId) continue;
      this.lastAttackId = a.id;
      this.onAttack();
    }
  }

  private onAttack(): void {
    const L = this.cfg.limits;
    // A newer attack replaces the oldest voice instead of stacking.
    for (const kind of ["heeHee", "aura"] as const) {
      const mine = this.voices.filter((v) => v.kind === kind);
      if (mine.length >= L.attackVoices) this.kill(mine[0]!, 0.08);
    }
    this.start("heeHee");
    this.start("aura");
    this.sink.duck();
  }

  private onDamage(): void {
    const t = this.now();
    const L = this.cfg.limits;
    if (t - this.lastHitAt < L.playerHitMinGapMs || this.count("playerHit") >= L.playerHitVoices) return;
    const n = this.sink.variations("playerHit");
    if (n === 0) return;
    this.lastHitAt = t;
    this.hitVariation = (this.hitVariation + 1) % n;
    this.start("playerHit", { variation: this.hitVariation });
  }

  private onGameOver(): void {
    if (this.gameOverPlayed) return;
    this.gameOverPlayed = true;
    this.stopGroansFor(() => true, 0.4);
    if (this.musicOn) this.sink.stopMusic();
    this.musicOn = false;
    if (this.sink.variations("gameOver") > 0) this.start("gameOver");
  }

  private onRestart(): void {
    for (const v of this.voices) this.sink.stop(v.handle, 0.05);
    this.voices = [];
    this.gameOverPlayed = false;
    this.lastAttackId = this.maxAttackId();
    this.lastHitAt = -Infinity;
    this.nextGroanAt = this.now() + this.cfg.groans.minGapMs;
    // Restart the song from the top with a fade (the same single loop is reused).
    this.sink.startMusic(true);
    this.musicOn = true;
  }

  private ensureMusic(): void {
    if (this.musicOn) return;
    this.sink.startMusic(true);
    this.musicOn = true;
  }

  private groansAllowed(): boolean {
    const st = this.survival.snapshot().state;
    return this.running && !this.tabHidden && !this.gameOverPlayed && st === "PLAYING";
  }

  private updateSuspended(): void {
    this.sink.setSuspended(!this.running || this.tabHidden);
  }

  private start(kind: SoundId, opts: Parameters<AudioSink["play"]>[1] = {}, zombieId?: number): void {
    const handle = this.sink.play(kind, opts);
    if (handle < 0) return;
    const dur = this.sink.duration(kind, opts.variation ?? 0);
    this.voices.push({ handle, kind, endsAt: this.now() + dur * 1000, zombieId });
  }

  private stopGroansFor(match: (zombieId: number) => boolean, fade: number = this.cfg.groans.stopFadeSec): void {
    for (const v of this.voices) if (v.kind === "groan" && v.zombieId !== undefined && match(v.zombieId)) this.kill(v, fade);
  }

  private kill(v: ActiveVoice, fade: number): void {
    this.sink.stop(v.handle, fade);
    this.voices = this.voices.filter((x) => x !== v);
  }

  private prune(t: number): void {
    if (this.voices.some((v) => v.endsAt <= t)) this.voices = this.voices.filter((v) => v.endsAt > t);
  }

  private maxAttackId(): number {
    return this.survival.combat.attacks.reduce((m, a) => Math.max(m, a.id), 0);
  }
}
