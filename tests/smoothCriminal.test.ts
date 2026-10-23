/**
 * SMOOTH CRIMINAL for real webcam play: a safe whole-body sideways lean either way, feet
 * optional, the far arm may be hidden, and nothing that merely tilts (head, one shoulder,
 * the waist) or another pose counts. Includes the real hold state machine with jitter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POSE_REGISTRY } from "../src/game/poseRegistry";
import { SMOOTH_CRIMINAL_CONFIG as C, POSE_CONFIG } from "../src/pose/poseConfig";
import { PoseHoldStateMachine } from "../src/pose/poseStateMachine";
import type { PoseFrame } from "../src/pose/poseTypes";
import { NEUTRAL_STANCE, POSE_REFERENCES } from "./helpers/poseReferences";
import { body, DOWN, FACE, LOW, LOW_WIDE, WING, type Arm, type BodyOpts } from "./helpers/syntheticBody";

const SC = POSE_REGISTRY.find((p) => p.id === "SMOOTH_CRIMINAL")!.classifier;
const matches = (f: PoseFrame) => POSE_REGISTRY.filter((p) => p.classifier.evaluate(f).matched).map((p) => p.id);

function mirrorFrame(f: PoseFrame): PoseFrame {
  const pairs = [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [2, 5], [7, 8], [9, 10]] as const;
  const lm = f.landmarks!.map((p) => ({ ...p, x: f.width - p.x }));
  for (const [a, b] of pairs) [lm[a], lm[b]] = [lm[b]!, lm[a]!];
  return { ...f, landmarks: lm };
}
const edit = (f: PoseFrame, fn: (lm: NonNullable<PoseFrame["landmarks"]>) => void) => {
  const lm = f.landmarks!.map((p) => ({ ...p }));
  fn(lm);
  return { ...f, landmarks: lm };
};
const hide = (f: PoseFrame, ...idx: number[]) => edit(f, (lm) => idx.forEach((i) => (lm[i] = { ...lm[i]!, confidence: 0.25 })));
/** Natural lean: a little from the ankles, the rest from the hips (legs tilt less than the torso). */
const natural = (legs: number, torsoExtra: number, o: BodyOpts = {}) => body(LOW, LOW, { legs: 45, lean: legs, waistBend: torsoExtra, ...o });

function expectSC(f: PoseFrame, what: string) {
  const e = SC.evaluate(f);
  const fails = e.conditions.filter((c) => !c.pass).map((c) => `${c.id}=${c.value.toFixed(2)}`);
  assert.equal(e.matched, true, `${what}: feedback="${e.feedback}" ${fails.join(" ")}`);
  assert.deepEqual(matches(f), ["SMOOTH_CRIMINAL"], `${what}: only SMOOTH_CRIMINAL`);
}
const expectNotSC = (f: PoseFrame, what: string) => assert.equal(SC.evaluate(f).matched, false, what);

describe("Smooth Criminal: a safe whole-body lean is recognized", () => {
  it("left and right, mirrored, from a moderate 10° up", () => {
    for (const lean of [10, 12, 15, 20, -10, -12, -15, -20]) {
      expectSC(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean }), `plank lean ${lean}°`);
      expectSC(mirrorFrame(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean })), `mirrored ${lean}°`);
    }
  });
  it("a natural lean: hips shifted a little, upper body leaning more", () => {
    for (const [legs, extra] of [[4, 7], [3, 9], [6, 5], [-4, -7], [-3, -9]] as const) expectSC(natural(legs, extra), `legs ${legs}° + torso ${extra}°`);
  });
  it("feet optional: full body, knees only, or hips-up framing", () => {
    expectSC(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), "full body");
    expectSC(hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), 27, 28), "ankles out of view (knees used)");
    expectSC(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12, legs: undefined }), "legs out of view");
  });
  it("different body proportions and camera distances", () => {
    for (const o of [{ armScale: 0.88 }, { armScale: 1.12 }, { shoulderHalf: 70 }, { scale: 0.6, offset: [120, 60] }, { scale: 1.05 }, { scale: 0.8, offset: [-200, 20] }] as BodyOpts[])
      expectSC(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12, ...o }), JSON.stringify(o));
  });
  it("arms: hanging or a little out for balance; the far arm may be hidden (side-on)", () => {
    expectSC(body(LOW_WIDE, LOW, { legs: 45, lean: 12 }), "one arm a little out");
    expectSC(body(DOWN, DOWN, { legs: 45, lean: -12 }), "arms straight down");
    expectSC(hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), 14, 16), "right arm hidden");
    expectSC(hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: -12 }), 13, 15), "left arm hidden, other way");
    const e = SC.evaluate(hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), 14, 16));
    assert.ok(e.notes!.some((n) => n.startsWith("HIDDEN ARM: right ACCEPTABLE")), "tester shows the hidden arm as acceptable");
  });
});

