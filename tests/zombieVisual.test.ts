/**
 * Zombie visuals: state → animation mapping, deterministic variants, strike sync,
 * no mutation of gameplay data, gameplay identical with visuals attached,
 * shared resources, disposal, defeat lifecycle. No rendering.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  animFor,
  computeZombiePose,
  createPose,
  makeZombieVariant,
  OUTFITS,
  ZOMBIE_ANIM,
  type ZombieAnim,
} from "../src/arena/characters/zombieAnimation";
import {
  liveZombieCharacters,
  ZombieCharacter,
  zombieResourcesAllocated,
} from "../src/arena/characters/zombieCharacter";
import { visualSeed, ZombieCrowd } from "../src/arena/characters/zombieCrowd";
import { COMBAT_CONFIG } from "../src/combat/combatConfig";
import { CombatSystem, type Zombie } from "../src/combat/combatSystem";

const DT = 1 / 60;

function zombie(over: Partial<Zombie> = {}): Zombie {
  return {
    id: 1,
    x: 0,
    z: 3,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    state: "APPROACHING",
    stateTime: 0,
    speed: 1,
    atTarget: false,
    phase: 0.3,
    active: true,
    hits: 0,
    attackTimer: 0,
    strikeAge: 10,
    ...over,
  };
}

function seeded(seed = 5): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("zombie visuals: state → animation", () => {
  const cases: [Partial<Zombie>, ZombieAnim][] = [
    [{ state: "APPROACHING" }, "walk"],
    [{ state: "APPROACHING", atTarget: true }, "idle"],
    [{ state: "ATTACKING", attackTimer: 0.9, strikeAge: 2 }, "ready"],
    [{ state: "ATTACKING", attackTimer: ZOMBIE_ANIM.windup - 0.01, strikeAge: 2 }, "windup"],
    [{ state: "ATTACKING", attackTimer: 1, strikeAge: 0 }, "strike"],
    [{ state: "ATTACKING", attackTimer: 0.8, strikeAge: ZOMBIE_ANIM.strike + 0.05 }, "recover"],
    [{ state: "KNOCKBACK", vx: 5 }, "knockback"],
    [{ state: "RECOVERING", stateTime: 0.1 }, "dazed"],
    [{ state: "RECOVERING", stateTime: COMBAT_CONFIG.recovery.dazedMs / 1000 + 0.1 }, "rise"],
    [{ state: "DEFEATED", stateTime: 0.1 }, "defeated"],
    [{ state: "DEFEATED", stateTime: ZOMBIE_ANIM.dissolveStart + 0.01 }, "dissolve"],
    [{ state: "DEFEATED", active: false }, "hidden"],
  ];
  for (const [over, anim] of cases) {
    it(`${over.state}${over.active === false ? " (inactive)" : ""} → ${anim}`, () => {
      assert.equal(animFor(zombie(over)), anim);
    });
  }

  it("the visible strike starts on the exact frame the simulation strikes (damage timing untouched)", () => {
    const c = new CombatSystem(COMBAT_CONFIG, seeded());
    c.zombies.push(zombie({ x: 2, z: 0 }));
    const z = c.zombies[0]!;
    const v = makeZombieVariant(1);
    const pose = createPose();
    const strikeFrames: number[] = [];
    const animAtStrike: ZombieAnim[] = [];
    let sawWindupBeforeStrike = 0;
    let prev: ZombieAnim = "walk";
    let frame = 0;
    c.onZombieStrike(() => strikeFrames.push(frame));
    for (; frame < 60 * 5; frame++) {
      const before = strikeFrames.length;
      c.step(DT);
      computeZombiePose(z, v, frame * DT, pose);
      if (strikeFrames.length > before) {
        animAtStrike.push(pose.anim);
        if (prev === "windup") sawWindupBeforeStrike++;
      }
      prev = pose.anim;
    }
    assert.ok(strikeFrames.length >= 3, "several strikes happened");
    assert.deepEqual(new Set(animAtStrike), new Set(["strike"]), "strike pose on every damage frame");
    assert.equal(sawWindupBeforeStrike, strikeFrames.length, "every strike is preceded by a visible wind-up");
  });
});

describe("zombie visuals: variants", () => {
  it("are deterministic for a seed", () => {
    assert.deepEqual(makeZombieVariant(1234), makeZombieVariant(1234));
    assert.equal(visualSeed(7, 99), visualSeed(7, 99));
  });

  it("vary across seeds (outfits, skin, hair, proportions)", () => {
    const vs = Array.from({ length: 60 }, (_, i) => makeZombieVariant(visualSeed(i, 42)));
    assert.equal(new Set(vs.map((v) => v.outfit)).size, OUTFITS.length);
    assert.ok(new Set(vs.map((v) => v.skin)).size >= 3);
    assert.ok(new Set(vs.map((v) => v.hair)).size >= 3);
    assert.ok(new Set(vs.map((v) => v.id)).size > 20);
    for (const v of vs) {
      assert.ok(v.scale >= 0.93 && v.scale <= 1.07);
      assert.ok(Math.abs(v.headTilt) >= 0.12 && Math.abs(v.headTilt) <= 0.32, "asymmetric head tilt");
    }
  });
});

describe("zombie visuals: never touch gameplay", () => {
  it("computeZombiePose / ZombieCharacter.sync work on a frozen zombie (no writes)", () => {
    const states: Partial<Zombie>[] = [
      { state: "APPROACHING" },
      { state: "ATTACKING", attackTimer: 0.1, strikeAge: 2 },
      { state: "KNOCKBACK", vx: 6, vz: -3, y: 0.4 },
      { state: "RECOVERING", stateTime: 1 },
      { state: "DEFEATED", stateTime: 0.7, y: 0.2 },
    ];
    const ch = new ZombieCharacter();
    ch.setVariant(makeZombieVariant(3));
    for (const s of states) {
      const z = Object.freeze(zombie(s));
      const before = JSON.stringify(z);
      computeZombiePose(z, makeZombieVariant(3), 1.23, createPose()); // throws in strict mode if it writes
      ch.sync(z, 1.23);
      assert.equal(JSON.stringify(z), before);
    }
    ch.dispose();
  });

  it("the root follows the simulation exactly (no root motion), facing MJ", () => {
    const ch = new ZombieCharacter();
    ch.setVariant(makeZombieVariant(9));
    for (const [x, zz] of [
      [3, 0],
      [-2, 4],
      [0.5, -6],
    ] as const) {
      ch.sync(zombie({ x, z: zz }), 2.5);
      assert.deepEqual(ch.root.position.toArray(), [x, 0, zz]);
      // +Z of the character points at the origin.
      const fwd = new THREE.Vector3(0, 0, 1).applyEuler(ch.root.rotation);
      const toMj = new THREE.Vector3(-x, 0, -zz).normalize();
      assert.ok(fwd.dot(toMj) > 0.999);
    }
    ch.dispose();
  });

  it("gameplay is identical with or without the visual crowd attached", () => {
    const run = (withVisuals: boolean) => {
      const c = new CombatSystem(COMBAT_CONFIG, seeded(11));
      c.spawnInitial(5);
      const crowd = withVisuals ? new ZombieCrowd(123) : null;
      const strikes: number[] = [];
      c.onZombieStrike((z) => strikes.push(z.id));
      for (let f = 0; f < 60 * 20; f++) {
        if (f === 60 * 6 || f === 60 * 9 || f === 60 * 13) c.attack("SIDE_POINT");
        c.step(DT);
        crowd?.sync(c.zombies, f * DT, DT);
      }
      crowd?.dispose();
      return { zombies: JSON.stringify(c.zombies), strikes: strikes.join(",") };
    };
    const a = run(false);
    const b = run(true);
    assert.equal(b.zombies, a.zombies);
    assert.equal(b.strikes, a.strikes);
  });
});

describe("zombie visuals: resources and lifecycle", () => {
  it("characters share geometries and materials (no per-zombie GPU resources)", () => {
    const a = new ZombieCharacter();
    const b = new ZombieCharacter();
    a.setVariant(makeZombieVariant(1));
    b.setVariant(makeZombieVariant(2));
    const geos = (c: ZombieCharacter) => {
      const s = new Set<THREE.BufferGeometry>();
      c.root.traverse((o) => {
        if (o instanceof THREE.Mesh) s.add(o.geometry);
      });
      return s;
    };
    const ga = geos(a);
    const gb = geos(b);
    assert.equal(ga.size, gb.size);
    for (const g of ga) assert.ok(gb.has(g), "same geometry objects");
    a.dispose();
    b.dispose();
  });

  it("crowd disposal removes figures and frees shared resources; a new crowd works after", () => {
    const c = new CombatSystem(COMBAT_CONFIG, seeded(2));
    c.spawnInitial(4);
    const scene = new THREE.Scene();
    const crowd = new ZombieCrowd(1);
    scene.add(crowd.root);
    crowd.sync(c.zombies, 0, DT);
    assert.equal(crowd.figureCount, 4);
    assert.ok(liveZombieCharacters() >= 4);
    crowd.dispose();
    assert.equal(crowd.figureCount, 0);
    assert.equal(liveZombieCharacters(), 0);
    assert.equal(zombieResourcesAllocated(), false);
    assert.equal(scene.children.length, 0);
    const again = new ZombieCrowd(1);
    again.sync(c.zombies, 0, DT);
    assert.equal(again.figureCount, 4);
    again.dispose();
  });

  it("defeat lifecycle: defeated → dissolve (shrinks away, one dust burst) → hidden when removed", () => {
    const c = new CombatSystem(COMBAT_CONFIG, seeded(4));
    c.zombies.push(zombie({ x: 2, z: 0, hits: 1 }));
    const z = c.zombies[0]!;
    const crowd = new ZombieCrowd(7);
    c.attack("FACE_COVER");
    const seen: ZombieAnim[] = [];
    let minScaleWhileActive = Infinity;
    for (let f = 0; f < 60 * 3; f++) {
      c.step(DT);
      crowd.sync(c.zombies, f * DT, DT);
      const anim = animFor(z);
      if (seen[seen.length - 1] !== anim) seen.push(anim);
      if (z.active !== false && z.state === "DEFEATED") {
        const p = computeZombiePose(z, makeZombieVariant(1), f * DT, createPose());
        minScaleWhileActive = Math.min(minScaleWhileActive, p.scale);
      }
    }
    assert.deepEqual(seen.slice(-3), ["defeated", "dissolve", "hidden"]);
    assert.ok(minScaleWhileActive < 0.05, "fully shrunk before the simulation removes it");
    assert.equal(crowd.dustBursts, 1, "exactly one dust burst");
    crowd.dispose();
  });

  it("a respawned zombie in a reused slot gets its own look", () => {
    const c = new CombatSystem(COMBAT_CONFIG, seeded(6));
    const crowd = new ZombieCrowd(99);
    const first = c.spawnZombie({ angle: 0, radius: 6, speed: 1 });
    crowd.sync(c.zombies, 0, DT);
    const look1 = crowd.debugRows(c.zombies)[0]!.variant;
    first.active = false;
    crowd.sync(c.zombies, 0, DT);
    const second = c.spawnZombie({ angle: 1, radius: 6, speed: 1 });
    assert.equal(c.zombies.indexOf(second), 0, "slot reused");
    crowd.sync(c.zombies, 0, DT);
    const row = crowd.debugRows(c.zombies)[0]!;
    assert.equal(row.id, second.id);
    assert.equal(row.variant, makeZombieVariant(visualSeed(second.id, 99)).id);
    void look1;
    crowd.dispose();
  });
});
