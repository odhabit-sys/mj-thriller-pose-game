import { SURVIVAL_CONFIG } from "../survival/survivalConfig";
import { COMBAT_CONFIG, type CombatConfig } from "./combatConfig";

/**
 * Pure combat simulation (no Three.js): zombies on the XZ ground plane walking
 * toward MJ at the origin, and radial aura attacks that knock them back.
 * The arena renders this state; tests drive it directly.
 *
 *   APPROACHING ──reach MJ──▶ ATTACKING (windup, then one strike per cooldown)
 *        ▲                        │ aura hit (interrupts)
 *        │                        ▼
 *   RECOVERING ◀──lands── KNOCKBACK ◀── aura hit (from any live state)
 *
 *   final aura hit (hitsToDefeat) ──▶ DEFEATED (bigger launch, fade) ──▶ inactive
 */
export type ZombieState = "APPROACHING" | "KNOCKBACK" | "RECOVERING" | "ATTACKING" | "DEFEATED";

export interface Zombie {
  id: number;
  x: number;
  z: number;
  /** Height above ground (knockback hop). */
  y: number;
  vx: number;
  vz: number;
  vy: number;
  state: ZombieState;
  /** Seconds spent in the current state. */
  stateTime: number;
  /** Base walking speed (units/s). */
  speed: number;
  /** True when standing at MJ (stopDistance reached). */
  atTarget: boolean;
  /** Animation phase offset so zombies don't walk in sync. */
  phase: number;
  /** False once a defeated zombie has faded out (slot can be reused). Undefined = active. */
  active?: boolean;
  /** Aura hits taken. */
  hits?: number;
  /** ATTACKING: seconds until the next strike. */
  attackTimer?: number;
  /** ATTACKING: seconds since the last strike (for the swipe animation). */
  strikeAge?: number;
}

export interface Attack {
  id: number;
  poseId: string;
  /** Seconds since the attack started. */
  age: number;
  /** Current ring radius. */
  radius: number;
  done: boolean;
  /** Zombies already hit by this attack (each zombie at most once per attack). */
  hit: Set<number>;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** Survival rules the combat simulation needs (values come from SURVIVAL_CONFIG). */
export interface CombatRules {
  attackDistance: number;
  attackCooldownMs: number;
  attackWindupMs: number;
  hitsToDefeat: number;
  defeatKnockbackMultiplier: number;
  defeatLift: number;
  defeatFadeMs: number;
}

export const DEFAULT_COMBAT_RULES: CombatRules = {
  attackDistance: SURVIVAL_CONFIG.zombieAttackDistance,
  attackCooldownMs: SURVIVAL_CONFIG.zombieAttackCooldown,
  attackWindupMs: SURVIVAL_CONFIG.zombieAttackWindup,
  hitsToDefeat: SURVIVAL_CONFIG.hitsToDefeatZombie,
  defeatKnockbackMultiplier: SURVIVAL_CONFIG.defeatKnockbackMultiplier,
  defeatLift: SURVIVAL_CONFIG.defeatLift,
  defeatFadeMs: SURVIVAL_CONFIG.defeatFadeMs,
};

/** Unit vector from MJ (origin) toward (x, z): the knockback direction. Defaults to +z at the exact center. */
export function radialDirection(x: number, z: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  const len = Math.hypot(x, z);
  if (len < 1e-6) {
    out.x = 0;
    out.z = 1;
  } else {
    out.x = x / len;
    out.z = z / len;
  }
  return out;
}

export function distanceFromCenter(z: Pick<Zombie, "x" | "z">): number {
  return Math.hypot(z.x, z.z);
}

export function isInAttackRadius(distance: number, radius: number): boolean {
  return distance <= radius;
}

/** Outward knockback speed: stronger the closer the zombie is to MJ. */
export function knockbackSpeed(distance: number, cfg: CombatConfig = COMBAT_CONFIG): number {
  const t = Math.min(1, Math.max(0, distance / cfg.attack.attackRadius));
  return cfg.knockback.speedNear + (cfg.knockback.speedFar - cfg.knockback.speedNear) * t;
}

/** Still in the fight: active and not defeated. */
export function isAlive(z: Zombie): boolean {
  return z.active !== false && z.state !== "DEFEATED";
}

export interface SpawnOptions {
  /** Angle around MJ (radians; 0 = +Z). */
  angle: number;
  radius: number;
  speed: number;
}

export class CombatSystem {
  readonly zombies: Zombie[] = [];
  readonly attacks: Attack[] = [];
  private nextAttackId = 1;
  private nextZombieId = 0;
  private readonly dir: Vec2 = { x: 0, z: 0 };
  private readonly hitListeners = new Set<(zombie: Zombie, attack: Attack) => void>();
  private readonly strikeListeners = new Set<(zombie: Zombie) => void>();
  private readonly defeatListeners = new Set<(zombie: Zombie) => void>();

