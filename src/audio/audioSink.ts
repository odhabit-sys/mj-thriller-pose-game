import type { SoundId } from "./audioConfig";

export interface PlayOptions {
  /** Extra linear gain on top of the sound's configured gain. */
  gain?: number;
  /** Stereo position, -1 (left) … 1 (right). */
  pan?: number;
  /** Which variation to play (index into the sound's clips). */
  variation?: number;
}

/**
 * What the game-audio logic needs from an audio backend. The real one is
 * WebAudioEngine; tests use a recording fake. Every method must be safe to call
 * before unlock, while suspended, or when an asset failed to load (no-op).
 */
export interface AudioSink {
  /** Starts a one-shot sound. Returns a voice handle, or -1 if nothing could play. */
  play(id: SoundId, opts?: PlayOptions): number;
  /** Fades a voice out and frees it. Unknown / finished handles are ignored. */
  stop(handle: number, fadeSec?: number): void;
  /** Number of variations available for a sound (0 = asset not supplied). */
  variations(id: SoundId): number;
  /** Clip length in seconds (for voice bookkeeping). */
  duration(id: SoundId, variation: number): number;

  /** Starts (or keeps) the music loop, fading in. Never creates a second loop. */
  startMusic(fromStart: boolean): void;
  /** Fades the music out and pauses it. */
  stopMusic(): void;
  /** Briefly lowers the music under an important sound. */
  duck(): void;

  /** Pauses / resumes all audio output (pause, tracking loss, hidden tab). */
  setSuspended(suspended: boolean): void;
}
