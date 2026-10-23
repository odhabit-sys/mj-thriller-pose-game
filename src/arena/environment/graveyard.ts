import * as THREE from "three";
import { COMBAT_CONFIG } from "../../combat/combatConfig";
import { GRAVEYARD_CONFIG as G } from "./graveyardConfig";
import { createGround, fbm, groundHeight, pathStrength } from "./ground";
import { createGroundFog } from "./groundFog";
import { deadTreeGeometry, detailGeometries, fenceGeometries, gravestoneGeometries, rng } from "./props";
import { createBackdrop } from "./sky";

/**
 * The Thriller-inspired graveyard around the arena. Purely decorative:
 * it never reads or writes gameplay state, has no collisions, and keeps every
 * prop that could block outside the playable circle. Built once; restarts and
 * waves never rebuild it. Repeated props are InstancedMeshes.
 */
const fbmMask = (x: number, z: number) => fbm(x * 0.45 + 13, z * 0.45 + 2);

export interface Placement {
  kind: string;
  x: number;
  z: number;
  /** True for props tall enough to block movement/visibility if placed in the arena. */
  blocking: boolean;
}

export interface GraveyardStats {
  meshes: number;
  instancedMeshes: number;
  instances: number;
  drawCalls: number;
  triangles: number;
}

/** Soft moon shadow decal: dark, fading along its length, instanced. */
const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const SHADOW_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uStrength;
  #include <fog_pars_fragment>
  void main() {
    float along = pow(1.0 - vUv.y, 1.4);
    float across = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    gl_FragColor = vec4(0.01, 0.012, 0.03, along * across * uStrength);
    #include <fog_fragment>
  }
