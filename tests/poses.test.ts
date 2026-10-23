/**
 * Synthetic pose tests: hand-built skeletons, no webcam.
 * They check the geometry logic and the hold/release behavior, not real-world
 * accuracy (only physical testing can confirm that).
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagonalReachPose } from "../src/pose/diagonalReachPose";
import { faceCoverPose } from "../src/pose/faceCoverPose";
import { PoseHoldStateMachine } from "../src/pose/poseStateMachine";
import type { PoseClassifier, PoseFrame } from "../src/pose/poseTypes";
import { sidePointPose } from "../src/pose/sidePointPose";
import {
  body,
  mirror,
  DOWN,
  HORIZONTAL,
  EXT,
  WAIST,
  FACE,
  FACE_SALUTE,
  FACE_OFFSET,
  LOW,
  LOW_WIDE,
  LOW_OFFSCREEN,
  CHEST,
  FLEX,
  DIAG,
  DIAG_HIGH,
  DIAG_LOW,
  DIAG_STRAIGHT,
  DIAG_BENT,
  CHEST_HAND,
  CHEST_OFFSET,
} from "./helpers/syntheticBody";

function expectMatch(pose: PoseClassifier, frame: PoseFrame, msg: string) {
  const e = pose.evaluate(frame);
  const fails = e.conditions.filter((c) => !c.pass).map((c) => `${c.id}=${c.value.toFixed(2)}`);
  assert.equal(e.matched, true, `${pose.id} should match "${msg}". feedback="${e.feedback}" fails=${fails.join(" ")}`);
  return e;
}
function expectNoMatch(pose: PoseClassifier, frame: PoseFrame, msg: string) {
  const e = pose.evaluate(frame);
  assert.equal(e.matched, false, `${pose.id} should NOT match "${msg}"`);
  return e;
}

// ---------------------------------------------------------------------------
describe("SIDE_POINT (locked, regression)", () => {
  it("matches the reference and its mirror, with roles reported", () => {
    const a = expectMatch(sidePointPose, body(EXT, WAIST), "left ext + right waist");
    assert.deepEqual(a.roles, { extended: "left", center: "right" });
    const b = expectMatch(sidePointPose, mirror(EXT, WAIST), "right ext + left waist");
    assert.deepEqual(b.roles, { extended: "right", center: "left" });
  });
  it("matches forgiving variants", () => {
    expectMatch(sidePointPose, body(EXT, WAIST, { hipsHidden: true }), "hips hidden");
    expectMatch(sidePointPose, body([[105, 0], [210, -5]], WAIST), "arm level");
    expectMatch(sidePointPose, body(EXT, [[30, 110], [-40, 130]]), "hand on belly");
  });
  it("rejects non-poses with sensible coaching", () => {
    expectNoMatch(sidePointPose, body(DOWN, DOWN), "arms down");
    expectNoMatch(sidePointPose, body(HORIZONTAL, HORIZONTAL), "T-pose");
    expectNoMatch(sidePointPose, body(EXT, DOWN), "other arm hanging");
    assert.equal(
      expectNoMatch(sidePointPose, body([[80, -75], [150, -150]], WAIST), "arm raised").feedback,
      "Lower your arm to shoulder height",
    );
    assert.equal(
      expectNoMatch(sidePointPose, body([[105, 15], [120, -80]], WAIST), "bent").feedback,
      "Straighten your extended arm",
    );
    expectNoMatch(sidePointPose, body(WAIST, WAIST), "both hands at waist");
    expectNoMatch(sidePointPose, body(EXT, [[40, 110], [40, 200]]), "hand far out at hip side");
  });
});

describe("FACE_COVER: should match", () => {
  it("reference-like, left hand at face", () => {
    const e = expectMatch(faceCoverPose, body(FACE, LOW), "left face + right low");
    assert.deepEqual(e.roles, { face: "left", low: "right" });
  });
  it("mirrored, right hand at face", () => {
    const e = expectMatch(faceCoverPose, mirror(FACE, LOW), "right face + left low");
    assert.deepEqual(e.roles, { face: "right", low: "left" });
  });
  it("different elbow bend (elbow out to the side)", () => {
    expectMatch(faceCoverPose, body(FACE_SALUTE, LOW), "salute-like face arm");
  });
  it("wrist slightly offset from the face", () => {
    expectMatch(faceCoverPose, body(FACE_OFFSET, LOW), "wrist beside jaw");
  });
  it("low arm more outward", () => {
    expectMatch(faceCoverPose, body(FACE, LOW_WIDE), "wide low arm");
  });
  it("hips not visible (estimated)", () => {
    const e = expectMatch(faceCoverPose, body(FACE, LOW, { hipsHidden: true }), "hips hidden");
    assert.equal(e.body?.hipsEstimated, true);
  });
  it("face landmarks hidden by the hand (head estimated from shoulders)", () => {
    const e = expectMatch(faceCoverPose, body(FACE, LOW, { faceHidden: true }), "face hidden");
    assert.equal(e.body?.head.estimated, true);
  });
  it("low wrist off the bottom of the frame (judged by elbow)", () => {
    expectMatch(faceCoverPose, body(FACE, LOW_OFFSCREEN), "low wrist off-screen");
  });
});

describe("FACE_COVER: should NOT match", () => {
  it("both arms down", () => {
    assert.equal(expectNoMatch(faceCoverPose, body(DOWN, DOWN), "arms down").feedback, "Bring one hand toward your face");
  });
  it("T-pose", () => {
    expectNoMatch(faceCoverPose, body(HORIZONTAL, HORIZONTAL), "T-pose");
  });
  it("SIDE_POINT (and its mirror)", () => {
    expectNoMatch(faceCoverPose, body(EXT, WAIST), "side point");
    expectNoMatch(faceCoverPose, mirror(EXT, WAIST), "side point mirrored");
  });
  it("both hands near the face", () => {
    assert.equal(expectNoMatch(faceCoverPose, body(FACE, FACE), "both at face").feedback, "Lower your other arm");
  });
  it("face hand not actually near the head (at chest)", () => {
    expectNoMatch(faceCoverPose, body(CHEST, LOW), "hand at chest");
  });
  it("opposite arm raised horizontally", () => {
    assert.equal(expectNoMatch(faceCoverPose, body(FACE, HORIZONTAL), "low arm horizontal").feedback, "Lower your other arm");
  });
  it("random bent arms", () => {
    expectNoMatch(faceCoverPose, body(CHEST, CHEST), "both bent at chest");
    expectNoMatch(faceCoverPose, body(FLEX, FLEX), "double biceps flex");
    expectNoMatch(faceCoverPose, body(FACE, WAIST), "face hand + other hand at waist");
    expectNoMatch(faceCoverPose, body(FLEX, LOW), "wrist beside head, not near face");
  });
});

describe("cross-pose separation", () => {
  it("FACE_COVER poses do not match SIDE_POINT", () => {
    for (const f of [body(FACE, LOW), mirror(FACE, LOW), body(FACE_SALUTE, LOW_WIDE), body(FACE, LOW_OFFSCREEN)]) {
      expectNoMatch(sidePointPose, f, "face cover variant");
    }
  });
  it("SIDE_POINT poses do not match FACE_COVER", () => {
    for (const f of [body(EXT, WAIST), mirror(EXT, WAIST), body(EXT, WAIST, { hipsHidden: true })]) {
      expectNoMatch(faceCoverPose, f, "side point variant");
    }
  });
});

describe("DIAGONAL_REACH: should match", () => {
  it("reference-like, left arm diagonal", () => {
    const e = expectMatch(diagonalReachPose, body(DIAG, CHEST_HAND), "left diag + right chest");
    assert.deepEqual(e.roles, { diagonal: "left", chest: "right" });
  });
  it("mirrored, right arm diagonal", () => {
    const e = expectMatch(diagonalReachPose, mirror(DIAG, CHEST_HAND), "right diag + left chest");
    assert.deepEqual(e.roles, { diagonal: "right", chest: "left" });
  });
  it("diagonal arm slightly higher / lower", () => {
    expectMatch(diagonalReachPose, body(DIAG_HIGH, CHEST_HAND), "higher");
    expectMatch(diagonalReachPose, body(DIAG_LOW, CHEST_HAND), "lower");
  });
  it("different elbow bend (straight and more bent)", () => {
    expectMatch(diagonalReachPose, body(DIAG_STRAIGHT, CHEST_HAND), "straight");
    expectMatch(diagonalReachPose, body(DIAG_BENT, CHEST_HAND), "more bent");
  });
  it("chest wrist slightly offset", () => {
    expectMatch(diagonalReachPose, body(DIAG, CHEST_OFFSET), "offset chest hand");
  });
  it("torso slightly rotated (narrower shoulders)", () => {
    expectMatch(diagonalReachPose, body(DIAG, CHEST_HAND, { shoulderHalf: 55 }), "rotated");
    expectMatch(diagonalReachPose, mirror(DIAG, CHEST_HAND, { shoulderHalf: 55 }), "rotated mirrored");
  });
  it("hips not visible (estimated)", () => {
    const e = expectMatch(diagonalReachPose, body(DIAG, CHEST_HAND, { hipsHidden: true }), "hips hidden");
    assert.equal(e.body?.hipsEstimated, true);
  });
});

describe("DIAGONAL_REACH: should NOT match", () => {
  it("arms down", () => {
    assert.equal(expectNoMatch(diagonalReachPose, body(DOWN, DOWN), "arms down").feedback, "Raise your arm diagonally");
  });
  it("T-pose", () => {
    expectNoMatch(diagonalReachPose, body(HORIZONTAL, HORIZONTAL), "T-pose");
  });
  it("SIDE_POINT and FACE_COVER references (both orientations)", () => {
    for (const f of [body(EXT, WAIST), mirror(EXT, WAIST), body(FACE, LOW), mirror(FACE, LOW)]) {
      expectNoMatch(diagonalReachPose, f, "other pose");
    }
  });
  it("both arms diagonal", () => {
    expectNoMatch(diagonalReachPose, body(DIAG, DIAG), "both diagonal");
  });
  it("diagonal arm with the other arm hanging down", () => {
    assert.equal(
      expectNoMatch(diagonalReachPose, body(DIAG, DOWN), "other hanging").feedback,
      "Bring your other hand toward your chest",
    );
  });
  it("chest hand with the other arm horizontal", () => {
    assert.equal(
      expectNoMatch(diagonalReachPose, body(HORIZONTAL, CHEST_HAND), "other horizontal").feedback,
      "Raise your arm diagonally",
    );
  });
  it("hand near the face instead of the chest", () => {
    expectNoMatch(diagonalReachPose, body(DIAG, FACE), "hand at face");
  });
  it("random bent-arm positions", () => {
    expectNoMatch(diagonalReachPose, body(CHEST_HAND, CHEST_HAND), "both hands at chest");
    expectNoMatch(diagonalReachPose, body(FLEX, FLEX), "double biceps flex");
    expectNoMatch(diagonalReachPose, body(FLEX, CHEST_HAND), "flex + chest");
    expectNoMatch(diagonalReachPose, body(DIAG, WAIST), "diagonal + hand at waist");
    expectNoMatch(diagonalReachPose, body(CHEST, CHEST), "both wrists low chest, arms tucked");
  });
});

describe("cross-pose matrix: each reference matches ONLY its own classifier", () => {
  const POSES = [sidePointPose, faceCoverPose, diagonalReachPose];
  const references: [PoseClassifier, string, PoseFrame][] = [
    [sidePointPose, "SIDE_POINT ref", body(EXT, WAIST)],
    [sidePointPose, "SIDE_POINT mirrored", mirror(EXT, WAIST)],
    [sidePointPose, "SIDE_POINT hips hidden", body(EXT, WAIST, { hipsHidden: true })],
    [faceCoverPose, "FACE_COVER ref", body(FACE, LOW)],
    [faceCoverPose, "FACE_COVER mirrored", mirror(FACE, LOW)],
    [faceCoverPose, "FACE_COVER salute/wide", body(FACE_SALUTE, LOW_WIDE)],
    [faceCoverPose, "FACE_COVER low off-screen", body(FACE, LOW_OFFSCREEN)],
    [diagonalReachPose, "DIAGONAL_REACH ref", body(DIAG, CHEST_HAND)],
    [diagonalReachPose, "DIAGONAL_REACH mirrored", mirror(DIAG, CHEST_HAND)],
    [diagonalReachPose, "DIAGONAL_REACH low/offset", body(DIAG_LOW, CHEST_OFFSET)],
    [diagonalReachPose, "DIAGONAL_REACH high/rotated", body(DIAG_HIGH, CHEST_HAND, { shoulderHalf: 55 })],
  ];
  for (const [owner, name, frame] of references) {
    it(name, () => {
      for (const pose of POSES) {
        if (pose === owner) expectMatch(pose, frame, name);
        else expectNoMatch(pose, frame, name);
      }
    });
  }
});

describe("hold / release with the real classifiers", () => {
  function run(pose: PoseClassifier) {
    const sm = new PoseHoldStateMachine(pose.id);
    let confirms = 0;
    sm.onConfirmed(() => confirms++);
    let t = 0;
    const play = (frame: PoseFrame, ms: number) => {
      for (const end = t + ms; t < end; t += 50) {
        const e = pose.evaluate(frame);
        sm.update(e.matched, e.stillInPose, e.roles[pose.primaryRole] ?? null, t);
      }
    };
    return { play, count: () => confirms };
  }

  for (const [pose, frame] of [
    [faceCoverPose, body(FACE, LOW)],
    [sidePointPose, body(EXT, WAIST)],
    [diagonalReachPose, body(DIAG, CHEST_HAND)],
  ] as const) {
    it(`${pose.id}: holding 3 s confirms once; release and re-enter confirms again`, () => {
      const r = run(pose);
      r.play(body(DOWN, DOWN), 300);
      r.play(frame, 300);
      assert.equal(r.count(), 0, "must not confirm before the hold time");
      r.play(frame, 2700);
      assert.equal(r.count(), 1, "exactly one confirmation while held");
      r.play(body(DOWN, DOWN), 600);
      r.play(frame, 600);
      assert.equal(r.count(), 2, "re-armed after leaving the pose");
    });
  }

  it("FACE_COVER: switching to the mirrored version while held does not re-trigger", () => {
    const r = run(faceCoverPose);
    r.play(body(FACE, LOW), 600);
    r.play(mirror(FACE, LOW), 600);
    // Mirroring requires passing through a non-pose in reality; here it's instant, so the
    // release timer must see ≥ releaseDuration of "not in pose", which it doesn't.
    assert.equal(r.count(), 1);
  });
});
