/**
 * Attack / impact VFX safety: the VFX layer can't change gameplay, reflects only
 * real hits, cleans itself up, doesn't leak, and the camera impulse never moves
 * the permanent gameplay camera.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { computeZombiePose, createPose, makeZombieVariant } from "../src/arena/characters/zombieAnimation";
import { AttackVfx, bindVfxToCombat } from "../src/arena/vfx/attackVfx";
import { CameraImpulse } from "../src/arena/vfx/cameraImpulse";
import { VFX_CONFIG } from "../src/arena/vfx/vfxConfig";
import { COMBAT_CONFIG } from "../src/combat/combatConfig";
import { CombatSystem, isAlive, type Zombie } from "../src/combat/combatSystem";
import { createMemoryScoreStorage } from "../src/survival/bestScore";
import { SurvivalGame } from "../src/survival/survivalGame";

const DT = 1 / 60;

function seeded(seed = 9): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gameplayFingerprint(g: SurvivalGame): string {
  return JSON.stringify({ snap: g.snapshot(), zombies: g.combat.zombies, attacks: g.combat.attacks.map((a) => ({ ...a, hit: [...a.hit] })) });
}

/** A scripted 40 s session: the "player" blasts whenever a zombie gets close. */
function playSession(withVfx: boolean) {
  const g = new SurvivalGame(createMemoryScoreStorage(), seeded(21));
  g.setRunning(true);
  g.start();
  const vfx = withVfx ? new AttackVfx() : null;
  if (vfx) bindVfxToCombat(g.combat, vfx);
  let last = -999;
  const trace: string[] = [];
  for (let f = 0; f < 60 * 40; f++) {
    const near = g.combat.zombies.some((z) => isAlive(z) && Math.hypot(z.x, z.z) < 3);
    if (near && f - last > 90) {
      if (g.handlePoseConfirmed("SIDE_POINT")) vfx?.charge();
      last = f;
    }
    g.update(DT);
    if (vfx) {
      vfx.syncAttacks(g.combat.attacks);
      vfx.update(DT);
    }
    if (f % 120 === 0) trace.push(gameplayFingerprint(g));
  }
  vfx?.dispose();
  return { final: gameplayFingerprint(g), trace: trace.join("|"), vfx };
}

describe("VFX: gameplay is untouched", () => {
  it("a full session is identical with VFX enabled and disabled (zombies, health, score, waves)", () => {
    const off = playSession(false);
    const on = playSession(true);
    assert.equal(on.trace, off.trace, "every checkpoint identical");
    assert.equal(on.final, off.final);
    const snap = JSON.parse(off.final).snap;
    assert.ok(snap.wave >= 2 && snap.score > 0, "the session actually played waves and scored");
  });

  it("triggering VFX directly changes no gameplay state (zombie state/position, MJ health, score, wave)", () => {
    const g = new SurvivalGame(createMemoryScoreStorage(), seeded(3));
    g.setRunning(true);
    g.start();
    for (let f = 0; f < 200; f++) g.update(DT);
    const before = gameplayFingerprint(g);
    const vfx = new AttackVfx();
    for (let i = 0; i < 20; i++) {
      vfx.charge();
      for (const z of g.combat.zombies) vfx.impact(z.x, z.y, z.z, i % 2 === 0, i);
      vfx.syncAttacks(g.combat.attacks);
      vfx.update(DT);
    }
    vfx.reset();
    vfx.dispose();
    assert.equal(gameplayFingerprint(g), before);
  });

  it("the bridge hands VFX only primitives: frozen zombies survive impacts", () => {
    const vfx = new AttackVfx();
    const frozen = Object.freeze({ x: 2, y: 0.3, z: -1, state: "DEFEATED" }) as Readonly<Zombie>;
    const attack = Object.freeze({ id: 1, poseId: "X", age: 0.1, radius: 2, done: false, hit: new Set([1, 2]) });
    let listener: ((z: Readonly<Zombie>, a: typeof attack) => void) | null = null;
    bindVfxToCombat({ onZombieHit: (cb) => ((listener = cb as never), () => {}) }, vfx);
    listener!(frozen, attack); // would throw in strict mode on any write
    assert.equal(vfx.stats.impacts, 1);
    assert.equal(vfx.stats.defeatImpacts, 1);
    vfx.dispose();
  });
});

