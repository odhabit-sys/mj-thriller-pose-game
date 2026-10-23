import { AUDIO_CONFIG, type SoundClip, type SoundId } from "./audioConfig";
import type { AudioSettings } from "./audioSettings";
import type { AudioSink, PlayOptions } from "./audioSink";

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * The ONE place that touches the Web Audio API.
 *
 *   SFX voices ─▶ sfxBus ─────────────────────────┐
 *   <audio> music ─▶ musicBus ─▶ musicFade ─▶ duck ┴▶ master (mute) ─▶ limiter ─▶ speakers
 *
 * - The AudioContext is created on the first user gesture (unlock), so browsers'
 *   autoplay rules are respected; sound files are fetched up front and decoded then.
 * - Music streams through a single <audio> element (a 6-minute song is far too big
 *   to decode into memory), so there can never be two music loops.
 * - Any file that fails to load just makes its sound a no-op.
 */
export class WebAudioEngine implements AudioSink {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private musicFade!: GainNode;
  private duckGain!: GainNode;
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Decoded clips per sound (missing files are simply absent). */
  private readonly ready = new Map<SoundId, { clip: SoundClip; buffer: AudioBuffer }[]>();
  private readonly voices = new Map<number, Voice>();
  private nextHandle = 1;
  private suspended = false;
  private musicWanted = false;
  private musicToken = 0;
  /** play() was refused by the browser (autoplay policy): retried on the next user interaction. */
  private musicBlocked = false;
  private musicElementUnlocked = false;
  private looping = false;
  private readonly music: HTMLAudioElement | null;
  private settings: AudioSettings;

  constructor(settings: AudioSettings, private readonly cfg = AUDIO_CONFIG) {
    this.settings = { ...settings };
    // Preload: fetch the bytes now (no AudioContext needed yet).
    for (const def of Object.values(cfg.sounds))
      for (const c of def.clips) if (!this.bytes.has(c.url)) this.bytes.set(c.url, this.fetchBytes(c.url));
    // No music URL (e.g. a build without a music file): no music element at all, so nothing is requested.
    this.music = typeof Audio === "undefined" || !cfg.music.url ? null : new Audio();
    if (this.music) {
      this.music.src = cfg.music.url;
      // Fallback only: the loop normally jumps back from loopEndSec to startSec (see onMusicTime).
      this.music.loop = true;
      this.music.preload = "auto";
      this.music.addEventListener("error", () => console.warn("[audio] music unavailable:", cfg.music.url));
      this.music.addEventListener("timeupdate", () => this.onMusicTime());
    }
  }