`;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export class Graveyard {
  readonly root = new THREE.Group();
  /** Every scenery placement (for tests / debug). */
  readonly placements: Placement[] = [];
  private readonly animated: { uniforms: Record<string, THREE.IUniform> }[] = [];
  private readonly grassUniforms = { uTime: { value: 0 } };
  /** Shadow casters collected during build: x, z, width, length. */
  private readonly shadowCasters: [number, number, number, number][] = [];
  private time = 0;
  private disposed = false;

  constructor(seed: number = G.seed) {
    this.root.name = "graveyard";
    const rand = rng(seed);
    const P = G.palette;
    const flat = (color: number, rough = 0.95, metal = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });

    // ----- Backdrop sky / moon / hills -----
    const sky = createBackdrop();
    this.root.add(sky.mesh);
    this.animated.push(sky.material);

    // ----- Ground -----
    const details = detailGeometries();
    this.root.add(createGround());
    this.addArenaDetails(rand, flat, details);

    // ----- Gravestones -----
    const stones = gravestoneGeometries();
    const stoneMat = flat(P.stone, 0.92);
    const kinds: [keyof typeof stones, number][] = [
      ["rounded", 0.3],
      ["rect", 0.24],
      ["cross", 0.17],
      ["broken", 0.17],
      ["slab", 0.12],
    ];
    const graves = this.gravestoneSpots(rand);
    const byKind = new Map<string, THREE.Matrix4[]>();
    const colorsByKind = new Map<string, THREE.Color[]>();
    for (const g of graves) {
      let roll = rand();
      let kind: keyof typeof stones = "rounded";
      for (const [k, w] of kinds) {
        if ((roll -= w) <= 0) {
          kind = k;
          break;
        }
      }
      const lean = rand() < 0.25;
      tmpE.set(lean ? (rand() - 0.5) * 0.5 : (rand() - 0.5) * 0.06, g.yaw, lean ? (rand() - 0.5) * 0.45 : (rand() - 0.5) * 0.05);
      const s = 0.85 + rand() * 0.45;
      tmpM.compose(tmpP.set(g.x, groundHeight(g.x, g.z) - 0.04, g.z), tmpQ.setFromEuler(tmpE), tmpS.set(s, s * (0.9 + rand() * 0.25), s));
      (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push(tmpM.clone());
      this.shadowCasters.push([g.x, g.z, 0.65 * s, (kind === "slab" ? 1.1 : 1.6) * s]);
      const shade = new THREE.Color(P.stone).lerp(new THREE.Color(rand() < 0.3 ? P.moss : P.stoneDark), rand() * 0.6);
      (colorsByKind.get(kind) ?? colorsByKind.set(kind, []).get(kind)!).push(shade);
      this.placements.push({ kind: `grave:${kind}`, x: g.x, z: g.z, blocking: true });
    }
    for (const [kind, mats] of byKind) this.addInstanced(stones[kind as keyof typeof stones], stoneMat, mats, colorsByKind.get(kind));
    // Monuments: a few large ones framing the arena.
    const monuments: [number, number, number][] = [
      [-11.2, -6.5, 0.4],
      [10.6, -8.8, -0.5],
      [-14.2, 1.5, 0.9],
    ];
    this.addInstanced(
      stones.monument,
      flat(P.stoneDark, 0.9),
      monuments.map(([x, z, yaw]) => {
        this.placements.push({ kind: "monument", x, z, blocking: true });
        this.shadowCasters.push([x, z, 1.1, 4.2]);
        return new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1.1, 1.15, 1.1));
      }),
    );

    // ----- Dead trees (framing) -----
    const treeGeos = [0, 1, 2, 3].map((i) => deadTreeGeometry(seed * 31 + i * 7, 4 + i * 0.35));
    const bark = flat(P.bark, 1);
    // Framing trees just outside the playable circle at the sides (inside the camera's view),
    // plus a few deeper ones behind the graves.
    const treeSpots: [number, number][] = [
      [-10.5, -3.4],
      [10.8, -4.6],
      [-10.2, -8.2],
      [10.6, 0.8],
      [-11.4, 2.4],
      [6.8, -13.6],
      [-6.6, -14.4],
      [12.6, -10.4],
      [-14.2, -9.6],
    ];
    const treeMats: THREE.Matrix4[][] = [[], [], [], []];
    treeSpots.slice(0, G.counts.trees).forEach(([x, z], i) => {
      const s = 0.95 + rand() * 0.4;
      treeMats[i % 4]!.push(
        new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12)), new THREE.Vector3(s, s, s)),
      );
      this.placements.push({ kind: "tree", x, z, blocking: true });
      this.shadowCasters.push([x, z, 0.55 * s, 7 * s]);
    });
    treeGeos.forEach((g, i) => this.addInstanced(g, bark, treeMats[i]!));
    // Distant silhouette trees against the moonlit backdrop (unlit, unfogged).
    const silhouette = new THREE.MeshBasicMaterial({ color: P.silhouette, fog: false });
    const farMats: THREE.Matrix4[][] = [[], [], [], []];
    for (let i = 0; i < G.counts.distantTrees; i++) {
      const a = -1.6 + (i / (G.counts.distantTrees - 1)) * 3.2 + (rand() - 0.5) * 0.12;
      const r = 17 + rand() * 1.3;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const s = 1.1 + rand() * 0.6;
      farMats[i % 4]!.push(new THREE.Matrix4().compose(new THREE.Vector3(x, -0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)), new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s)));
      this.placements.push({ kind: "distantTree", x, z, blocking: true });
    }
    treeGeos.forEach((g, i) => this.addInstanced(g, silhouette, farMats[i]!));

    // ----- Fence + gate -----
    this.addFence(rand, flat);

    // ----- Ground fog (one draw call) -----
    const fog = createGroundFog(rand);
    this.root.add(fog.mesh);
    this.animated.push(fog.material);

    // ----- Small details -----
    this.addDetails(rand, flat, details);

    // ----- Moon shadows (one instanced draw call) -----
    this.addMoonShadows();
  }

  /** Subtle environment motion only (fog drift, clouds, grass sway). */
  update(dt: number): void {
    this.time += Math.min(dt, 0.1);
    for (const a of this.animated) a.uniforms.uTime!.value = this.time;
    this.grassUniforms.uTime.value = this.time;
  }

  get stats(): GraveyardStats {
    const s: GraveyardStats = { meshes: 0, instancedMeshes: 0, instances: 0, drawCalls: 0, triangles: 0 };
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
      if (o instanceof THREE.InstancedMesh) {
        s.instancedMeshes++;
        s.instances += o.count;
        s.triangles += tris * o.count;
      } else {
        s.meshes++;
        s.triangles += tris;
      }
      s.drawCalls++;
    });
    return s;
  }

  get objectCount(): number {
    let n = 0;
    this.root.traverse(() => n++);
    return n;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geos.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        if (o instanceof THREE.InstancedMesh) o.dispose();
      }
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }

  // -------------------------------------------------------------------------
  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh | null {
    if (matrices.length === 0) return null;
    const m = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
    if (colors) {
      // Instance colors multiply the material color: carry the full tint per instance instead.
      for (const mm of Array.isArray(mat) ? mat : [mat]) if ("color" in mm && mm.color instanceof THREE.Color) mm.color.set(0xffffff);
      colors.forEach((c, i) => m.setColorAt(i, c));
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    this.root.add(m);
    return m;
  }

  private addMoonShadows(): void {
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2); // base at origin, extends +Z
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: { ...THREE.UniformsLib.fog, uStrength: { value: G.moonShadow.strength } },
    });
    const yaw = G.moonShadow.yaw;
    const mats = this.shadowCasters.map(([x, z, w, len]) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, groundHeight(x, z) + 0.02, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
        new THREE.Vector3(w, 1, len),
      ),
    );
    const m = this.addInstanced(geo, mat, mats);
    if (m) m.renderOrder = 1;
  }

  /** Jittered rows of graves outside the arena, leaving the gate path open. */
  private gravestoneSpots(rand: () => number): { x: number; z: number; yaw: number }[] {
    const clear = G.arenaRadius + G.clearMargin + 0.05;
    const spots: { x: number; z: number; yaw: number }[] = [];
    for (let row = -17; row <= 7; row += 1.55) {
      for (let col = -17; col <= 17; col += 1.3) {
        const x = col + (rand() - 0.5) * 0.7;
        const z = row + (rand() - 0.5) * 0.5;
        const r = Math.hypot(x, z);
        if (r < clear || r > 16.6) continue;
        if (pathStrength(x, z) > 0.05 || (Math.abs(x) < 2.6 && z < -13)) continue; // path + gate
        if (rand() > 0.55) continue;
        spots.push({ x, z, yaw: (rand() - 0.5) * 0.5 });
      }
    }
    // Shuffle, then keep the configured number.
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [spots[i], spots[j]] = [spots[j]!, spots[i]!];
    }
    return spots.slice(0, G.counts.gravestones);
  }

  private addFence(rand: () => number, flat: (c: number, r?: number, m?: number) => THREE.MeshStandardMaterial): void {
    const F = G.fence;
    const geo = fenceGeometries();
    const iron = flat(G.palette.iron, 0.6, 0.5);
    const stone = flat(G.palette.stoneDark, 0.95);
    const deg = Math.PI / 180;
    const R = F.radius;
    const toXZ = (a: number) => [Math.sin(a) * R, -Math.cos(a) * R] as const;
    // Two broken stretches.
    const gaps: [number, number][] = [
      [-48 + rand() * 6, -40 + rand() * 4],
      [30 + rand() * 6, 37 + rand() * 4],
    ];
    const inGap = (d: number) => Math.abs(d) < F.gateHalfWidthDeg || gaps.some(([a, b]) => d > a && d < b);
    const bars: THREE.Matrix4[] = [];
    const barStep = F.barSpacing / R;
    for (let a = F.fromDeg * deg; a <= F.toDeg * deg; a += barStep) {
      if (inGap(a / deg) || rand() < 0.08) continue; // missing bars
      const [x, z] = toXZ(a);
      const tilt = rand() < 0.07 ? (rand() - 0.5) * 0.6 : (rand() - 0.5) * 0.04;
      bars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), tmpQ.setFromEuler(tmpE.set(tilt, -a, (rand() - 0.5) * 0.05)).clone(), new THREE.Vector3(1, 0.9 + rand() * 0.15, 1)));
    }
    this.addInstanced(geo.bar, iron, bars);
    // Posts + rails between neighbouring posts.
    const posts: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const postStep = F.postEvery / R;
    let prev: number | null = null;
    for (let a = F.fromDeg * deg; a <= F.toDeg * deg + 1e-6; a += postStep) {
      const d = a / deg;
      if (Math.abs(d) < F.gateHalfWidthDeg + 2) {
        prev = null;
        continue;
      }
      const [x, z] = toXZ(a);
      posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), tmpQ.setFromEuler(tmpE.set(0, -a, 0)).clone(), new THREE.Vector3(1, 1, 1)));
      this.placements.push({ kind: "fencePost", x, z, blocking: true });
      this.shadowCasters.push([x, z, 0.35, 2.6]);
      if (prev !== null && !inGap((prev + a) / 2 / deg)) {
        const [px, pz] = toXZ(prev);
        const mx = (x + px) / 2;
        const mz = (z + pz) / 2;
        const len = Math.hypot(x - px, z - pz);
        for (const y of [0.35, 1.2]) {
          rails.push(new THREE.Matrix4().compose(new THREE.Vector3(mx, groundHeight(mx, mz) + y, mz), tmpQ.setFromEuler(tmpE.set(0, -(a + prev) / 2, (rand() - 0.5) * 0.03)).clone(), new THREE.Vector3(len, 1, 1)));
        }
      }
      prev = a;
    }
    this.addInstanced(geo.post, stone, posts);
    this.addInstanced(geo.rail, iron, rails);
    // Gate on the path behind MJ.
    const gate = new THREE.Mesh(geo.gate, iron);
    gate.position.set(0, groundHeight(0, -R), -R);
    this.root.add(gate);
    this.placements.push({ kind: "gate", x: 0, z: -R, blocking: true });
    this.shadowCasters.push([0, -R, 3.4, 4.8]);
  }

  /** Flat details that integrate the gameplay circle: a stone dais under MJ and flagstones along the attack ring. */
  private addArenaDetails(
    rand: () => number,
    flat: (c: number, r?: number, m?: number) => THREE.MeshStandardMaterial,
    d: ReturnType<typeof detailGeometries>,
  ): void {
    const stone = flat(G.palette.stoneDark, 0.95);
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.02, 8), stone);
    dais.position.y = 0.0;
    dais.rotation.y = Math.PI / 8;
    this.root.add(dais);
    // Broken ring of flagstones on the attack radius (flush with the ground).
    const A = COMBAT_CONFIG.attack.attackRadius;
    const slabs: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const n = 58;
    for (let i = 0; i < n; i++) {
      if (rand() < 0.14) continue; // missing stones
      const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.05;
      const r = A + (rand() - 0.5) * 0.18;
      slabs.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(a) * r, 0.006, Math.cos(a) * r),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a + (rand() - 0.5) * 0.25, 0)),
          new THREE.Vector3(0.3 + rand() * 0.12, 0.014, 0.4 + rand() * 0.16),
        ),
      );
      colors.push(new THREE.Color(G.palette.stoneDark).lerp(new THREE.Color(G.palette.soilWarm), 0.25 + rand() * 0.3));
    }
    this.addInstanced(d.paver, flat(G.palette.stone, 0.95), slabs, colors);

    // Broken paving remnants: a few clusters of sunken, earth-stained flagstones (flush, never raised).
    const paving: THREE.Matrix4[] = [];
    const pcol: THREE.Color[] = [];
    const clusters: [number, number][] = [];
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const r = 2 + rand() * (G.arenaRadius - 2.8);
      clusters.push([Math.sin(a) * r, Math.cos(a) * r]);
    }
    let guard = 0;
    while (paving.length < G.counts.paving && guard++ < 4000) {
      const [cx, cz] = clusters[paving.length % clusters.length]!;
      const x = cx + (rand() - 0.5) * 2.4;
      const z = cz + (rand() - 0.5) * 2.0;
      const r = Math.hypot(x, z);
      if (r < 1.5 || r > G.arenaRadius - 0.3 || Math.abs(r - A) < 0.45) continue; // keep the attack ring readable
      if (fbmMask(x, z) < 0.4) continue; // broken, irregular edges
      if (paving.some((m) => Math.hypot(m.elements[12]! - x, m.elements[14]! - z) < 0.42)) continue; // no overlaps
      const sz = 0.28 + rand() * 0.3;
      paving.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0.004, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI, 0)),
          new THREE.Vector3(sz, 0.01, sz * (0.8 + rand() * 0.4)),
        ),
      );
      pcol.push(new THREE.Color(G.palette.stoneDark).lerp(new THREE.Color(rand() < 0.3 ? G.palette.moss : G.palette.soilWarm), 0.2 + rand() * 0.45));
    }
    this.addInstanced(d.paver, flat(G.palette.stone, 1), paving, pcol);
  }

  private addDetails(
    rand: () => number,
    flat: (c: number, r?: number, m?: number) => THREE.MeshStandardMaterial,
    d: ReturnType<typeof detailGeometries>,
  ): void {
    const P = G.palette;
    const R = G.arenaRadius;
    const clear = R + G.clearMargin;
    const scatter = (count: number, rMin: number, rMax: number, opts: { backBias?: number } = {}) => {
      const out: { x: number; z: number }[] = [];
      let guard = 0;
      while (out.length < count && guard++ < count * 20) {
        const a = rand() * Math.PI * 2;
        const r = rMin + Math.sqrt(rand()) * (rMax - rMin);
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        if (z > 8) continue; // behind the camera
        if (opts.backBias && z > 0 && rand() < opts.backBias) continue;
        out.push({ x, z });
      }
      return out;
    };
    const mat = (x: number, z: number, s: number, yaw: number, sy = s, y = 0) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) + y, z), tmpQ.setFromEuler(tmpE.set(0, yaw, 0)).clone(), new THREE.Vector3(s, sy, s));

    // Grass: dense outside, sparse tufts at the arena edge, none near MJ. Sways subtly.
    const grassSpots = [...scatter(Math.floor(G.counts.grass * 0.75), clear, 17), ...scatter(Math.floor(G.counts.grass * 0.25), 2.6, R)];
    const grassMat = flat(P.grassDead, 1);
    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grassUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
            transformed.x += sin(uTime * 1.3 + ph) * 0.05 * transformed.y;
            transformed.z += cos(uTime * 1.1 + ph) * 0.03 * transformed.y;
          #endif`,
        );
    };
    grassMat.customProgramCacheKey = () => "graveyard-grass";
    this.addInstanced(
      d.grass,
      grassMat,
      // Trampled (short) inside the playable circle, taller among the graves.
      grassSpots.map((p) => mat(p.x, p.z, (Math.hypot(p.x, p.z) < R ? 0.35 : 0.55) + rand() * 0.55, rand() * 6.28)),
      grassSpots.map(() => new THREE.Color(P.grassDead).lerp(new THREE.Color(P.grassCold), rand())),
    );

    // Rocks (outside the arena; small pebbles allowed near the edge).
    const rockSpots = scatter(G.counts.rocks, clear, 17);
    const rocks = rockSpots.map((p) => mat(p.x, p.z, 0.4 + rand() * 1.1, rand() * 6.28, 0.3 + rand() * 0.6, -0.04));
    for (const p of rockSpots) this.placements.push({ kind: "rock", x: p.x, z: p.z, blocking: true });
    const pebbles = scatter(18, 5.5, R - 0.3).map((p) => mat(p.x, p.z, 0.22 + rand() * 0.15, rand() * 6.28, 0.15, -0.02));
    for (const m of pebbles) {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      this.placements.push({ kind: "pebble", x: p.x, z: p.z, blocking: false });
    }
    this.addInstanced(d.rock, flat(P.rock, 0.95), [...rocks, ...pebbles]);

    // Broken stone shards near graves.
    const shardSpots = scatter(G.counts.shards, clear + 0.4, 16, { backBias: 0.5 });
    this.addInstanced(d.shard, flat(P.stoneDark, 0.95), shardSpots.map((p) => mat(p.x, p.z, 0.6 + rand() * 0.8, rand() * 6.28, 0.5, 0)));
    for (const p of shardSpots) this.placements.push({ kind: "shard", x: p.x, z: p.z, blocking: true });

    // Fallen branches.
    const branchSpots = scatter(G.counts.branches, clear, 16.5);
    this.addInstanced(d.branch, flat(P.bark, 1), branchSpots.map((p) => mat(p.x, p.z, 0.7 + rand() * 0.6, rand() * 6.28, 0.7, 0.03)));
    for (const p of branchSpots) this.placements.push({ kind: "branch", x: p.x, z: p.z, blocking: true });

    // Pale, faintly glowing mushrooms clustered at tree roots.
    const shroomSpots: { x: number; z: number }[] = [];
    const roots: [number, number][] = [
      [-10.5, -3.4],
      [10.8, -4.6],
      [-10.2, -8.2],
      [10.6, 0.8],
    ];
    for (let i = 0; i < G.counts.mushrooms; i++) {
      const [tx, tz] = roots[i % roots.length]!;
      const a = rand() * 6.28;
      const r = 0.5 + rand() * 0.9;
      shroomSpots.push({ x: tx + Math.cos(a) * r, z: tz + Math.sin(a) * r });
    }
    const shroomMats = shroomSpots.map((p) => mat(p.x, p.z, 0.8 + rand() * 1.0, rand() * 6.28));
    this.addInstanced(d.mushroomStem, flat(0x9aa6b4, 0.9), shroomMats);
    const cap = flat(P.mushroom, 0.6);
    cap.emissive = new THREE.Color(0x6f9cc8);
    cap.emissiveIntensity = 0.35;
    this.addInstanced(d.mushroomCap, cap, shroomMats);

    // Scattered dead leaves (flat; fine anywhere except right under MJ).
    const leafSpots = scatter(G.counts.leaves, 2.2, 16.5);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    this.addInstanced(
      d.leaf,
      leafMat,
      leafSpots.map((p) => mat(p.x, p.z, 0.8 + rand() * 0.8, rand() * 6.28, 1, 0.012)),
      leafSpots.map(() => new THREE.Color(P.leaf).lerp(new THREE.Color(rand() < 0.5 ? 0x5a3a22 : 0x3a3430), rand())),
    );
  }
}
