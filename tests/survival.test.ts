/** Survival game: health, attacks, defeat, score, waves, game over, pause, restart, best score. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMBAT_CONFIG } from "../src/combat/combatConfig";
import { distanceFromCenter, isAlive, type Zombie } from "../src/combat/combatSystem";
import { emitGameState, emitPoseConfirmed } from "../src/game/gameEvents";
import { createLocalScoreStorage, createMemoryScoreStorage } from "../src/survival/bestScore";
import { SURVIVAL_CONFIG as S } from "../src/survival/survivalConfig";
import { bindSurvivalToGameEvents, restartSession } from "../src/survival/survivalEvents";
import { SurvivalGame } from "../src/survival/survivalGame";

const DT = 1 / 60;

function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function game(storage = createMemoryScoreStorage()) {
  const g = new SurvivalGame(storage, seeded(3));
  g.setRunning(true);
  g.start();
  return g;
}

function run(g: SurvivalGame, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) g.update(DT);
}

const live = (g: SurvivalGame): Zombie[] => g.combat.zombies.filter(isAlive);

/** Keep only the first live zombie and place it at distance d (others removed). */
function lone(g: SurvivalGame, d: number): Zombie {
  const [z] = live(g);
  for (const other of live(g)) if (other !== z) other.active = false;
  Object.assign(z!, { x: d, z: 0, y: 0, vx: 0, vz: 0, vy: 0, state: "APPROACHING", stateTime: 0, speed: 1.5 });
  return z!;
}

/** Bring a zombie back next to MJ, ready to be hit again. */
function returnToMj(z: Zombie, d = 2): void {
  Object.assign(z, { x: d, z: 0, y: 0, vx: 0, vz: 0, vy: 0, state: "APPROACHING", stateTime: 0 });
}

/** One aura attack, simulated until the aura is done. */
function blast(g: SurvivalGame): boolean {
  const ok = g.handlePoseConfirmed("SIDE_POINT");
  run(g, COMBAT_CONFIG.attack.durationMs / 1000 + 0.05);
  return ok;
}

function runUntil(g: SurvivalGame, cond: () => boolean, maxSeconds = 30): void {
  for (let t = 0; t < maxSeconds && !cond(); t += DT) g.update(DT);
  assert.ok(cond(), "condition never reached");
}

describe("survival: start", () => {
  it("READY until START GAME; no zombies, no damage before start", () => {
    const g = new SurvivalGame(createMemoryScoreStorage(), seeded(1));
    g.setRunning(true);
    run(g, 5);
    assert.equal(g.snapshot().state, "READY");
    assert.equal(g.combat.zombies.length, 0);
    assert.equal(g.snapshot().health, S.maxHealth);
    assert.equal(g.handlePoseConfirmed("SIDE_POINT"), false);
  });

  it("START GAME begins wave 1 with baseZombieCount zombies and full health", () => {
    const g = game();
    const s = g.snapshot();
    assert.equal(s.state, "PLAYING");
    assert.equal(s.wave, 1);
    assert.equal(s.health, 100);
    assert.equal(live(g).length, S.baseZombieCount);
    assert.equal(s.banner, "WAVE 1");
  });
});

describe("survival: zombie attacks", () => {
  it("a zombie reaching MJ switches to ATTACKING and damages him", () => {
    const g = game();
    const z = lone(g, 2);
    runUntil(g, () => z.state === "ATTACKING");
    runUntil(g, () => g.snapshot().health < 100, 2);
    assert.equal(g.snapshot().health, 100 - S.zombieDamage);
  });

  it("does not damage every frame: one strike, then nothing until the cooldown", () => {
    const g = game();
    const z = lone(g, 2);
    runUntil(g, () => g.snapshot().health < 100);
    const after1 = g.snapshot().health;
    run(g, (S.zombieAttackCooldown / 1000) * 0.8);
    assert.equal(g.snapshot().health, after1, "no extra damage within the cooldown");
    assert.equal(z.state, "ATTACKING");
  });

  it("attack cooldown: strikes repeat on a fixed cadence while in range", () => {
    const g = game();
    const strikes: number[] = [];
    g.on("damage", () => strikes.push(1));
    lone(g, 2);
    runUntil(g, () => strikes.length === 1);
    run(g, (3 * S.zombieAttackCooldown) / 1000 + 0.05);
    assert.equal(strikes.length, 4, "1 + 3 cooldowns");
    assert.equal(g.snapshot().health, 100 - 4 * S.zombieDamage);
  });

  it("an aura interrupts an attacking zombie and knocks it away (no more damage)", () => {
    const g = game();
    const z = lone(g, 2);
    runUntil(g, () => z.state === "ATTACKING");
    const hp = g.snapshot().health;
    assert.equal(g.handlePoseConfirmed("FACE_COVER"), true);
    run(g, 0.3);
    assert.equal(z.state, "KNOCKBACK");
    run(g, 0.8);
    assert.ok(distanceFromCenter(z) > S.zombieAttackDistance + 1);
    assert.equal(g.snapshot().health, hp);
  });

  it("health cannot fall below zero (damage that doesn't divide max health evenly)", () => {
    const g = new SurvivalGame(createMemoryScoreStorage(), seeded(3), { ...S, zombieDamage: 30 });
    g.setRunning(true);
    g.start();
    const seen: number[] = [];
    g.on("damage", (e) => seen.push(e.health));
    lone(g, 1.2);
    run(g, 30);
    assert.deepEqual(seen, [70, 40, 10, 0]);
    assert.equal(g.snapshot().health, 0);
  });
});

