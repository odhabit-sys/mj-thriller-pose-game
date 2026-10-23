import { COMBAT_CONFIG } from "../combat/combatConfig";
import { CombatSystem, isAlive, type Zombie } from "../combat/combatSystem";
import type { ScoreStorage } from "./bestScore";
import { createMemoryScoreStorage } from "./bestScore";
import { SURVIVAL_CONFIG, type SurvivalConfig } from "./survivalConfig";

/**
 * The survival game: health, waves, score, game over, restart.
 * Separate from pose recognition and from the pose-prompt controller. It owns the
 * combat simulation and advances it only while PLAYING (or between waves) AND
 * running (tracking OK, tab visible). Pure: no DOM, no Three.js.
 *
 *   READY ──start()──▶ PLAYING ──wave cleared──▶ WAVE_TRANSITION ──▶ PLAYING (next wave)
 *                         │ health 0
 *                         ▼
 *                     GAME_OVER ──restart()──▶ PLAYING (wave 1)
 */
export type SurvivalState = "READY" | "PLAYING" | "WAVE_TRANSITION" | "GAME_OVER";

export interface SurvivalSnapshot {
  state: SurvivalState;
  health: number;
  maxHealth: number;
  wave: number;
  score: number;
  best: number;
  /** Paused by tracking loss / hidden tab. */
  paused: boolean;
  /** Center banner text, if any ("WAVE 2", "WAVE COMPLETE"). */
  banner: string | null;
  /** Zombies of this wave still to defeat (alive + queued). */
  remaining: number;
}

export interface WaveSpec {
  wave: number;
  count: number;
  speed: number;
}

type Listener<T> = (e: T) => void;

export class SurvivalGame {
  readonly combat: CombatSystem;

  private state: SurvivalState = "READY";
  private running = false;
  private health: number;
  private score = 0;
  private best: number;
  private wave = 0;
  /** Seconds in the current state (survival clock: frozen while paused). */
  private stateTime = 0;
  private spawnQueue = 0;
  private spawnCooldown = 0;
  private gameOverFired = false;

  private readonly listeners = {
    damage: new Set<Listener<{ amount: number; health: number; zombie: Zombie }>>(),
    defeated: new Set<Listener<{ zombie: Zombie; score: number }>>(),
    waveStart: new Set<Listener<{ wave: number }>>(),
    waveComplete: new Set<Listener<{ wave: number; bonus: number }>>(),
    gameOver: new Set<Listener<{ score: number; best: number; wave: number }>>(),
    restart: new Set<Listener<void>>(),
  };

  constructor(
    private readonly storage: ScoreStorage = createMemoryScoreStorage(),
    private readonly random: () => number = Math.random,
    private readonly cfg: SurvivalConfig = SURVIVAL_CONFIG,
    combat?: CombatSystem,
  ) {
    this.combat = combat ?? new CombatSystem(COMBAT_CONFIG, random);
    this.health = cfg.maxHealth;
    this.best = storage.load();
    this.combat.onZombieStrike((z) => this.onStrike(z));
    this.combat.onZombieDefeated((z) => this.onDefeated(z));
  }

  on<K extends keyof SurvivalGame["listeners"]>(
    event: K,
    cb: SurvivalGame["listeners"][K] extends Set<infer L> ? L : never,
  ): () => void {
    const set = this.listeners[event] as Set<typeof cb>;
    set.add(cb);
    return () => set.delete(cb);
  }

  /** Difficulty curve: pressure only (count + speed). Pose recognition is never touched. */
  waveSpec(wave: number): WaveSpec {
    const c = this.cfg;
    return {
      wave,
      count: c.baseZombieCount + c.zombiesAddedPerWave * (wave - 1),
      speed: Math.min(c.maxZombieSpeed, c.baseZombieSpeed + c.speedIncreasePerWave * (wave - 1)),
    };
  }

  /** START GAME. */
  start(): void {
    if (this.state !== "READY") return;
    this.resetRun();
    this.beginWave(1);
  }

  /** RESTART: full reset of the run without touching the camera. */
  restart(): void {
    this.resetRun();
    this.listeners.restart.forEach((l) => l());
    this.beginWave(1);
  }

  /** Tracking OK and tab visible. While false, nothing in the survival game advances. */
  setRunning(running: boolean): void {
    this.running = running;
  }

  /**
   * A gameplay POSE_CONFIRMED arrived. Starts one aura attack only while PLAYING
   * and running; returns whether the world was affected.
   */
  handlePoseConfirmed(poseId: string): boolean {
    if (this.state !== "PLAYING" || !this.running) return false;
    this.combat.attack(poseId);
    return true;
  }

  /** True when the world (zombies, auras, timers) should animate. */
  isSimulating(): boolean {
    return this.running && (this.state === "PLAYING" || this.state === "WAVE_TRANSITION");
  }

