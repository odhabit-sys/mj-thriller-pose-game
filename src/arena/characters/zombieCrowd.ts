import * as THREE from "three";
import type { Zombie } from "../../combat/combatSystem";
import { makeZombieVariant, type ZombieAnim } from "./zombieAnimation";
import { disposeZombieResources, ZombieCharacter } from "./zombieCharacter";

/** Deterministic per-zombie visual seed (salt varies the look between page sessions). */
export function visualSeed(zombieId: number, salt: number): number {
  return (Math.imul(zombieId + 1, 2654435761) ^ salt) >>> 0;
}

export interface CrowdDebugRow {
  id: number;
  variant: string;
  anim: ZombieAnim;
  state: string;
}

/**
 * Renders the simulation's zombies with pooled ZombieCharacters (one per
 * simulation slot) plus a small pooled dust puff when a defeated zombie dissolves.
 * Read-only with respect to gameplay data.
 */
export class ZombieCrowd {
  readonly root = new THREE.Group();
  private readonly figures: ZombieCharacter[] = [];
  /** Which zombie id each figure currently represents (slots get reused on respawn). */
  private readonly figureZombieId: number[] = [];
  private readonly lastAnim: ZombieAnim[] = [];
  private readonly dust = new DustPool();

  constructor(private readonly salt = (Math.random() * 0xffffffff) >>> 0) {
    this.root.add(this.dust.root);
  }

  sync(zombies: readonly Readonly<Zombie>[], time: number, dt: number): void {
    while (this.figures.length < zombies.length) {
      const f = new ZombieCharacter();
      this.figures.push(f);
      this.figureZombieId.push(-1);
      this.lastAnim.push("hidden");
      this.root.add(f.root);
    }
    for (let i = 0; i < this.figures.length; i++) {
      const f = this.figures[i]!;
      const z = zombies[i];
      if (!z) {
        f.root.visible = false;
        continue;
      }
      if (this.figureZombieId[i] !== z.id) {
        // New zombie in this slot: give it its own look.
        f.setVariant(makeZombieVariant(visualSeed(z.id, this.salt)));
        this.figureZombieId[i] = z.id;
        this.lastAnim[i] = "hidden";
      }
      const pose = f.sync(z, time);
      if (pose.anim === "dissolve" && this.lastAnim[i] !== "dissolve") this.dust.burst(z.x, z.z, f.variant!.seed);
      this.lastAnim[i] = pose.anim;
    }
    this.dust.update(dt);
  }

  debugRows(zombies: readonly Readonly<Zombie>[]): CrowdDebugRow[] {
    const rows: CrowdDebugRow[] = [];
    for (let i = 0; i < this.figures.length; i++) {
      const z = zombies[i];
      if (!z || z.active === false) continue;
      rows.push({ id: z.id, variant: this.figures[i]!.variant?.id ?? "—", anim: this.figures[i]!.pose.anim, state: z.state });
    }
    return rows;
  }

  /** Dust bursts emitted so far (one per dissolving zombie). */
  get dustBursts(): number {
    return this.dust.count;
  }

  get figureCount(): number {
    return this.figures.length;
  }

  /** Remove every figure and free shared zombie GPU resources. */
  dispose(): void {
    for (const f of this.figures) f.dispose();
    this.figures.length = 0;
    this.figureZombieId.length = 0;
    this.lastAnim.length = 0;
    this.dust.dispose();
    this.root.removeFromParent();
    disposeZombieResources();
  }
}

/** A few pooled low-poly dust bursts (8 tiny shards each). No per-frame allocation. */
class DustPool {
  readonly root = new THREE.Group();
  private readonly geo = new THREE.TetrahedronGeometry(0.07, 0);
  private readonly bursts: {
    group: THREE.Group;
    mat: THREE.MeshBasicMaterial;
    shards: THREE.Mesh[];
    vel: Float32Array;
    age: number;
  }[] = [];
  count = 0;
  private static readonly SHARDS = 8;
  private static readonly LIFE = 0.6;

  constructor(count = 4) {
    for (let b = 0; b < count; b++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fb3a0, transparent: true, opacity: 0, depthWrite: false });
      const group = new THREE.Group();
      group.visible = false;
      const shards: THREE.Mesh[] = [];
      for (let i = 0; i < DustPool.SHARDS; i++) {
        const s = new THREE.Mesh(this.geo, mat);
        shards.push(s);
        group.add(s);
      }
      this.root.add(group);
      this.bursts.push({ group, mat, shards, vel: new Float32Array(DustPool.SHARDS * 3), age: DustPool.LIFE });
    }
  }

  burst(x: number, z: number, seed: number): void {
    this.count++;
    // Reuse the oldest burst.
    let b = this.bursts[0]!;
    for (const c of this.bursts) if (c.age > b.age) b = c;
    b.age = 0;
    b.group.visible = true;
    b.group.position.set(x, 0.3, z);
    for (let i = 0; i < DustPool.SHARDS; i++) {
      const a = (i / DustPool.SHARDS) * Math.PI * 2 + (seed % 7) * 0.3;
      b.shards[i]!.position.set(0, 0, 0);
      b.vel[i * 3] = Math.cos(a) * 1.6;
      b.vel[i * 3 + 1] = 1.2 + ((i * 37 + seed) % 10) * 0.12;
      b.vel[i * 3 + 2] = Math.sin(a) * 1.6;
    }
  }

  update(dt: number): void {
    for (const b of this.bursts) {
      if (b.age >= DustPool.LIFE) {
        b.group.visible = false;
        continue;
      }
      b.age += dt;
      const t = Math.min(1, b.age / DustPool.LIFE);
      b.mat.opacity = 0.75 * (1 - t);
      for (let i = 0; i < DustPool.SHARDS; i++) {
        const s = b.shards[i]!;
        b.vel[i * 3 + 1]! -= 4 * dt;
        s.position.x += b.vel[i * 3]! * dt;
        s.position.y = Math.max(-0.28, s.position.y + b.vel[i * 3 + 1]! * dt);
        s.position.z += b.vel[i * 3 + 2]! * dt;
        s.rotation.x += 6 * dt;
        s.scale.setScalar(1 - t * 0.7);
      }
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const b of this.bursts) b.mat.dispose();
  }
}
