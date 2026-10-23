import * as THREE from "three";
import { GRAVEYARD_CONFIG as G } from "./graveyardConfig";

/**
 * Cemetery terrain: one faceted mesh with vertex colors (soil, dead grass,
 * stone patches, a worn path to the gate). Visually uneven outside the arena,
 * effectively flat inside it (< 2 cm) so feet stay planted. Gameplay is 2D and
 * never reads this mesh.
 */
function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number): number {
  return valueNoise(x, z) * 0.55 + valueNoise(x * 2.07 + 5.2, z * 2.07 + 1.3) * 0.3 + valueNoise(x * 4.3 + 9.1, z * 4.3 + 7.7) * 0.15;
}

/** Height of the visual ground at (x, z). */
export function groundHeight(x: number, z: number): number {
  const R = G.arenaRadius;
  const r = Math.hypot(x, z);
  const n = fbm(x * 0.35, z * 0.35) - 0.5;
  if (r <= R) return n * G.ground.insideRelief;
  const t = Math.min(1, (r - R) / 2.5);
  const ramp = t * t * (3 - 2 * t);
  return n * G.ground.insideRelief * (1 - ramp) + (n + 0.25) * G.ground.outsideRelief * ramp;
}

/** Worn path from the gate (behind MJ) to the arena; returns 0..1 path strength. */
export function pathStrength(x: number, z: number): number {
  if (z > -1) return 0;
  const center = Math.sin(z * 0.35) * 0.6;
  const w = 0.75 + valueNoise(z * 0.8, 3) * 0.35;
  const d = Math.abs(x - center);
  const s = 1 - Math.min(1, d / w);
  return s * Math.min(1, (-1 - z) / 3);
}

/** Tileable value noise on a `period`-cell lattice (for the baked detail texture). */
function tileNoise(x: number, z: number, period: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period);
  const a = h(ix, iz);
  const b = h(ix + 1, iz);
  const c = h(ix, iz + 1);
  const d = h(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fine surface detail baked ONCE into a small tiling texture (instead of per-pixel
 * noise): R = mottling, G = grit, B = hairline cracks, A = damp moss.
 */
export function createGroundDetailTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const mott = tileNoise(u * 6, v * 6, 6) * 0.6 + tileNoise(u * 14, v * 14, 14) * 0.4;
      const grit = tileNoise(u * 48, v * 48, 48) * 0.6 + tileNoise(u * 110, v * 110, 110) * 0.4;
      const zone = tileNoise(u * 3, v * 3, 3);
      const cr = Math.abs(tileNoise(u * 8, v * 8, 8) - 0.5) + Math.abs(tileNoise(u * 19, v * 19, 19) - 0.5) * 0.35;
      const crack = (1 - smooth(0.012, 0.04, cr)) * smooth(0.5, 0.65, zone);
      const moss = smooth(0.58, 0.75, tileNoise(u * 4, v * 4, 4) * 0.7 + tileNoise(u * 17, v * 17, 17) * 0.3);
      const i = (y * size + x) * 4;
      data[i] = mott * 255;
      data[i + 1] = grit * 255;
      data[i + 2] = crack * 255;
      data[i + 3] = moss * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const GROUND_DETAIL = /* glsl */ `
  {
    // Two scales of the same baked tile, offset, so the 8 m repeat doesn't read.
    vec4 d1 = texture2D(uDetail, vGround * 0.125);
    vec4 d2 = texture2D(uDetail, vGround * 0.31 + vec2(0.37, 0.61));
    float mott = mix(d1.r, d2.r, 0.35);
    float grit = d2.g;
    diffuseColor.rgb *= (0.72 + 0.56 * mott) * (0.86 + 0.28 * grit);
    // Damp moss in low, shaded spots.
    diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.75 + 0.5 * grit), d1.a * 0.55);
    // Hairline cracks in dry patches only.
    diffuseColor.rgb *= 1.0 - d1.b * 0.55;
  }
`;

export function createGround(): THREE.Mesh {
  const { size, segments } = G.ground;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const P = G.palette;
  const soil = new THREE.Color(P.soil);
  const soilWarm = new THREE.Color(P.soilWarm);
  const grass = new THREE.Color(P.grassDead);
  const grassCold = new THREE.Color(P.grassCold);
  const stone = new THREE.Color(P.stonePatch);
  const path = new THREE.Color(P.path);
  const c = new THREE.Color();
  const R = G.arenaRadius;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const r = Math.hypot(x, z);
    // Base soil: large warm/cool blotches.
    c.copy(soil).lerp(soilWarm, Math.min(1, Math.max(0, (fbm(x * 0.22 + 20, z * 0.22) - 0.3) * 2.2)));
    // Dead grass and moss: thicker outside the trampled arena, patchy inside.
    const g = fbm(x * 0.28 + 40, z * 0.28);
    const grassAmt = Math.max(0, (g - (r < R ? 0.48 : 0.4)) * 3.2);
    c.lerp(valueNoise(x * 0.7, z * 0.7) > 0.5 ? grass : grassCold, Math.min(0.9, grassAmt));
    // Stone patches / old paving.
    const st = fbm(x * 0.6 + 7, z * 0.6 + 3);
    if (st > 0.64) c.lerp(stone, Math.min(0.85, (st - 0.64) * 5));
    // Worn path to the gate.
    c.lerp(path, pathStrength(x, z) * 0.85);
    // Dark pools (damp earth) for depth and contrast.
    const pool = fbm(x * 0.18 + 70, z * 0.18 + 30);
    if (pool < 0.4) c.multiplyScalar(0.62 + pool * 0.9);
    // Cracked earth: thin darker lines.
    const crack = Math.abs(valueNoise(x * 1.7, z * 1.7) - 0.5);
    if (crack < 0.035) c.multiplyScalar(0.62);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // Lambert: the ground is fully rough anyway and covers the whole screen, so skip the PBR cost.
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  // Fine surface detail the vertex grid (~40 cm) can't carry: grit, mottling, hairline cracks, moss (baked texture).
  const detail = createGroundDetailTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMoss = { value: new THREE.Color(P.moss) };
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGround;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGround;\nuniform vec3 uMoss;\nuniform sampler2D uDetail;")
      .replace("#include <color_fragment>", `#include <color_fragment>\n${GROUND_DETAIL}`);
  };
  // Disposed with the material (the Graveyard disposes every unique material).
  mat.userData.detail = detail;
  const origDispose = mat.dispose.bind(mat);
  mat.dispose = () => {
    detail.dispose();
    origDispose();
  };
  mat.customProgramCacheKey = () => "graveyard-ground";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "ground";
  return mesh;
}