describe("Smooth Criminal: zones and live coaching", () => {
  const fb = (f: PoseFrame) => SC.evaluate(f).feedback;
  it("0–6° standing, 6–9° almost, 9°+ lean OK", () => {
    assert.equal(fb(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 3 })), "Lean your whole body to the left or right");
    assert.equal(fb(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: -7.5 })), "Lean a little farther");
    assert.equal(fb(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 })), "GOOD — HOLD IT");
    assert.equal(C.almostLean, 6);
    assert.equal(C.minTorsoLean, 9);
  });
  it("waist-only bend and an over-folded body get a precise fix", () => {
    assert.equal(fb(body(LOW, LOW, { legs: 45, waistBend: 14 })), "Don't bend at the waist: shift your hips the same way");
    assert.equal(fb(body(LOW, LOW, { legs: 45, lean: -3, waistBend: 16 })), "Don't bend at the waist: shift your hips the same way");
    assert.equal(fb(body(LOW, LOW, { legs: 45, lean: 3, waistBend: 28 })), "Keep your body straight");
  });
  it("the tester readout shows the live values", () => {
    const notes = SC.evaluate(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 7.5 })).notes!;
    assert.match(notes[0]!, /^BODY LEAN: 7\.5° .*required ≥ 9°.*ALMOST/);
    assert.match(notes[1]!, /^BODY STRAIGHTNESS: legs 7\.5° with the lean/);
    assert.match(notes[2]!, /^VISIBLE ARM: left PASS .*right PASS/);
    assert.match(notes[4]!, /^FEET \/ ANKLES: visible/);
    assert.match(notes[5]!, /^RESULT: Lean a little farther/);
  });
});