  /** Call from a user gesture (Enable Camera / Start / Restart). Idempotent. */
  unlock(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      try {
        this.ctx = new Ctx();
      } catch (err) {
        console.warn("[audio] Web Audio unavailable", err);
        return;
      }
      this.buildGraph(this.ctx);
      void this.decodeAll(this.ctx);
    }
    // A context created inside a gesture starts running: keep it in step with pause state.
    if (this.suspended) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
    // Music that the browser refused to start earlier: retry inside this gesture.
    if (this.musicWanted && this.musicBlocked && !this.suspended) {
      this.playMusicElement();
      return;
    }
    // Unlock the <audio> element inside the first gesture too (iOS/Safari), without playing it yet.
    if (this.music && !this.musicWanted && !this.musicElementUnlocked) {
      this.musicElementUnlocked = true;
      this.music.muted = true;
      this.music
        .play()
        .then(() => {
          if (!this.musicWanted) this.music?.pause();
          if (this.music) this.music.muted = false;
        })
        .catch(() => {
          if (this.music) this.music.muted = false;
        });
    }
  }

  applySettings(s: AudioSettings): void {
    this.settings = { ...s };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ramp(this.master.gain, s.muted ? 0 : 1, t, 0.08);
    this.ramp(this.musicBus.gain, this.cfg.music.gain * s.music, t, 0.08);
    this.ramp(this.sfxBus.gain, s.sfx, t, 0.08);
  }

  // ---- AudioSink -----------------------------------------------------------

  variations(id: SoundId): number {
    return this.ready.get(id)?.length ?? 0;
  }

  duration(id: SoundId, variation: number): number {
    const c = this.ready.get(id)?.[variation];
    return c ? Math.min(c.clip.duration, c.buffer.duration - c.clip.offset) : 0;
  }

  play(id: SoundId, opts: PlayOptions = {}): number {
    const ctx = this.ctx;
    const list = this.ready.get(id);
    if (!ctx || this.suspended || !list || list.length === 0) return -1;
    const def = this.cfg.sounds[id];
    const { clip, buffer } = list[Math.abs(opts.variation ?? 0) % list.length]!;
    const dur = Math.max(0.01, Math.min(clip.duration, buffer.duration - clip.offset));
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const peak = def.gain * (opts.gain ?? 1);
    const fadeIn = Math.min(def.fadeIn, dur / 2);
    const fadeOut = Math.min(def.fadeOut, dur - fadeIn);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + fadeIn);
    gain.gain.setValueAtTime(peak, t + dur - fadeOut);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    let tail: AudioNode = gain;
    src.connect(gain);
    if (opts.pan !== undefined && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(p);
      tail = p;
    }
    tail.connect(this.sfxBus);
    const handle = this.nextHandle++;
    this.voices.set(handle, { src, gain });
    src.onended = () => {
      this.voices.delete(handle);
      src.disconnect();
      tail.disconnect();
      if (tail !== gain) gain.disconnect();
    };
    src.start(t, clip.offset, dur);
    return handle;
  }

  stop(handle: number, fadeSec = 0.05): void {
    const v = this.voices.get(handle);
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fadeSec);
    try {
      v.src.stop(t + fadeSec + 0.01);
    } catch {
      // already stopped
    }
  }

  startMusic(fromStart: boolean): void {
    const el = this.music;
    if (!el) return;
    this.musicWanted = true;
    this.musicToken++;
    if (fromStart) el.currentTime = this.cfg.music.startSec;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.musicFade.gain.cancelScheduledValues(t);
      this.musicFade.gain.setValueAtTime(fromStart ? 0 : this.musicFade.gain.value, t);
      this.musicFade.gain.linearRampToValueAtTime(1, t + this.cfg.music.fadeInSec);
    }
    if (!this.suspended) this.playMusicElement();
  }

  stopMusic(): void {
    const el = this.music;
    if (!el || !this.musicWanted) return;
    this.musicWanted = false;
    const token = ++this.musicToken;
    const fade = this.cfg.music.fadeOutSec;
    if (!this.ctx) {
      el.pause();
      return;
    }
    const t = this.ctx.currentTime;
    this.musicFade.gain.cancelScheduledValues(t);
    this.musicFade.gain.setValueAtTime(this.musicFade.gain.value, t);
    this.musicFade.gain.linearRampToValueAtTime(0, t + fade);
    // Pause after the fade, unless the music was restarted meanwhile.
    setTimeout(() => {
      if (token === this.musicToken && !this.musicWanted) el.pause();
    }, fade * 1000 + 50);
  }

  duck(): void {
    if (!this.ctx) return;
    const D = this.cfg.music.duck;
    const g = this.duckGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(D.depth, t + D.attackSec);
    g.setValueAtTime(D.depth, t + D.attackSec + D.holdSec);
    g.linearRampToValueAtTime(1, t + D.attackSec + D.holdSec + D.releaseSec);
  }

  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    if (suspended) {
      this.music?.pause();
      void this.ctx?.suspend().catch(() => {});
    } else {
      void this.ctx?.resume().catch(() => {});
      if (this.musicWanted) this.playMusicElement();
    }
  }

  /** Leaving gameplay: silence everything immediately. */
  stopAll(): void {
    for (const h of [...this.voices.keys()]) this.stop(h, 0.03);
    this.musicWanted = false;
    this.musicToken++;
    this.music?.pause();
  }

  /** Live voices (debug / verification). */
  get activeVoices(): number {
    return this.voices.size;
  }

  get state(): string {
    return this.ctx?.state ?? "locked";
  }

  // ---- internals -------------------------------------------------------------

  private playMusicElement(): void {
    const el = this.music;
    if (!el) return;
    el.muted = false; // never leave the unlock trick's mute on
    el.play()
      .then(() => {
        this.musicBlocked = false;
      })
      .catch((err: unknown) => {
        // NotAllowedError = autoplay policy: retried on the next click / key press (unlock()).
        this.musicBlocked = (err as { name?: string })?.name === "NotAllowedError";
        if (!this.musicBlocked) console.warn("[audio] music could not play:", err);
      });
  }

  /** Loop over the full-level body of the song: short dip, jump back, rise. */
  private onMusicTime(): void {
    const el = this.music;
    const M = this.cfg.music;
    if (!el || !this.ctx || this.looping || !this.musicWanted) return;
    if (el.currentTime < M.loopEndSec - M.loopFadeSec) return;
    this.looping = true;
    const g = this.musicFade.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + M.loopFadeSec);
    setTimeout(() => {
      el.currentTime = M.startSec;
      if (this.musicWanted && this.ctx) {
        const t2 = this.ctx.currentTime;
        g.cancelScheduledValues(t2);
        g.setValueAtTime(0, t2);
        g.linearRampToValueAtTime(1, t2 + M.loopFadeSec);
      }
      this.looping = false;
    }, M.loopFadeSec * 1000);
  }

  private buildGraph(ctx: AudioContext): void {
    const L = this.cfg.limiter;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = L.threshold;
    limiter.knee.value = L.knee;
    limiter.ratio.value = L.ratio;
    limiter.attack.value = L.attack;
    limiter.release.value = L.release;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    this.musicFade = ctx.createGain();
    this.musicFade.gain.value = 0;
    this.musicFade.connect(this.duckGain);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFade);
    if (this.music) {
      try {
        ctx.createMediaElementSource(this.music).connect(this.musicBus);
      } catch (err) {
        console.warn("[audio] music routing failed", err);
      }
    }
    const s = this.settings;
    this.master.gain.value = s.muted ? 0 : 1;
    this.musicBus.gain.value = this.cfg.music.gain * s.music;
    this.sfxBus.gain.value = s.sfx;
  }

  private async fetchBytes(url: string): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.arrayBuffer();
    } catch {
      console.warn("[audio] missing sound (game continues without it):", url);
      return null;
    }
  }

  private async decodeAll(ctx: AudioContext): Promise<void> {
    await Promise.all(
      [...this.bytes].map(async ([url, p]) => {
        const data = await p;
        if (!data) return;
        try {
          this.buffers.set(url, await ctx.decodeAudioData(data.slice(0)));
        } catch {
          console.warn("[audio] could not decode:", url);
        }
      }),
    );
    for (const [id, def] of Object.entries(this.cfg.sounds) as [SoundId, (typeof this.cfg.sounds)[SoundId]][]) {
      const list: { clip: SoundClip; buffer: AudioBuffer }[] = [];
      for (const clip of def.clips) {
        const buffer = this.buffers.get(clip.url);
        if (buffer && clip.offset < buffer.duration) list.push({ clip, buffer });
      }
      this.ready.set(id, list);
    }
  }

  private ramp(p: AudioParam, v: number, t: number, sec: number): void {
    p.cancelScheduledValues(t);
    if (this.ctx?.state !== "running") {
      // The audio clock is frozen while suspended: apply settings immediately.
      p.value = v;
      return;
    }
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + sec);
  }
}
