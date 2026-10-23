/**
 * Sound + music configuration. Files live in public/audio/local/. The background music file
 * is kept on the development machine only (see docs/CREDITS.md); the production build uses
 * the same sounds without it (publicAudio.ts). The game runs silently when any file is missing.
 */
const BASE = `${import.meta.env.BASE_URL ?? "/"}audio/local/`;

export type SoundId = "heeHee" | "aura" | "playerHit" | "groan" | "gameOver";

export interface SoundClip {
  url: string;
  /** Seconds into the file where the useful part starts. */
  offset: number;
  /** Seconds to play (the clip is faded out at the end). */
  duration: number;
}

export interface SoundDef {
  /** One of these is picked per play (variations). Empty = no asset supplied. */
  clips: SoundClip[];
  /** Linear gain on the SFX bus. */
  gain: number;
  /** Fade-in / fade-out (s) to avoid clicks. */
  fadeIn: number;
  fadeOut: number;
}

const groanClips: SoundClip[] = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
  url: `${BASE}zombie-groan-${i}.m4a`,
  offset: 0,
  duration: 3.2,
}));

export const AUDIO_CONFIG = {
  sounds: {
    // "Hee-hee": the lead sound of every attack. Source is quiet (peak -8.6 dBFS,
    // loud RMS -19 dB); ×1.85 puts it at ~-14 dB RMS / ~-3 dBFS peak — loud, but under
    // the limiter so it is never squashed or distorted.
    heeHee: { clips: [{ url: `${BASE}mj-hee-hee.mp3`, offset: 0.28, duration: 1.0 }], gain: 1.85, fadeIn: 0.005, fadeOut: 0.12 },
    // Energy swell: start just before its loud release so the burst lands as the ring expands.
    // Source is very hot (loud RMS -8 dB, mostly sub/bass); ×0.2 keeps it ~8 dB under the voice.
    aura: { clips: [{ url: `${BASE}energy-swell.mp3`, offset: 1.55, duration: 1.5 }], gain: 0.2, fadeIn: 0.02, fadeOut: 0.6 },
    // The damage file holds three separate hits; each is a variation.
    playerHit: {
      clips: [0.03, 1.53, 2.97].map((offset) => ({ url: `${BASE}player-damage.mp3`, offset, duration: 0.35 })),
      gain: 0.55,
      fadeIn: 0.003,
      fadeOut: 0.08,
    },
    // Short slices of the supplied "zombie group roaming" track.
    groan: { clips: groanClips, gain: 0.2, fadeIn: 0.25, fadeOut: 0.5 },
    // No game-over sound was supplied: music fades out and the groans stop instead.
    gameOver: { clips: [] as SoundClip[], gain: 0.8, fadeIn: 0.01, fadeOut: 0.3 },
  } satisfies Record<SoundId, SoundDef>,

  music: {
    url: `${BASE}thriller.mp3`,
    /**
     * Linear music-bus gain at volume 1. The song body is ~-17 dB RMS in the file, so
     * 0.57 × the default 0.7 volume puts it at ~-24 dB: clearly audible, ~8 dB under the hee-hee.
     */
    gain: 0.57,
    /**
     * The file opens with ~40 s of very quiet atmosphere (-30…-40 dB) and ends with a
     * fade-out, so playback starts and loops on the full-level body of the song.
     */
    startSec: 36,
    loopEndSec: 343,
    /** Short dip used to hide the loop jump. */
    loopFadeSec: 0.35,
    fadeInSec: 1.5,
    /** Fade-out on game over / leaving gameplay. */
    fadeOutSec: 1.6,
    /** Ducking under the hee-hee + aura: -18 dB for the whole 1 s voice, then a gentle return. */
    duck: { depth: 0.12, attackSec: 0.03, holdSec: 1.1, releaseSec: 0.7 },
  },

  limits: {
    /** Max overlapping player-hit sounds, and the minimum gap between two (ms). */
    playerHitVoices: 2,
    playerHitMinGapMs: 90,
    /** Max overlapping attack voices / aura sounds (a newer one replaces the oldest). */
    attackVoices: 2,
    /** Max simultaneous zombie groans, whatever the wave size. */
    groanVoices: 3,
  },

  groans: {
    /** Random gap between two groans (ms), shortened a little in bigger crowds. */
    minGapMs: 1400,
    maxGapMs: 4200,
    /** Fade used when a groaning zombie is defeated / removed. */
    stopFadeSec: 0.2,
    /** Scheduler period (ms). */
    tickMs: 200,
  },

  /**
   * Safety limiter only: high threshold so normal mixes pass untouched (a low
   * threshold made the loud aura pump the voice down); it just catches rare stacks.
   */
  limiter: { threshold: -3, knee: 2, ratio: 20, attack: 0.002, release: 0.15 },

  settingsKey: "mj-pose-game:audio",
  defaults: { muted: false, music: 0.7, sfx: 0.85 },
};

/** A full audio setup (sounds, music, mix). AUDIO_CONFIG is the local pack; see publicAudio.ts for the shipped one. */
export type AudioConfig = typeof AUDIO_CONFIG;
