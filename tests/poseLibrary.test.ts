/**
 * Expanded pose library: every pose individually, mirrored, with/without legs,
 * different body proportions and camera distances, and a full confusion matrix
 * (no pose may trigger another). Plus wave-based pose selection.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAYABLE_POSES, POSE_REGISTRY } from "../src/game/poseRegistry";
import { difficultyWeights, selectPose, UNIFORM_WEIGHTS } from "../src/game/poseSelector";
import type { PoseFrame } from "../src/pose/poseTypes";
import { NEUTRAL_STANCE, POSE_REFERENCES } from "./helpers/poseReferences";
import {
  body,
  CHEST_HAND,
  CLAW,
  DOWN,
  FACE,
  FIST_BENT,
  FIST_STRAIGHT,
  HISTORY_FIST_CLOSE,
  HISTORY_FIST_WIDE,
  LOW,
  OVERHEAD,
  UP,
  WING,
  type Arm,
  type BodyOpts,
} from "./helpers/syntheticBody";

const IDS = POSE_REGISTRY.map((p) => p.id);
const classifier = (id: string) => POSE_REGISTRY.find((p) => p.id === id)!.classifier;
const matches = (frame: PoseFrame) => POSE_REGISTRY.filter((p) => p.classifier.evaluate(frame).matched).map((p) => p.id);

/** The same pose done with the other arms: reflect the image and swap left/right landmarks. */
function mirrorFrame(f: PoseFrame): PoseFrame {
  const pairs = [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [2, 5], [7, 8], [9, 10]] as const;
  const lm = f.landmarks!.map((p) => ({ ...p, x: f.width - p.x }));
  for (const [a, b] of pairs) [lm[a], lm[b]] = [lm[b]!, lm[a]!];
  return { ...f, landmarks: lm };
}

function expectOnly(id: string, frame: PoseFrame, what: string) {
  const ev = classifier(id).evaluate(frame);
  const fails = ev.conditions.filter((c) => !c.pass).map((c) => `${c.id}=${c.value.toFixed(2)}`);
  assert.equal(ev.matched, true, `${id} should match (${what}). feedback="${ev.feedback}" fails=${fails.join(" ")}`);
  assert.deepEqual(matches(frame), [id], `${what}: only ${id} may match`);
}

describe("pose library: registry", () => {
  it("has 12 distinct poses across all three difficulties", () => {
    assert.equal(POSE_REGISTRY.length, 12);
    assert.equal(new Set(IDS).size, 12);
    const by = (d: string) => POSE_REGISTRY.filter((p) => p.difficulty === d).length;
    assert.ok(by("easy") >= 4 && by("medium") >= 3 && by("hard") >= 3, "difficulty spread");
    for (const p of POSE_REGISTRY) assert.ok(p.instruction.length > 10 && p.displayName.length > 3, p.id);
    for (const id of Object.keys(POSE_REFERENCES)) assert.ok(IDS.includes(id), `reference for unknown pose ${id}`);
    for (const id of IDS) assert.ok(POSE_REFERENCES[id], `no reference skeleton for ${id}`);
  });
});

describe("pose library: reference photos", () => {
  it("every pose carries photo fields; only poses with a real MJ photo are playable", () => {
    for (const p of POSE_REGISTRY) {
      assert.equal(typeof p.referenceImageAlt, "string");
      assert.equal(typeof p.referenceImagePosition, "string");
      assert.ok(p.referenceImageScale > 0);
      assert.equal(p.missingReference, !PLAYABLE_POSES.includes(p));
    }
    assert.deepEqual(
      PLAYABLE_POSES.map((p) => p.id),
      ["SIDE_POINT", "FACE_COVER", "DIAGONAL_REACH", "HISTORY_STANCE", "SMOOTH_CRIMINAL", "ARMS_OVERHEAD"],
    );
    assert.deepEqual(
      POSE_REGISTRY.filter((p) => p.missingReference).map((p) => p.id),
      ["SKY_POINT", "DOUBLE_SIDE", "THRILLER_CLAW", "POWER_STANCE", "CROSS_BODY", "OVERHEAD_DIAGONAL"],
    );
  });
  it("selection from the playable pool never asks for a pose without a photo, and still avoids repeats", () => {
    let a = 9;
    const r = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
    const recent: string[] = [];
    for (let i = 0; i < 300; i++) {
      const p = selectPose(PLAYABLE_POSES, recent, difficultyWeights(1 + (i % 6)), r);
      assert.equal(p.missingReference, false);
      assert.notEqual(p.id, recent[recent.length - 1]);
      assert.notEqual(p.id, recent[recent.length - 2]);
      recent.push(p.id);
    }
  });
});

