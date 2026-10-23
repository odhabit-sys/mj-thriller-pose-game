import * as THREE from "three";
import { COMBAT_CONFIG } from "../combat/combatConfig";
import { distanceFromCenter } from "../combat/combatSystem";
import { onPoseConfirmed } from "../game/gameEvents";
import { SURVIVAL_CONFIG } from "../survival/survivalConfig";
import { bindSurvivalToGameEvents } from "../survival/survivalEvents";
import type { SurvivalGame } from "../survival/survivalGame";
import { type GlbMichael, loadGlbMichael } from "./characters/glbMichael";
import { MichaelCharacter } from "./characters/michaelCharacter";
import { ZombieCrowd } from "./characters/zombieCrowd";
import { Graveyard } from "./environment/graveyard";
import { GRAVEYARD_CONFIG } from "./environment/graveyardConfig";
import { AttackVfx, bindVfxToCombat } from "./vfx/attackVfx";
import { VFX_CONFIG } from "./vfx/vfxConfig";

export interface ArenaOptions {
  /** ?debug=combat: brighter attack radius + zombie states / FPS / event log overlay. */
  debug: boolean;
  /** Element for the full-screen hit flash. */
  flashEl?: HTMLElement | null;
  /** Element for the red damage vignette. */
  damageEl?: HTMLElement | null;
  /** Element for combat debug text. */
  debugEl?: HTMLElement | null;
}

const CAMERA_POS = new THREE.Vector3(0, 8.2, 11);
/**
 * Composition only (no gameplay coordinates depend on it): tilted ~4° up from the
 * original (0, 0.4, 0.9) so the cemetery horizon, gate and rising moon enter the top
 * of the frame while MJ stays near the center.
 */
const CAMERA_TARGET = new THREE.Vector3(0, 0.95, 0.1);

/**
 * The 3D layer. It steps and renders the SurvivalGame (which owns combat) and
 * reacts ONLY to gameplay events on `window` (POSE_CONFIRMED, GAME_STATE) and
 * survival events. It never sees MediaPipe.
 */
