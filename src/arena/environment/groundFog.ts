import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GRAVEYARD_CONFIG as G } from "./graveyardConfig";

/**
 * Low drifting ground fog: irregular patches merged into ONE mesh (one draw
 * call). Noise is sampled in world space so patches drift continuously.
 * Kept faint inside the playable circle so zombies are never hidden.
 */
const VERT = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float aAlpha;
  varying float vAlpha;
  varying vec2 vUv;
  varying vec2 vXZ;
  void main() {
    vAlpha = aAlpha;
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  varying float vAlpha;
  varying vec2 vUv;
  varying vec2 vXZ;
  uniform float uTime;
  uniform vec3 uFog, uFogPurple;
  uniform float uClearR, uInside;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // Cheap early-out: patch edges and the cleared combat area cost almost nothing.
    float edge = smoothstep(0.5, 0.2, length(vUv - 0.5));
    float r = length(vXZ);
    float clearing = mix(uInside, 1.0, smoothstep(uClearR - 2.5, uClearR + 0.6, r));
    float k = edge * vAlpha * clearing;
    if (k < 0.01) discard;
    vec2 drift = vec2(uTime * 0.07, uTime * 0.025);
    // Two layers drifting in different directions → wisps that slowly morph.
    float n = noise(vXZ * 0.3 + drift) * 0.4 + noise(vXZ * 0.63 + drift * 0.5 + 7.0) * 0.25
            + noise(vXZ * 0.55 - drift * 1.7 + 11.0) * 0.35;
    float a = smoothstep(0.2, 0.55, n) * k;
    vec3 col = mix(uFog, uFogPurple, noise(vXZ * 0.12 + 4.0 + uTime * 0.01));
    // Brighter crests: the mist catches the moonlight.
    col *= 0.85 + 0.45 * smoothstep(0.45, 0.75, n);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`;

interface Patch {
  x: number;
  z: number;
  size: number;
  y: number;
  alpha: number;
}

export function fogPatches(rand: () => number): Patch[] {
  const R = G.arenaRadius;
  const F = G.groundFog;
  const out: Patch[] = [];
  // Ground-hugging banks around the arena edge, among the first rows of graves.
  for (let i = 0; i < F.ringPatches; i++) {
    const a = (i / F.ringPatches) * Math.PI * 2 + rand() * 0.35;
    const r = R + 0.5 + rand() * 3.5;
    out.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, size: 5 + rand() * 3.5, y: 0.08 + rand() * 0.12, alpha: F.ringAlpha });
  }
  // A second, higher layer at the edge so the mist has some volume against the graves.
  for (let i = 0; i < F.ringPatches / 2; i++) {
    const a = rand() * Math.PI * 2;
    const r = R + 1.5 + rand() * 3;
    out.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, size: 6 + rand() * 3, y: 0.45 + rand() * 0.3, alpha: F.ringAlpha * 0.6 });
  }
  // Thick banks among the far graves and along the fence.
  for (let i = 0; i < F.backPatches; i++) {
    const a = (rand() - 0.5) * 3.0;
    const r = 12.5 + rand() * 4;
    out.push({ x: Math.sin(a) * r, z: -Math.cos(a) * r, size: 8 + rand() * 4, y: 0.25 + rand() * 0.45, alpha: F.backAlpha });
  }
  // Faint wisps that drift across the playable circle (the shader keeps them thin there).
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    const r = 2.5 + rand() * 4;
    out.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, size: 6, y: 0.05, alpha: F.insideAlpha });
  }
  return out;
}

export function createGroundFog(rand: () => number): { mesh: THREE.Mesh; material: THREE.ShaderMaterial; patches: number } {
  const patches = fogPatches(rand);
  const geos = patches.map((p) => {
    const g = new THREE.PlaneGeometry(p.size, p.size * (0.6 + rand() * 0.4));
    g.rotateX(-Math.PI / 2);
    g.rotateY(rand() * Math.PI);
    g.translate(p.x, p.y, p.z);
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(new Array(g.attributes.position!.count).fill(p.alpha), 1));
    return g;
  });
  const geo = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0 },
      uFog: { value: new THREE.Color(G.palette.fog) },
      uFogPurple: { value: new THREE.Color(G.palette.fogPurple) },
      uClearR: { value: G.arenaRadius },
      uInside: { value: G.groundFog.insideStrength },
    },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 5;
  mesh.name = "groundFog";
  return { mesh, material, patches: patches.length };
}