describe("pose library: every pose recognises its own silhouette and nothing else", () => {
  for (const id of Object.keys(POSE_REFERENCES)) {
    it(`${id}: reference, mirrored (other arm / mirrored webcam), legs out of frame`, () => {
      const ref = POSE_REFERENCES[id]!;
      expectOnly(id, ref(), "reference");
      expectOnly(id, mirrorFrame(ref()), "mirrored");
      expectOnly(id, ref({ legs: undefined }), "legs not visible");
    });
    it(`${id}: different body proportions and camera distances`, () => {
      const ref = POSE_REFERENCES[id]!;
      const variants: [string, BodyOpts][] = [
        ["shorter arms", { armScale: 0.88 }],
        ["longer arms", { armScale: 1.12 }],
        ["narrow shoulders", { shoulderHalf: 70 }],
        ["far from camera", { scale: 0.6, offset: [120, 60] }],
        ["closer to camera", { scale: 1.08 }],
        ["off-center", { scale: 0.8, offset: [-200, 20] }],
      ];
      for (const [what, o] of variants) expectOnly(id, ref(o), what);
    });
  }

  it("a relaxed neutral stance (with or without legs, any distance) matches no pose", () => {
    for (const f of [NEUTRAL_STANCE(), NEUTRAL_STANCE({ legs: undefined }), NEUTRAL_STANCE({ scale: 0.6 }), mirrorFrame(NEUTRAL_STANCE())])
      assert.deepEqual(matches(f), []);
  });
});

describe("pose library: similar poses don't trigger each other", () => {
  it("raised arm at 70° with the other down: neither SKY_POINT nor DIAGONAL_REACH", () => {
    const steep: Arm = [[35, -100], [70, -190]]; // ~70°
    const f = body(LOW, steep, { legs: 70 });
    assert.deepEqual(matches(f), []);
    assert.equal(classifier("SKY_POINT").evaluate(f).feedback, "Point straight up");
  });
  it("hands overhead but apart: not ARMS_OVERHEAD, not THRILLER_CLAW", () => {
    const apart: Arm = [[60, -105], [40, -215]];
    const f = body(apart, apart, { legs: 120 });
    assert.deepEqual(matches(f), []);
    assert.equal(classifier("ARMS_OVERHEAD").evaluate(f).feedback, "Bring your hands together above your head");
  });
  it("claw with straight arms is DOUBLE_SIDE territory, not THRILLER_CLAW", () => {
    assert.deepEqual(matches(body(WING, WING)), ["DOUBLE_SIDE"]);
    assert.equal(classifier("THRILLER_CLAW").evaluate(body(WING, WING)).matched, false);
  });
  it("one claw arm + one wing arm matches neither", () => {
    assert.deepEqual(matches(body(CLAW, WING)), []);
  });
  it("sky point with the low arm bent at the chest is not SKY_POINT", () => {
    assert.equal(classifier("SKY_POINT").evaluate(body([[40, 90], [-40, 40]], UP)).matched, false);
  });
  it("DIAGONAL_REACH at the photo's flatter angle (~14°) matches; a level arm with the chest hand does not", () => {
    const flat: Arm = [[100, -5], [190, -48]];
    expectOnly("DIAGONAL_REACH", body(flat, CHEST_HAND), "flat diagonal");
    expectOnly("DIAGONAL_REACH", mirrorFrame(body(flat, CHEST_HAND)), "flat diagonal, mirrored");
    assert.deepEqual(matches(body(WING, CHEST_HAND)), []);
    assert.deepEqual(matches(body([[105, 0], [205, -25]], CHEST_HAND)), [], "arm just above level (~7°)");
  });
  it("a lean between the HISTORY (≤ 8°) and SMOOTH_CRIMINAL (≥ 9°) thresholds matches neither", () => {
    assert.deepEqual(matches(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 8.5 })), []);
    assert.deepEqual(matches(POSE_REFERENCES.HISTORY_STANCE!({ lean: 8.5 })), []);
  });
});

