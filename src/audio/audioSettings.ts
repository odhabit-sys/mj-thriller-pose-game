import { AUDIO_CONFIG } from "./audioConfig";

/** Player audio preferences, persisted locally (never sent anywhere). */
export interface AudioSettings {
  muted: boolean;
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clamp01 = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export function loadAudioSettings(storage: SettingsStorage | null = safeLocalStorage()): AudioSettings {
  const d = AUDIO_CONFIG.defaults;
  try {
    const raw = storage?.getItem(AUDIO_CONFIG.settingsKey);
    if (!raw) return { ...d };
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    return { muted: typeof p.muted === "boolean" ? p.muted : d.muted, music: clamp01(p.music, d.music), sfx: clamp01(p.sfx, d.sfx) };
  } catch {
    return { ...d };
  }
}

export function saveAudioSettings(s: AudioSettings, storage: SettingsStorage | null = safeLocalStorage()): void {
  try {
    storage?.setItem(AUDIO_CONFIG.settingsKey, JSON.stringify(s));
  } catch {
    // Private mode / storage full: preferences just won't persist.
  }
}

function safeLocalStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
