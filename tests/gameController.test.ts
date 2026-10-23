/**
 * Gameplay-loop tests: the REAL (locked) classifiers evaluate synthetic
 * skeletons, and the GameController decides what counts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GAME_CONFIG } from "../src/game/gameConfig";
import { GameController, type PoseConfirmedEvent } from "../src/game/gameController";
import { POSE_REGISTRY } from "../src/game/poseRegistry";
import { POSE_CONFIG } from "../src/pose/poseConfig";
import type { PoseFrame } from "../src/pose/poseTypes";
import { POSE_REFERENCES } from "./helpers/poseReferences";
import { DOWN, body } from "./helpers/syntheticBody";

const IDS = POSE_REGISTRY.map((p) => p.id);
/** One canonical body per pose in the library (all 12). */
const REFERENCE: Record<string, PoseFrame> = Object.fromEntries(IDS.map((id) => [id, POSE_REFERENCES[id]!()]));
const NEUTRAL = body(DOWN, DOWN);
const NO_PERSON: PoseFrame = { landmarks: null, width: 1280, height: 720, timestamp: 0 };
const STEP = 50; // ms per detection frame (20/s, like the app)
const HOLD = POSE_CONFIG.holdDuration;

/** Deterministic RNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function harness(seed = 1) {
  const game = new GameController(POSE_REGISTRY, mulberry32(seed));
  const events: PoseConfirmedEvent[] = [];
  game.onPoseConfirmed((e) => events.push(e));
  let t = 10_000;
  game.start(t);
  const targets: string[] = [game.snapshot().target!.id];

  /** Feed `ms` of frames. `body` picks the player's body given the current target id. */
  const play = (pick: (targetId: string) => PoseFrame, ms: number) => {
    for (const end = t + ms; t < end; t += STEP) {
      const target = game.snapshot().target!;
      const evaluation = target.classifier.evaluate(pick(target.id));
      const snap = game.update({ now: t, evaluation });
      if (snap.target && snap.target.id !== targets[targets.length - 1]) targets.push(snap.target.id);
    }
    return game.snapshot();
  };
  return { game, events, targets, play, now: () => t };
}

const doTarget = (id: string) => REFERENCE[id]!;
const doWrong = (id: string) => REFERENCE[IDS.find((x) => x !== id)!]!;
/** Time from a confirmation until the next target accepts input. */
const BETWEEN = GAME_CONFIG.hitDisplayMs + GAME_CONFIG.transitionMs;