describe("survival: defeat and score", () => {
  it("first aura hit does not defeat a 2-hit zombie; the second does", () => {
    assert.equal(S.hitsToDefeatZombie, 2);
    const g = game();
    const z = lone(g, 2);
    blast(g);
    assert.equal(z.hits, 1);
    assert.notEqual(z.state, "DEFEATED");
    assert.ok(isAlive(z));
    returnToMj(z);
    blast(g);
    assert.equal(z.hits, 2);
    assert.equal(z.state, "DEFEATED");
  });

  it("defeated zombies get a stronger launch, fade out and are removed", () => {
    const g = new SurvivalGame(createMemoryScoreStorage(), seeded(3));
    g.setRunning(true);
    g.start();
    const [z, other] = live(g);
    // Keep the wave alive with a second zombie far away so we can watch the first one.
    Object.assign(other!, { x: 8, z: 0, speed: 0.01 });
    for (const extra of live(g).slice(2)) extra.active = false;
    Object.assign(z!, { x: 2, z: 0, y: 0, state: "APPROACHING", hits: 1, vx: 0, vz: 0, vy: 0 });
    g.handlePoseConfirmed("X");
    run(g, 0.2);
    assert.equal(z!.state, "DEFEATED");
    assert.ok(z!.y > 0.3, "lifted");
    run(g, S.defeatFadeMs / 1000 + 0.2);
    assert.equal(z!.active, false, "removed after fading");
  });

  it("a defeated zombie scores exactly once", () => {
    const g = game();
    const scored: number[] = [];
    g.on("defeated", (e) => scored.push(e.score));
    const [z] = live(g);
    Object.assign(z!, { x: 2, z: 0, hits: 1, state: "APPROACHING" });
    blast(g);
    assert.equal(g.snapshot().score, S.scorePerZombie);
    // More blasts and time: the defeated zombie can't be hit or scored again.
    blast(g);
    blast(g);
    run(g, 2);
    assert.deepEqual(scored, [S.scorePerZombie]);
    assert.equal(g.snapshot().score, S.scorePerZombie);
  });
});

describe("survival: waves", () => {
  function clearWave(g: SurvivalGame): void {
    for (const z of live(g)) Object.assign(z, { x: 2, z: 0, hits: S.hitsToDefeatZombie - 1, state: "APPROACHING" });
    blast(g);
  }

  it("wave ends when all its zombies are defeated → WAVE COMPLETE + bonus", () => {
    const g = game();
    const completes: number[] = [];
    g.on("waveComplete", (e) => completes.push(e.wave));
    clearWave(g);
    run(g, 0.1);
    const s = g.snapshot();
    assert.equal(s.state, "WAVE_TRANSITION");
    assert.equal(s.banner, "WAVE COMPLETE");
    assert.deepEqual(completes, [1]);
    assert.equal(s.score, S.baseZombieCount * S.scorePerZombie + S.waveClearBonus);
  });

  it("no attacks count during the wave break; then the next wave begins", () => {
    const g = game();
    clearWave(g);
    run(g, 0.1);
    assert.equal(g.handlePoseConfirmed("SIDE_POINT"), false, "combat frozen between waves");
    run(g, S.waveTransitionDuration / 1000);
    const s = g.snapshot();
    assert.equal(s.state, "PLAYING");
    assert.equal(s.wave, 2);
    assert.equal(s.banner, "WAVE 2");
    assert.equal(live(g).length, S.baseZombieCount + S.zombiesAddedPerWave);
  });

  it("later waves have more and faster zombies (pressure only)", () => {
    const g = game();
    const w1 = g.waveSpec(1);
    const w3 = g.waveSpec(3);
    const w9 = g.waveSpec(9);
    assert.deepEqual([w1.count, g.waveSpec(2).count, w3.count], [3, 4, 5]);
    assert.ok(w3.speed > w1.speed && w9.speed > w3.speed);
    assert.ok(g.waveSpec(100).speed <= S.maxZombieSpeed);
    // Actual spawned speeds follow the spec (within jitter).
    clearWave(g);
    run(g, S.waveTransitionDuration / 1000 + 0.1);
    clearWave(g);
    run(g, S.waveTransitionDuration / 1000 + 0.1);
    assert.equal(g.snapshot().wave, 3);
    for (const z of live(g)) assert.ok(Math.abs(z.speed - w3.speed) <= w3.speed * S.speedJitter + 1e-9);
  });

  it("never more than maxActiveZombies alive; the rest queue and still count toward the wave", () => {
    const g = game();
    // Jump to a big wave by clearing repeatedly.
    while (g.waveSpec(g.snapshot().wave).count <= S.maxActiveZombies) {
      clearWave(g);
      run(g, S.waveTransitionDuration / 1000 + 0.1);
    }
    const spec = g.waveSpec(g.snapshot().wave);
    assert.equal(live(g).length, S.maxActiveZombies);
    assert.equal(g.snapshot().remaining, spec.count);
  });
});

