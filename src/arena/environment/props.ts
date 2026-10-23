import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Low-poly reusable prop geometries (built once, shared by all instances). */

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

/** Merge geometries that may mix indexed/non-indexed sources. */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    // keep only position/normal/uv so attribute sets match
    for (const name of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(name)) n.deleteAttribute(name);
    return n;
  });
  const out = mergeGeometries(flat, false)!;
  for (const g of geos) g.dispose();
  for (const g of flat) g.dispose();
  return out;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function extrude(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Gravestones (origin at the base center, facing +Z)
// ---------------------------------------------------------------------------
export function gravestoneGeometries() {
  const rounded = (() => {
    const s = new THREE.Shape();
    const w = 0.3;
    s.moveTo(-w, 0);
    s.lineTo(w, 0);
    s.lineTo(w, 0.62);
    s.absarc(0, 0.62, w, 0, Math.PI, false);
    s.lineTo(-w, 0);
    return merge([extrude(s, 0.14), box(0.78, 0.08, 0.24, 0, 0.04, 0)]);
  })();
  const rect = merge([box(0.56, 0.92, 0.14, 0, 0.5, 0), box(0.68, 0.1, 0.24, 0, 0.05, 0), box(0.5, 0.06, 0.16, 0, 0.99, 0)]);
  const cross = merge([box(0.15, 1.15, 0.13, 0, 0.62, 0), box(0.62, 0.14, 0.13, 0, 0.86, 0), box(0.46, 0.14, 0.3, 0, 0.07, 0)]);
  const broken = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, 0.38);
    s.lineTo(0.17, 0.5);
    s.lineTo(0.06, 0.36);
    s.lineTo(-0.07, 0.56);
    s.lineTo(-0.18, 0.42);
    s.lineTo(-0.3, 0.47);
    s.lineTo(-0.3, 0);
    return merge([extrude(s, 0.15), box(0.74, 0.08, 0.26, 0, 0.04, 0)]);
  })();
  const monument = (() => {
    const obelisk = new THREE.CylinderGeometry(0.1, 0.3, 1.9, 4, 1).rotateY(Math.PI / 4).translate(0, 1.55, 0);
    const tip = new THREE.ConeGeometry(0.15, 0.32, 4).rotateY(Math.PI / 4).translate(0, 2.66, 0);
    return merge([box(1.05, 0.3, 1.05, 0, 0.15, 0), box(0.7, 0.36, 0.7, 0, 0.48, 0), obelisk, tip]);
  })();
  const slab = merge([box(0.7, 0.09, 1.5, 0, 0.045, -0.4), box(0.56, 0.7, 0.12, 0, 0.35, 0.36)]); // grave slab + headstone
  return { rounded, rect, cross, broken, monument, slab };
}

// ---------------------------------------------------------------------------
// Dead trees: crooked trunk + recursive bare branches, merged into one geometry
// ---------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);

function segment(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(from.x, from.y, from.z);
  return g;
}