  update(dt: number): void {
    if (!this.isSimulating()) return;
    const d = Math.min(Math.max(0, dt), COMBAT_CONFIG.maxDt);
    this.stateTime += d;

    if (this.state === "PLAYING") {
      this.combat.step(d);
      if (this.state !== "PLAYING") return; // game over during this step
      this.spawnQueued(d);
      if (this.spawnQueue === 0 && this.combat.aliveCount() === 0) this.completeWave();
    } else {
      // WAVE_TRANSITION: no live zombies; let defeated ones finish fading.
      this.combat.step(d);
      if (this.stateTime * 1000 >= this.cfg.waveTransitionDuration) this.beginWave(this.wave + 1);
    }
  }

  snapshot(): SurvivalSnapshot {
    const ms = this.stateTime * 1000;
    let banner: string | null = null;
    if (this.state === "PLAYING" && ms < this.cfg.waveIntroMs) banner = `WAVE ${this.wave}`;
    if (this.state === "WAVE_TRANSITION")
      banner = ms < this.cfg.waveCompleteBannerMs ? "WAVE COMPLETE" : `WAVE ${this.wave + 1}`;
    return {
      state: this.state,
      health: this.health,
      maxHealth: this.cfg.maxHealth,
      wave: this.wave,
      score: this.score,
      best: this.best,
      paused: !this.running && (this.state === "PLAYING" || this.state === "WAVE_TRANSITION"),
      banner,
      remaining: this.spawnQueue + this.combat.aliveCount(),
    };
  }

  // -------------------------------------------------------------------------

  private resetRun(): void {
    this.combat.clear();
    this.health = this.cfg.maxHealth;
    this.score = 0;
    this.wave = 0;
    this.spawnQueue = 0;
    this.spawnCooldown = 0;
    this.stateTime = 0;
    this.gameOverFired = false;
  }

  private beginWave(wave: number): void {
    this.wave = wave;
    this.state = "PLAYING";
    this.stateTime = 0;
    const spec = this.waveSpec(wave);
    const now = Math.min(spec.count, this.cfg.maxActiveZombies);
    // Initial group spread evenly around MJ with a random rotation.
    const offset = this.random() * Math.PI * 2;
    for (let i = 0; i < now; i++) {
      const jitter = (this.random() - 0.5) * (Math.PI / now);
      this.spawnOne(offset + (i / now) * Math.PI * 2 + jitter);
    }
    this.spawnQueue = spec.count - now;
    this.spawnCooldown = this.cfg.spawnIntervalMs / 1000;
    this.listeners.waveStart.forEach((l) => l({ wave }));
  }

  private spawnQueued(dt: number): void {
    if (this.spawnQueue === 0) return;
    this.spawnCooldown -= dt;
    if (this.spawnCooldown > 0 || this.combat.aliveCount() >= this.cfg.maxActiveZombies) return;
    this.spawnOne(this.random() * Math.PI * 2);
    this.spawnQueue--;
    this.spawnCooldown = this.cfg.spawnIntervalMs / 1000;
  }

  private spawnOne(angle: number): void {
    const Z = COMBAT_CONFIG.zombies;
    const spec = this.waveSpec(this.wave);
    const jitter = 1 + (this.random() * 2 - 1) * this.cfg.speedJitter;
    this.combat.spawnZombie({
      angle,
      radius: Z.spawnRadiusMin + this.random() * (Z.spawnRadiusMax - Z.spawnRadiusMin),
      speed: spec.speed * jitter,
    });
  }

  private completeWave(): void {
    const bonus = this.cfg.waveClearBonus;
    this.score += bonus;
    this.state = "WAVE_TRANSITION";
    this.stateTime = 0;
    this.listeners.waveComplete.forEach((l) => l({ wave: this.wave, bonus }));
  }

  private onStrike(zombie: Zombie): void {
    if (this.state !== "PLAYING" || !this.running || !isAlive(zombie)) return;
    const amount = this.cfg.zombieDamage;
    this.health = Math.max(0, this.health - amount);
    this.listeners.damage.forEach((l) => l({ amount, health: this.health, zombie }));
    if (this.health === 0) this.gameOver();
  }

  private onDefeated(zombie: Zombie): void {
    if (this.state !== "PLAYING") return;
    this.score += this.cfg.scorePerZombie;
    this.listeners.defeated.forEach((l) => l({ zombie, score: this.score }));
  }

  private gameOver(): void {
    if (this.gameOverFired) return;
    this.gameOverFired = true;
    this.state = "GAME_OVER";
    this.stateTime = 0;
    if (this.score > this.best) {
      this.best = this.score;
      this.storage.save(this.best);
    }
    this.listeners.gameOver.forEach((l) => l({ score: this.score, best: this.best, wave: this.wave }));
  }
}
