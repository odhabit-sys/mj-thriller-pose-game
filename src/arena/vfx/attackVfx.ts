import * as THREE from "three";
import { COMBAT_CONFIG } from "../../combat/combatConfig";
import type { Attack } from "../../combat/combatSystem";
import { CameraImpulse } from "./cameraImpulse";
import { ParticlePool, StreakPool } from "./particles";
import { VFX_CONFIG } from "./vfxConfig";

/**
 * MJ attack / impact VFX. VISUAL ONLY.
 *
 * Inputs are plain numbers and read-only views of gameplay:
 *   - charge()             on POSE_CONFIRMED (after the survival game accepted the attack)
 *   - syncAttacks(attacks) each frame: rings follow the GAMEPLAY ring radius/age,
 *                          brightness follows how many zombies this attack really hit
 *   - impact(x, y, z, …)   from combat.onZombieHit (only zombies the simulation hit)
 * Nothing here can write gameplay state. All objects are pooled.
 */

const C = VFX_CONFIG;
const color = (hex: number) => new THREE.Color(hex);
const WARM_WHITE = color(C.palette.warmWhite);
const GOLD = color(C.palette.gold);
const AMBER = color(C.palette.amber);
const PURPLE = color(C.palette.purple);

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const RING_VERT = /* glsl */ `
  varying vec2 vPos;
  uniform float uExtent;
  void main() {
    vPos = position.xy * uExtent;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Flat shockwave: bright main ring, thinner trailing ring, inner afterglow, energetic shimmer. */
const RING_FRAG = /* glsl */ `
  varying vec2 vPos;
  uniform float uRadius;
  uniform float uThick;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uTrail;
  uniform vec3 uCore;
  uniform vec3 uGold;
  uniform vec3 uAmber;
  uniform vec3 uPurple;
  void main() {
    float d = length(vPos);
    float ang = atan(vPos.y, vPos.x);
    float shimmer = 0.5 + 0.5 * sin(ang * 11.0 + uTime * 24.0) * sin(ang * 5.0 - uTime * 17.0);
    float r = uRadius * (1.0 + 0.012 * sin(ang * 9.0 + uTime * 30.0));
    float x = (d - r) / uThick;
    // Sharp leading edge, softer tail toward MJ.
    float main = x > 0.0 ? exp(-x * x * 5.0) : exp(-x * x * 1.2);
    float trail = exp(-pow((d - r * uTrail) / (uThick * 0.35), 2.0)) * 0.6;
    float inner = (d < r) ? pow(d / max(r, 1e-3), 3.0) * 0.18 : 0.0;
    vec3 col = mix(uGold, uCore, clamp(main * 1.4 - 0.2, 0.0, 1.0));
    col = mix(col, uAmber, clamp(x * 0.8, 0.0, 1.0));
    col += uPurple * inner * 0.6;
    float a = (main * (0.75 + 0.25 * shimmer) + trail + inner) * uAlpha;
    gl_FragColor = vec4(col, a);
  }
`;

/** Vertical shockwave curtain (open cylinder): bright at the ground, fading upward. */
const WALL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const WALL_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uAlpha;
  uniform float uTime;
  uniform vec3 uGold;
  uniform vec3 uCore;
  void main() {
    float h = vUv.y;
    float streak = 0.55 + 0.45 * sin(vUv.x * 80.0 + uTime * 9.0) * sin(vUv.x * 31.0 - uTime * 13.0);
    float fade = pow(1.0 - h, 2.6);
    vec3 col = mix(uGold, uCore, fade);
    gl_FragColor = vec4(col, fade * streak * uAlpha);
  }
`;

/** Radial glow decal (ground glow under MJ, energy residue at a defeat). */
const GLOW_FRAG = /* glsl */ `
  varying vec2 vPos;
  uniform float uAlpha;
  uniform vec3 uCore;
  uniform vec3 uGold;
  void main() {
    float d = length(vPos);
    if (d > 1.0) discard;
    float g = exp(-d * d * 4.0);
    gl_FragColor = vec4(mix(uGold, uCore, g), g * uAlpha);
  }
`;

