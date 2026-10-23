import * as THREE from "three";
import { GRAVEYARD_CONFIG as G } from "./graveyardConfig";

/**
 * Night backdrop: a curved wall behind the cemetery with a cold sky gradient,
 * a pale haloed moon, slow drifting clouds and dark rolling hills. One mesh, no fog.
 * (The gameplay camera looks down at ~33°, so a real skydome would never be seen;
 * this "theatre backdrop" puts the moon where the camera can see it.)
 */
const VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vW;
  uniform vec3 uMoon;
  uniform float uMoonR;
  uniform float uTime;
  uniform vec3 uSky, uHaze, uHills, uMoonCol, uHalo;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float ang = atan(vW.x, -vW.z);
    float h = vW.y;
    vec3 col = mix(uHaze, uSky, smoothstep(0.3, 6.0, h));
    // Moon + soft halo
    float d = distance(vW, uMoon);
    float halo = exp(-max(d - uMoonR, 0.0) / (uMoonR * 1.1));
    col += uHalo * halo * 0.45;
    float disc = smoothstep(uMoonR, uMoonR - 0.06, d);
    vec2 mp = (vW.xy - uMoon.xy) / uMoonR;
    float craters = noise(mp * 2.2 + 3.0) * 0.6 + noise(mp * 5.5) * 0.4;
    vec3 moonCol = uMoonCol * (0.8 + 0.2 * craters) * (1.0 - 0.12 * dot(mp, mp));
    col = mix(col, moonCol, disc);
    // Thin clouds drifting slowly; lit where they cross the halo
    float c = noise(vec2(ang * 5.0 + uTime * 0.012, h * 0.8)) * noise(vec2(ang * 11.0 - uTime * 0.02, h * 1.9 + 5.0));
    float band = smoothstep(1.2, 2.2, h) * (1.0 - smoothstep(4.5, 6.5, h));
    float cloud = smoothstep(0.22, 0.5, c) * band;
    vec3 cloudCol = mix(vec3(0.06, 0.07, 0.13), uHalo * 0.75, halo);
    col = mix(col, cloudCol, cloud * 0.75);
    // Distant rolling hills
    float hill = 0.75 + 0.35 * sin(ang * 3.1 + 1.0) + 0.22 * sin(ang * 7.3) + 0.15 * noise(vec2(ang * 22.0, 0.0));
    // A valley under the moon so it rises clear of the hills, framed by the fence and gate.
    float moonAng = atan(uMoon.x, -uMoon.z);
    hill -= 1.6 * exp(-pow((ang - moonAng) / 0.17, 2.0));
    col = mix(col, uHills, smoothstep(hill + 0.03, hill - 0.03, h));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createBackdrop(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const B = G.backdrop;
  const arc = (B.arcDeg * Math.PI) / 180;
  const geo = new THREE.CylinderGeometry(B.radius, B.radius, B.height, 72, 1, true, Math.PI - arc / 2, arc);
  geo.translate(0, B.height / 2 - 1.2, 0);
  const a = (G.moon.angleDeg * Math.PI) / 180;
  const c = (hex: number) => new THREE.Color(hex);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    fog: false,
    // Writes depth so the far ground ring beyond the backdrop can't paint over the moon / hills.
    depthWrite: true,
    uniforms: {
      uMoon: { value: new THREE.Vector3(Math.sin(a) * B.radius, G.moon.height, -Math.cos(a) * B.radius) },
      uMoonR: { value: G.moon.radius },
      uTime: { value: 0 },
      uSky: { value: c(G.palette.sky) },
      uHaze: { value: c(G.palette.skyHaze) },
      uHills: { value: c(G.palette.hills) },
      uMoonCol: { value: c(G.palette.moon) },
      uHalo: { value: c(G.palette.moonHalo) },
    },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -10;
  mesh.name = "backdrop";
  return { mesh, material };
}