describe("Smooth Criminal: not a generic 'leaning slightly' detector", () => {
  it("standing, slight casual lean, waist-only bend", () => {
    expectNotSC(NEUTRAL_STANCE(), "neutral");
    for (const lean of [-6, -4, 4, 6]) expectNotSC(NEUTRAL_STANCE({ lean }), `casual lean ${lean}°`);
    for (const bend of [12, 16, 22, -16]) expectNotSC(body(LOW, LOW, { legs: 45, waistBend: bend }), `waist bend ${bend}°`);
    expectNotSC(body(LOW, LOW, { legs: 45, lean: -4, waistBend: 18 }), "hips pushed the other way");
  });
  it("head tilt and a dropped shoulder (hips visible) are not a lean", () => {
    const tilt = edit(NEUTRAL_STANCE(), (lm) => {
      for (const i of [0, 2, 5, 7, 8, 9, 10]) lm[i] = { ...lm[i]!, x: lm[i]!.x + 40 };
    });
    expectNotSC(tilt, "head tilted");
    const shoulder = edit(NEUTRAL_STANCE(), (lm) => (lm[11] = { ...lm[11]!, y: lm[11]!.y + 35 }));
    expectNotSC(shoulder, "one shoulder dropped");
  });
  it("hips out of view: never guessed from the shoulders", () => {
    const e = SC.evaluate(edit(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 15, legs: undefined, hipsHidden: true }), () => {}));
    assert.equal(e.matched, false);
    assert.equal(e.feedback, "Step back so your hips are in view");
    expectNotSC(edit(NEUTRAL_STANCE({ legs: undefined, hipsHidden: true }), (lm) => (lm[11] = { ...lm[11]!, y: lm[11]!.y + 35 })), "dropped shoulder, hips hidden");
  });
  it("other poses, even while leaning, never become Smooth Criminal", () => {
    const leaning = (l: Arm, r: Arm, lean: number) => body(l, r, { legs: 45, lean });
    for (const lean of [0, 12, -12]) {
      for (const [id, ref] of Object.entries(POSE_REFERENCES)) {
        // History's arms hang down too; leaning it 12° IS the Smooth Criminal shape (History itself
        // requires standing upright ≤ 8°; the upright boundary is tested below).
        if (id === "SMOOTH_CRIMINAL" || (id === "HISTORY_STANCE" && lean !== 0)) continue;
        expectNotSC(ref({ lean }), `${id} lean ${lean}°`);
      }
      expectNotSC(leaning(LOW, FACE, lean), `face cover lean ${lean}°`);
      expectNotSC(leaning(WING, LOW, lean), `diagonal/side arm out, lean ${lean}°`);
      expectNotSC(hide(leaning(LOW, FACE, lean), 14, 16), `face hand hidden, lean ${lean}°`);
    }
    expectNotSC(hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), 13, 14, 15, 16), "both arms hidden");
  });
  it("History Stance and Smooth Criminal never overlap (8°…9° is neither)", () => {
    for (const lean of [0, 5, 8.5, -8.5]) assert.ok(!matches(POSE_REFERENCES.HISTORY_STANCE!({ lean })).includes("SMOOTH_CRIMINAL"));
    for (const lean of [9.5, 12, -12]) assert.ok(!matches(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean })).includes("HISTORY_STANCE"));
  });
});

describe("Smooth Criminal: hold behavior with real-looking tracking noise", () => {
  /** Deterministic ±px jitter on every landmark (MediaPipe-like flicker). */
  const jitter = (f: PoseFrame, seed: number, px: number) => {
    let a = seed * 9301 + 49297;
    const rnd = () => ((a = (a * 9301 + 49297) % 233280) / 233280) * 2 - 1;
    return edit(f, (lm) => lm.forEach((p, i) => (lm[i] = { ...p, x: p.x + rnd() * px, y: p.y + rnd() * px })));
  };
  const run = (make: (i: number) => PoseFrame, frames = 30, stepMs = 50) => {
    const m = new PoseHoldStateMachine("SMOOTH_CRIMINAL");
    let confirmedAt: number | null = null;
    m.onConfirmed((e) => (confirmedAt ??= e.timestamp));
    for (let i = 0; i < frames; i++) {
      const e = SC.evaluate(make(i));
      m.update(e.matched, e.stillInPose, null, i * stepMs);
    }
    return confirmedAt;
  };
  it("a held 11° lean confirms within ~0.5 s despite ±4 px jitter, either way, partly hidden arm", () => {
    for (const lean of [11, -11]) {
      const t = run((i) => jitter(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean }), i + 1, 4));
      assert.ok(t !== null && t <= POSE_CONFIG.holdDuration + 150, `lean ${lean}: confirmed at ${t}`);
    }
    const flicker = (i: number) => jitter(i % 3 === 0 ? hide(POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), 14, 16) : POSE_REFERENCES.SMOOTH_CRIMINAL!({ lean: 12 }), i + 7, 4);
    assert.ok(run(flicker) !== null, "far arm flickering in and out of tracking");
  });
  it("jittery standing or waist bending never confirms", () => {
    assert.equal(run((i) => jitter(NEUTRAL_STANCE({ lean: 5 }), i + 3, 4), 60), null);
    assert.equal(run((i) => jitter(body(LOW, LOW, { legs: 45, waistBend: 16 }), i + 5, 4), 60), null);
  });
  it("after confirming, standing up straight re-arms (the pose can be left)", () => {
    const up = SC.evaluate(NEUTRAL_STANCE());
    assert.equal(up.stillInPose, false);
  });
});