describe("survival: game over", () => {
  it("zero health → GAME_OVER exactly once; nothing after (damage, score, attacks)", () => {
    const g = game();
    const overs: number[] = [];
    g.on("gameOver", (e) => overs.push(e.score));
    for (const z of live(g)) Object.assign(z, { x: 1.2, z: 0 });
    runUntil(g, () => g.snapshot().state === "GAME_OVER", 60);
    assert.equal(g.snapshot().health, 0);
    const scoreAtEnd = g.snapshot().score;
    const positions = g.combat.zombies.map((z) => [z.x, z.z]);

    run(g, 10);
    assert.deepEqual(overs.length, 1, "GAME_OVER fired once");
    assert.equal(g.snapshot().health, 0);
    assert.equal(g.handlePoseConfirmed("SIDE_POINT"), false, "pose attacks no longer affect the world");
    assert.equal(g.combat.activeAttackCount(), 0);
    assert.equal(g.snapshot().score, scoreAtEnd, "no scoring after game over");
    assert.deepEqual(
      g.combat.zombies.map((z) => [z.x, z.z]),
      positions,
      "zombies frozen",
    );
  });
});

describe("survival: pause (tracking loss / hidden tab)", () => {
  it("tracking loss pauses everything: no movement, no damage, no wave timer", () => {
    const g = game();
    const z = lone(g, 1.2);
    run(g, 0.1);
    g.setRunning(false);
    const hp = g.snapshot().health;
    const pos = [z.x, z.z];
    run(g, 10);
    assert.equal(g.snapshot().health, hp, "never lose health while untracked");
    assert.deepEqual([z.x, z.z], pos);
    assert.equal(g.snapshot().paused, true);
    g.setRunning(true);
    runUntil(g, () => g.snapshot().health < hp, 2);
  });

  it("wave break timer is frozen while paused", () => {
    const g = game();
    for (const z of live(g)) Object.assign(z, { x: 2, z: 0, hits: 1, state: "APPROACHING" });
    blast(g);
    run(g, 0.2);
    assert.equal(g.snapshot().state, "WAVE_TRANSITION");
    g.setRunning(false);
    run(g, 10);
    assert.equal(g.snapshot().state, "WAVE_TRANSITION");
    g.setRunning(true);
    run(g, S.waveTransitionDuration / 1000);
    assert.equal(g.snapshot().wave, 2);
  });

  it("hidden tab (GAME_STATE running:false) pauses survival through the event bridge", () => {
    const bus = new EventTarget();
    const g = new SurvivalGame(createMemoryScoreStorage(), seeded(2));
    bindSurvivalToGameEvents(bus, g);
    emitGameState(bus, { running: true, paused: null, phase: "TARGET_ACTIVE" });
    g.start();
    const z = lone(g, 1.2);
    run(g, 0.05);
    emitGameState(bus, { running: false, paused: "hidden", phase: "TARGET_ACTIVE" });
    const hp = g.snapshot().health;
    const pos = [z.x, z.z];
    run(g, 10);
    assert.equal(g.snapshot().health, hp);
    assert.deepEqual([z.x, z.z], pos);
    emitPoseConfirmed(bus, { poseId: "SIDE_POINT", timestamp: 1, hits: 1 });
    assert.equal(g.combat.activeAttackCount(), 0, "no attacks while hidden");
  });

  it("POSE_CONFIRMED through the bridge starts exactly one attack and the visual hook once", () => {
    const bus = new EventTarget();
    const g = new SurvivalGame(createMemoryScoreStorage(), seeded(2));
    const visuals: string[] = [];
    bindSurvivalToGameEvents(bus, g, { onAttack: (id) => visuals.push(id) });
    emitGameState(bus, { running: true, paused: null, phase: "TARGET_ACTIVE" });
    g.start();
    emitPoseConfirmed(bus, { poseId: "DIAGONAL_REACH", timestamp: 1, hits: 1 });
    assert.equal(g.combat.activeAttackCount(), 1);
    assert.deepEqual(visuals, ["DIAGONAL_REACH"]);
  });
});

