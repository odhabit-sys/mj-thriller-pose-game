/**
 * Production presentation assets: every playable pose card points at its image in
 * public/poses/, and the production build plays every sound effect but never requests the
 * background music file (which isn't shipped). Tests run as a production build: DEV = false.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { AUDIO_CONFIG } from "../src/audio/audioConfig";
import { PUBLIC_AUDIO_CONFIG, PUBLIC_AUDIO_ENABLED, RELEASE_AUDIO_CONFIG, selectAudioPack } from "../src/audio/publicAudio";
import { PLAYABLE_POSES, POSE_REGISTRY } from "../src/game/poseRegistry";

describe("release: pose cards", () => {
  it("every playable pose shows its image from public/poses/", () => {
    assert.deepEqual(
      PLAYABLE_POSES.map((p) => p.publicCard),
      [
        "poses/side-point.webp",
        "poses/face-cover.webp",
        "poses/diagonal-reach.png",
        "poses/history-stance.webp",
        "poses/smooth-criminal.webp",
        "poses/arms-overhead.webp",
      ],
    );
    for (const p of PLAYABLE_POSES) {
      assert.equal(p.referenceImage, `/${p.publicCard}`, p.id);
      assert.ok(existsSync(`public/${p.publicCard}`), `public/${p.publicCard} exists`);
    }
    for (const p of POSE_REGISTRY) assert.ok(!(p.referenceImage ?? "").includes("dev-reference"), p.id);
    for (const p of POSE_REGISTRY.filter((q) => q.missingReference)) assert.equal(p.publicCard, null, p.id);
  });
});

describe("release: audio", () => {
  it("development plays the full mix; production the same sounds without the music file", () => {
    assert.equal(selectAudioPack(true, ""), AUDIO_CONFIG);
    assert.equal(selectAudioPack(true, "?audio=public"), PUBLIC_AUDIO_CONFIG);
    assert.equal(selectAudioPack(false, ""), PUBLIC_AUDIO_ENABLED ? PUBLIC_AUDIO_CONFIG : RELEASE_AUDIO_CONFIG);
    assert.equal(RELEASE_AUDIO_CONFIG.music.url, "", "no music file is requested");
    assert.equal(RELEASE_AUDIO_CONFIG.sounds, AUDIO_CONFIG.sounds, "same sound effects and mix");
    assert.deepEqual(RELEASE_AUDIO_CONFIG.limits, AUDIO_CONFIG.limits);
  });
  it("every released sound effect file is in the repository; the music file is not referenced", () => {
    const urls = Object.values(RELEASE_AUDIO_CONFIG.sounds).flatMap((s) => s.clips.map((c) => c.url));
    assert.ok(urls.length >= 10);
    for (const u of new Set(urls)) {
      assert.ok(!u.includes("thriller"), u);
      assert.ok(existsSync(`public${u}`), `public${u} exists`);
    }
  });
});