describe("VFX: reflects only real hits", () => {
  it("one impact per simulated hit, none for zombies outside the radius; defeats match", () => {
    const c = new CombatSystem(COMBAT_CONFIG, seeded(4));
    const vfx = new AttackVfx();
    bindVfxToCombat(c, vfx);
    let hits = 0;
    let defeats = 0;
    c.onZombieHit(() => hits++);
    c.onZombieDefeated(() => defeats++);
    const mk = (x: number, z: number, h = 0) => {
      const zz = c.spawnZombie({ angle: Math.atan2(x, z), radius: Math.hypot(x, z), speed: 0.001 });
      zz.hits = h;
      return zz;
    };
    mk(2, 0);
    mk(0, -2.5, 1); // will be defeated
    const outside = mk(COMBAT_CONFIG.attack.attackRadius + 1.5, 0);
    c.attack("SIDE_POINT");
    for (let f = 0; f < 60; f++) {
      c.step(DT);
      vfx.syncAttacks(c.attacks);
      vfx.update(DT);
    }
    assert.equal(hits, 2);
    assert.equal(vfx.stats.impacts, hits);
    assert.equal(vfx.stats.defeatImpacts, defeats);
    assert.equal(defeats, 1);
    assert.equal(outside.state, "APPROACHING");
    vfx.dispose();
  });

  it("combo: the shockwave brightens with the number of zombies this attack really hit", () => {
    const vfx = new AttackVfx();
    const base = { id: 1, poseId: "X", age: 0.1, radius: 2, done: false };
    vfx.syncAttacks([{ ...base, hit: new Set<number>() }]);
    const a0 = vfx.debugRingAlpha()[0]!;
    vfx.syncAttacks([{ ...base, hit: new Set([1, 2, 3, 4]) }]);
    const a4 = vfx.debugRingAlpha()[0]!;
    assert.ok(a4 > a0 * 1.3, `${a4} vs ${a0}`);
    vfx.syncAttacks([{ ...base, hit: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]) }]);
    const a9 = vfx.debugRingAlpha()[0]!;
    assert.ok(a9 <= a0 * (1 + VFX_CONFIG.shockwave.comboMax * VFX_CONFIG.shockwave.comboBoost) + 1e-9, "capped");
    vfx.dispose();
  });
});

describe("VFX: camera impulse", () => {
  it("is zero when idle, nonzero during, exactly zero after its duration", () => {
    const imp = new CameraImpulse(0.14, true);
    const o = { x: 9, y: 9, z: 9 };
    imp.offset(o);
    assert.deepEqual(o, { x: 0, y: 0, z: 0 });
    imp.kick(0.08, 120);
    imp.update(0.02);
    imp.offset(o);
    assert.ok(Math.hypot(o.x, o.y, o.z) > 0);
    imp.update(0.2);
    imp.offset(o);
    assert.deepEqual(o, { x: 0, y: 0, z: 0 });
    assert.equal(imp.active, false);
  });

  it("never alters the permanent camera transform (offset is added per frame on a copy)", () => {
    const BASE = new THREE.Vector3(0, 8.2, 11);
    const baseCopy = BASE.clone();
    const cam = new THREE.PerspectiveCamera();
    const imp = new CameraImpulse(0.14, true);
    const off = new THREE.Vector3();
    imp.kick(0.14, 120);
    for (let f = 0; f < 30; f++) {
      imp.update(DT);
      cam.position.copy(BASE).add(imp.offset(off));
    }
    assert.ok(BASE.equals(baseCopy), "base untouched");
    assert.ok(cam.position.equals(BASE), "camera back exactly at the base pose");
  });

  it("is capped (multi-kills stay controlled) and can be disabled", () => {
    const imp = new CameraImpulse(0.14, true);
    for (let i = 0; i < 20; i++) imp.kick(0.1, 120);
    const o = { x: 0, y: 0, z: 0 };
    let max = 0;
    for (let f = 0; f < 10; f++) {
      imp.update(0.005);
      imp.offset(o);
      max = Math.max(max, Math.hypot(o.x, o.y, o.z));
    }
    assert.ok(max <= 0.14 * 1.2, `max offset ${max}`);
    const off = new CameraImpulse(0.14, false);
    off.kick(0.1, 120);
    off.update(0.01);
    assert.deepEqual(off.offset(o), { x: 0, y: 0, z: 0 });
  });
});

