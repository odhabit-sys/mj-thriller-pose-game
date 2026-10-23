/**
 * MJ character rig: IK accuracy, pose shapes (hand positions), distinctness,
 * and the play → hold → return-to-neutral timeline. No rendering.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { MichaelCharacter, MJ_ANIMATION, solveArmIK } from "../src/arena/characters/michaelCharacter";

const POSES = ["SIDE_POINT", "FACE_COVER", "DIAGONAL_REACH"] as const;

function hands(c: MichaelCharacter) {
  return { left: c.getHandPosition("left"), right: c.getHandPosition("right"), head: c.getHeadPosition() };
}

function shoulderHeight(): number {
  const c = new MichaelCharacter();
  c.setPose(null);
  // Head center minus a neck: rough shoulder line, measured on the rig itself.
  return c.getHeadPosition().y - 0.3 * 1.5;
}

describe("two-bone arm IK", () => {
  it("reaches reachable targets (forward kinematics lands on the hand)", () => {
    const shoulder = new THREE.Vector3(0.2, 0.5, 0);
    for (const hand of [
      new THREE.Vector3(0.6, 0.5, 0.1),
      new THREE.Vector3(0.0, 0.8, 0.2),
      new THREE.Vector3(0.25, 0.05, 0.1),
      new THREE.Vector3(-0.1, 0.4, 0.25),
    ]) {
      const r = solveArmIK(shoulder, hand, new THREE.Vector3(0.8, 0.3, -0.3), 0.29, 0.27);
      const s = new THREE.Object3D();
      s.position.copy(shoulder);
      s.quaternion.copy(r.shoulder);
      const e = new THREE.Object3D();
      e.position.set(0, -0.29, 0);
      e.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), r.elbowAngle);
      const w = new THREE.Object3D();
      w.position.set(0, -0.27, 0);
      s.add(e);
      e.add(w);
      s.updateMatrixWorld(true);
      const got = w.getWorldPosition(new THREE.Vector3());
      assert.ok(got.distanceTo(hand) < 1e-3, `hand ${hand.toArray()} reached ${got.toArray()}`);
    }
  });
  it("clamps unreachable targets to a straight arm pointing at them", () => {
    const r = solveArmIK(new THREE.Vector3(), new THREE.Vector3(5, 0, 0), new THREE.Vector3(0, 1, 0), 0.29, 0.27);
    assert.ok(Math.abs(r.elbowAngle) < 0.1, "nearly straight");
  });
});

describe("pose shapes (character faces +Z; his right = −X)", () => {
  const sh = shoulderHeight();

  it("SIDE_POINT: right arm out at shoulder height, left hand low at the waist/center", () => {
    const c = new MichaelCharacter();
    c.setPose("SIDE_POINT");
    const h = hands(c);
    assert.ok(h.right.x < -0.9, `right hand far out (x=${h.right.x.toFixed(2)})`);
    assert.ok(Math.abs(h.right.y - sh) < 0.3, `right hand near shoulder height (${h.right.y.toFixed(2)} vs ${sh.toFixed(2)})`);
    assert.ok(Math.abs(h.left.x) < 0.25, "left hand near the body center");
    assert.ok(h.left.y < sh - 0.4, "left hand low (waist)");
  });

  it("FACE_COVER: left hand at the face, right arm low and out", () => {
    const c = new MichaelCharacter();
    c.setPose("FACE_COVER");
    const h = hands(c);
    assert.ok(h.left.distanceTo(h.head) < 0.35, `left hand near head (${h.left.distanceTo(h.head).toFixed(2)})`);
    assert.ok(h.left.z > h.head.z, "hand in front of the face");
    assert.ok(h.right.y < sh - 0.5, "right hand low");
    assert.ok(h.right.x < -0.5, "right hand out to the side");
  });

  it("DIAGONAL_REACH: right hand up and out above the head line, left hand at the upper chest", () => {
    const c = new MichaelCharacter();
    c.setPose("DIAGONAL_REACH");
    const h = hands(c);
    assert.ok(h.right.y > h.head.y - 0.05, "right hand at/above head height");
    assert.ok(h.right.x < -0.7, "right hand well out to the side");
    assert.ok(Math.abs(h.left.x) < 0.35, "left hand near the chest center");
    assert.ok(h.left.y > sh - 0.35 && h.left.y < sh + 0.1, "left hand at upper chest height");
  });

  it("the three poses are clearly distinct from each other and from neutral", () => {
    const c = new MichaelCharacter();
    const snaps = [null, ...POSES].map((id) => {
      c.setPose(id);
      const h = hands(c);
      return { id, l: h.left.clone(), r: h.right.clone() };
    });
    for (let i = 0; i < snaps.length; i++)
      for (let j = i + 1; j < snaps.length; j++) {
        const a = snaps[i]!;
        const b = snaps[j]!;
        const diff = a.l.distanceTo(b.l) + a.r.distanceTo(b.r);
        assert.ok(diff > 0.5, `${a.id} vs ${b.id} hands differ by only ${diff.toFixed(2)}`);
      }
  });

  it("feet stay planted: the root never moves", () => {
    const c = new MichaelCharacter();
    for (const id of POSES) {
      c.playPose(id);
      for (let t = 0; t < 1.5; t += 1 / 60) c.update(1 / 60);
      assert.deepEqual(c.root.position.toArray(), [0, 0, 0]);
    }
  });
});

describe("animation timeline", () => {
  const A = MJ_ANIMATION;
  const step = (c: MichaelCharacter, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 120) c.update(1 / 120);
  };

  it("starts moving immediately on playPose (no delay before the aura)", () => {
    const c = new MichaelCharacter();
    step(c, 0.2);
    const before = c.getHandPosition("right").clone();
    c.playPose("DIAGONAL_REACH");
    c.update(1 / 60);
    assert.ok(c.getHandPosition("right").distanceTo(before) > 0.02, "hand already moving after one frame");
  });

  it("transitions in fast, holds the pose, then returns to neutral", () => {
    const c = new MichaelCharacter();
    const neutralHand = c.getHandPosition("right").clone();
    const target = new MichaelCharacter();
    target.setPose("SIDE_POINT");
    const targetHand = target.getHandPosition("right").clone();

    c.playPose("SIDE_POINT");
    assert.ok(A.transitionIn >= 0.1 && A.transitionIn <= 0.18, "transition 100–180 ms");
    assert.ok(A.hold >= 0.25 && A.hold <= 0.5, "hold 250–500 ms");
    step(c, A.transitionIn + A.hold / 2);
    assert.equal(c.poseId, "SIDE_POINT");
    assert.ok(c.getHandPosition("right").distanceTo(targetHand) < 0.08, "in the pose during the hold");

    step(c, A.hold / 2 + A.transitionOut + 0.05);
    assert.equal(c.poseId, null, "back to idle");
    assert.ok(c.getHandPosition("right").distanceTo(neutralHand) < 0.08, "back near neutral");
  });

  it("a new pose mid-animation blends from the current position (no snapping)", () => {
    const c = new MichaelCharacter();
    c.playPose("SIDE_POINT");
    step(c, 0.25);
    const mid = c.getHandPosition("right").clone();
    c.playPose("FACE_COVER");
    c.update(1 / 240);
    assert.ok(c.getHandPosition("right").distanceTo(mid) < 0.1, "continuous: no jump on retrigger");
    assert.equal(c.poseId, "FACE_COVER");
  });

  it("reset() returns to neutral idle", () => {
    const c = new MichaelCharacter();
    c.setPose("FACE_COVER");
    c.reset();
    assert.equal(c.poseId, null);
  });
});

describe("expanded pose library on MJ", () => {
  // Imported lazily to keep the original suites above unchanged.
  const load = async () => {
    const { POSE_REGISTRY } = await import("../src/game/poseRegistry");
    const { mjPoseFrame } = await import("../src/arena/characters/mjPoseProbe");
    return { POSE_REGISTRY, mjPoseFrame };
  };

  it("MJ knows every gameplay pose", async () => {
    const { POSE_REGISTRY } = await load();
    for (const p of POSE_REGISTRY) assert.ok(MichaelCharacter.POSE_IDS.includes(p.id), `MJ has no animation for ${p.id}`);
  });

  it("every pose MJ demonstrates is recognized as exactly that pose by the real classifiers", async () => {
    const { POSE_REGISTRY, mjPoseFrame } = await load();
    const c = new MichaelCharacter();
    for (const p of POSE_REGISTRY) {
      c.setPose(p.id);
      const frame = mjPoseFrame(c);
      const hits = POSE_REGISTRY.filter((q) => q.classifier.evaluate(frame).matched).map((q) => q.id);
      assert.deepEqual(hits, [p.id], `MJ's ${p.id} is recognized as [${hits.join(", ")}]`);
    }
    c.setPose(null);
    assert.deepEqual(
      POSE_REGISTRY.filter((q) => q.classifier.evaluate(mjPoseFrame(c)).matched).map((q) => q.id),
      [],
      "neutral MJ matches nothing",
    );
  });

  it("feet stay on the floor and every joint stays finite in every pose (no exploding rig)", async () => {
    const { POSE_REGISTRY } = await load();
    const c = new MichaelCharacter();
    for (const p of POSE_REGISTRY) {
      c.setPose(p.id);
      const s = c.skeleton();
      for (const side of ["left", "right"] as const) {
        assert.ok(s.ankle[side].y > -0.05 && s.ankle[side].y < 0.2, `${p.id} ${side} ankle at ${s.ankle[side].y.toFixed(2)}`);
        for (const v of [s.shoulder[side], s.elbow[side], s.wrist[side], s.hip[side], s.knee[side]])
          assert.ok(Number.isFinite(v.x + v.y + v.z), `${p.id} non-finite joint`);
      }
      assert.ok(s.head.y > 1.8, `${p.id} head height ${s.head.y.toFixed(2)}`);
      assert.ok(Math.abs(s.ankle.left.y - s.ankle.right.y) < 0.03, `${p.id}: both feet planted (ankles ${s.ankle.left.y.toFixed(3)} / ${s.ankle.right.y.toFixed(3)})`);
      assert.deepEqual(c.root.position.toArray(), [0, 0, 0]);
    }
  });

  it("transitionTo blends smoothly (no snap) and then holds the new pose", async () => {
    const c = new MichaelCharacter();
    c.setPose("SKY_POINT");
    const target = new MichaelCharacter();
    target.setPose("THRILLER_CLAW");
    const goal = target.getHandPosition("right").clone();
    let prev = c.getHandPosition("right").clone();
    c.transitionTo("THRILLER_CLAW", 0.45);
    let maxStep = 0;
    for (let t = 0; t < 0.6; t += 1 / 60) {
      c.update(1 / 60);
      const now = c.getHandPosition("right").clone();
      maxStep = Math.max(maxStep, now.distanceTo(prev));
      prev = now;
    }
    assert.ok(maxStep < 0.12, `largest per-frame hand jump ${maxStep.toFixed(3)} (should glide)`);
    assert.ok(c.getHandPosition("right").distanceTo(goal) < 0.05, "arrives at the new pose");
    assert.equal(c.poseId, "THRILLER_CLAW", "and holds it");
  });
});
