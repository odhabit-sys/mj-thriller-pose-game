import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Geometry builders for the stylized Thriller-era MJ. Everything is generated
 * procedurally (no external model) and merged per material, so the character
 * stays a few dozen draw calls. Geometry is spent on the silhouette (head, hair,
 * shoulders, hands, shoes); flat clothing areas stay low-poly.
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic PRNG so the hair/curls are identical every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns geo transformed by position / euler rotation / scale. */
export function placed(
  geo: THREE.BufferGeometry,
  pos: THREE.Vector3Like = { x: 0, y: 0, z: 0 },
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos.x, pos.y, pos.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  return geo.applyMatrix4(m);
}

/** Merge geometries of one material (normalises attributes: position + normal, non-indexed). */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map((g) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    return n;
  });
  const out = mergeGeometries(list, false);
  if (!out) throw new Error("mjGeometry: merge failed");
  for (const g of geos) g.dispose();
  return out;
}

/** Capsule between two points (fingers, brows, lips, curl chains). */
export function segment(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const geo = new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 2, radial);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
}

// ---------------------------------------------------------------------------
// Lofted surfaces (torso, sleeves, legs)
// ---------------------------------------------------------------------------
export interface Ring {
  y: number;
  /** Half-width (x) and half-depth (z). */
  rx: number;
  rz: number;
  /** Centre offset. */
  cx?: number;
  cz?: number;
  /** Superellipse exponent: 2 = ellipse, >2 = squarer (structured shoulders). */
  n?: number;
}

/** Point on a ring at angle θ (θ = 0 faces +Z / front, θ = +π/2 is +X / his left). */
export function ringPoint(r: Ring, theta: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 2 / (r.n ?? 2);
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  return out.set(
    (r.cx ?? 0) + r.rx * Math.sign(s) * Math.abs(s) ** e,
    r.y,
    (r.cz ?? 0) + r.rz * Math.sign(c) * Math.abs(c) ** e,
  );
}

/** Ring parameters interpolated at height y (rings sorted by ascending y). */
export function ringAt(rings: Ring[], y: number): Ring {
  if (y <= rings[0]!.y) return { ...rings[0]!, y };
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      return {
        y,
        rx: lerp(a.rx, b.rx, t),
        rz: lerp(a.rz, b.rz, t),
        cx: lerp(a.cx ?? 0, b.cx ?? 0, t),
        cz: lerp(a.cz ?? 0, b.cz ?? 0, t),
        n: lerp(a.n ?? 2, b.n ?? 2, t),
      };
    }
  }
  return { ...rings[rings.length - 1]!, y };
}

export interface LoftOptions {
  segments?: number;
  /** Open surface: per-height angular range [start, end] (front opening of the jacket). */
  arc?: (y: number) => [number, number];
  capTop?: boolean;
  capBottom?: boolean;
}

