import "./styles.css";
import { ArenaGame } from "./arena/arenaGame";
import { CameraError, startCamera, type CameraSession } from "./camera/camera";
import type { AppMode } from "./modes/appMode";
import { DebugMode } from "./modes/debugMode";
import { GameMode } from "./modes/gameMode";
import { DETECTOR_CONFIG } from "./pose/poseConfig";
import { PoseDetector } from "./pose/poseDetector";
import type { TrackedLandmark } from "./pose/poseTypes";
import { SkeletonOverlay } from "./ui/debugOverlay";
import { GameHud } from "./ui/gameHud";
import { Hud, type TrackingStatus } from "./ui/hud";
import { createLocalScoreStorage } from "./survival/bestScore";
import { SurvivalGame } from "./survival/survivalGame";
import { SurvivalHud } from "./ui/survivalHud";
import { GameAudio } from "./audio/gameAudio";
import { loadAudioSettings, saveAudioSettings } from "./audio/audioSettings";
import { WebAudioEngine } from "./audio/webAudioEngine";
import type { AudioConfig } from "./audio/audioConfig";
import { selectAudioPack } from "./audio/publicAudio";
import { AudioControls } from "./ui/audioControls";

// ?debug=true (or =pose) → manual pose selector + measurements.
// ?debug=combat → normal game + combat debug overlay (radius, zombie states, FPS, event log).
// Default → the game.
const debugParam = new URLSearchParams(location.search).get("debug") ?? "";
// Development tools (pose tester, combat overlay, "debug tools" link) exist only in development builds.
const debug = import.meta.env.DEV && ["true", "1", "pose"].includes(debugParam);
const combatDebug = import.meta.env.DEV && debugParam === "combat";
if (!import.meta.env.DEV) document.querySelectorAll(".mode-link").forEach((el) => el.remove());
document.body.dataset.mode = debug ? "debug" : "game";

// The survival game (health, waves, score) owns combat. The 3D arena steps and
// renders it and listens to gameplay events on window; it's created before the
// game mode so it hears the very first GAME_STATE.
const survival = new SurvivalGame(createLocalScoreStorage());
if (!debug) startArena();
// Sound + music (game mode only; created after the arena so it observes the same events).
// Development plays the full mix; production the same sounds without the background music
// file, which is never shipped (see audio/publicAudio.ts).
const audioPack = selectAudioPack(import.meta.env.DEV, location.search);
const audio = debug ? null : startAudio(audioPack);
// DEV + ?debug=combat: drive the survival game from the console without a webcam.
if (import.meta.env.DEV && combatDebug) (window as unknown as Record<string, unknown>).__survival = survival;

const hud = new Hud(debug);
const video = document.getElementById("video") as HTMLVideoElement;
const overlay = new SkeletonOverlay(document.getElementById("skeleton") as HTMLCanvasElement);
const stage = document.getElementById("stage") as HTMLElement;
const mode: AppMode = debug
  ? new DebugMode(hud, overlay)
  : new GameMode(hud, overlay, new GameHud(), survival, new SurvivalHud());

let detector: PoseDetector | null = null;
let camera: CameraSession | null = null;
let rafId = 0;

let landmarks: TrackedLandmark[] | null = null;
let lastDetectAt = 0;
let lastVideoTime = -1;
let lastPersonAt = 0;
let detectCount = 0;
let fpsWindowStart = 0;
let fps = 0;

const detectInterval = 1000 / DETECTOR_CONFIG.targetDetectionsPerSecond;

hud.enableButton.addEventListener("click", start);
hud.retryButton.addEventListener("click", start);