describe("GameController", () => {
  it("starts READY, then the initial target is one of the library poses", () => {
    const g = new GameController(POSE_REGISTRY, mulberry32(7));
    assert.equal(g.snapshot().phase, "READY");
    assert.equal(g.snapshot().target, null);
    g.start(0);
    const s = g.snapshot();
    assert.equal(s.phase, "TARGET_ACTIVE");
    assert.ok(IDS.includes(s.target!.id));
    assert.equal(s.hits, 0);
    assert.equal(s.progress, 0);
  });

  it("initial target varies with randomness (not a fixed first pose)", () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const g = new GameController(POSE_REGISTRY, mulberry32(seed));
      g.start(0);
      firsts.add(g.snapshot().target!.id);
    }
    assert.ok(firsts.size >= 6, `only ${firsts.size} different first poses`);
  });

  it("the requested pose, held, confirms and advances to a different pose", () => {
    const h = harness();
    const first = h.game.snapshot().target!.id;
    h.play(doTarget, HOLD + 3 * STEP);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0]!.poseId, first);
    assert.equal(h.game.snapshot().phase, "TARGET_CONFIRMED");
    assert.equal(h.game.snapshot().hits, 1);
    h.play(() => NEUTRAL, BETWEEN + STEP);
    const next = h.game.snapshot();
    assert.equal(next.phase, "TARGET_ACTIVE");
    assert.notEqual(next.target!.id, first);
  });

  it("does not confirm before the hold time", () => {
    const h = harness();
    h.play(doTarget, HOLD - 2 * STEP);
    assert.equal(h.events.length, 0);
    assert.equal(h.game.snapshot().phase, "TARGET_MATCHING");
    assert.ok(h.game.snapshot().progress > 0.5);
  });

  it("wrong poses do NOT advance (only the requested pose counts)", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const h = harness(seed);
      const first = h.game.snapshot().target!.id;
      for (const other of IDS.filter((x) => x !== first)) h.play(() => REFERENCE[other]!, 3000);
      h.play(() => NEUTRAL, 1000);
      assert.equal(h.events.length, 0, `seed ${seed}: a non-target pose confirmed`);
      assert.equal(h.game.snapshot().target!.id, first);
      assert.equal(h.game.snapshot().hits, 0);
    }
  });

  it("an evaluation from a different classifier can never count, even if matched", () => {
    const g = new GameController(POSE_REGISTRY, mulberry32(3));
    let hits = 0;
    g.onPoseConfirmed(() => hits++);
    g.start(0);
    const target = g.snapshot().target!;
    const other = POSE_REGISTRY.find((p) => p.id !== target.id)!;
    const real = other.classifier.evaluate(REFERENCE[other.id]!);
    assert.equal(real.matched, true);
    for (let t = 0; t < 3000; t += STEP) g.update({ now: t, evaluation: real });
    assert.equal(hits, 0);
  });

  it("confirmation increments the count exactly once; holding the pose does not repeat", () => {
    const h = harness();
    const first = h.game.snapshot().target!.id;
    // Player freezes in the first pose for 6 s, through the transition to new targets.
    h.play(() => REFERENCE[first]!, 6000);
    assert.equal(h.events.length, 1);
    assert.equal(h.game.snapshot().hits, 1);
    assert.notEqual(h.game.snapshot().target!.id, first);
  });

  it("next pose differs; long runs never repeat a pose consecutively and are not a fixed sequence", () => {
    const sequences = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const h = harness(seed);
      for (let round = 0; round < 40; round++) {
        h.play(doTarget, HOLD + 2 * STEP);
        h.play(() => NEUTRAL, BETWEEN + STEP);
      }
      assert.equal(h.events.length, 40, `seed ${seed}`);
      const seq = h.events.map((e) => e.poseId);
      for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `seed ${seed}: duplicate at ${i}`);
      for (const id of IDS) assert.ok(seq.includes(id), `seed ${seed}: ${id} never requested`);
      // Event order matches the order targets were shown.
      assert.deepEqual(seq, h.targets.slice(0, seq.length));
      sequences.add(seq.slice(0, 12).join(","));
    }
    assert.ok(sequences.size > 5, "sequences should vary between runs");
  });

  it("each event carries poseId and timestamp; hits count up by exactly 1", () => {
    const h = harness(5);
    for (let i = 1; i <= 5; i++) {
      const id = h.game.snapshot().target!.id;
      h.play(doTarget, HOLD + 2 * STEP);
      const e = h.events[h.events.length - 1]!;
      assert.equal(e.poseId, id);
      assert.equal(e.hits, i);
      assert.ok(e.timestamp > 10_000 && e.timestamp <= h.now());
      h.play(() => NEUTRAL, BETWEEN + STEP);
    }
  });

  it("tracking loss freezes progression: no fail, same pose, no hold progress; resumes after", () => {
    const h = harness();
    const first = h.game.snapshot().target!.id;
    h.play(doTarget, HOLD - 2 * STEP); // almost done
    const lost = h.play(() => NO_PERSON, 3000);
    assert.equal(lost.paused, "tracking");
    assert.equal(lost.target!.id, first);
    assert.equal(lost.progress, 0);
    assert.equal(h.events.length, 0);

    // Back in frame and in the pose: needs a full fresh hold.
    h.play(doTarget, HOLD - 2 * STEP);
    assert.equal(h.events.length, 0, "stale progress from before the pause must not count");
    assert.equal(h.game.snapshot().paused, null);
    h.play(doTarget, 4 * STEP);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0]!.poseId, first);
  });

  it("tracking loss during POSE HIT / transition pauses the transition too", () => {
    const h = harness();
    h.play(doTarget, HOLD + 2 * STEP);
    const confirmedTarget = h.game.snapshot().target!.id;
    h.play(() => NO_PERSON, 3000);
    assert.equal(h.game.snapshot().phase, "TARGET_CONFIRMED");
    assert.equal(h.game.snapshot().target!.id, confirmedTarget);
    h.play(() => NEUTRAL, BETWEEN + STEP);
    assert.equal(h.game.snapshot().phase, "TARGET_ACTIVE");
  });

  it("a brief tracking dropout (< grace) does not pause the game", () => {
    const h = harness();
    h.play(() => NEUTRAL, 200);
    const s = h.play(() => NO_PERSON, GAME_CONFIG.trackingLostGraceMs - STEP);
    assert.equal(s.paused, null);
  });

  it("hidden tab: nothing progresses or confirms while hidden; resumes safely", () => {
    const h = harness();
    const first = h.game.snapshot().target!.id;
    h.play(doTarget, HOLD - 2 * STEP);
    h.game.setHidden(true);
    h.play(doTarget, 5000);
    assert.equal(h.events.length, 0);
    assert.equal(h.game.snapshot().paused, "hidden");
    assert.equal(h.game.snapshot().target!.id, first);
    h.game.setHidden(false);
    h.play(doTarget, HOLD - 2 * STEP);
    assert.equal(h.events.length, 0, "hold progress from before hiding must not count");
    h.play(doTarget, 4 * STEP);
    assert.equal(h.events.length, 1);
  });

  it("a new target starts with a clean hold: no instant confirm from residual position", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const h = harness(seed);
      h.play(doTarget, HOLD + 2 * STEP);
      // Player is a "perfect" machine: the instant a new target is shown, they're in it.
      const shownAt = h.now();
      let newTargetShownAt: number | null = null;
      let firstPhase: string | null = null;
      for (let i = 0; i < 100 && h.events.length < 2; i++) {
        const before = h.game.snapshot().target!.id;
        h.play(doTarget, STEP);
        const s = h.game.snapshot();
        if (newTargetShownAt === null && s.target!.id !== before) {
          newTargetShownAt = h.now();
          firstPhase = s.phase;
          assert.equal(s.progress, 0, "new target must start at 0 progress");
        }
      }
      assert.ok(newTargetShownAt !== null && newTargetShownAt > shownAt);
      assert.equal(firstPhase, "TRANSITION");
      const secondConfirmAt = h.events[1]!.timestamp;
      assert.ok(
        secondConfirmAt - newTargetShownAt! >= GAME_CONFIG.transitionMs + HOLD - STEP,
        `seed ${seed}: next pose confirmed too fast (${secondConfirmAt - newTargetShownAt!} ms)`,
      );
    }
  });

  it("wrong pose during the hold resets it (leaving the pose resets progress)", () => {
    const h = harness();
    h.play(doTarget, HOLD - 3 * STEP);
    h.play(doWrong, 500);
    assert.equal(h.game.snapshot().progress, 0);
    h.play(doTarget, HOLD - 3 * STEP);
    assert.equal(h.events.length, 0);
  });

  it("with a wave provider: early waves ask only easy/medium poses, later waves add hard ones; no repeats within 3", () => {
    const run = (wave: number, seed: number) => {
      const game = new GameController(POSE_REGISTRY, mulberry32(seed), GAME_CONFIG, () => wave);
      const seen: string[] = [];
      let t = 0;
      game.start(t);
      for (let round = 0; round < 60; round++) {
        const id = game.snapshot().target!.id;
        seen.push(id);
        for (let k = 0; k < (HOLD + BETWEEN) / STEP + 6; k++) {
          const target = game.snapshot().target!;
          game.update({ now: (t += STEP), evaluation: target.classifier.evaluate(REFERENCE[target.id]!) });
          if (game.snapshot().target!.id !== id && game.snapshot().phase === "TARGET_ACTIVE") break;
        }
      }
      return seen;
    };
    const difficulty = (id: string) => POSE_REGISTRY.find((p) => p.id === id)!.difficulty;
    const early = run(1, 4);
    assert.ok(early.every((id) => difficulty(id) !== "hard"), "wave 1 never requests a hard pose");
    const late = run(6, 4);
    assert.ok(late.some((id) => difficulty(id) === "hard"), "later waves include hard poses");
    for (const seq of [early, late])
      for (let i = 0; i < seq.length; i++)
        for (let k = 1; k <= 3 && i + k < seq.length; k++) assert.notEqual(seq[i], seq[i + k], `repeat within 3 at ${i}`);
  });
});
