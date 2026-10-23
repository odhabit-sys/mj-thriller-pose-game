/**
 * Imported GLB MJ: the asset is what the rig assumes, skin weights are sane, the
 * GLB skeleton follows the procedural rig exactly, and attaching it changes
 * nothing about poses or the recognizer-check skeleton (visual only).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as THREE from "three";
import { computeSkinWeights, GLB_MJ_RIG, GlbMichael, RIG_JOINTS, type BoneSegment } from "../src/arena/characters/glbMichael";
import { MichaelCharacter } from "../src/arena/characters/michaelCharacter";
import { mjPoseFrame } from "../src/arena/characters/mjPoseProbe";

const GLB_PATH = "public/models/michael_jackson_thriller.glb";

function glbJson(): { json: Record<string, unknown[]> & { meshes: { primitives: { attributes: Record<string, number> }[] }[] }; buf: Buffer } {
  const buf = readFileSync(GLB_PATH);
  assert.equal(buf.toString("utf8", 0, 4), "glTF");
  const len = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.toString("utf8", 20, 20 + len)), buf };
}

describe("GLB MJ asset", () => {
  it("is the static single-mesh model the runtime rig was built for", () => {
    const { json } = glbJson();
    assert.equal(json.meshes.length, 1);
    const attrs = json.meshes[0]!.primitives[0]!.attributes;
    assert.ok(attrs.POSITION !== undefined && attrs.TEXCOORD_0 !== undefined);
    assert.equal(attrs.JOINTS_0, undefined, "no skin in the file (rigged at load time)");
    assert.equal((json.skins ?? []).length, 0);
    assert.equal((json.images ?? []).length, 1, "one embedded texture");
  });
});

/** A tiny stand-in mesh in the GLB's model space: points at known body parts. */
const PROBES: Record<string, [number, number, number]> = {
  head: [0, 1.85, 0.05],
  hair: [0.05, 1.95, 0],
  chest: [0, 1.4, 0.1],
  leftHand: [0.72, 1.19, 0.03],
  rightHand: [-0.72, 1.19, 0.03],
  leftForearm: [0.55, 1.33, -0.02],
  leftThigh: [0.11, 0.78, 0],
  rightShin: [-0.14, 0.33, -0.02],
  leftShoe: [0.15, 0.03, 0.08],
};

function probeGlb() {
  const pos = Object.values(PROBES).flat();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new GlbMichael(geo, new THREE.MeshStandardMaterial(), MichaelCharacter.LEG_LENGTH);
}

describe("GLB MJ rig", () => {
  it("skin weights: ≤ 4 influences, normalized, rigid when asked", () => {
    const segs: BoneSegment[] = [
      { index: 0, a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(0, 1, 0), radius: 0.1 },
      { index: 1, a: new THREE.Vector3(0, 1, 0), b: new THREE.Vector3(1, 1, 0), radius: 0.05 },
    ];
    const { indices, weights } = computeSkinWeights([0, 0.5, 0, 0.9, 1, 0, 0, 2, 0], segs, { rigid: (p) => (p.y > 1.5 ? 1 : null) });
    for (let v = 0; v < 3; v++) {
      const w = [...weights.slice(v * 4, v * 4 + 4)];
      assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-5, `vertex ${v} weights sum to 1`);
    }
    assert.equal(indices[0], 0, "trunk point → trunk bone");
    assert.ok(weights[0]! > 0.99);
    assert.equal(indices[4], 1, "arm point → arm bone");
    assert.deepEqual([indices[8], weights[8]], [1, 1], "rigid point");
  });

  it("each body part is driven by the right bone", () => {
    const g = probeGlb();
    const bones = g.mesh.skeleton.bones;
    const si = g.mesh.geometry.getAttribute("skinIndex");
    const sw = g.mesh.geometry.getAttribute("skinWeight");
    const main = (i: number) => {
      let best = 0;
      for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
      return bones[si.getComponent(i, best)]!.name;
    };
    const names = Object.keys(PROBES);
    const expect: Record<string, string> = {
      head: "neck",
      hair: "neck",
      chest: "chest",
      leftHand: "wrist.L",
      rightHand: "wrist.R",
      leftForearm: "elbow.L",
      leftThigh: "hip.L",
      rightShin: "knee.R",
      leftShoe: "foot.L",
    };
    names.forEach((n, i) => assert.equal(main(i), expect[n], n));
  });

  it("follows the procedural rig joint-for-joint, including the feet-on-floor offset", () => {
    const mj = new MichaelCharacter();
    const g = probeGlb();
    mj.attachVisual(g);
    for (const id of MichaelCharacter.POSE_IDS) {
      mj.setPose(id);
      mj.update(1 / 60);
      for (const k of RIG_JOINTS) {
        const src = (mj as unknown as { joints: Record<string, THREE.Object3D> }).joints[k]!;
        assert.ok(g.bones[k].quaternion.angleTo(src.quaternion) < 1e-6, `${id} ${k}`);
      }
      const body = (mj as unknown as { joints: Record<string, THREE.Object3D> }).joints.lean!;
      const ratio = GLB_MJ_RIG.legLength / MichaelCharacter.LEG_LENGTH;
      assert.ok(g.bones.lean.position.distanceTo(body.position.clone().multiplyScalar(ratio)) < 1e-9, `${id} body offset`);
    }
  });

  it("neutral bind pose: the mesh is undeformed at rest (arms in the A-pose)", () => {
    const g = probeGlb();
    g.root.updateMatrixWorld(true);
    g.mesh.skeleton.update();
    const p = new THREE.Vector3();
    Object.values(PROBES).forEach(([x, y, z], i) => {
      g.mesh.getVertexPosition(i, p);
      assert.ok(p.distanceTo(new THREE.Vector3(x, y, z)) < 1e-5, `vertex ${i} moved in bind pose`);
    });
  });

  it("attaching the visual hides the procedural meshes; detaching restores the fallback", () => {
    const mj = new MichaelCharacter();
    const g = probeGlb();
    const procedural = mj.root.children[0]!;
    mj.attachVisual(g);
    assert.equal(procedural.visible, false);
    assert.ok(mj.root.children.includes(g.root));
    assert.equal(mj.hasImportedVisual, true);
    mj.attachVisual(null);
    assert.equal(procedural.visible, true);
    assert.ok(!mj.root.children.includes(g.root));
  });

  it("is visual only: poses and the recognizer-check skeleton are identical with or without it", () => {
    const plain = new MichaelCharacter();
    const withGlb = new MichaelCharacter();
    withGlb.attachVisual(probeGlb());
    for (const id of MichaelCharacter.POSE_IDS) {
      plain.setPose(id);
      withGlb.setPose(id);
      const a = mjPoseFrame(plain).landmarks!;
      const b = mjPoseFrame(withGlb).landmarks!;
      a.forEach((l, i) => assert.ok(Math.abs(l.x - b[i]!.x) + Math.abs(l.y - b[i]!.y) < 1e-6, `${id} landmark ${i}`));
    }
  });

  it("the attack flash warms the material and returns to rest", () => {
    const g = probeGlb();
    const mat = g.mesh.material as THREE.MeshStandardMaterial;
    g.setFlash(0);
    const rest = mat.emissiveIntensity;
    g.setFlash(1);
    assert.ok(mat.emissiveIntensity > rest);
    g.setFlash(0);
    assert.equal(mat.emissiveIntensity, rest);
  });
});
