import { AUDIO_CONFIG, type AudioConfig, type SoundClip } from "./audioConfig";

/**
 * Which sounds each build plays.
 *
 *   - `npm run dev`: AUDIO_CONFIG, the full mix including the background music file, which is
 *     kept on the development machine only (git-ignored, removed from builds by vite.config.ts).
 *   - Production: RELEASE_AUDIO_CONFIG, the same sound effects and mix without background music.
 *
 * PUBLIC_AUDIO_CONFIG is an optional replacement pack (files in public/audio/, each playing
 * from its start). Set PUBLIC_AUDIO_ENABLED to ship it instead; `npm run dev` with
 * `?audio=public` previews it. Missing files are skipped silently.
 */
export const PUBLIC_AUDIO_ENABLED = false;

export const PUBLIC_AUDIO_DIR = "audio";
const BASE = `${import.meta.env.BASE_URL ?? "/"}${PUBLIC_AUDIO_DIR}/`;
const clip = (file: string, duration: number): SoundClip => ({ url: `${BASE}${file}`, offset: 0, duration });

export const PUBLIC_AUDIO_FILES = {
  attackVoice: "attack-voice.mp3",
  attackRelease: "attack-release.mp3",
  playerHit: ["player-hit-1.mp3", "player-hit-2.mp3", "player-hit-3.mp3"],
  zombieGroan: ["zombie-groan-1.mp3", "zombie-groan-2.mp3", "zombie-groan-3.mp3", "zombie-groan-4.mp3"],
  gameOver: "game-over.mp3",
  music: "music.mp3",
} as const;

const F = PUBLIC_AUDIO_FILES;

export const PUBLIC_AUDIO_CONFIG: AudioConfig = {
  ...AUDIO_CONFIG,
  sounds: {
    heeHee: { ...AUDIO_CONFIG.sounds.heeHee, clips: [clip(F.attackVoice, 1.2)], gain: 1 },
    aura: { ...AUDIO_CONFIG.sounds.aura, clips: [clip(F.attackRelease, 1.5)], gain: 0.5 },
    playerHit: { ...AUDIO_CONFIG.sounds.playerHit, clips: F.playerHit.map((f) => clip(f, 0.4)), gain: 0.6 },
    groan: { ...AUDIO_CONFIG.sounds.groan, clips: F.zombieGroan.map((f) => clip(f, 3.2)), gain: 0.3 },
    gameOver: { ...AUDIO_CONFIG.sounds.gameOver, clips: [clip(F.gameOver, 3)], gain: 0.8 },
  },
  music: {
    ...AUDIO_CONFIG.music,
    url: `${BASE}${F.music}`,
    gain: 0.5,
    // A loop-ready track: play from the start and let the element loop the whole file.
    startSec: 0,
    loopEndSec: Number.POSITIVE_INFINITY,
  },
};

/** The released build: every game sound effect, no background music (the music file isn't shipped). */
export const RELEASE_AUDIO_CONFIG: AudioConfig = { ...AUDIO_CONFIG, music: { ...AUDIO_CONFIG.music, url: "" } };

/** Which pack this build plays. */
export function selectAudioPack(dev: boolean, search: string): AudioConfig {
  if (dev) return new URLSearchParams(search).get("audio") === "public" ? PUBLIC_AUDIO_CONFIG : AUDIO_CONFIG;
  return PUBLIC_AUDIO_ENABLED ? PUBLIC_AUDIO_CONFIG : RELEASE_AUDIO_CONFIG;
}