describe("pose library: reference-photo reliability (real MediaPipe findings)", () => {
  // Real MediaPipe on the ARMS OVERHEAD photo, mirrored: the arm hidden behind the head is placed
  // with its wrist beside the ear and the elbow near shoulder height (the other arm is overhead).
  const EAR_SUPPORT: Arm = [[60, 10], [-50, -60]];
  const hide = (f: PoseFrame, ...idx: number[]) => {
    for (const i of idx) f.landmarks![i] = { ...f.landmarks![i]!, confidence: 0.25 };
    return f;
  };
  it("ARMS_OVERHEAD: one arm overhead + the other raised to the head and converging (either side)", () => {
    expectOnly("ARMS_OVERHEAD", body(EAR_SUPPORT, OVERHEAD, { legs: 120 }), "support arm at the ear");
    expectOnly("ARMS_OVERHEAD", mirrorFrame(body(EAR_SUPPORT, OVERHEAD, { legs: 120 })), "mirrored");
    expectOnly("ARMS_OVERHEAD", body(EAR_SUPPORT, OVERHEAD), "legs not visible");
  });
  it("ARMS_OVERHEAD still needs both arms up and the hands together", () => {
    const relaxed: Arm = [[10, 110], [15, 210]];
    for (const [what, f] of [
      ["one arm overhead, other down", body(relaxed, OVERHEAD, { legs: 120 })],
      ["one arm overhead, other at the chest", body(CHEST_HAND, OVERHEAD, { legs: 120 })],
      ["support hand at the ear but far from the raised hand", body([[60, 10], [40, -60]], [[60, -105], [60, -215]], { legs: 120 })],
      ["both elbows bent, hands beside the head", body([[85, -20], [-10, -85]], [[85, -20], [-10, -85]], { legs: 120 })],
    ] as const)
      assert.equal(classifier("ARMS_OVERHEAD").evaluate(f).matched, false, what);
  });
  it("SMOOTH_CRIMINAL: the far arm may be hidden behind the body (side-on lean), either side", () => {
    expectOnly("SMOOTH_CRIMINAL", hide(POSE_REFERENCES.SMOOTH_CRIMINAL!(), 14, 16), "right arm hidden");
    expectOnly("SMOOTH_CRIMINAL", hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: -15 }), 13, 15), "left arm hidden, other way");
    assert.equal(classifier("SMOOTH_CRIMINAL").evaluate(hide(body(LOW, LOW, { legs: 30 }), 14, 16)).matched, false, "hidden arm, no lean");
    assert.equal(
      classifier("SMOOTH_CRIMINAL").evaluate(hide(body(LOW, LOW, { legs: 30, waistBend: 16 }), 14, 16)).matched,
      false,
      "hidden arm, waist bend only",
    );
    // Face Cover photo finding: a raised arm (hand at the face) can't count as "hidden" in a lean.
    assert.equal(
      classifier("SMOOTH_CRIMINAL").evaluate(hide(body(LOW, FACE, { legs: 30, lean: 12 }), 14, 16)).matched,
      false,
      "hidden arm is raised, not hanging",
    );
    const both = classifier("SMOOTH_CRIMINAL").evaluate(hide(POSE_REFERENCES.SMOOTH_CRIMINAL!(), 13, 14, 15, 16));
    assert.equal(both.matched, false, "both arms hidden");
  });
  it("edge cases trigger nothing (or only their own pose)", () => {
    assert.deepEqual(matches(NEUTRAL_STANCE({ lean: 5 })), [], "normal slight body lean");
    assert.deepEqual(matches(NEUTRAL_STANCE({ lean: -5 })), [], "normal slight body lean, other way");
    assert.deepEqual(matches(body(LOW, LOW, { legs: 30, waistBend: 16 })), [], "waist-only bend");
    assert.deepEqual(matches(body(WING, WING)), ["DOUBLE_SIDE"], "arms straight sideways");
    assert.ok(!matches(body(DOWN, UP, { legs: 70 })).includes("ARMS_OVERHEAD"), "one arm overhead");
    assert.deepEqual(matches(body([[85, -20], [-10, -85]], [[85, -20], [-10, -85]])), [], "both elbows bent beside the head");
  });
});