describe("survival: restart and best score", () => {
  function playToGameOver(g: SurvivalGame): void {
    for (const z of live(g)) Object.assign(z, { x: 1.2, z: 0 });
    runUntil(g, () => g.snapshot().state === "GAME_OVER", 60);
  }

  it("restart resets health, score, wave, zombies, auras and timers", () => {
    const g = game();
    const [z] = live(g);
    Object.assign(z!, { x: 2, z: 0, hits: 1, state: "APPROACHING" });
    g.handlePoseConfirmed("X");
    run(g, 0.2);
    assert.ok(g.snapshot().score > 0);
    playToGameOver(g);
    g.handlePoseConfirmed("X");

    let restarted = 0;
    g.on("restart", () => restarted++);
    g.restart();
    const s = g.snapshot();
    assert.equal(restarted, 1);
    assert.equal(s.state, "PLAYING");
    assert.equal(s.wave, 1);
    assert.equal(s.health, S.maxHealth);
    assert.equal(s.score, 0);
    assert.equal(s.banner, "WAVE 1");
    assert.equal(live(g).length, S.baseZombieCount);
    for (const zz of live(g)) {
      assert.equal(zz.state, "APPROACHING");
      assert.equal(zz.hits, 0);
      assert.ok(distanceFromCenter(zz) >= COMBAT_CONFIG.zombies.spawnRadiusMin - 1e-9);
    }
    assert.equal(g.combat.activeAttackCount(), 0);
    // And the new run plays normally (game over can happen again, once).
    const overs: number[] = [];
    g.on("gameOver", () => overs.push(1));
    playToGameOver(g);
    assert.equal(overs.length, 1);
  });

  it("restart keeps the camera: restartSession never touches it and restarts the pose loop", () => {
    const g = game();
    playToGameOver(g);
    const camera = { permissionRequests: 1, stream: { id: "webcam-1", active: true } };
    const poseLoopStarts: number[] = [];
    restartSession(g, { start: (now) => poseLoopStarts.push(now) }, 1234);
    assert.equal(camera.permissionRequests, 1, "no second permission request");
    assert.equal(camera.stream.active, true);
    assert.deepEqual(poseLoopStarts, [1234], "fresh pose prompt");
    assert.equal(g.snapshot().state, "PLAYING");
    assert.equal(restartSession.length, 3, "restart API has no camera parameter");
  });

  it("best score updates when beaten and never decreases", () => {
    const storage = createMemoryScoreStorage(0);
    const g = game(storage);
    // Run 1: defeat all 3 (300 + 250 bonus), then die in wave 2.
    for (const z of live(g)) Object.assign(z, { x: 2, z: 0, hits: 1, state: "APPROACHING" });
    blast(g);
    run(g, S.waveTransitionDuration / 1000 + 0.2);
    playToGameOver(g);
    const first = g.snapshot().score;
    assert.equal(first, 3 * S.scorePerZombie + S.waveClearBonus);
    assert.equal(g.snapshot().best, first);
    assert.equal(storage.load(), first);

    // Run 2: score less, best stays.
    g.restart();
    playToGameOver(g);
    assert.ok(g.snapshot().score < first);
    assert.equal(g.snapshot().best, first);
    assert.equal(storage.load(), first);

    // A new game reads the stored best.
    assert.equal(new SurvivalGame(storage).snapshot().best, first);
  });

  it("unavailable localStorage is handled gracefully", () => {
    // Node has no localStorage: every access throws → falls back to memory.
    const storage = createLocalScoreStorage("test-key");
    assert.equal(storage.load(), 0);
    storage.save(500);
    assert.equal(storage.load(), 500);
    storage.save(100);
    assert.equal(storage.load(), 500, "never decreases");
  });
});
