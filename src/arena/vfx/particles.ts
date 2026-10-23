import * as THREE from "three";

/**
 * Pooled additive particles: ONE THREE.Points draw call, fixed-size typed
 * arrays, ring-buffer allocation (oldest particle is recycled when full).
 * Nothing is allocated after construction.
 */
export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  /** World-space size. */
  size: number;
  color: THREE.Color;
  alpha?: number;
  /** Exponential velocity damping per second. */
  drag?: number;
  /** Downward acceleration (negative = rises). */
  gravity?: number;
  /** End size as a fraction of start size. */
  shrink?: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 1.8);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

export class ParticlePool {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly shrink: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor(readonly capacity: number) {
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.shrink = new Float32Array(n);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // never culled
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Pixel-size scale (call on resize: ~ viewport height / (2·tan(fov/2))). */
  setScale(s: number): void {
    this.mat.uniforms.uScale!.value = s;
  }

  spawn(p: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.life[i]! <= 0) this.alive++;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx;
    this.vel[i3 + 1] = p.vy;
    this.vel[i3 + 2] = p.vz;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.baseSize[i] = p.size;
    this.baseAlpha[i] = p.alpha ?? 1;
    this.drag[i] = p.drag ?? 0;
    this.gravity[i] = p.gravity ?? 0;
    this.shrink[i] = p.shrink ?? 0.3;
    const i4 = i * 4;
    this.col[i4] = p.color.r;
    this.col[i4 + 1] = p.color.g;
    this.col[i4 + 2] = p.color.b;
    this.col[i4 + 3] = this.baseAlpha[i]!;
    this.size[i] = p.size;
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      let l = this.life[i]!;
      if (l <= 0) continue;
      l -= dt;
      this.life[i] = l;
      const i3 = i * 3;
      const i4 = i * 4;
      if (l <= 0) {
        this.size[i] = 0;
        this.col[i4 + 3] = 0;
        continue;
      }
      alive++;
      const damp = Math.exp(-this.drag[i]! * dt);
      this.vel[i3]! *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * damp - this.gravity[i]! * dt;
      this.vel[i3 + 2]! *= damp;
      this.pos[i3]! += this.vel[i3]! * dt;
      this.pos[i3 + 1] = Math.max(0.02, this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt);
      this.pos[i3 + 2]! += this.vel[i3 + 2]! * dt;
      const t = 1 - l / this.maxLife[i]!; // 0 → 1
      this.size[i] = this.baseSize[i]! * (1 - t * (1 - this.shrink[i]!));
      this.col[i4 + 3] = this.baseAlpha[i]! * (1 - t) * (1 - t * 0.3);
    }
    this.alive = alive;
    const g = this.geo.attributes;
    g.position!.needsUpdate = true;
    g.aColor!.needsUpdate = true;
    g.aSize!.needsUpdate = true;
  }

  get aliveCount(): number {
    return this.alive;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    for (let i = 0; i < this.capacity; i++) this.col[i * 4 + 3] = 0;
    this.alive = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Pooled directional streaks: ONE LineSegments draw call. Each streak is a short
 * line from its head back along its velocity, so motion reads as a "zip".
 */
export class StreakPool {
  readonly lines: THREE.LineSegments;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.LineBasicMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly head: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly len: Float32Array;
  private readonly rgb: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor(readonly capacity: number) {
    const n = capacity;
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 8);
    this.head = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.len = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 11;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, len: number, color: THREE.Color): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.life[i]! <= 0) this.alive++;
    const i3 = i * 3;
    this.head[i3] = x;
    this.head[i3 + 1] = y;
    this.head[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.rgb[i3] = color.r;
    this.rgb[i3 + 1] = color.g;
    this.rgb[i3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.len[i] = len;
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const i3 = i * 3;
      const i6 = i * 6;
      const i8 = i * 8;
      let l = this.life[i]!;
      if (l <= 0) {
        this.col[i8 + 3] = 0;
        this.col[i8 + 7] = 0;
        continue;
      }
      l -= dt;
      this.life[i] = l;
      if (l <= 0) {
        this.col[i8 + 3] = 0;
        this.col[i8 + 7] = 0;
        continue;
      }
      alive++;
      const damp = Math.exp(-5 * dt);
      for (let k = 0; k < 3; k++) {
        this.vel[i3 + k]! *= damp;
        this.head[i3 + k]! += this.vel[i3 + k]! * dt;
      }
      const speed = Math.hypot(this.vel[i3]!, this.vel[i3 + 1]!, this.vel[i3 + 2]!) || 1;
      const tail = this.len[i]! / speed;
      for (let k = 0; k < 3; k++) {
        this.pos[i6 + k] = this.head[i3 + k]!;
        this.pos[i6 + 3 + k] = this.head[i3 + k]! - this.vel[i3 + k]! * tail;
      }
      const a = l / this.maxLife[i]!;
      for (let k = 0; k < 3; k++) {
        this.col[i8 + k] = this.rgb[i3 + k]!;
        this.col[i8 + 4 + k] = this.rgb[i3 + k]! * 0.6;
      }
      this.col[i8 + 3] = a;
      this.col[i8 + 7] = 0; // tail fades to nothing
    }
    this.alive = alive;
    this.geo.attributes.position!.needsUpdate = true;
    this.geo.attributes.color!.needsUpdate = true;
  }

  get aliveCount(): number {
    return this.alive;
  }

  clear(): void {
    this.life.fill(0);
    this.col.fill(0);
    this.alive = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