/** Surface through cross-section rings (ascending y). Outward-facing, smooth normals. */
export function loft(rings: Ring[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const seg = opts.segments ?? 12;
  const closed = !opts.arc;
  const cols = closed ? seg : seg + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (const r of rings) {
    const [a0, a1] = opts.arc ? opts.arc(r.y) : [0, Math.PI * 2];
    for (let j = 0; j < cols; j++) {
      ringPoint(r, a0 + ((a1 - a0) * j) / seg, p);
      pos.push(p.x, p.y, p.z);
    }
  }
  const at = (i: number, j: number) => i * cols + (closed ? j % cols : j);
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = at(i, j);
      const b = at(i, j + 1);
      const c = at(i + 1, j);
      const d = at(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  if (closed && (opts.capBottom || opts.capTop)) {
    const cap = (ring: number, top: boolean) => {
      const r = rings[ring]!;
      const center = pos.length / 3;
      pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
      for (let j = 0; j < seg; j++) {
        const v0 = at(ring, j);
        const v1 = at(ring, j + 1);
        if (top) idx.push(center, v0, v1);
        else idx.push(center, v1, v0);
      }
    };
    if (opts.capBottom) cap(0, false);
    if (opts.capTop) cap(rings.length - 1, true);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Point + outward normal on a loft surface at (θ, y). */
export function surfaceFrame(rings: Ring[], theta: number, y: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const e = 1e-3;
  const p = ringPoint(ringAt(rings, y), theta);
  const dT = ringPoint(ringAt(rings, y), theta + e).sub(p);
  const dY = ringPoint(ringAt(rings, y + e), theta).sub(p);
  const n = new THREE.Vector3().crossVectors(dT, dY).normalize();
  return { p, n };
}

/**
 * Flat trim strip lying on a loft surface along a path of (θ, y) points:
 * leather stripes, piping, seams. Lifted slightly off the surface.
 */
export function surfaceRibbon(rings: Ring[], path: [number, number][], width: number, lift = 0.004): THREE.BufferGeometry {
  const frames = path.map(([t, y]) => surfaceFrame(rings, t, y));
  const pos: number[] = [];
  const idx: number[] = [];
  frames.forEach((f, i) => {
    const prev = frames[Math.max(0, i - 1)]!.p;
    const next = frames[Math.min(frames.length - 1, i + 1)]!.p;
    const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, f.n).normalize().multiplyScalar(width / 2);
    const c = f.p.clone().addScaledVector(f.n, lift);
    pos.push(c.x - side.x, c.y - side.y, c.z - side.z, c.x + side.x, c.y + side.y, c.z + side.z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Path helper: n points from (θ0,y0) to (θ1,y1). */
export function line(t0: number, y0: number, t1: number, y1: number, n = 8): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => [lerp(t0, t1, i / n), lerp(y0, y1, i / n)] as [number, number]);
}

// ---------------------------------------------------------------------------
// Head: one sculpted, smooth-shaded skull + face features
// ---------------------------------------------------------------------------
export const HEAD_R = 0.126;

/**
 * Sculpt function: unit direction → surface point. Narrow face, defined jaw and
 * chin, high cheekbones, eye sockets, fuller back of the skull.
 */
export function headPoint(dir: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const d = dir;
  let x = d.x;
  let y = d.y;
  let z = d.z;
  const front = Math.max(0, z);
  // Jaw: narrows below the cheekbones toward a defined chin.
  const jaw = smoothstep(0.05, -0.9, y);
  x *= 1 - 0.3 * jaw;
  z *= 1 - 0.08 * jaw * (z < 0 ? 1.5 : 0);
  // Chin: pulled slightly forward and down at the bottom front.
  const chin = smoothstep(-0.55, -0.92, y) * front;
  z += 0.1 * chin;
  y -= 0.05 * chin;
  // Jaw angle: a subtle corner below the ears.
  const ang = Math.exp(-((Math.abs(d.x) - 0.7) ** 2 + (d.y + 0.45) ** 2 + (d.z - 0.25) ** 2) / 0.02);
  x += Math.sign(d.x) * 0.035 * ang;
  // Cheekbones.
  const cheek = Math.exp(-((Math.abs(d.x) - 0.58) ** 2 + (d.y - 0.02) ** 2 + (d.z - 0.75) ** 2) / 0.025);
  // Eye sockets.
  const eye = Math.exp(-((Math.abs(d.x) - 0.36) ** 2 + (d.y - 0.14) ** 2 + (d.z - 0.9) ** 2) / 0.012);
  // Brow ridge.
  const brow = Math.exp(-((Math.abs(d.x) - 0.3) ** 2 + (d.y - 0.3) ** 2 + (d.z - 0.88) ** 2) / 0.03);
  const bump = 0.05 * cheek - 0.05 * eye + 0.02 * brow;
  x += d.x * bump;
  y += d.y * bump;
  z += d.z * bump;
  // Slightly flatter face plane; fuller back of the head.
  if (z > 0) z *= 0.97;
  else z *= 1.06;
  return out.set(x * 0.84 * HEAD_R, y * 1.08 * HEAD_R, z * 0.96 * HEAD_R);
}

const dirv = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
/** Surface point of the sculpted head in direction (x,y,z), pushed out along the direction by `out`. */
export function faceAt(x: number, y: number, z: number, out = 0): THREE.Vector3 {
  const d = dirv(x, y, z);
  return headPoint(d).addScaledVector(d, out);
}

export interface HeadParts {
  skin: THREE.BufferGeometry; // smooth: skull, ears
  nose: THREE.BufferGeometry; // faceted skin
  eyes: THREE.BufferGeometry; // whites
  dark: THREE.BufferGeometry; // irises, brows
  lips: THREE.BufferGeometry;
}

export function buildHeadParts(): HeadParts {
  const skull = new THREE.SphereGeometry(1, 30, 22);
  const p = skull.attributes.position!;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    headPoint(v, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  skull.computeVertexNormals();

  const skin: THREE.BufferGeometry[] = [skull];
  for (const s of [1, -1]) {
    const ear = placed(new THREE.SphereGeometry(1, 10, 8), faceAt(s, 0.02, -0.08, -0.004), [0, s * 0.35, s * -0.15], [0.016, 0.034, 0.024]);
    const lobe = placed(new THREE.SphereGeometry(1, 8, 6), faceAt(s, -0.2, -0.02, -0.002), [0, 0, 0], [0.012, 0.012, 0.012]);
    skin.push(ear, lobe);
  }

  // Nose: slim bridge with a defined tip and narrow wings (faceted).
  const top = faceAt(0, 0.16, 1, 0.003);
  const midL = faceAt(0.05, -0.02, 1, 0.006);
  const midR = faceAt(-0.05, -0.02, 1, 0.006);
  const tip = faceAt(0, -0.17, 1, 0.022);
  const wingL = faceAt(0.095, -0.235, 0.98, 0.008);
  const wingR = faceAt(-0.095, -0.235, 0.98, 0.008);
  const base = faceAt(0, -0.27, 1, 0.01);
  const tris = [top, midL, tip, top, tip, midR, midL, wingL, tip, midR, tip, wingR, wingL, base, tip, wingR, tip, base];
  const nose = new THREE.BufferGeometry();
  nose.setAttribute("position", new THREE.Float32BufferAttribute(tris.flatMap((t) => [t.x, t.y, t.z]), 3));
  nose.computeVertexNormals();

  const eyes: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    // Almond eyes sitting in the sockets, turned with the face curvature.
    const c = faceAt(0.36 * s, 0.13, 0.92, 0.002);
    eyes.push(placed(new THREE.SphereGeometry(1, 12, 8), c, [0, s * 0.38, s * -0.08], [0.019, 0.0085, 0.007]));
    const iris = faceAt(0.35 * s, 0.13, 0.93, 0.008);
    dark.push(placed(new THREE.SphereGeometry(1, 8, 6), iris, [0, s * 0.38, 0], [0.0088, 0.0088, 0.0045]));
    // Upper lash line: a thin dark arc that defines the eye at distance.
    dark.push(segment(faceAt(0.23 * s, 0.165, 0.95, 0.007), faceAt(0.47 * s, 0.165, 0.86, 0.007), 0.0035, 4));
    dark.push(segment(faceAt(0.25 * s, 0.1, 0.95, 0.005), faceAt(0.45 * s, 0.105, 0.87, 0.005), 0.0018, 4));
    // Brows: slim, arched.
    dark.push(segment(faceAt(0.15 * s, 0.3, 0.97, 0.006), faceAt(0.33 * s, 0.35, 0.92, 0.006), 0.0045, 4));
    dark.push(segment(faceAt(0.33 * s, 0.35, 0.92, 0.006), faceAt(0.52 * s, 0.3, 0.8, 0.005), 0.0038, 4));
  }

  // Lips: subtle, a touch fuller lower lip.
  const lips = merge([
    segment(faceAt(-0.17, -0.44, 0.94, 0.006), faceAt(0.17, -0.44, 0.94, 0.006), 0.0065, 6),
    segment(faceAt(-0.13, -0.52, 0.92, 0.006), faceAt(0.13, -0.52, 0.92, 0.006), 0.0078, 6),
  ]);

  return { skin: merge(skin), nose, eyes: merge(eyes), dark: merge(dark), lips };
}

// ---------------------------------------------------------------------------
// Hair: Thriller-era curls (one merged mesh)
// ---------------------------------------------------------------------------
/** Lowest d.y the hair reaches in direction d: hairline at the forehead, temples, ears, nape. */
function hairlineY(d: THREE.Vector3): number {
  const frontLine = 0.5 - 0.42 * Math.abs(d.x) ** 1.4; // forehead → temples
  const w = smoothstep(-0.15, 0.45, d.z); // 0 back … 1 front
  return lerp(-0.42, frontLine, w);
}

export function buildHair(seed = 1958): THREE.BufferGeometry {
  const rand = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const shell = (d: THREE.Vector3, extra: number) =>
    // Moderate volume: a little fuller on top and at the back, close at the sides.
    headPoint(d).addScaledVector(d, 0.006 + extra + 0.009 * Math.max(0, d.y) + 0.006 * Math.max(0, -d.z));

  // Base cap following the skull inside the hairline.
  const cap = new THREE.SphereGeometry(1, 28, 20).toNonIndexed();
  const cp = cap.attributes.position!;
  const keep: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < cp.count; i += 3) {
    a.fromBufferAttribute(cp, i).normalize();
    b.fromBufferAttribute(cp, i + 1).normalize();
    c.fromBufferAttribute(cp, i + 2).normalize();
    const m = a.clone().add(b).add(c).normalize();
    if (m.y < hairlineY(m)) continue;
    for (const v of [a, b, c]) {
      const s = shell(v, 0);
      keep.push(s.x, s.y, s.z);
    }
  }
  cap.dispose();
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
  capGeo.computeVertexNormals();
  parts.push(capGeo);

  // Many small, elongated curls lying along the head and "falling" downhill:
  // a layered jheri-curl texture instead of a few big balls.
  const N = 900;
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const twist = new THREE.Quaternion();
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    const d = new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);
    if (d.y < hairlineY(d) + 0.02) continue;
    if (rand() < 0.55) continue;
    const size = 0.0095 + rand() * 0.006;
    const pos = shell(d, 0.002 + rand() * 0.004);
    // Long axis along the downhill tangent of the head surface.
    const t = new THREE.Vector3(0, -1, 0).addScaledVector(d, d.y);
    if (t.lengthSq() < 1e-4) t.set(rand() - 0.5, 0, rand() - 0.5);
    q.setFromUnitVectors(up, t.normalize().negate());
    twist.setFromAxisAngle(up, rand() * Math.PI);
    q.multiply(twist);
    const g = new THREE.SphereGeometry(1, 6, 4); // smooth-shaded: rounded curls, not shards
    g.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(size, size * (1.5 + rand() * 0.6), size * 0.9)));
    parts.push(g);
  }

  // Ringlet chains: forehead curls, curls over the ears, curls at the nape.
  const chain = (d0: THREE.Vector3, drop: number, links: number, r0: number, sway: number) => {
    let p = shell(d0.clone().normalize(), 0.004);
    for (let k = 0; k < links; k++) {
      const r = r0 * (1 - k * 0.12);
      const next = p.clone().add(new THREE.Vector3(((k % 2) * 2 - 1) * sway, -drop, 0.002));
      parts.push(placed(new THREE.IcosahedronGeometry(1, 1), p, [rand() * 0.6, rand() * 6, 0], [r, r * 1.35, r]));
      p = next;
    }
  };
  // Forehead: a few loose curls falling toward the brows (off-centre, like the video).
  chain(new THREE.Vector3(-0.24, 0.5, 0.84), 0.015, 3, 0.011, 0.004);
  chain(new THREE.Vector3(-0.02, 0.54, 0.85), 0.017, 4, 0.011, 0.005);
  chain(new THREE.Vector3(0.22, 0.5, 0.84), 0.015, 3, 0.01, 0.004);
  // Sides: curls framing the face, partly over the ears.
  for (const s of [1, -1]) {
    chain(new THREE.Vector3(0.88 * s, 0.28, 0.25), 0.017, 4, 0.012, 0.004);
    chain(new THREE.Vector3(0.95 * s, 0.22, -0.05), 0.018, 5, 0.013, 0.004);
    chain(new THREE.Vector3(0.78 * s, 0.15, -0.5), 0.018, 4, 0.013, 0.005);
  }
  // Nape: hair reaching the collar.
  for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) chain(new THREE.Vector3(x, -0.25, -0.88), 0.018, 3, 0.013, 0.004);

  return merge(parts);
}

