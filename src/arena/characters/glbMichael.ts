import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * IMPORTED THRILLER MJ (michael_jackson_thriller.glb, CC-BY-4.0, see docs/CREDITS.md).
 *
 * The supplied GLB is a single STATIC mesh (no skeleton, no skin weights, no
 * animations) in an A-pose: faces +Z, feet at y = 0, ~1.98 units tall. So it is
 * rigged here, at load time, without modifying the file:
 *
 *   1. a skeleton with the SAME joint hierarchy as the procedural MJ rig
 *      (body/lean → hips → knees → feet, chest → neck, shoulder → elbow → wrist)
 *      is placed inside the mesh at measured landmarks, posed like the mesh (A-pose);
 *   2. skin weights are computed from each vertex's distance to the bone segments
 *      (envelope skinning), with the head/hair kept rigid;
 *   3. every frame the bones copy the procedural rig's joint rotations
 *      (MichaelCharacter stays the single source of poses, transitions and timing).
 *
 * Gameplay code never touches this module: it is a visual adapter only.
 */

export const GLB_MJ_URL = `${import.meta.env.BASE_URL}models/michael_jackson_thriller.glb`;

/** Rig joints driven by MichaelCharacter (same names as its joint map). */
export type RigJoint =
  | "lean"
  | "spine"
  | "head"
  | "shoulderL"
  | "elbowL"
  | "wristL"
  | "shoulderR"
  | "elbowR"
  | "wristR"
  | "hipL"
  | "hipR"
  | "footL"
  | "footR";

export const RIG_JOINTS: readonly RigJoint[] = [
  "lean",
  "spine",
  "head",
  "shoulderL",
  "elbowL",
  "wristL",
  "shoulderR",
  "elbowR",
  "wristR",
  "hipL",
  "hipR",
  "footL",
  "footR",
];

/** What the imported visual needs from the procedural rig each frame. */
export interface RigSource {
  joints: Readonly<Record<RigJoint, THREE.Object3D>>;
}

type V3 = [number, number, number];

/**
 * Landmarks measured on the GLB mesh (model units, after its node transforms:
 * x = his left, y = up, z = front). Left side; the right side is mirrored.
 */
export const GLB_MJ_RIG = {
  /** Total height (top of the hair). */
  height: 1.978,
  /** Uniform scale inside the character root so he matches the procedural MJ's height (≈1.85 character units). */
  scale: 1.85 / 1.978,
  chest: [0, 1.08, 0] as V3,
  neck: [0, 1.7, 0.01] as V3,
  headTop: [0, 1.96, 0.02] as V3,
  pelvisBottom: [0, 0.9, 0] as V3,
  shoulder: [0.2, 1.55, -0.045] as V3,
  wrist: [0.63, 1.265, 0.0] as V3,
  upperArmFraction: 0.56, // elbow position along shoulder → wrist (measured edge loops ≈ x 0.44–0.48)
  handLength: 0.15,
  hip: [0.1, 0.98, 0.0] as V3,
  knee: [0.125, 0.56, -0.01] as V3,
  ankle: [0.15, 0.1, -0.03] as V3,
  toe: [0.15, 0.02, 0.13] as V3,
  /** Hip-to-sole length (for the feet-on-floor drop). */
  legLength: 0.98,
  /** Head + hair: rigid to the head bone above this height. */
  rigidHeadY: 1.73,
};

/** A bone's influence segment for envelope skinning (bind pose, model units). */
export interface BoneSegment {
  index: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Approximate limb radius: distance is measured from the limb surface, not its axis. */
  radius: number;
}

/**
 * Envelope skin weights: up to 4 bones per vertex, weight ∝ 1 / distance^power
 * (distance from each bone's capsule surface). Pure, exported for tests.
 */