describe("pose library: stance, lean and orientation rules", () => {
  it("leg rules apply when the feet are visible: narrow stance fails with coaching", () => {
    const overhead = classifier("ARMS_OVERHEAD").evaluate(body(OVERHEAD, OVERHEAD, { legs: 25 }));
    assert.equal(overhead.matched, false);
    assert.equal(overhead.feedback, "Spread your feet wide");
    assert.equal(classifier("POWER_STANCE").evaluate(POSE_REFERENCES.POWER_STANCE!({ legs: 30 })).matched, false);
  });
  it("HISTORY_STANCE matches the photo's nearly straight arms, and variations of it", () => {
    const H = (l: Arm, r: Arm, o?: BodyOpts) => body(l, r, { legs: 60, ...o });
    expectOnly("HISTORY_STANCE", H(HISTORY_FIST_CLOSE, HISTORY_FIST_WIDE), "photo, other arm wider");
    expectOnly("HISTORY_STANCE", H(FIST_BENT, FIST_STRAIGHT), "one arm more bent");
    expectOnly("HISTORY_STANCE", H(HISTORY_FIST_WIDE, HISTORY_FIST_WIDE), "both fists wide");
    expectOnly("HISTORY_STANCE", H([[0, 105], [30, 205]], [[0, 105], [30, 205]]), "both arms straight, fists a little out");
    expectOnly("HISTORY_STANCE", POSE_REFERENCES.HISTORY_STANCE!({ lean: 5 }), "slight lean, like the photo");
    expectOnly("HISTORY_STANCE", mirrorFrame(POSE_REFERENCES.HISTORY_STANCE!({ armScale: 0.9, shoulderHalf: 74 })), "mirrored, other proportions");
  });
  it("HISTORY_STANCE: relaxed standing, one fist out or leaning doesn't count", () => {
    const relaxed: Arm = [[0, 110], [0, 210]]; // wrists right under the shoulders
    for (const f of [body(DOWN, DOWN, { legs: 60 }), body(relaxed, relaxed, { legs: 60 }), body(DOWN, DOWN, { legs: 60, armScale: 1.12 }), mirrorFrame(body(DOWN, DOWN))])
      assert.equal(classifier("HISTORY_STANCE").evaluate(f).matched, false, "relaxed standing");
    assert.equal(classifier("HISTORY_STANCE").evaluate(body(HISTORY_FIST_WIDE, relaxed, { legs: 60 })).matched, false, "one fist out only");
    const leaning = classifier("HISTORY_STANCE").evaluate(POSE_REFERENCES.HISTORY_STANCE!({ lean: 12 }));
    assert.equal(leaning.matched, false);
    assert.equal(leaning.conditions.find((c) => c.id.endsWith("upright"))?.pass, false, "leaning fails the upright rule");
  });
  it("roles report which physical arm did what (mirrored webcam keeps anatomy)", () => {
    const e = classifier("SKY_POINT").evaluate(POSE_REFERENCES.SKY_POINT!());
    assert.deepEqual(e.roles, { up: "right", down: "left" });
    const m = classifier("SKY_POINT").evaluate(mirrorFrame(POSE_REFERENCES.SKY_POINT!()));
    assert.deepEqual(m.roles, { up: "left", down: "right" });
  });
  it("hysteresis: a matched pose stays 'in pose' through a small wobble", () => {
    const f = body(OVERHEAD, [[60, -100], [-30, -180]], { legs: 120 }); // hands drifting apart slightly
    const e = classifier("ARMS_OVERHEAD").evaluate(f);
    assert.equal(e.stillInPose, true);
  });
});

describe("pose selection", () => {
  const rand = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const run = (wave: number | null, n: number, seed = 3) => {
    const r = rand(seed);
    const recent: string[] = [];
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = selectPose(POSE_REGISTRY, recent, wave === null ? UNIFORM_WEIGHTS : difficultyWeights(wave), r);
      out.push(p.id);
      recent.push(p.id);
    }
    return out;
  };
  const diff = (id: string) => POSE_REGISTRY.find((p) => p.id === id)!.difficulty;

  it("never repeats a pose within the next 3 selections", () => {
    for (const wave of [null, 1, 2, 3, 6]) {
      const seq = run(wave, 400);
      for (let i = 0; i < seq.length; i++)
        for (let k = 1; k <= 3 && i + k < seq.length; k++) assert.notEqual(seq[i], seq[i + k], `wave ${wave} at ${i}+${k}`);
    }
  });
  it("wave 1 is almost all easy, never hard", () => {
    const seq = run(1, 400);
    assert.equal(seq.filter((id) => diff(id) === "hard").length, 0);
    assert.ok(seq.filter((id) => diff(id) === "easy").length / seq.length > 0.75);
  });
  it("wave 2 mixes in medium poses, still no hard ones", () => {
    const seq = run(2, 400);
    assert.equal(seq.filter((id) => diff(id) === "hard").length, 0);
    assert.ok(seq.filter((id) => diff(id) === "medium").length / seq.length > 0.25);
  });
  it("later waves use the full library, including hard poses, and stay random", () => {
    const seq = run(6, 600);
    assert.ok(seq.filter((id) => diff(id) === "hard").length / seq.length > 0.25);
    for (const id of IDS) assert.ok(seq.includes(id), `${id} never chosen at wave 6`);
    assert.notDeepEqual(run(6, 30, 1), run(6, 30, 2));
  });
  it("difficulty rises monotonically-ish across waves", () => {
    const hardShare = (w: number) => run(w, 600).filter((id) => diff(id) === "hard").length / 600;
    assert.ok(hardShare(1) <= hardShare(3) && hardShare(3) <= hardShare(5));
  });
});
