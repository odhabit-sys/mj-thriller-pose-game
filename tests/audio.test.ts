/** Game audio: event → sound mapping, caps, game over, restart, pause, missing files. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SoundId } from "../src/audio/audioConfig";
import { AUDIO_CONFIG } from "../src/audio/audioConfig";
import { loadAudioSettings, saveAudioSettings } from "../src/audio/audioSettings";
import type { AudioSink, PlayOptions } from "../src/audio/audioSink";
import { GameAudio } from "../src/audio/gameAudio";
import { emitGameState, emitPoseConfirmed } from "../src/game/gameEvents";
import { createMemoryScoreStorage } from "../src/survival/bestScore";
import { bindSurvivalToGameEvents } from "../src/survival/survivalEvents";
import { SurvivalGame } from "../src/survival/survivalGame";

const DUR: Record<SoundId, number> = { heeHee: 1, aura: 1.5, playerHit: 0.35, groan: 3.2, gameOver: 1 };

class FakeSink implements AudioSink {
  plays: { id: SoundId; opts: PlayOptions; handle: number; at: number }[] = [];
  now: () => number = () => 0;
  stops: number[] = [];
  musicStarts = 0;
  musicStops = 0;
  ducks = 0;
  suspended = false;
  musicPlaying = false;
  private next = 1;
  constructor(private readonly available: Partial<Record<SoundId, number>> = { heeHee: 1, aura: 1, playerHit: 3, groan: 8 }) {}
  play(id: SoundId, opts: PlayOptions = {}): number {
    if (!this.available[id] || this.suspended) return -1;
    const handle = this.next++;
    this.plays.push({ id, opts, handle, at: this.now() });
    return handle;
  }
  stop(handle: number): void {
    this.stops.push(handle);
  }
  variations(id: SoundId): number {
    return this.available[id] ?? 0;
  }
  duration(id: SoundId): number {
    return DUR[id];
  }
  startMusic(): void {
    this.musicStarts++;
    this.musicPlaying = true;
  }
  stopMusic(): void {
    this.musicStops++;
    this.musicPlaying = false;
  }
  duck(): void {
    this.ducks++;
  }
  setSuspended(s: boolean): void {
    this.suspended = s;
  }
  count(id: SoundId): number {
    return this.plays.filter((p) => p.id === id).length;
  }
}

function setup(sink = new FakeSink()) {
  let seed = 11;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const target = new EventTarget();
  const clock = { t: 0 };
  const g = new SurvivalGame(createMemoryScoreStorage(), random);
  // Audio is created BEFORE the survival binding here: listener order must not matter.
  sink.now = () => clock.t;
  const audio = new GameAudio(sink, g, target, () => clock.t, random);
  bindSurvivalToGameEvents(target, g);
  const pose = async (id = "SIDE_POINT") => {
    emitPoseConfirmed(target, { poseId: id, timestamp: clock.t, hits: 1 } as never);
    await Promise.resolve();
  };
  const step = (sec: number, fps = 60) => {
    for (let i = 0; i < sec * fps; i++) {
      g.update(1 / fps);
      clock.t += 1000 / fps;
      if (i % Math.round((AUDIO_CONFIG.groans.tickMs / 1000) * fps) === 0) audio.tick();
    }
  };
  return { sink, g, audio, target, clock, pose, step };
}

describe("game audio", () => {
  it("one confirmed pose that attacks → exactly one hee-hee, one aura, one duck", async () => {
    const { sink, g, pose } = setup();
    g.setRunning(true);
    g.start();
    await pose();
    assert.equal(sink.count("heeHee"), 1);
    assert.equal(sink.count("aura"), 1);
    assert.equal(sink.ducks, 1);
  });

  it("no attack → no attack sounds (not started, or paused by tracking loss)", async () => {
    const { sink, g, pose } = setup();
    await pose(); // READY: the survival game ignores it
    g.setRunning(false);
    g.start();
    await pose(); // paused: ignored
    assert.equal(sink.count("heeHee") + sink.count("aura"), 0);
  });

  it("player-hit sounds follow real damage events only, and are capped", () => {
    const { sink, g, step } = setup();
    let damage = 0;
    g.on("damage", () => damage++);
    g.setRunning(true);
    g.start();
    step(3); // zombies still walking in: no damage yet
    assert.equal(damage, 0);
    assert.equal(sink.count("playerHit"), 0);
    for (let i = 0; i < 6; i++) g.combat.spawnZombie({ angle: i, radius: 1.4, speed: 1 }); // a crowd strikes together
    step(6);
    assert.ok(damage > 0);
    assert.ok(sink.count("playerHit") > 0 && sink.count("playerHit") <= damage);
    // Simultaneous strikes are merged: never closer than the minimum gap, never above the voice cap.
    const hits = sink.plays.filter((p) => p.id === "playerHit");
    assert.ok(hits.length < damage, "simultaneous strikes are merged");
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i]!.at - hits[i - 1]!.at >= AUDIO_CONFIG.limits.playerHitMinGapMs);
    for (const h of hits) {
      const overlapping = hits.filter((o) => o.at <= h.at && o.at + DUR.playerHit * 1000 > h.at).length;
      assert.ok(overlapping <= AUDIO_CONFIG.limits.playerHitVoices);
    }
  });

  it("crowded waves keep groans under the voice cap and stop them when zombies are removed", () => {
    const { sink, g, audio, step } = setup();
    g.setRunning(true);
    g.start();
    g.combat.clear(); // only the slow crowd below (nobody reaches MJ, so the run stays alive)
    for (let i = 0; i < 20; i++) g.combat.spawnZombie({ angle: i * 0.31, radius: 8.4, speed: 0.05 });
    let maxGroans = 0;
    for (let s = 0; s < 40; s++) {
      step(0.5);
      maxGroans = Math.max(maxGroans, audio.count("groan"));
    }
    assert.ok(sink.count("groan") >= 3, "groans happen");
    assert.ok(maxGroans <= AUDIO_CONFIG.limits.groanVoices, `max ${maxGroans}`);
    // Removed zombies (restart clears them all) must stop groaning immediately.
    let guard = 0;
    while (audio.count("groan") === 0 && guard++ < 100) step(0.2);
    const live = sink.plays.filter((p) => p.id === "groan" && p.at + DUR.groan * 1000 > sink.now()).map((p) => p.handle);
    assert.ok(live.length > 0);
    g.restart();
    for (const h of live) assert.ok(sink.stops.includes(h), `groan ${h} stopped`);
    assert.equal(audio.count("groan"), 0);
  });

  it("game over fades the music and stops ambience exactly once", () => {
    const { sink, g, audio, step } = setup();
    let overs = 0;
    g.on("gameOver", () => overs++);
    g.setRunning(true);
    g.start();
    for (let i = 0; i < 8; i++) g.combat.spawnZombie({ angle: i, radius: 1.4, speed: 1 });
    step(40);
    assert.equal(overs, 1);
    assert.equal(sink.musicStops, 1);
    assert.equal(audio.isMusicOn, false);
    assert.equal(audio.count("groan"), 0);
    step(5);
    assert.equal(sink.musicStops, 1);
    assert.equal(sink.count("gameOver"), 0, "no game-over file supplied → nothing extra plays");
  });

  it("restart repeatedly: one music loop, no leaked voices or listeners", async () => {
    const { sink, g, audio, pose, step } = setup();
    g.setRunning(true);
    g.start();
    assert.equal(sink.musicStarts, 1);
    for (let r = 0; r < 5; r++) {
      await pose();
      step(1);
      g.restart();
      assert.equal(audio.count(), 0);
      assert.ok(sink.musicPlaying);
    }
    // Music restarted once per restart (from the top), never stacked by waveStart.
    assert.equal(sink.musicStarts, 6);
    assert.equal(sink.count("heeHee"), 5);
    audio.dispose();
    const before = sink.plays.length;
    await pose();
    assert.equal(sink.plays.length, before, "disposed: no listeners left");
  });

  it("pause, tracking loss and hidden tab suspend audio; resuming lifts it", () => {
    const { sink, audio, target } = setup();
    emitGameState(target, { running: false, paused: "tracking-lost", phase: "PLAYING" } as never);
    assert.equal(sink.suspended, true);
    emitGameState(target, { running: true, paused: null, phase: "PLAYING" } as never);
    assert.equal(sink.suspended, false);
    audio.setTabHidden(true);
    assert.equal(sink.suspended, true);
    audio.setTabHidden(false);
    assert.equal(sink.suspended, false);
  });

  it("missing audio files never break gameplay", async () => {
    const quiet = new FakeSink({});
    const { g, pose, step, audio } = setup(quiet);
    g.setRunning(true);
    g.start();
    for (let i = 0; i < 4; i++) g.combat.spawnZombie({ angle: i, radius: 2, speed: 1 });
    await pose();
    step(10);
    assert.equal(quiet.plays.length, 0);
    assert.equal(audio.count(), 0);
    assert.ok(g.snapshot().score >= 0);
  });

  it("settings persist locally and survive bad stored data", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    assert.deepEqual(loadAudioSettings(store), { ...AUDIO_CONFIG.defaults });
    saveAudioSettings({ muted: true, music: 0.2, sfx: 1 }, store);
    assert.deepEqual(loadAudioSettings(store), { muted: true, music: 0.2, sfx: 1 });
    mem.set(AUDIO_CONFIG.settingsKey, "{not json");
    assert.deepEqual(loadAudioSettings(store), { ...AUDIO_CONFIG.defaults });
    mem.set(AUDIO_CONFIG.settingsKey, JSON.stringify({ muted: "x", music: 7, sfx: -2 }));
    assert.deepEqual(loadAudioSettings(store), { muted: false, music: 1, sfx: 0 });
  });
  it("mix: the hee-hee stands clearly above the aura and ducked music, without clipping", () => {
    // Measured from the supplied files (dB): loud RMS / peak of the used segments.
    const SRC = { voiceRms: -19.3, voicePeak: -8.6, auraRms: -8.0, auraPeak: -0.3 };
    const db = (g: number) => 20 * Math.log10(g);
    const S = AUDIO_CONFIG.sounds;
    const sfx = AUDIO_CONFIG.defaults.sfx;
    const voice = SRC.voiceRms + db(S.heeHee.gain * sfx);
    const aura = SRC.auraRms + db(S.aura.gain * sfx);
    assert.ok(voice - aura >= 6, `voice only ${(voice - aura).toFixed(1)} dB above aura`);
    // Music ducked hard for the whole voice.
    const M = AUDIO_CONFIG.music;
    assert.ok(M.duck.depth <= 0.15);
    assert.ok(M.duck.attackSec + M.duck.holdSec >= S.heeHee.clips[0]!.duration);
    // Worst-case summed peak of voice + aura stays under the limiter threshold (no squash, no clip).
    const peak = db(10 ** ((SRC.voicePeak + db(S.heeHee.gain * sfx)) / 20) + 10 ** ((SRC.auraPeak + db(S.aura.gain * sfx)) / 20));
    assert.ok(peak < 0 && peak <= AUDIO_CONFIG.limiter.threshold + 1, `peak ${peak.toFixed(1)} dBFS`);
    // Music: clearly audible at default volume (song body ~-17 dB RMS in the file), yet under the voice.
    const music = -17 + db(M.gain * AUDIO_CONFIG.defaults.music);
    assert.ok(music >= -28, `music too quiet: ${music.toFixed(1)} dB`);
    assert.ok(voice - music >= 6, `music only ${(voice - music).toFixed(1)} dB under the voice`);
    // Playback starts and loops on the full-level part of the song, not the quiet intro / fade-out.
    assert.ok(M.startSec >= 30 && M.loopEndSec > M.startSec + 120);
  });
});