export class ArenaGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  private readonly mj = new MichaelCharacter();
  /** Wraps the (locked) character so damage flinches never touch its pose animation. */
  private readonly mjHolder = new THREE.Group();
  private flinch = 0;
  private readonly zombies = new ZombieCrowd();
  /** Attack / impact VFX: visual only, driven by existing gameplay events. */
  private readonly vfx = new AttackVfx();
  private readonly impulse = new THREE.Vector3();
  private hemi!: THREE.HemisphereLight;
  private hemiBase = 0.95;
  /** Thriller graveyard scenery (decorative; built once, never touched by gameplay). */
  private readonly graveyard = new Graveyard();
  private readonly mjLight = new THREE.PointLight(0xffd36b, 0, 14, 1.6);
  /** The imported GLB MJ (visual only). Until it loads, or if it fails, the procedural MJ is shown. */
  private glbMj: GlbMichael | null = null;
  private disposed = false;

  private rafId = 0;
  private lastTime: number | null = null;
  /** Animation clock, frozen while paused. */
  private animTime = 0;
  private shakeLeft = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;

  // Debug bookkeeping
  private readonly confirmLog: string[] = [];
  private frames = 0;
  private fpsWindow = 0;
  private fps = 0;
  private debugAccum = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: ArenaOptions,
    private readonly survival: SurvivalGame,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);

    this.buildScene();
    this.loadImportedMj();

    // POSE_CONFIRMED → survival decides if it counts → MJ pose + aura + highlight together.
    bindSurvivalToGameEvents(window, survival, {
      onAttack: (poseId) => {
        // One event: MJ pose + charge/shockwave VFX + screen flash all start together.
        this.mj.playPose(poseId);
        if (VFX_CONFIG.enabled) this.vfx.charge();
        this.flash(this.opts.flashEl);
      },
    });
    // Impacts only where the simulation reports a hit (read-only, primitives only).
    if (VFX_CONFIG.enabled) bindVfxToCombat(survival.combat, this.vfx);
    survival.on("damage", () => {
      this.flinch = 1;
      this.flash(this.opts.damageEl);
      const D = SURVIVAL_CONFIG.damageShake;
      if (COMBAT_CONFIG.cameraShake.enabled) this.shake(D.durationMs, D.intensity);
    });
    survival.on("restart", () => this.resetEffects());
    if (opts.debug) {
      onPoseConfirmed(window, (e) => {
        this.confirmLog.unshift(`${new Date().toLocaleTimeString()}  POSE_CONFIRMED: ${e.poseId}  (#${e.hits})`);
        this.confirmLog.length = Math.min(this.confirmLog.length, 6);
      });
    }

    if (import.meta.env.DEV && opts.debug) this.exposeDevHooks();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.rafId = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.glbMj?.dispose();
    this.zombies.dispose();
    this.vfx.dispose();
    this.graveyard.dispose();
    this.renderer.dispose();
  }

  private buildScene(): void {
    const s = this.scene;
    // Cold moonlit night. MJ's warm gold attack light contrasts against it.
    s.background = new THREE.Color(0x05060d);
    s.fog = new THREE.Fog(GRAVEYARD_CONFIG.fog.color, GRAVEYARD_CONFIG.fog.near, GRAVEYARD_CONFIG.fog.far);

    this.hemi = new THREE.HemisphereLight(0x5d6aa8, 0x140f1f, this.hemiBase);
    s.add(this.hemi);
    // Cold key moonlight from the front-left so characters stay readable...
    const moon = new THREE.DirectionalLight(0xa6b6ff, 1.3);
    moon.position.set(-6, 12, 4);
    s.add(moon);
    // ...and a back light from the moon's side to silhouette graves, trees and characters.
    const rim = new THREE.DirectionalLight(0x8f8cff, 1.0);
    rim.position.set(-3, 7, -14);
    s.add(rim);
    this.mjLight.position.set(0, 1.6, 0.6);
    s.add(this.mjLight);

    // Attack radius indicator: always faintly visible so the reach is understandable.
    const a = COMBAT_CONFIG.attack.attackRadius;
    const radius = new THREE.Mesh(
      new THREE.RingGeometry(a - 0.05, a, 128),
      new THREE.MeshBasicMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: this.opts.debug ? 0.7 : 0.16,
        depthWrite: false,
      }),
    );
    radius.rotation.x = -Math.PI / 2;
    radius.position.y = 0.02;
    // MJ's stage spot
    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.y = 0.015;
    this.mjHolder.add(this.mj.root);
    s.add(this.graveyard.root, radius, spot, this.mjHolder, this.zombies.root, this.vfx.root);
  }

  /** Load the GLB MJ once; swap it in when ready. The procedural MJ stays as the fallback. */
  private loadImportedMj(): void {
    const started = performance.now();
    loadGlbMichael(MichaelCharacter.LEG_LENGTH)
      .then((glb) => {
        if (this.disposed) return glb.dispose();
        this.glbMj = glb;
        this.mj.attachVisual(glb);
        this.renderer.compile(this.scene, this.camera); // compile the skinned shader now, not on the first attack
        if (import.meta.env.DEV) console.info(`[mj] GLB character ready in ${Math.round(performance.now() - started)} ms`);
      })
      .catch((err) => console.warn("[mj] GLB character failed to load; keeping the procedural MJ", err));
  }

  /** DEV + ?debug=combat only: inspect character poses from the console. */
  private exposeDevHooks(): void {
    if (!import.meta.env.DEV) return; // stripped from production builds
    (window as unknown as Record<string, unknown>).__mj = {
      poses: MichaelCharacter.POSE_IDS,
      hold: (id: string | null) => this.mj.setPose(id),
      play: (id: string) => this.mj.playPose(id),
      reset: () => this.mj.reset(),
      /** Switch between the imported GLB (true) and the procedural fallback (false). */
      useGlb: (on: boolean) => this.mj.attachVisual(on ? this.glbMj : null),
      /** Close-up inspection camera (true) or the real gameplay camera (false). */
      closeUp: (on: boolean, yawDeg = 0) => {
        this.inspect = on ? { yaw: yawDeg, x: 0, z: 0, y: 1.25, dist: 4.2 } : null;
      },
    };
    (window as unknown as Record<string, unknown>).__arena = {
      /** Slow-motion for inspecting VFX frames (0 = freeze, 1 = normal). DEV only. */
      slowmo: (scale: number) => {
        this.devTimeScale = Math.max(0, scale);
      },
      vfxStats: () => ({ ...this.vfx.stats, idle: this.vfx.idle }),
      envStats: () => ({ ...this.graveyard.stats, objects: this.graveyard.objectCount }),
      renderInfo: () => ({
        ...this.renderer.info.render,
        programs: this.renderer.info.programs?.length ?? 0,
        brokenPrograms: ((this.renderer.info.programs ?? []) as unknown as { diagnostics?: { runnable: boolean } }[]).filter(
          (p) => p.diagnostics && !p.diagnostics.runnable,
        ).length,
      }),
      /** Show/hide scene objects by name (profiling: "graveyard", "ground", "groundFog", "backdrop"). DEV only. */
      toggle: (name: string, visible?: boolean) => {
        const o = this.scene.getObjectByName(name);
        if (o) o.visible = visible ?? !o.visible;
        return o ? o.visible : null;
      },
      /** Screen position (NDC) of a world point from the current camera. DEV only. */
      project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(this.camera);
        return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), fov: this.camera.fov, aspect: +this.camera.aspect.toFixed(3) };
      },
      /** Advance `steps` frames of `ms` each (works even when the tab isn't animating). DEV only. */
      tick: (ms = 16, steps = 1) => {
        for (let i = 0; i < steps; i++) this.frame(ms / 1000, performance.now());
      },
    };
    (window as unknown as Record<string, unknown>).__cam = {
      /** Inspection camera aimed at (x, z) from yawDeg at dist; `off()` returns to the gameplay camera. */
      at: (x: number, z: number, yawDeg = 0, dist = 3, y = 1.0) => {
        this.inspect = { yaw: yawDeg, x, z, y, dist };
      },
      off: () => {
        this.inspect = null;
      },
    };
  }

  private inspect: { yaw: number; x: number; z: number; y: number; dist: number } | null = null;

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the arena framed on narrow screens.
    this.camera.fov = this.camera.aspect < 1.2 ? 62 : 45;
    this.camera.updateProjectionMatrix();
    this.vfx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** DEV inspection only (__arena.slowmo); always 1 in normal play. */
  private devTimeScale = 1;

  private readonly loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt =
      (this.lastTime === null ? 0 : Math.min((now - this.lastTime) / 1000, COMBAT_CONFIG.maxDt)) * this.devTimeScale;
    this.lastTime = now;
    this.frame(dt, now);
  };

  /** One arena frame: step the survival game (if live), sync visuals, render. */
  private frame(dt: number, now: number): void {
    // The survival game advances only while PLAYING / between waves AND tracking is OK.
    const simulating = this.survival.isSimulating();
    this.survival.update(dt);
    if (simulating) this.animTime += dt;
    this.zombies.sync(this.survival.combat.zombies, this.animTime, dt);
    this.graveyard.update(dt);
    this.vfx.syncAttacks(this.survival.combat.attacks);
    this.vfx.update(dt);
    this.mj.update(dt);
    this.updateFlinch(dt);
    // MJ glow: the charge ramps it up fast; the blast punch briefly brightens the whole scene.
    this.mjLight.intensity = Math.max(this.mjLight.intensity - 120 * dt, VFX_CONFIG.charge.lightPeak * this.vfx.chargeLevel(), 0);
    this.hemi.intensity = this.hemiBase * (1 + VFX_CONFIG.punch.hemisphereBoost * this.vfx.punchLevel());
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    this.updateDebug(now, dt);
  }

  /** Small recoil when MJ is hit; applied to the holder so his pose animation is untouched. */
  private updateFlinch(dt: number): void {
    this.flinch = Math.max(0, this.flinch - dt * 5);
    const k = Math.sin(this.flinch * Math.PI) * this.flinch;
    this.mjHolder.rotation.x = -0.12 * k;
    this.mjHolder.scale.set(1 + 0.04 * k, 1 - 0.05 * k, 1 + 0.04 * k);
  }

  private shake(durationMs: number, intensity: number): void {
    // Never weaker than a shake already in progress.
    if (this.shakeLeft > 0 && this.shakeIntensity > intensity) return;
    this.shakeDuration = durationMs / 1000;
    this.shakeLeft = this.shakeDuration;
    this.shakeIntensity = intensity;
  }

  /** Restart: clear every lingering visual effect. */
  private resetEffects(): void {
    this.mj.reset();
    this.flinch = 0;
    this.shakeLeft = 0;
    this.mjLight.intensity = 0;
    this.animTime = 0;
    this.vfx.reset();
    for (const el of [this.opts.flashEl, this.opts.damageEl]) el?.classList.remove("flash");
  }

  private updateCamera(dt: number): void {
    if (this.inspect !== null) {
      const c = this.inspect;
      const a = (c.yaw * Math.PI) / 180;
      this.camera.position.set(c.x + Math.sin(a) * c.dist, c.y + c.dist * 0.15, c.z + Math.cos(a) * c.dist);
      this.camera.lookAt(c.x, c.y, c.z);
      return;
    }
    this.camera.position.copy(CAMERA_POS);
    if (this.shakeLeft > 0) {
      const k = (this.shakeLeft / this.shakeDuration) * this.shakeIntensity;
      this.camera.position.x += (Math.random() * 2 - 1) * k;
      this.camera.position.y += (Math.random() * 2 - 1) * k;
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    }
    // Visual-only impulse added on top of the fixed camera pose (CAMERA_POS is never modified).
    this.vfx.camera.offset(this.impulse);
    this.camera.position.add(this.impulse);
    this.camera.lookAt(CAMERA_TARGET);
  }

  private flash(el: HTMLElement | null | undefined): void {
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("flash");
  }

  private updateDebug(now: number, dt: number): void {
    this.frames++;
    if (now - this.fpsWindow >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsWindow || 1);
      this.frames = 0;
      this.fpsWindow = now;
    }
    const el = this.opts.debugEl;
    if (!this.opts.debug || !el) return;
    this.debugAccum += dt;
    if (this.debugAccum < 0.2) return;
    this.debugAccum = 0;
    const combat = this.survival.combat;
    const sv = this.survival.snapshot();
    const visual = new Map(this.zombies.debugRows(combat.zombies).map((r) => [r.id, r]));
    const zs = combat.zombies
      .filter((z) => z.active !== false)
      .map(
        (z) =>
          `  #${z.id} ${z.state.padEnd(11)} dist ${distanceFromCenter(z).toFixed(1).padStart(4)}  hits ${z.hits ?? 0}` +
          `  anim ${(visual.get(z.id)?.anim ?? "—").padEnd(9)} ${visual.get(z.id)?.variant ?? ""}` +
          `${z.y > 0 ? `  air ${z.y.toFixed(1)}` : ""}`,
      )
      .join("\n");
    el.textContent = [
      `render fps ${this.fps.toFixed(0)}   ${sv.state}${sv.paused ? " (PAUSED)" : ""}   wave ${sv.wave}   remaining ${sv.remaining}`,
      `hp ${sv.health}/${sv.maxHealth}   score ${sv.score}   best ${sv.best}`,
      `attack radius ${COMBAT_CONFIG.attack.attackRadius}   active auras ${combat.activeAttackCount()}`,
      `vfx particles ${this.vfx.stats.particles}/${VFX_CONFIG.capacity.particles}  streaks ${this.vfx.stats.streaks}  rings ${this.vfx.stats.rings}  decals ${this.vfx.stats.decals}  impacts ${this.vfx.stats.impacts} (defeat ${this.vfx.stats.defeatImpacts})`,
      "zombies:",
      zs || "  —",
      "events:",
      ...(this.confirmLog.length ? this.confirmLog.map((l) => `  ${l}`) : ["  —"]),
    ].join("\n");
  }
}
