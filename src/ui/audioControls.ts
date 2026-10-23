import type { AudioSettings } from "../audio/audioSettings";

/**
 * Master mute + music / SFX volume sliders (game mode only).
 * Reports every change through `onChange`; persistence is the caller's job.
 */
export class AudioControls {
  private readonly root = document.getElementById("audio-controls");
  private readonly mute = document.getElementById("audio-mute") as HTMLButtonElement | null;
  private readonly music = document.getElementById("audio-music") as HTMLInputElement | null;
  private readonly sfx = document.getElementById("audio-sfx") as HTMLInputElement | null;

  constructor(
    private settings: AudioSettings,
    private readonly onChange: (s: AudioSettings) => void,
  ) {
    this.render();
    this.root?.classList.remove("hidden");
    this.mute?.addEventListener("click", () => this.update({ muted: !this.settings.muted }));
    this.music?.addEventListener("input", () => this.update({ music: Number(this.music!.value) / 100 }));
    this.sfx?.addEventListener("input", () => this.update({ sfx: Number(this.sfx!.value) / 100 }));
  }

  private update(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.render();
    this.onChange(this.settings);
  }

  private render(): void {
    const s = this.settings;
    if (this.mute) {
      this.mute.textContent = s.muted ? "SOUND OFF" : "SOUND ON";
      this.mute.setAttribute("aria-pressed", String(s.muted));
      this.mute.classList.toggle("muted", s.muted);
    }
    if (this.music) this.music.value = String(Math.round(s.music * 100));
    if (this.sfx) this.sfx.value = String(Math.round(s.sfx * 100));
    this.root?.classList.toggle("is-muted", s.muted);
  }
}