function additive(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
interface RingView {
  group: THREE.Group;
  ring: THREE.ShaderMaterial;
  wall: THREE.ShaderMaterial;
  wallMesh: THREE.Mesh;
}

interface Decal {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  life: number;
  peak: number;
}

export interface VfxStats {
  particles: number;
  streaks: number;
  rings: number;
  decals: number;
  impacts: number;
  defeatImpacts: number;
  charges: number;
}

export class AttackVfx {
  readonly root = new THREE.Group();
  readonly camera = new CameraImpulse(C.camera.maxKick, C.camera.enabled);
  private readonly particles = new ParticlePool(C.capacity.particles);
  private readonly streaks = new StreakPool(C.capacity.streaks);
  private readonly rings: RingView[] = [];
  private readonly decals: Decal[] = [];
  private readonly groundGlow: Decal;
  private readonly planeGeo = new THREE.PlaneGeometry(2, 2);
  private readonly wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
  private readonly maxRingExtent = COMBAT_CONFIG.attack.attackRadius * 1.35;
  private time = 0;
  private chargeT = Infinity;
  private punchT = Infinity;
  private hitStopT = Infinity;
  private rng = 1;
  private disposed = false;
  readonly stats: VfxStats = { particles: 0, streaks: 0, rings: 0, decals: 0, impacts: 0, defeatImpacts: 0, charges: 0 };

  constructor() {
    this.root.add(this.particles.points, this.streaks.lines);
    for (let i = 0; i < C.capacity.rings; i++) this.rings.push(this.makeRing());
    for (let i = 0; i < C.capacity.decals; i++) this.decals.push(this.makeDecal(0.9));
    this.groundGlow = this.makeDecal(2.2);
    this.groundGlow.mesh.position.set(0, 0.035, 0);
  }

  /** Particle pixel scale for the current viewport (height px / (2·tan(fov/2))). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.particles.setScale(heightPx / (2 * Math.tan(((fovDeg / 2) * Math.PI) / 180)));
  }

  /** POSE_CONFIRMED accepted: MJ power charge. Starts immediately; overlaps the gameplay ring. */
  charge(): void {
    this.chargeT = 0;
    this.stats.charges++;
    this.groundGlow.age = 0;
    this.groundGlow.life = C.shockwave.groundGlowMs / 1000;
    this.groundGlow.peak = 1;
    // Motes pulled into MJ from around him.
    for (let i = 0; i < C.charge.motes; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 1.3 + this.rand() * 0.8;
      const y = 0.3 + this.rand() * 2.4;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const t = 0.14;
      this.particles.spawn({
        x,
        y,
        z,
        vx: -x / t,
        vy: (1.6 - y) / t,
        vz: -z / t,
        life: t,
        size: 0.11 + this.rand() * 0.06,
        color: this.rand() < 0.5 ? GOLD : WARM_WHITE,
        alpha: 0.9,
        shrink: 0.2,
      });
    }
    // Sparkles rising off MJ.
    for (let i = 0; i < C.charge.sparkles; i++) {
      const a = this.rand() * Math.PI * 2;
      this.particles.spawn({
        x: Math.sin(a) * 0.35,
        y: 0.4 + this.rand() * 1.8,
        z: Math.cos(a) * 0.35,
        vx: Math.sin(a) * 0.4,
        vy: 1.4 + this.rand(),
        vz: Math.cos(a) * 0.4,
        life: 0.5 + this.rand() * 0.3,
        size: 0.07 + this.rand() * 0.05,
        color: GOLD,
        alpha: 0.8,
        drag: 1.5,
      });
    }
    // Outward ground particles riding the shockwave.
    for (let i = 0; i < C.shockwave.outwardParticles; i++) {
      const a = (i / C.shockwave.outwardParticles) * Math.PI * 2 + this.rand() * 0.2;
      const sp = 11 + this.rand() * 5;
      this.particles.spawn({
        x: Math.sin(a) * 0.4,
        y: 0.12 + this.rand() * 0.25,
        z: Math.cos(a) * 0.4,
        vx: Math.sin(a) * sp,
        vy: 0.6 + this.rand() * 0.8,
        vz: Math.cos(a) * sp,
        life: 0.4 + this.rand() * 0.15,
        size: 0.12 + this.rand() * 0.08,
        color: this.rand() < 0.3 ? AMBER : GOLD,
        alpha: 0.85,
        drag: 3.2,
        gravity: 2,
      });
    }
    this.camera.kick(C.camera.blastKick, C.camera.durationMs);
  }

  /**
   * A zombie the SIMULATION hit. Pure numbers in: position, whether it was defeated,
   * and how many zombies this attack has hit so far (combo).
   */
  impact(x: number, y: number, z: number, defeated: boolean, hitsSoFar: number): void {
    const I = C.impact;
    const len = Math.hypot(x, z) || 1;
    const dx = x / len;
    const dz = z / len;
    const cy = 1.1 + y;
    const combo = Math.min(hitsSoFar, C.shockwave.comboMax);
    this.stats.impacts++;
    if (defeated) this.stats.defeatImpacts++;

    // Flash at the body.
    this.particles.spawn({ x, y: cy, z, vx: 0, vy: 0, vz: 0, life: defeated ? 0.16 : 0.11, size: defeated ? 1.9 : 1.2, color: WARM_WHITE, alpha: defeated ? 1 : 0.85, shrink: 1.6 });
    this.particles.spawn({ x, y: cy, z, vx: 0, vy: 0, vz: 0, life: defeated ? 0.28 : 0.2, size: defeated ? 1.2 : 0.8, color: GOLD, alpha: 0.6, shrink: 1.4 });

    // Sparks thrown away from MJ.
    const n = defeated ? I.defeatSparks : I.sparks;
    for (let i = 0; i < n; i++) {
      const spread = (this.rand() - 0.5) * 1.6;
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const sx = dx * ca - dz * sa;
      const sz = dx * sa + dz * ca;
      const sp = (defeated ? 7 : 5) + this.rand() * 4;
      this.particles.spawn({
        x,
        y: cy + (this.rand() - 0.5) * 0.5,
        z,
        vx: sx * sp,
        vy: 1 + this.rand() * 3,
        vz: sz * sp,
        life: 0.25 + this.rand() * 0.2,
        size: 0.07 + this.rand() * 0.06,
        color: this.rand() < 0.35 ? AMBER : this.rand() < 0.5 ? WARM_WHITE : GOLD,
        alpha: 1,
        drag: 4,
        gravity: 7,
      });
    }
    // Directional streaks.
    const s = defeated ? I.defeatStreaks : I.streaks;
    for (let i = 0; i < s; i++) {
      const spread = (this.rand() - 0.5) * 0.9;
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const sp = 9 + this.rand() * 6;
      this.streaks.spawn(
        x,
        cy + (this.rand() - 0.5) * 0.8,
        z,
        (dx * ca - dz * sa) * sp,
        (this.rand() - 0.3) * 2,
        (dx * sa + dz * ca) * sp,
        0.16 + this.rand() * 0.08,
        0.35 + this.rand() * 0.3,
        this.rand() < 0.5 ? WARM_WHITE : GOLD,
      );
    }

    if (defeated) {
      // Embers drifting up + short energy residue on the ground where it was hit.
      for (let i = 0; i < I.defeatEmbers; i++) {
        this.particles.spawn({
          x: x + (this.rand() - 0.5) * 0.6,
          y: 0.3 + this.rand() * 1.2,
          z: z + (this.rand() - 0.5) * 0.6,
          vx: dx * 0.6,
          vy: 0.8 + this.rand() * 0.8,
          vz: dz * 0.6,
          life: 0.6 + this.rand() * 0.4,
          size: 0.08 + this.rand() * 0.05,
          color: AMBER,
          alpha: 0.85,
          drag: 1.2,
          gravity: -0.4,
        });
      }
      this.placeDecal(x, z);
    }

    // Camera: tiny thump per hit, more for defeats; capped (stacks for multi-kills).
    this.camera.kick(C.camera.blastKick + combo * C.camera.perHit + (defeated ? C.camera.perDefeat : 0), C.camera.durationMs);
    this.punchT = 0;
    this.hitStopT = 0;
  }

  /** Rings follow the gameplay attacks' radius/age; combo brightness from hits reported by the simulation. */
  syncAttacks(attacks: readonly Readonly<Attack>[]): void {
    let used = 0;
    const total = COMBAT_CONFIG.attack.durationMs / 1000;
    for (const a of attacks) {
      if (a.done || used >= this.rings.length) continue;
      const v = this.rings[used++]!;
      const life = Math.min(1, a.age / total);
      const hits = Math.min(a.hit.size, C.shockwave.comboMax);
      const boost = 1 + hits * C.shockwave.comboBoost;
      const fade = Math.pow(1 - life, 1.4);
      const r = Math.max(0.05, a.radius);
      v.group.visible = true;
      v.ring.uniforms.uRadius!.value = r;
      v.ring.uniforms.uAlpha!.value = Math.min(1.6, 1.15 * fade * boost);
      v.ring.uniforms.uThick!.value = C.shockwave.thickness * (0.6 + 0.6 * life);
      v.ring.uniforms.uTime!.value = this.time;
      v.wall.uniforms.uAlpha!.value = 0.55 * fade * fade * boost;
      v.wall.uniforms.uTime!.value = this.time;
      v.wallMesh.scale.set(r, 0.9 + 0.5 * (1 - life), r);
      v.wallMesh.position.y = v.wallMesh.scale.y / 2;
    }
    for (let i = used; i < this.rings.length; i++) this.rings[i]!.group.visible = false;
    this.stats.rings = used;
  }

  /** Advance VFX (visual clock; hit stop only slows these effects, never the simulation). */
  update(dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1);
    this.hitStopT += dt;
    const scale = this.hitStopT * 1000 < C.hitStop.durationMs ? C.hitStop.timeScale : 1;
    const vdt = dt * scale;
    this.time += vdt;
    this.chargeT += dt;
    this.punchT += dt;
    this.particles.update(vdt);
    this.streaks.update(vdt);
    this.camera.update(dt);

    let decals = this.updateDecal(this.groundGlow, vdt);
    for (let i = 0; i < this.decals.length; i++) decals += this.updateDecal(this.decals[i]!, vdt);
    this.stats.particles = this.particles.aliveCount;
    this.stats.streaks = this.streaks.aliveCount;
    this.stats.decals = decals;
  }

  /** 0..1 MJ charge brightness (fast rise, quick fall) for the MJ light. */
  chargeLevel(): number {
    const ms = this.chargeT * 1000;
    const D = C.charge.durationMs;
    if (ms < D * 0.6) return ms / (D * 0.6);
    if (ms < D * 3) return Math.max(0, 1 - (ms - D * 0.6) / (D * 2.4));
    return 0;
  }

  /** 0..1 brightness punch when the blast connects. */
  punchLevel(): number {
    const ms = this.punchT * 1000;
    return ms < C.punch.durationMs ? 1 - ms / C.punch.durationMs : 0;
  }

  /** Current main-ring opacity for each visible ring (tests / debug). */
  debugRingAlpha(): number[] {
    return this.rings.filter((r) => r.group.visible).map((r) => r.ring.uniforms.uAlpha!.value as number);
  }

  /** Number of objects under the VFX root (for leak checks). */
  get objectCount(): number {
    let n = 0;
    this.root.traverse(() => n++);
    return n;
  }

  /** Everything finished (pools idle). */
  get idle(): boolean {
    return (
      this.particles.aliveCount === 0 &&
      this.streaks.aliveCount === 0 &&
      this.stats.rings === 0 &&
      this.stats.decals === 0 &&
      !this.camera.active
    );
  }

  /** Restart: drop every effect immediately. */
  reset(): void {
    this.particles.clear();
    this.streaks.clear();
    for (const r of this.rings) r.group.visible = false;
    for (const d of [...this.decals, this.groundGlow]) {
      d.age = d.life = 0;
      d.mesh.visible = false;
    }
    this.camera.reset();
    this.chargeT = this.punchT = this.hitStopT = Infinity;
    this.stats.particles = this.stats.streaks = this.stats.rings = this.stats.decals = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.particles.dispose();
    this.streaks.dispose();
    this.planeGeo.dispose();
    this.wallGeo.dispose();
    for (const r of this.rings) {
      r.ring.dispose();
      r.wall.dispose();
    }
    for (const d of [...this.decals, this.groundGlow]) d.mat.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }

  // -------------------------------------------------------------------------
  /** Returns 1 while the decal is still visible. */
  private updateDecal(d: Decal, vdt: number): number {
    if (d.age >= d.life) {
      d.mesh.visible = false;
      return 0;
    }
    d.age += vdt;
    const t = Math.min(1, d.age / d.life);
    d.mesh.visible = t < 1;
    d.mat.uniforms.uAlpha!.value = d.peak * (1 - t) * (1 - t);
    return t < 1 ? 1 : 0;
  }

  private makeRing(): RingView {
    const ring = additive(RING_VERT, RING_FRAG, {
      uExtent: { value: this.maxRingExtent },
      uRadius: { value: 0 },
      uThick: { value: C.shockwave.thickness },
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uTrail: { value: C.shockwave.trailingRing },
      uCore: { value: WARM_WHITE },
      uGold: { value: GOLD },
      uAmber: { value: AMBER },
      uPurple: { value: PURPLE },
    });
    ring.fog = false;
    const wall = additive(WALL_VERT, WALL_FRAG, {
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uGold: { value: GOLD },
      uCore: { value: WARM_WHITE },
    });
    const group = new THREE.Group();
    const ringMesh = new THREE.Mesh(this.planeGeo, ring);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.04;
    // The plane is 2×2 (local ±1). Scale it to world size; uExtent maps local ±1 to world units in the shader.
    ringMesh.scale.setScalar(this.maxRingExtent);
    const wallMesh = new THREE.Mesh(this.wallGeo, wall);
    group.add(ringMesh, wallMesh);
    group.visible = false;
    group.renderOrder = 9;
    this.root.add(group);
    return { group, ring, wall, wallMesh };
  }

  private makeDecal(size: number): Decal {
    const mat = additive(RING_VERT, GLOW_FRAG, {
      uExtent: { value: 1 },
      uAlpha: { value: 0 },
      uCore: { value: WARM_WHITE },
      uGold: { value: AMBER },
    });
    const mesh = new THREE.Mesh(this.planeGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    mesh.scale.setScalar(size);
    mesh.visible = false;
    this.root.add(mesh);
    return { mesh, mat, age: 0, life: 0, peak: 0.8 };
  }

  private placeDecal(x: number, z: number): void {
    let d = this.decals[0]!;
    for (const c of this.decals) if (c.age / (c.life || 1) > d.age / (d.life || 1)) d = c;
    d.mesh.position.set(x, 0.03, z);
    d.age = 0;
    d.life = C.impact.residueMs / 1000;
    d.peak = 0.75;
  }

  /** Deterministic visual RNG (keeps VFX reproducible; never shared with gameplay). */
  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
}

/**
 * Wire VFX to the combat simulation's EXISTING hit events (read-only).
 * Only primitives leave the simulation; the VFX can't reach the zombie object.
 */
export function bindVfxToCombat(
  combat: { onZombieHit(cb: (z: Readonly<{ x: number; y: number; z: number; state: string }>, a: Readonly<Attack>) => void): () => void },
  vfx: Pick<AttackVfx, "impact">,
): () => void {
  return combat.onZombieHit((z, a) => vfx.impact(z.x, z.y, z.z, z.state === "DEFEATED", a.hit.size));
}