export function computeSkinWeights(
  positions: ArrayLike<number>,
  segments: readonly BoneSegment[],
  opts: { power?: number; rigid?: (p: THREE.Vector3) => number | null } = {},
): { indices: Uint16Array; weights: Float32Array } {
  const power = opts.power ?? 6;
  const n = positions.length / 3;
  const indices = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const scores: { i: number; w: number }[] = segments.map(() => ({ i: 0, w: 0 }));

  for (let v = 0; v < n; v++) {
    p.set(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
    const rigid = opts.rigid?.(p);
    if (rigid !== null && rigid !== undefined) {
      indices[v * 4] = rigid;
      weights[v * 4] = 1;
      continue;
    }
    segments.forEach((s, k) => {
      ab.subVectors(s.b, s.a);
      const t = THREE.MathUtils.clamp(ap.subVectors(p, s.a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
      closest.copy(s.a).addScaledVector(ab, t);
      const d = Math.max(p.distanceTo(closest) - s.radius, 0) + 0.01;
      scores[k]!.i = s.index;
      scores[k]!.w = 1 / d ** power;
    });
    const top = [...scores].sort((x, y) => y.w - x.w).slice(0, 4);
    const sum = top.reduce((acc, s) => acc + s.w, 0);
    top.forEach((s, k) => {
      indices[v * 4 + k] = s.i;
      weights[v * 4 + k] = s.w / sum;
    });
  }
  return { indices, weights };
}

const v3 = (a: V3, mirror = false) => new THREE.Vector3(mirror ? -a[0] : a[0], a[1], a[2]);
const DOWN = new THREE.Vector3(0, -1, 0);
/** Matches MichaelCharacter's built-in hip splay (contrapposto) so the bind pose equals his neutral legs. */
const HIP_SPLAY = 0.035;

export class GlbMichael {
  /** Add this under the character root. Holds the skinned mesh at the GLB → character scale. */
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: Record<RigJoint, THREE.Bone>;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly rim: RimUniforms;
  private readonly legRatio: number;

  constructor(geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, procLegLength: number) {
    const R = GLB_MJ_RIG;
    this.root.name = "michael-glb";
    this.root.scale.setScalar(R.scale);
    this.legRatio = R.legLength / procLegLength;
    this.material = material;
    this.rim = addRim(material);

    // ----- Skeleton in the bind (A-) pose -----
    const make = (name: string) => Object.assign(new THREE.Bone(), { name });
    const b = {
      lean: make("body"),
      spine: make("chest"),
      head: make("neck"),
      shoulderL: make("shoulder.L"),
      elbowL: make("elbow.L"),
      wristL: make("wrist.L"),
      shoulderR: make("shoulder.R"),
      elbowR: make("elbow.R"),
      wristR: make("wrist.R"),
      hipL: make("hip.L"),
      hipR: make("hip.R"),
      footL: make("foot.L"),
      footR: make("foot.R"),
    } satisfies Record<RigJoint, THREE.Bone>;
    const kneeL = make("knee.L");
    const kneeR = make("knee.R");
    this.bones = b;

    b.lean.add(b.spine, b.hipL, b.hipR);
    b.spine.add(b.head, b.shoulderL, b.shoulderR);
    b.shoulderL.add(b.elbowL);
    b.elbowL.add(b.wristL);
    b.shoulderR.add(b.elbowR);
    b.elbowR.add(b.wristR);
    b.hipL.add(kneeL);
    kneeL.add(b.footL);
    b.hipR.add(kneeR);
    kneeR.add(b.footR);

    // Bind rotations: arms along the mesh's A-pose (minimal rotation from straight down keeps
    // the elbow hinge facing forward, like the procedural rig); legs at his neutral splay.
    const armDir = (mirror: boolean) => v3(R.wrist, mirror).sub(v3(R.shoulder, mirror)).normalize();
    b.shoulderL.quaternion.setFromUnitVectors(DOWN, armDir(false));
    b.shoulderR.quaternion.setFromUnitVectors(DOWN, armDir(true));
    b.hipL.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), HIP_SPLAY);
    b.hipR.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -HIP_SPLAY);
    kneeL.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -HIP_SPLAY);
    kneeR.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), HIP_SPLAY);

    const armLen = v3(R.wrist).distanceTo(v3(R.shoulder));
    const elbowAt = (mirror: boolean) => v3(R.shoulder, mirror).addScaledVector(armDir(mirror), armLen * R.upperArmFraction);
    const wristAt = (mirror: boolean) => v3(R.shoulder, mirror).addScaledVector(armDir(mirror), armLen);
    // Place each bone at its landmark (converted into its parent's bind space, top-down).
    const place: [THREE.Bone, THREE.Vector3][] = [
      [b.spine, v3(R.chest)],
      [b.head, v3(R.neck)],
      [b.shoulderL, v3(R.shoulder)],
      [b.elbowL, elbowAt(false)],
      [b.wristL, wristAt(false)],
      [b.shoulderR, v3(R.shoulder, true)],
      [b.elbowR, elbowAt(true)],
      [b.wristR, wristAt(true)],
      [b.hipL, v3(R.hip)],
      [kneeL, v3(R.knee)],
      [b.footL, v3(R.ankle)],
      [b.hipR, v3(R.hip, true)],
      [kneeR, v3(R.knee, true)],
      [b.footR, v3(R.ankle, true)],
    ];
    for (const [bone, world] of place) {
      bone.parent!.updateMatrixWorld(true);
      bone.position.copy(bone.parent!.worldToLocal(world.clone()));
    }
    b.lean.updateMatrixWorld(true);

    const all = [b.lean, b.spine, b.head, b.shoulderL, b.elbowL, b.wristL, b.shoulderR, b.elbowR, b.wristR, b.hipL, kneeL, b.footL, b.hipR, kneeR, b.footR];
    const idx = (bone: THREE.Bone) => all.indexOf(bone);
    const hand = (mirror: boolean) => wristAt(mirror).addScaledVector(armDir(mirror), R.handLength);
    const seg = (bone: THREE.Bone, a: THREE.Vector3, c: THREE.Vector3, radius: number): BoneSegment => ({ index: idx(bone), a, b: c, radius });
    const segments: BoneSegment[] = [
      seg(b.lean, v3(R.pelvisBottom), v3(R.chest), 0.13),
      seg(b.spine, v3(R.chest).setY(R.chest[1] + 0.08), v3(R.neck).setY(R.neck[1] - 0.06), 0.17),
      seg(b.head, v3(R.neck), v3(R.headTop), 0.09),
    ];
    for (const m of [false, true]) {
      const [sh, el, wr, hp, kn, ft] = m
        ? [b.shoulderR, b.elbowR, b.wristR, b.hipR, kneeR, b.footR]
        : [b.shoulderL, b.elbowL, b.wristL, b.hipL, kneeL, b.footL];
      segments.push(
        seg(sh, v3(R.shoulder, m), elbowAt(m), 0.05),
        seg(el, elbowAt(m), wristAt(m), 0.04),
        seg(wr, wristAt(m), hand(m), 0.03),
        seg(hp, v3(R.hip, m), v3(R.knee, m), 0.07),
        seg(kn, v3(R.knee, m), v3(R.ankle, m), 0.05),
        seg(ft, v3(R.ankle, m), v3(R.toe, m), 0.04),
      );
    }
    const { indices, weights } = computeSkinWeights(geometry.attributes.position!.array, segments, {
      rigid: (p) => (p.y > R.rigidHeadY && Math.abs(p.x) < 0.16 ? idx(b.head) : null),
    });
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));

    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.name = "michael-glb-mesh";
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // skinned bounds change with the pose; he is always on screen
    this.mesh.add(b.lean);
    this.mesh.bind(new THREE.Skeleton(all));
    this.root.add(this.mesh);
  }

  /** Copy the procedural rig's current pose onto the GLB skeleton. No allocation. */
  sync(src: RigSource): void {
    // Both rigs share joint frames: arms rest pointing down (−Y) with the elbow hinge facing
    // forward, legs rest at the hip splay. The bind pose (A-pose arms) is just another pose in
    // that frame, so the procedural local rotations apply to these bones unchanged.
    const j = src.joints;
    for (const k of RIG_JOINTS) this.bones[k].quaternion.copy(j[k].quaternion);
    this.bones.spine.scale.copy(j.spine.scale); // breathing
    // Feet on the floor: the procedural body drops (spread legs) and shifts (sideways lean); same at this leg length.
    this.bones.lean.position.copy(j.lean.position).multiplyScalar(this.legRatio);
  }

  /** Attack highlight (0..1): the texture warms up and the rim shifts from moonlight purple to gold. */
  setFlash(f: number): void {
    this.material.emissiveIntensity = GLB_MJ_LOOK.baseGlow + f * GLB_MJ_LOOK.flashGlow;
    this.rim.uRimColor.value.lerpColors(GLB_MJ_LOOK.rimRest, GLB_MJ_LOOK.rimHit, Math.min(1, f * 1.4));
    this.rim.uRimStrength.value = GLB_MJ_LOOK.rimStrength * (1 + f * 1.2);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}

