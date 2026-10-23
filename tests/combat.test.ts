/** Pure combat logic (no Three.js). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMBAT_CONFIG } from "../src/combat/combatConfig";
import { bindCombatToGameEvents } from "../src/combat/combatEvents";
import {
  CombatSystem,
  distanceFromCenter,
  isInAttackRadius,
  knockbackSpeed,
  radialDirection,
  type Zombie,
} from "../src/combat/combatSystem";
import { emitGameState, emitPoseConfirmed } from "../src/game/gameEvents";

const R = COMBAT_CONFIG.attack.attackRadius;
const DT = 1 / 60;

function system(): CombatSystem {
  return new CombatSystem(COMBAT_CONFIG, () => 0.5);
}

/** Put a single zombie at (x, z). */
function place(c: CombatSystem, ...positions: [number, number][]): Zombie[] {
  c.zombies.length = 0;
  positions.forEach(([x, z], id) =>
    c.zombies.push({
      id,
      x,
      z,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      state: "APPROACHING",
      stateTime: 0,
      speed: 1,
      atTarget: false,
      phase: 0,
    }),
  );
  return c.zombies;
}

function run(c: CombatSystem, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) c.step(DT);
}

describe("radial direction / radius", () => {
  it("points from MJ (origin) toward the zombie, unit length", () => {
    for (const [x, z] of [
      [3, 0],
      [0, -2],
      [-1.5, 2],
      [4, 4],
    ] as const) {
      const d = radialDirection(x, z);
      assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9);
      assert.ok(d.x * x + d.z * z > 0, "same direction as the zombie position");
      assert.ok(Math.abs(d.x * z - d.z * x) < 1e-9, "collinear with the zombie position");
    }
  });
  it("has a safe default at the exact center", () => {
    const d = radialDirection(0, 0);
    assert.equal(Math.hypot(d.x, d.z), 1);
  });
  it("inside/outside attack radius", () => {
    assert.equal(isInAttackRadius(R - 0.01, R), true);
    assert.equal(isInAttackRadius(R, R), true);
    assert.equal(isInAttackRadius(R + 0.01, R), false);
  });
  it("closer zombies are knocked harder", () => {
    assert.ok(knockbackSpeed(0.5) > knockbackSpeed(R - 0.5));
  });
});

describe("attacks and knockback", () => {
  it("zombies inside the radius are knocked AWAY from MJ; outside are untouched", () => {
    const c = system();
    const [a, b, far] = place(c, [2, 0], [-1.5, -1.5], [R + 1.5, 0]);
    const before = [a!, b!, far!].map((z) => distanceFromCenter(z));
    c.attack("SIDE_POINT");
    run(c, 0.4);
    assert.equal(a!.state, "KNOCKBACK");
    assert.equal(b!.state, "KNOCKBACK");
    assert.ok(distanceFromCenter(a!) > before[0]!, "pushed outward");
    assert.ok(distanceFromCenter(b!) > before[1]!, "pushed outward");
    // velocity points away from center
    assert.ok(a!.vx > 0 && Math.abs(a!.vz) < 1e-9);
    assert.ok(b!.vx < 0 && b!.vz < 0);
    assert.equal(far!.state, "APPROACHING", "outside radius: not affected");
    assert.ok(distanceFromCenter(far!) < before[2]!, "still walking in");
  });

  it("knockback lifts the zombie off the ground, then it lands", () => {
    const c = system();
    const [z] = place(c, [1.5, 0]);
    c.attack("FACE_COVER");
    run(c, 0.2);
    assert.ok(z!.y > 0, "in the air");
    run(c, 3);
    assert.equal(z!.y, 0);
  });

  it("each attack hits each zombie at most once (no multi-hit from one aura)", () => {
    const c = system();
    const hits: number[] = [];
    c.onZombieHit((z) => hits.push(z.id));
    place(c, [1, 0], [0, 2]);
    c.attack("X");
    run(c, 1);
    assert.deepEqual(hits.sort(), [0, 1]);
  });

  it("the aura expands to the attack radius, then finishes", () => {
    const c = system();
    place(c);
    const a = c.attack("X");
    run(c, COMBAT_CONFIG.attack.expandMs / 1000 + 0.02);
    assert.ok(Math.abs(a.radius - R) < 1e-6);
    run(c, 1);
    assert.equal(a.done, true);
    assert.equal(c.activeAttackCount(), 0);
  });

  it("finished attack objects are reused", () => {
    const c = system();
    place(c);
    c.attack("A");
    run(c, 1);
    c.attack("B");
    assert.equal(c.attacks.length, 1);
  });

  it("knockback never throws a zombie outside the arena", () => {
    const c = system();
    const [z] = place(c, [0.3, 0]);
    c.attack("X");
    run(c, 3);
    assert.ok(distanceFromCenter(z!) <= COMBAT_CONFIG.arenaRadius + 1e-9);
  });
});