export function deadTreeGeometry(seed: number, height = 4.2): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  // Trunk: 3 crooked segments.
  let p = new THREE.Vector3(0, 0, 0);
  let dir = new THREE.Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25).normalize();
  let rad = 0.2 + r() * 0.08;
  const trunkSegs = 3;
  const forks: { p: THREE.Vector3; d: THREE.Vector3; r: number }[] = [];
  for (let i = 0; i < trunkSegs; i++) {
    const len = (height / trunkSegs) * (0.85 + r() * 0.3);
    const next = p.clone().addScaledVector(dir, len);
    const r1 = rad * 0.72;
    parts.push(segment(p, next, rad, r1));
    if (i >= 1) forks.push({ p: next.clone(), d: dir.clone(), r: r1 });
    p = next;
    rad = r1;
    dir.add(new THREE.Vector3((r() - 0.5) * 0.55, 0, (r() - 0.5) * 0.55)).normalize();
  }
  // Roots flaring at the base.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    parts.push(segment(new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(Math.cos(a) * 0.55, -0.02, Math.sin(a) * 0.55), 0.12, 0.03));
  }
  // Branches: recursive, bending outward and slightly down at the tips.
  const grow = (start: THREE.Vector3, d: THREE.Vector3, len: number, r0: number, depth: number) => {
    const bend = new THREE.Vector3((r() - 0.5) * 0.6, (r() - 0.6) * 0.5, (r() - 0.5) * 0.6);
    const nd = d.clone().add(bend).normalize();
    const end = start.clone().addScaledVector(nd, len);
    const r1 = Math.max(0.012, r0 * 0.6);
    parts.push(segment(start, end, r0, r1));
    if (depth <= 0) return;
    const kids = 1 + Math.floor(r() * 2.2);
    for (let k = 0; k < kids; k++) {
      const side = new THREE.Vector3(r() - 0.5, r() * 0.7, r() - 0.5).normalize();
      grow(end, nd.clone().lerp(side, 0.55).normalize(), len * (0.55 + r() * 0.2), r1, depth - 1);
    }
  };
  for (const f of forks) {
    const n = 2 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0.45 + r() * 0.6, Math.sin(a)).normalize();
      grow(f.p, out, 0.9 + r() * 0.8, f.r * 0.75, 2);
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Fence + gate
// ---------------------------------------------------------------------------
export function fenceGeometries() {
  const bar = merge([box(0.04, 1.45, 0.04, 0, 0.725, 0), new THREE.ConeGeometry(0.045, 0.16, 4).translate(0, 1.53, 0)]);
  const rail = box(1, 0.05, 0.05); // scaled per segment
  const post = merge([box(0.3, 1.9, 0.3, 0, 0.95, 0), box(0.38, 0.12, 0.38, 0, 1.96, 0), new THREE.ConeGeometry(0.2, 0.28, 4).rotateY(Math.PI / 4).translate(0, 2.16, 0)]);
  const gate = (() => {
    const parts: THREE.BufferGeometry[] = [
      box(0.5, 3.0, 0.5, -1.5, 1.5, 0),
      box(0.5, 3.0, 0.5, 1.5, 1.5, 0),
      box(0.62, 0.16, 0.62, -1.5, 3.08, 0),
      box(0.62, 0.16, 0.62, 1.5, 3.08, 0),
      new THREE.TorusGeometry(1.25, 0.05, 4, 12, Math.PI).translate(0, 2.35, 0),
      box(2.5, 0.06, 0.06, 0, 2.35, 0),
      box(2.5, 0.06, 0.06, 0, 0.4, 0),
    ];
    // Bars of the two gate doors; the right door hangs open (rotated about its hinge).
    for (let i = 0; i < 6; i++) parts.push(box(0.035, 2.0, 0.035, -1.15 + i * 0.2, 1.3, 0));
    const door: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) door.push(box(0.035, 2.0, 0.035, 0.15 + i * 0.2, 1.3, 0));
    door.push(box(1.2, 0.05, 0.05, 0.65, 2.1, 0), box(1.2, 0.05, 0.05, 0.65, 0.5, 0));
    const openDoor = merge(door).rotateY(-0.9);
    return merge([...parts, openDoor]);
  })();
  return { bar, rail, post, gate };
}

// ---------------------------------------------------------------------------
// Small details
// ---------------------------------------------------------------------------
export function detailGeometries() {
  const grass = merge(
    [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2;
      return new THREE.ConeGeometry(0.035, 0.26 + (i % 2) * 0.1, 3)
        .translate(0, 0.14, 0)
        .rotateZ(Math.cos(a) * 0.35)
        .rotateX(Math.sin(a) * 0.35)
        .translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    }),
  );
  const rock = new THREE.IcosahedronGeometry(0.22, 0);
  const shard = new THREE.TetrahedronGeometry(0.16, 0);
  const branch = merge([
    new THREE.CylinderGeometry(0.03, 0.05, 1.2, 5).rotateZ(Math.PI / 2),
    new THREE.CylinderGeometry(0.015, 0.025, 0.45, 4).rotateZ(Math.PI / 2 - 0.7).translate(0.25, 0.12, 0.05),
  ]);
  const mushroomStem = new THREE.CylinderGeometry(0.018, 0.025, 0.1, 5).translate(0, 0.05, 0);
  const mushroomCap = new THREE.ConeGeometry(0.06, 0.05, 6).translate(0, 0.12, 0);
  const leaf = new THREE.PlaneGeometry(0.11, 0.07).rotateX(-Math.PI / 2);
  const flagstone = new THREE.BoxGeometry(1, 1, 1);
  // Irregular low-poly paving stone (flat 6-gon, slightly lopsided).
  const paver = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1);
  {
    const p = paver.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const k = 1 + 0.18 * Math.sin(x * 9.1 + z * 5.3);
      p.setX(i, x * k);
      p.setZ(i, z * (2 - k) * 0.9);
    }
    paver.computeVertexNormals();
  }
  return { grass, rock, shard, branch, mushroomStem, mushroomCap, leaf, flagstone, paver };
}