/**
 * Readability under the cold moonlight (same idea as the procedural MJ's materials):
 * a faint warm self-light from the model's own texture keeps the red jacket red, and a
 * Fresnel rim separates the dark hair / shoes from the dark arena.
 */
export const GLB_MJ_LOOK = {
  baseGlow: 0.14,
  flashGlow: 0.45,
  rimRest: new THREE.Color(0x5852b8),
  rimHit: new THREE.Color(0xffd36b),
  rimStrength: 0.3,
  rimPower: 3.8,
};

function addRim(mat: THREE.MeshStandardMaterial) {
  const uniforms = {
    uRimColor: { value: GLB_MJ_LOOK.rimRest.clone() },
    uRimStrength: { value: GLB_MJ_LOOK.rimStrength },
    uRimPower: { value: GLB_MJ_LOOK.rimPower },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float rim = 1.0 - saturate(abs(dot(normal, normalize(vViewPosition))));
          totalEmissiveRadiance += uRimColor * (pow(rim, uRimPower) * uRimStrength);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "mj-glb-rim";
  return uniforms;
}
type RimUniforms = ReturnType<typeof addRim>;

/** Load the GLB once and rig it. Rejects if the file is missing or malformed (the caller keeps the fallback). */
export async function loadGlbMichael(procLegLength: number, url = GLB_MJ_URL): Promise<GlbMichael> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let source: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  if (!source) throw new Error("GLB contains no mesh");
  const src = source as THREE.Mesh;
  // Bake the Sketchfab node transforms (Z-up → Y-up, cm → m) into the vertices.
  const geometry = src.geometry.clone().applyMatrix4(src.matrixWorld);
  const old = src.material as THREE.MeshStandardMaterial;
  const map = old.map;
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: 0xffc4a0,
    emissiveMap: map,
    emissiveIntensity: GLB_MJ_LOOK.baseGlow,
  });
  old.dispose();
  return new GlbMichael(geometry, material, procLegLength);
}