describe("zombie state machine", () => {
  it("APPROACHING → KNOCKBACK → RECOVERING → APPROACHING, then walks back toward MJ", () => {
    const c = system();
    const [z] = place(c, [2, 0]);
    const seen: string[] = [z!.state];
    const track = () => {
      if (seen[seen.length - 1] !== z!.state) seen.push(z!.state);
    };
    c.attack("X");
    for (let t = 0; t < 6 && seen.length < 4; t += DT) {
      c.step(DT);
      track();
    }
    assert.deepEqual(seen, ["APPROACHING", "KNOCKBACK", "RECOVERING", "APPROACHING"]);
    const d1 = distanceFromCenter(z!);
    assert.ok(d1 > R, "was thrown out past the attack radius");
    run(c, 0.5);
    assert.ok(distanceFromCenter(z!) < d1, "approaching MJ again");
  });

  it("RECOVERING zombies are dazed (stand still) before walking again", () => {
    const c = system();
    const [z] = place(c, [2, 0]);
    c.attack("X");
    while (z!.state !== "RECOVERING") c.step(DT);
    const d = distanceFromCenter(z!);
    run(c, (COMBAT_CONFIG.recovery.dazedMs / 1000) * 0.8);
    assert.ok(Math.abs(distanceFromCenter(z!) - d) < 1e-9, "no movement while dazed");
  });

  it("zombies stop at MJ (stopDistance) instead of walking through him", () => {
    const c = system();
    const [z] = place(c, [4, 0]);
    run(c, 10);
    assert.ok(Math.abs(distanceFromCenter(z!) - COMBAT_CONFIG.zombies.stopDistance) < 1e-6);
    assert.equal(z!.atTarget, true);
  });

  it("spawns the configured number of zombies on the outer ring, all outside the attack radius", () => {
    const c = new CombatSystem();
    c.spawnInitial();
    assert.equal(c.zombies.length, COMBAT_CONFIG.zombies.count);
    for (const z of c.zombies) {
      const d = distanceFromCenter(z);
      assert.ok(d >= COMBAT_CONFIG.zombies.spawnRadiusMin - 1e-9 && d <= COMBAT_CONFIG.zombies.spawnRadiusMax + 1e-9);
      assert.ok(d > R);
      assert.equal(z.state, "APPROACHING");
    }
  });

  it("clamps huge frame times (no teleporting)", () => {
    const c = system();
    const [z] = place(c, [8, 0]);
    c.step(5); // a 5 s stall
    assert.ok(8 - distanceFromCenter(z!) <= z!.speed * COMBAT_CONFIG.maxDt + 1e-9);
  });
});

describe("gameplay event → combat bridge", () => {
  it("exactly one attack per POSE_CONFIRMED", () => {
    const bus = new EventTarget();
    const c = system();
    place(c);
    const reactions: string[] = [];
    bindCombatToGameEvents(bus, c, { onAttack: (id) => reactions.push(id) });
    emitPoseConfirmed(bus, { poseId: "SIDE_POINT", timestamp: 1, hits: 1 });
    assert.equal(c.activeAttackCount(), 1);
    assert.deepEqual(reactions, ["SIDE_POINT"]);
    emitPoseConfirmed(bus, { poseId: "FACE_COVER", timestamp: 2, hits: 2 });
    assert.equal(c.activeAttackCount(), 2);
    assert.deepEqual(reactions, ["SIDE_POINT", "FACE_COVER"]);
  });

  it("nothing else (e.g. GAME_STATE) creates attacks; running changes are forwarded", () => {
    const bus = new EventTarget();
    const c = system();
    place(c);
    const running: boolean[] = [];
    bindCombatToGameEvents(bus, c, { onRunningChange: (r) => running.push(r) });
    emitGameState(bus, { running: true, paused: null, phase: "TARGET_ACTIVE" });
    emitGameState(bus, { running: false, paused: "tracking", phase: "TARGET_ACTIVE" });
    assert.equal(c.activeAttackCount(), 0);
    assert.deepEqual(running, [true, false]);
  });

  it("unbinding stops attacks", () => {
    const bus = new EventTarget();
    const c = system();
    const off = bindCombatToGameEvents(bus, c);
    off();
    emitPoseConfirmed(bus, { poseId: "SIDE_POINT", timestamp: 1, hits: 1 });
    assert.equal(c.activeAttackCount(), 0);
  });
});