describe("VFX: cleanup and leaks", () => {
  it("effects clean themselves up (pools idle after they finish)", () => {
    const vfx = new AttackVfx();
    vfx.charge();
    vfx.impact(2, 0, 1, true, 3);
    vfx.impact(-2, 0, 1, false, 4);
    vfx.update(DT);
    assert.equal(vfx.idle, false);
    vfx.syncAttacks([]);
    for (let f = 0; f < 120; f++) vfx.update(DT);
    assert.equal(vfx.idle, true);
    assert.equal(vfx.stats.particles, 0);
    assert.equal(vfx.stats.streaks, 0);
    assert.equal(vfx.stats.decals, 0);
    vfx.dispose();
  });

  it("hundreds of attacks don't grow the scene graph or exceed pool capacity", () => {
    const vfx = new AttackVfx();
    const scene = new THREE.Scene();
    scene.add(vfx.root);
    const objects = vfx.objectCount;
    for (let i = 0; i < 300; i++) {
      vfx.charge();
      for (let k = 0; k < 6; k++) vfx.impact(Math.cos(k) * 3, 0, Math.sin(k) * 3, k % 2 === 0, k);
      vfx.syncAttacks([{ id: i, poseId: "X", age: 0.1, radius: 2, done: false, hit: new Set([1, 2]) }]);
      vfx.update(DT);
      assert.ok(vfx.stats.particles <= VFX_CONFIG.capacity.particles);
      assert.ok(vfx.stats.streaks <= VFX_CONFIG.capacity.streaks);
    }
    assert.equal(vfx.objectCount, objects, "no new objects created during play");
    vfx.syncAttacks([]);
    for (let f = 0; f < 120; f++) vfx.update(DT);
    assert.equal(vfx.idle, true);
    vfx.dispose();
    assert.equal(scene.children.length, 0, "dispose detaches the VFX root");
  });

  it("reset() (restart) clears every effect immediately", () => {
    const vfx = new AttackVfx();
    vfx.charge();
    vfx.impact(1, 0, 1, true, 1);
    vfx.update(DT);
    vfx.reset();
    vfx.syncAttacks([]);
    vfx.update(DT);
    assert.equal(vfx.idle, true);
    vfx.dispose();
  });
});

describe("knockback presentation", () => {
  it("torso/head snap first, limbs trail (visual only)", () => {
    const v = makeZombieVariant(5);
    const zb = (t: number): Zombie => ({
      id: 1, x: 3, z: 0, y: 0.3, vx: 8, vz: 0, vy: 2, state: "KNOCKBACK", stateTime: t,
      speed: 1, atTarget: false, phase: 0.2, active: true, hits: 1,
    });
    const early = computeZombiePose(zb(0.01), v, 1, createPose());
    const late = { ...computeZombiePose(zb(0.2), v, 1, createPose()) };
    assert.ok(early.headX < late.headX - 0.2, "head whips back hardest right at the hit");
    assert.ok(early.shoulderLOut < late.shoulderLOut, "arms fling out a beat later");
  });
});
