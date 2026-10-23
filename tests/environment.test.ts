/** Graveyard environment: decorative only, keeps the arena clear, no leaks. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { Graveyard } from "../src/arena/environment/graveyard";
import { GRAVEYARD_CONFIG as G } from "../src/arena/environment/graveyardConfig";
import { groundHeight } from "../src/arena/environment/ground";
import { fogPatches } from "../src/arena/environment/groundFog";
import { rng } from "../src/arena/environment/props";
import { createMemoryScoreStorage } from "../src/survival/bestScore";
import { SurvivalGame } from "../src/survival/survivalGame";

function session(withEnv: boolean): string {
  let s = 7;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const g = new SurvivalGame(createMemoryScoreStorage(), r);
  g.setRunning(true);
  g.start();
  const env = withEnv ? new Graveyard() : null;
  for (let f = 0; f < 60 * 30; f++) {
    if (f % 150 === 0) g.handlePoseConfirmed("SIDE_POINT");
    g.update(1 / 60);
    env?.update(1 / 60);
  }
  env?.dispose();
  return JSON.stringify({ snap: g.snapshot(), zombies: g.combat.zombies });
}

describe("graveyard environment", () => {
  it("gameplay is identical with and without the environment", () => {
    assert.equal(session(true), session(false));
  });
  it("blocking scenery stays outside the playable circle", () => {
    const env = new Graveyard();
    const limit = G.arenaRadius + G.clearMargin;
    for (const p of env.placements.filter((q) => q.blocking))
      assert.ok(Math.hypot(p.x, p.z) >= limit, `${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    env.dispose();
  });
  it("ground is visually flat inside the arena (< 2 cm)", () => {
    for (let i = 0; i < 400; i++) {
      const a = i * 2.4;
      const r = (i / 400) * G.arenaRadius;
      assert.ok(Math.abs(groundHeight(Math.sin(a) * r, Math.cos(a) * r)) < 0.02);
    }
  });
  it("updates never allocate scene objects; dispose detaches and is idempotent", () => {
    const env = new Graveyard();
    const n = env.objectCount;
    for (let f = 0; f < 600; f++) env.update(1 / 60);
    assert.equal(env.objectCount, n);
    assert.ok(env.stats.drawCalls < 40, `draw calls ${env.stats.drawCalls}`);
    env.dispose();
    env.dispose();
    assert.equal(env.root.children.length, 0);
  });
  it("is deterministic for a seed", () => {
    const a = new Graveyard(5);
    const b = new Graveyard(5);
    assert.deepEqual(a.placements, b.placements);
    a.dispose();
    b.dispose();
  });
  it("ground mist stays faint over the combat area and dense outside it", () => {
    const F = G.groundFog;
    const patches = fogPatches(rng(G.seed));
    // Anything centred well inside the circle is a thin wisp once the shader's clearing is applied.
    for (const p of patches.filter((q) => Math.hypot(q.x, q.z) < G.arenaRadius - 2.5))
      assert.ok(p.alpha * F.insideStrength <= 0.15, `wisp at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    assert.ok(patches.filter((q) => Math.hypot(q.x, q.z) > G.arenaRadius && q.alpha >= 0.5).length >= 12, "visible banks outside");
    // Ground-hugging: never tall enough to hide a zombie's body.
    for (const p of patches) assert.ok(p.y < 0.8);
  });
  it("dispose also frees the baked ground-detail texture", () => {
    const env = new Graveyard();
    const ground = env.root.getObjectByName("ground") as THREE.Mesh;
    const tex = (ground.material as THREE.Material).userData.detail as THREE.Texture;
    let freed = false;
    tex.addEventListener("dispose", () => (freed = true));
    env.dispose();
    assert.ok(freed);
  });
});