async function start(): Promise<void> {
  hud.enableButton.disabled = true;
  stop();
  hud.showViewer();
  hud.setLoading("Starting camera…");

  // Load the model in parallel with the camera permission prompt.
  const detectorPromise = detector ? Promise.resolve(detector) : PoseDetector.create();
  detectorPromise.catch(() => {}); // handled below; avoid unhandled-rejection noise if camera fails first

  try {
    camera = await startCamera(video);
  } catch (err) {
    hud.showError(err instanceof CameraError ? err.message : `Camera error: ${String(err)}`);
    hud.enableButton.disabled = false;
    return;
  }
  stage.style.aspectRatio = `${camera.width} / ${camera.height}`;
  camera.onEnded(() => {
    stop();
    hud.showError("The webcam stopped (disconnected, or access was revoked). Reconnect it and try again.");
  });

  hud.setLoading("Loading pose model…");
  try {
    detector = await detectorPromise;
  } catch (err) {
    console.error(err);
    stop();
    hud.showError(
      `The pose model failed to load. Check your internet connection (the model is downloaded once from Google's MediaPipe servers) and try again.\n\n${(err as Error)?.message ?? err}`,
    );
    return;
  }

  const now = performance.now();
  mode.start(now);
  lastPersonAt = now;
  fpsWindowStart = now;
  rafId = requestAnimationFrame(loop);
}

function stop(): void {
  audio?.director.stopAll(); // leaving gameplay: no sound without the game running
  cancelAnimationFrame(rafId);
  camera?.stop();
  camera = null;
  landmarks = null;
  overlay.clear();
}

/**
 * Rendering runs every animation frame; MediaPipe inference is throttled to
 * DETECTOR_CONFIG.targetDetectionsPerSecond and skipped when the video frame
 * hasn't changed.
 */
function loop(now: number): void {
  rafId = requestAnimationFrame(loop);
  if (!detector || !camera || video.readyState < 2) return;

  if (now - lastDetectAt >= detectInterval && video.currentTime !== lastVideoTime) {
    lastDetectAt = now;
    lastVideoTime = video.currentTime;
    runDetection(now);
  }
}

function runDetection(now: number): void {
  if (!detector) return;
  try {
    landmarks = detector.detect(video, now);
  } catch (err) {
    console.error("[pose] detection failed", err);
    landmarks = null;
  }

  let tracking: TrackingStatus;
  if (landmarks) {
    lastPersonAt = now;
    tracking = "tracking";
  } else {
    tracking = now - lastPersonAt > DETECTOR_CONFIG.trackingLostAfterMs ? "lost" : "no-person";
  }

  detectCount++;
  if (now - fpsWindowStart >= 1000) {
    fps = (detectCount * 1000) / (now - fpsWindowStart);
    detectCount = 0;
    fpsWindowStart = now;
  }

  overlay.resize(video.videoWidth, video.videoHeight);
  mode.onFrame({
    frame: { landmarks, width: video.videoWidth, height: video.videoHeight, timestamp: now },
    landmarks,
    now,
    tracking,
    fps,
    delegate: detector.delegate,
  });
}

window.addEventListener("pagehide", () => {
  stop();
  audio?.director.dispose();
  detector?.close();
});

function startArena(): void {
  const container = document.getElementById("arena");
  if (!container) return;
  const debugEl = document.getElementById("combat-debug");
  if (combatDebug) debugEl?.classList.remove("hidden");
  try {
    new ArenaGame(
      container,
      {
        debug: combatDebug,
        flashEl: document.getElementById("arena-flash"),
        damageEl: document.getElementById("damage-flash"),
        debugEl,
      },
      survival,
    );
  } catch (err) {
    // WebGL unavailable: the pose loop still works without the 3D view.
    console.error("[arena] failed to start", err);
    container.textContent = "3D view unavailable (WebGL is disabled or unsupported in this browser).";
    container.classList.add("arena-error");
  }
}

function startAudio(pack: AudioConfig): { engine: WebAudioEngine; director: GameAudio } {
  const settings = loadAudioSettings();
  const engine = new WebAudioEngine(settings, pack);
  const director = new GameAudio(engine, survival, window, undefined, undefined, pack);
  new AudioControls(settings, (s) => {
    engine.applySettings(s);
    saveAudioSettings(s);
  });
  // Browsers only allow audio after a user gesture: unlock on ANY click / tap / key press
  // (capture phase, so it runs before the game's own handlers start the music).
  for (const type of ["pointerdown", "keydown", "click"])
    document.addEventListener(type, () => engine.unlock(), { capture: true });
  document.addEventListener("visibilitychange", () => director.setTabHidden(document.hidden));
  setInterval(() => director.tick(), pack.groans.tickMs);
  if (import.meta.env.DEV && combatDebug)
    (window as unknown as Record<string, unknown>).__audio = { engine, director, unlock: () => engine.unlock() };
  return { engine, director };
}
