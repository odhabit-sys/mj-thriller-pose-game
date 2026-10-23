import { SURVIVAL_CONFIG } from "./survivalConfig";

/** Where the best score lives. Local only, no backend. */
export interface ScoreStorage {
  load(): number;
  save(score: number): void;
}

/** localStorage-backed; silently degrades to memory if storage is unavailable (private mode, blocked). */
export function createLocalScoreStorage(key: string = SURVIVAL_CONFIG.bestScoreKey): ScoreStorage {
  let memory = 0;
  return {
    load() {
      try {
        const v = Number(localStorage.getItem(key));
        if (Number.isFinite(v) && v > 0) memory = Math.max(memory, Math.floor(v));
      } catch {
        // unavailable: keep the in-memory value
      }
      return memory;
    },
    save(score) {
      memory = Math.max(memory, score);
      try {
        localStorage.setItem(key, String(memory));
      } catch {
        // unavailable: the best score lasts for this session only
      }
    },
  };
}

export function createMemoryScoreStorage(initial = 0): ScoreStorage {
  let best = initial;
  return {
    load: () => best,
    save: (s) => {
      best = s;
    },
  };
}