// ---------------------------------------------------------------------------
// Hands (palm + fingers + thumb, one mesh). Hangs down from the wrist (−Y).
// side: +1 his left hand, −1 his right.
// ---------------------------------------------------------------------------
export function buildHand(side: 1 | -1, glove: boolean): THREE.BufferGeometry {
  const k = glove ? 1.08 : 1; // glove reads a touch fuller
  const parts: THREE.BufferGeometry[] = [];
  // Palm: a rounded slab, thin front-to-back.
  parts.push(placed(new THREE.SphereGeometry(1, 12, 10), { x: 0, y: -0.052, z: 0 }, [0, 0, 0], [0.036 * k, 0.046 * k, 0.016 * k]));
  // Wrist / glove cuff.
  parts.push(placed(new THREE.CylinderGeometry(0.026 * k, 0.03 * k, 0.03, 10), { x: 0, y: -0.012, z: 0 }, [0, 0, 0], [1, 1, 0.7]));
  // Fingers: four slightly curled capsules, middle longest.
  const lengths = [0.04, 0.047, 0.045, 0.036];
  const xs = [0.021, 0.007, -0.007, -0.021];
  for (let i = 0; i < 4; i++) {
    const x = xs[i]! * side * k;
    const base = new THREE.Vector3(x, -0.088 * k, 0.002);
    const mid = base.clone().add(new THREE.Vector3(x * 0.08, -lengths[i]! * 0.55, 0.008));
    const tip = mid.clone().add(new THREE.Vector3(x * 0.05, -lengths[i]! * 0.45, 0.014));
    parts.push(segment(base, mid, 0.0078 * k, 6), segment(mid, tip, 0.007 * k, 6));
  }
  // Thumb: from the inner palm, angled forward.
  const t0 = new THREE.Vector3(-0.03 * side * k, -0.04, 0.008);
  const t1 = new THREE.Vector3(-0.045 * side * k, -0.068, 0.02);
  const t2 = new THREE.Vector3(-0.043 * side * k, -0.092, 0.028);
  parts.push(segment(t0, t1, 0.009 * k, 6), segment(t1, t2, 0.0078 * k, 6));
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Loafer: glossy black, slim and slightly pointed, low heel. Origin = ankle, sole at y ≈ −0.035.
// ---------------------------------------------------------------------------
export function buildLoafer(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Upper: a long half-ellipsoid, tapered toward the toe.
  const upper = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = upper.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const taper = z > 0 ? 1 - 0.32 * z : 1; // narrower toward the toe
    p.setX(i, p.getX(i) * taper);
  }
  upper.computeVertexNormals();
  parts.push(placed(upper, { x: 0, y: -0.027, z: 0.055 }, [0, 0, 0], [0.054, 0.052, 0.14]));
  // Sole + heel.
  parts.push(placed(new THREE.CylinderGeometry(1, 1, 1, 16), { x: 0, y: -0.03, z: 0.055 }, [0, 0, 0], [0.056, 0.012, 0.142]));
  parts.push(placed(new THREE.BoxGeometry(0.09, 0.022, 0.07), { x: 0, y: -0.025, z: -0.04 }));
  // Penny-loafer strap across the instep.
  parts.push(placed(new THREE.TorusGeometry(1, 0.06, 4, 16, Math.PI), { x: 0, y: -0.004, z: 0.1 }, [0, 0, 0], [0.042, 0.03, 0.03]));
  return merge(parts);
}