  constructor(
    private readonly cfg: CombatConfig = COMBAT_CONFIG,
    private readonly random: () => number = Math.random,
    private readonly rules: CombatRules = DEFAULT_COMBAT_RULES,
  ) {}

  /** Spawns `count` zombies spread around the arena edge, facing MJ. */
  spawnInitial(count: number = this.cfg.zombies.count): void {
    this.zombies.length = 0;
    this.nextZombieId = 0;
    const Z = this.cfg.zombies;
    const offset = this.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const angle = offset + (i / count) * Math.PI * 2 + (this.random() - 0.5) * (Math.PI / count);
      const r = Z.spawnRadiusMin + this.random() * (Z.spawnRadiusMax - Z.spawnRadiusMin);
      this.spawnZombie({ angle, radius: r, speed: Z.speedMin + this.random() * (Z.speedMax - Z.speedMin) });
    }
  }

  /** Spawns one zombie, reusing a faded-out slot if there is one. */
  spawnZombie({ angle, radius, speed }: SpawnOptions): Zombie {
    const fresh: Zombie = {
      id: this.nextZombieId++,
      x: Math.sin(angle) * radius,
      z: Math.cos(angle) * radius,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      state: "APPROACHING",
      stateTime: 0,
      speed,
      atTarget: false,
      phase: this.random() * Math.PI * 2,
      active: true,
      hits: 0,
      attackTimer: 0,
      strikeAge: 10,
    };
    const slot = this.zombies.findIndex((z) => z.active === false);
    if (slot >= 0) {
      Object.assign(this.zombies[slot]!, fresh);
      return this.zombies[slot]!;
    }
    this.zombies.push(fresh);
    return fresh;
  }

  /** Removes every zombie and attack (restart). */
  clear(): void {
    this.zombies.length = 0;
    for (const a of this.attacks) {
      a.done = true;
      a.hit.clear();
    }
  }

  aliveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (isAlive(z)) n++;
    return n;
  }

  onZombieHit(cb: (zombie: Zombie, attack: Attack) => void): () => void {
    this.hitListeners.add(cb);
    return () => this.hitListeners.delete(cb);
  }

  /** A zombie landed a strike on MJ (once per cooldown, never per frame). */
  onZombieStrike(cb: (zombie: Zombie) => void): () => void {
    this.strikeListeners.add(cb);
    return () => this.strikeListeners.delete(cb);
  }

  /** A zombie took its final hit (fires exactly once per zombie). */
  onZombieDefeated(cb: (zombie: Zombie) => void): () => void {
    this.defeatListeners.add(cb);
    return () => this.defeatListeners.delete(cb);
  }

  /** Starts ONE aura attack from MJ. Call exactly once per POSE_CONFIRMED. */
  attack(poseId: string): Attack {
    // Reuse a finished attack object if available (no per-attack allocation churn).
    let a = this.attacks.find((x) => x.done);
    if (a) {
      a.id = this.nextAttackId++;
      a.poseId = poseId;
      a.age = 0;
      a.radius = 0;
      a.done = false;
      a.hit.clear();
    } else {
      a = { id: this.nextAttackId++, poseId, age: 0, radius: 0, done: false, hit: new Set() };
      this.attacks.push(a);
    }
    return a;
  }

  activeAttackCount(): number {
    return this.attacks.reduce((n, a) => n + (a.done ? 0 : 1), 0);
  }

  /** Advances the simulation. dt in seconds (clamped). */
  step(dtRaw: number): void {
    const dt = Math.min(Math.max(0, dtRaw), this.cfg.maxDt);
    if (dt === 0) return;
    this.stepAttacks(dt);
    for (const z of this.zombies) if (z.active !== false) this.stepZombie(z, dt);
  }

  private stepAttacks(dt: number): void {
    const A = this.cfg.attack;
    for (const a of this.attacks) {
      if (a.done) continue;
      a.age += dt;
      const t = Math.min(1, (a.age * 1000) / A.expandMs);
      // Ease-out: fast start, like a shockwave.
      a.radius = A.attackRadius * (1 - (1 - t) * (1 - t));
      for (const z of this.zombies) {
        if (!isAlive(z) || a.hit.has(z.id)) continue;
        const d = distanceFromCenter(z);
        if (isInAttackRadius(d, A.attackRadius) && d <= a.radius) {
          a.hit.add(z.id);
          z.hits = (z.hits ?? 0) + 1;
          if (z.hits >= this.rules.hitsToDefeat) this.defeat(z, d);
          else this.knockBack(z, d);
          this.hitListeners.forEach((l) => l(z, a));
          if (z.state === "DEFEATED") this.defeatListeners.forEach((l) => l(z));
        }
      }
      if (a.age * 1000 >= A.durationMs) a.done = true;
    }
  }

  private knockBack(z: Zombie, distance: number): void {
    const K = this.cfg.knockback;
    radialDirection(z.x, z.z, this.dir);
    const speed = knockbackSpeed(distance, this.cfg);
    z.vx = this.dir.x * speed;
    z.vz = this.dir.z * speed;
    z.vy = K.lift;
    z.state = "KNOCKBACK";
    z.stateTime = 0;
    z.atTarget = false;
    z.attackTimer = 0;
  }

  private defeat(z: Zombie, distance: number): void {
    this.knockBack(z, distance);
    z.vx *= this.rules.defeatKnockbackMultiplier;
    z.vz *= this.rules.defeatKnockbackMultiplier;
    z.vy = this.rules.defeatLift;
    z.state = "DEFEATED";
  }

  private stepZombie(z: Zombie, dt: number): void {
    z.stateTime += dt;

    switch (z.state) {
      case "KNOCKBACK":
        this.fly(z, dt);
        if (z.y === 0 && Math.hypot(z.vx, z.vz) < this.cfg.knockback.settleSpeed) {
          z.vx = z.vz = z.vy = 0;
          z.state = "RECOVERING";
          z.stateTime = 0;
        }
        break;

      case "DEFEATED":
        this.fly(z, dt);
        if (z.stateTime * 1000 >= this.rules.defeatFadeMs) z.active = false;
        break;

      case "RECOVERING": {
        const R = this.cfg.recovery;
        const ms = z.stateTime * 1000;
        if (ms >= R.dazedMs) {
          const ramp = Math.min(1, (ms - R.dazedMs) / R.rampMs);
          this.walk(z, dt, z.speed * ramp);
          if (ramp >= 1) {
            z.state = "APPROACHING";
            z.stateTime = 0;
          }
        }
        break;
      }

      case "APPROACHING":
        this.walk(z, dt, z.speed);
        if (distanceFromCenter(z) <= this.rules.attackDistance) {
          z.state = "ATTACKING";
          z.stateTime = 0;
          z.attackTimer = this.rules.attackWindupMs / 1000;
          z.strikeAge = 10;
        }
        break;

      case "ATTACKING": {
        // Close any remaining gap to stopDistance, then strike on a fixed cadence.
        this.walk(z, dt, z.speed);
        z.strikeAge = (z.strikeAge ?? 10) + dt;
        z.attackTimer = (z.attackTimer ?? 0) - dt;
        if (z.attackTimer <= 0) {
          z.attackTimer += this.rules.attackCooldownMs / 1000;
          z.strikeAge = 0;
          this.strikeListeners.forEach((l) => l(z));
        }
        break;
      }
    }
  }

  /** Ballistic slide used by knockback and defeat. */
  private fly(z: Zombie, dt: number): void {
    const K = this.cfg.knockback;
    z.x += z.vx * dt;
    z.z += z.vz * dt;
    z.vy -= K.gravity * dt;
    z.y = Math.max(0, z.y + z.vy * dt);
    if (z.y === 0 && z.vy < 0) z.vy = 0;
    const damp = Math.exp(-K.damping * dt);
    z.vx *= damp;
    z.vz *= damp;
    this.clampToArena(z);
  }

  /** Walk straight toward MJ, stopping at stopDistance. */
  private walk(z: Zombie, dt: number, speed: number): void {
    const d = distanceFromCenter(z);
    const stop = this.cfg.zombies.stopDistance;
    if (d <= stop) {
      z.atTarget = true;
      return;
    }
    z.atTarget = false;
    const step = Math.min(speed * dt, d - stop);
    z.x -= (z.x / d) * step;
    z.z -= (z.z / d) * step;
  }

  private clampToArena(z: Zombie): void {
    const d = distanceFromCenter(z);
    const max = this.cfg.arenaRadius;
    if (d > max) {
      z.x = (z.x / d) * max;
      z.z = (z.z / d) * max;
      // Hitting the edge kills the outward velocity.
      z.vx = 0;
      z.vz = 0;
    }
  }
}
