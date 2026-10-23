import * as THREE from "three";
import type { Zombie } from "../../combat/combatSystem";
import { computeZombiePose, createPose, type Side, type ZombiePose, type ZombieVariant } from "./zombieAnimation";

/**
 * Stylized low-poly UNDEAD DANCER (original design, procedural, no external model).
 * 80s graveyard music-video energy: decayed suits, torn casual wear, old formal
 * vests, worn work jackets. Grey-green skin, sunken glowing eyes, crooked jaw.
 * No gore.
 *
 * All geometries and materials are created ONCE and shared by every zombie.
 * A variant only reassigns shared materials, toggles optional parts and scales
 * a few joints, so respawning allocates nothing.
 *
 * The character never moves itself: the root follows the combat simulation;
 * animation only rotates joints locally (no root motion).
 * Faces +Z; its left is +X.
 */

// ---------------------------------------------------------------------------
// Shared resources
// ---------------------------------------------------------------------------
const HIP_Y = 0.86;
const THIGH = 0.42;
const SHIN = 0.4;
const UPPER_ARM = 0.31;
const FOREARM = 0.29;
/** Base world scale (gameplay distances unaffected). */
const BASE_SCALE = 1.08;

/**
 * Cool green-grey rim so dark clothing still separates from the dark arena at
 * gameplay distance (distinct from MJ's purple/gold rim).
 */
const zombieRimUniforms = {
  uRimColor: { value: new THREE.Color(0x5f8a76) },
  uRimStrength: { value: 0.38 },
  uRimPower: { value: 3.2 },
};

function withRim(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, zombieRimUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float rim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += uRimColor * (pow(rim, uRimPower) * uRimStrength);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "zombie-rim";
  return mat;
}

function createResources() {
  const flat = (color: number, roughness = 0.9, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const cloth = (color: number) => withRim(flat(color, 0.95));
  const limb = (len: number, r0: number, r1: number, sides = 6) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, sides);
    g.translate(0, -len / 2, 0);
    return g;
  };
  const shell = (rTop: number, rBot: number, h: number, gap: number, missing = 0) => {
    // Partial cylinder open at the front (theta 0 = +Z). `missing` cuts a ragged hole at the side.
    const g = new THREE.CylinderGeometry(rTop, rBot, h, 9, 1, true, gap / 2 + missing, Math.PI * 2 - gap - missing);
    g.translate(0, h / 2, 0);
    return g;
  };

  const geo = {
    pelvis: new THREE.CylinderGeometry(0.16, 0.15, 0.17, 6),
    torso: (() => {
      const g = new THREE.CylinderGeometry(0.19, 0.15, 0.5, 7);
      g.translate(0, 0.25, 0);
      return g;
    })(),
    jacketSuit: shell(0.225, 0.18, 0.53, 0.7),
    jacketOpen: shell(0.23, 0.19, 0.5, 1.5),
    jacketTorn: shell(0.225, 0.18, 0.5, 0.75, 1.1),
    vest: shell(0.205, 0.17, 0.3, 0.85),
    collar: new THREE.BoxGeometry(0.11, 0.05, 0.035),
    tail: new THREE.BoxGeometry(0.16, 0.16, 0.02), // ragged jacket tail
    thigh: limb(THIGH, 0.075, 0.06),
    shin: limb(SHIN - 0.05, 0.06, 0.047),
    shinShort: limb(SHIN - 0.13, 0.06, 0.05),
    ankle: limb(0.09, 0.042, 0.04, 5),
    shoe: new THREE.BoxGeometry(0.1, 0.07, 0.25),
    upperArm: limb(UPPER_ARM, 0.058, 0.048),
    forearm: limb(FOREARM - 0.04, 0.05, 0.042),
    forearmSkin: limb(FOREARM - 0.02, 0.036, 0.03, 5),
    tornCuff: new THREE.ConeGeometry(0.058, 0.07, 5, 1, true),
    hand: new THREE.IcosahedronGeometry(0.055, 0),
    finger: new THREE.ConeGeometry(0.018, 0.08, 3),
    neck: limb(0.12, 0.045, 0.052, 5),
    head: new THREE.IcosahedronGeometry(0.125, 1),
    brow: new THREE.BoxGeometry(0.15, 0.03, 0.05),
    socket: new THREE.SphereGeometry(0.036, 6, 4),
    eye: new THREE.SphereGeometry(0.02, 6, 4),
    nose: new THREE.ConeGeometry(0.03, 0.08, 4),
    jaw: new THREE.BoxGeometry(0.14, 0.065, 0.11),
    mouth: new THREE.BoxGeometry(0.085, 0.022, 0.02),
    hairChunk: new THREE.IcosahedronGeometry(0.06, 0),
    hairStrand: new THREE.ConeGeometry(0.03, 0.16, 4),
    shadow: new THREE.CircleGeometry(0.42, 18),
  };

  const mat = {
    // Ashen grey-green, sickly olive, cold teal-grey, pale bone.
    // Faint self-glow so faces and hands stay readable in the dark arena.
    skin: [0x93a889, 0xa9ad86, 0x80a296, 0xb9b4a0].map((c) => {
      const m = flat(c, 0.85);
      m.emissive.setHex(c);
      m.emissiveIntensity = 0.12;
      return m;
    }),
    // Yellowed white, dirty cream, faded rust, faded denim blue, washed-out red.
    shirt: [0xe0d9c0, 0xc9c0a2, 0x9c6a4c, 0x6d86a0, 0xa8504c].map(cloth),
    // Plum, mud brown, slate blue, faded purple, moss.
    jacket: [0x463a57, 0x5a4634, 0x34495a, 0x6a4f72, 0x4b5a3c].map(cloth),
    pants: [0x2e2e3a, 0x45392b, 0x2e3a44, 0x463650].map(cloth),
    hair: [0x2a2420, 0x4a4a48, 0x4a3524].map((c) => flat(c, 0.8)),
    shoe: withRim(flat(0x1d1b20, 0.5, 0.2)),
    socket: new THREE.MeshBasicMaterial({ color: 0x141014 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xe4f5a8 }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x150a0d }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  for (const m of [...mat.jacket, ...mat.shirt]) m.side = THREE.DoubleSide;
  return { geo, mat };
}

type Resources = ReturnType<typeof createResources>;
let resources: Resources | null = null;
let liveCharacters = 0;

export function getZombieResources(): Resources {
  resources ??= createResources();
  return resources;
}

/** Frees the shared GPU resources (call when the arena is torn down). */
export function disposeZombieResources(): void {
  if (!resources) return;
  for (const g of Object.values(resources.geo)) g.dispose();
  const m = resources.mat;
  for (const x of [...m.skin, ...m.shirt, ...m.jacket, ...m.pants, ...m.hair, m.shoe, m.socket, m.eye, m.mouth, m.shadow])
    x.dispose();
  resources = null;
}

export function zombieResourcesAllocated(): boolean {
  return resources !== null;
}

export function liveZombieCharacters(): number {
  return liveCharacters;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
interface ArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  foreSkin: THREE.Mesh;
  cuff: THREE.Mesh;
  hand: THREE.Mesh;
  fingers: THREE.Mesh[];
}

interface LegRig {
  thigh: THREE.Group;
  knee: THREE.Group;
  thighMesh: THREE.Mesh;
  shin: THREE.Mesh;
  shinShort: THREE.Mesh;
  ankle: THREE.Mesh;
  shoe: THREE.Mesh;
}

export class ZombieCharacter {
  readonly root = new THREE.Group();
  /** Current visual variant (null until assigned). */
  variant: ZombieVariant | null = null;
  readonly pose: ZombiePose = createPose();

  private readonly scaler = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL: ArmRig;
  private readonly armR: ArmRig;
  private readonly legL: LegRig;
  private readonly legR: LegRig;
  private readonly shadow: THREE.Mesh;
  private readonly parts: {
    torso: THREE.Mesh;
    jacketSuit: THREE.Mesh;
    jacketOpen: THREE.Mesh;
    jacketTorn: THREE.Mesh;
    vest: THREE.Mesh;
    tail: THREE.Mesh;
    collars: THREE.Mesh[];
    pelvis: THREE.Mesh;
    neck: THREE.Mesh;
    skull: THREE.Mesh;
    jaw: THREE.Mesh;
    nose: THREE.Mesh;
    brow: THREE.Mesh;
    hair: THREE.Mesh[];
  };
  private disposed = false;

  constructor() {
    const { geo, mat } = getZombieResources();
    liveCharacters++;
    const m = (g: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, material);
      o.position.set(x, y, z);
      return o;
    };
    const skin = mat.skin[0]!;
    const shirt = mat.shirt[0]!;
    const jacket = mat.jacket[0]!;
    const pants = mat.pants[0]!;

    this.root.add(this.scaler);
    this.scaler.add(this.body);

    // ----- Pelvis + legs -----
    this.pelvis.position.y = HIP_Y;
    this.body.add(this.pelvis);
    const pelvisMesh = m(geo.pelvis, pants, 0, 0.02, 0);
    pelvisMesh.scale.z = 0.75;
    this.pelvis.add(pelvisMesh);
    this.legL = this.makeLeg(1, pants, skin);
    this.legR = this.makeLeg(-1, pants, skin);

    // ----- Spine / torso -----
    this.spine.position.y = 0.07;
    this.pelvis.add(this.spine);
    const torso = m(geo.torso, shirt);
    torso.scale.z = 0.72;
    const jacketSuit = m(geo.jacketSuit, jacket, 0, -0.02, 0);
    const jacketOpen = m(geo.jacketOpen, jacket, 0, 0, 0);
    const jacketTorn = m(geo.jacketTorn, jacket, 0, 0, 0);
    const vest = m(geo.vest, jacket, 0, 0.12, 0);
    for (const s of [jacketSuit, jacketOpen, jacketTorn, vest]) s.scale.z = 0.8;
    // Ragged back tail hanging off one side of the jacket.
    const tail = m(geo.tail, jacket, -0.08, -0.05, -0.14);
    tail.rotation.set(0.15, 0.2, 0.25);
    // Crooked collar points.
    const collars = [1, -1].map((s) => {
      const c = m(geo.collar, shirt, 0.06 * s, 0.49, 0.115);
      c.rotation.set(-0.5, 0, s * 0.5);
      return c;
    });
    this.spine.add(torso, jacketSuit, jacketOpen, jacketTorn, vest, tail, ...collars);

    // ----- Arms -----
    this.armL = this.makeArm(1, jacket, skin);
    this.armR = this.makeArm(-1, jacket, skin);

    // ----- Neck + head -----
    this.neck.position.set(0, 0.5, 0.02);
    this.spine.add(this.neck);
    const neckMesh = m(geo.neck, skin, 0, 0, 0);
    neckMesh.rotation.x = Math.PI; // limb hangs down; flip to stand up
    this.neck.add(neckMesh);
    this.head.position.y = 0.17;
    this.neck.add(this.head);
    const skull = m(geo.head, skin);
    skull.scale.set(0.88, 1.08, 0.98);
    const brow = m(geo.brow, skin, 0, 0.04, 0.1);
    brow.rotation.x = 0.35;
    const sockets = [1, -1].map((s) => m(geo.socket, mat.socket, 0.045 * s, 0.0, 0.098));
    for (const s of sockets) s.scale.set(1.15, 0.8, 0.5);
    const eyes = [1, -1].map((s) => m(geo.eye, mat.eye, 0.045 * s, 0.0, 0.112));
    const nose = m(geo.nose, skin, 0, -0.03, 0.12);
    nose.rotation.x = Math.PI / 2 + 0.3;
    const jaw = m(geo.jaw, skin, 0, -0.115, 0.035);
    const mouth = m(geo.mouth, mat.mouth, 0, -0.085, 0.112);
    // Hair: 6 chunks + 3 strands; styles toggle visibility.
    const hair = [
      m(geo.hairChunk, mat.hair[0]!, 0.05, 0.1, -0.01),
      m(geo.hairChunk, mat.hair[0]!, -0.06, 0.1, 0.0),
      m(geo.hairChunk, mat.hair[0]!, 0.0, 0.11, -0.06),
      m(geo.hairChunk, mat.hair[0]!, 0.09, 0.04, -0.05),
      m(geo.hairChunk, mat.hair[0]!, -0.09, 0.05, -0.05),
      m(geo.hairChunk, mat.hair[0]!, 0.0, 0.05, -0.1),
      m(geo.hairStrand, mat.hair[0]!, 0.1, -0.06, -0.03),
      m(geo.hairStrand, mat.hair[0]!, -0.1, -0.07, -0.02),
      m(geo.hairStrand, mat.hair[0]!, 0.0, -0.05, -0.11),
    ];
    hair.forEach((h, i) => {
      if (i < 6) h.scale.set(1.2, 0.75, 1.1);
      else h.rotation.x = Math.PI; // strands hang down
    });
    this.head.add(skull, brow, ...sockets, ...eyes, nose, jaw, mouth, ...hair);

    this.parts = {
      torso,
      jacketSuit,
      jacketOpen,
      jacketTorn,
      vest,
      tail,
      collars,
      pelvis: pelvisMesh,
      neck: neckMesh,
      skull,
      jaw,
      nose,
      brow,
      hair,
    };

    this.shadow = new THREE.Mesh(geo.shadow, mat.shadow);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.root.add(this.shadow);
  }

  /** Apply a visual variant: material swaps, part visibility, a few joint offsets. No allocation. */
  setVariant(v: ZombieVariant): void {
    this.variant = v;
    const { mat } = getZombieResources();
    const skin = mat.skin[v.skin % mat.skin.length]!;
    const formalShirt = v.outfit === "suit" || v.outfit === "formal";
    const shirt = mat.shirt[(formalShirt ? v.shirt % 2 : v.shirt) % mat.shirt.length]!;
    const jacket = mat.jacket[v.jacket % mat.jacket.length]!;
    const pants = mat.pants[v.pants % mat.pants.length]!;
    const hairMat = mat.hair[v.hairColor % mat.hair.length]!;
    const P = this.parts;

    // Outfit shells
    P.jacketSuit.visible = v.outfit === "suit";
    P.jacketOpen.visible = v.outfit === "casual";
    P.jacketTorn.visible = v.outfit === "worker";
    P.vest.visible = v.outfit === "formal";
    P.tail.visible = v.outfit === "suit" || v.outfit === "worker";
    for (const s of [P.jacketSuit, P.jacketOpen, P.jacketTorn, P.vest, P.tail]) s.material = jacket;
    P.torso.material = shirt;
    for (const c of P.collars) c.material = shirt;
    P.collars[0]!.rotation.z = 0.5 + v.crookedCollar;
    P.collars[1]!.rotation.z = -0.5 + v.crookedCollar * 0.6;
    const sleeve = v.outfit === "formal" ? shirt : jacket;

    // Arms (torn sleeve exposes a thin forearm)
    for (const [arm, side] of [
      [this.armL, "L"],
      [this.armR, "R"],
    ] as [ArmRig, Side][]) {
      const torn = v.tornSleeve === side;
      arm.upper.material = sleeve;
      arm.fore.material = sleeve;
      arm.fore.visible = !torn;
      arm.foreSkin.visible = torn;
      arm.cuff.visible = torn;
      arm.cuff.material = sleeve;
      arm.foreSkin.material = skin;
      arm.hand.material = skin;
      for (const f of arm.fingers) f.material = skin;
      arm.shoulder.position.x = 0.2 * v.shoulderWidth * (side === "L" ? 1 : -1);
    }

    // Legs (mismatched trouser length shows a bare ankle)
    for (const [leg, side] of [
      [this.legL, "L"],
      [this.legR, "R"],
    ] as [LegRig, Side][]) {
      const short = v.shortTrouser === side;
      leg.thighMesh.material = pants;
      leg.shin.material = pants;
      leg.shinShort.material = pants;
      leg.shin.visible = !short;
      leg.shinShort.visible = short;
      leg.ankle.visible = short;
      leg.ankle.material = skin;
    }
    P.pelvis.material = pants;

    // Head
    for (const x of [P.neck, P.skull, P.jaw, P.nose, P.brow]) x.material = skin;
    P.jaw.scale.set(v.jawWidth, 1, 1);
    P.jaw.rotation.z = v.jawRoll;
    const style = v.hair;
    P.hair.forEach((h, i) => {
      h.material = hairMat;
      h.visible =
        style === "messy"
          ? i < 6
          : style === "balding"
            ? i === 3 || i === 5 || i === 6 // only patches at the side/back remain
            : style === "stringy"
              ? i === 2 || i >= 5
              : false;
    });

    // Shoulder width also widens the jacket a touch.
    for (const s of [P.jacketSuit, P.jacketOpen, P.jacketTorn, P.vest]) s.scale.x = v.shoulderWidth;
  }

  /** Follow the simulation and animate. Reads the zombie, never writes it. */
  sync(z: Readonly<Zombie>, time: number): ZombiePose {
    const v = this.variant!;
    const p = computeZombiePose(z, v, time, this.pose);
    this.root.visible = p.visible;
    if (!p.visible) return p;

    // Root: authoritative position from the simulation; face MJ (origin).
    this.root.position.set(z.x, 0, z.z);
    this.root.rotation.y = Math.atan2(-z.x, -z.z);
    this.scaler.scale.setScalar(BASE_SCALE * v.scale * p.scale);
    this.shadow.scale.setScalar(Math.max(0.4, 1 - z.y * 0.25) * p.scale);

    // Body: local offsets only (no root motion).
    this.body.position.y = z.y + p.bodyY - p.sink;
    this.body.rotation.set(p.bodyTiltX, p.bodyTwistY, p.bodyRollZ);
    this.pelvis.rotation.set(0, 0, p.pelvisZ);
    this.spine.rotation.set(p.spineX, p.spineY, p.spineZ);
    this.neck.rotation.set(p.neckX, 0, 0);
    this.head.rotation.set(p.headX, p.headY, p.headZ);

    this.armL.shoulder.rotation.set(p.shoulderLX, 0, p.shoulderLOut);
    this.armL.elbow.rotation.set(p.elbowLX, 0, 0);
    this.armR.shoulder.rotation.set(p.shoulderRX, 0, -p.shoulderROut);
    this.armR.elbow.rotation.set(p.elbowRX, 0, 0);
    this.legL.thigh.rotation.set(p.thighLX, 0, 0.04);
    this.legL.knee.rotation.set(p.kneeLX, 0, 0);
    this.legR.thigh.rotation.set(p.thighRX, 0, -0.04);
    this.legR.knee.rotation.set(p.kneeRX, 0, 0);
    return p;
  }

  /** Detach and release this character's objects. Shared resources stay (see disposeZombieResources). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    liveCharacters--;
  }

  // -------------------------------------------------------------------------
  private makeLeg(side: 1 | -1, pants: THREE.Material, skin: THREE.Material): LegRig {
    const { geo, mat } = getZombieResources();
    const thigh = new THREE.Group();
    thigh.position.set(0.09 * side, -0.02, 0);
    const thighMesh = new THREE.Mesh(geo.thigh, pants);
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    const shin = new THREE.Mesh(geo.shin, pants);
    const shinShort = new THREE.Mesh(geo.shinShort, pants);
    const ankle = new THREE.Mesh(geo.ankle, skin);
    ankle.position.y = -(SHIN - 0.13);
    const shoe = new THREE.Mesh(geo.shoe, mat.shoe);
    shoe.position.set(0, -SHIN + 0.0, 0.05);
    shoe.rotation.y = side * 0.12; // toes slightly splayed
    knee.add(shin, shinShort, ankle, shoe);
    thigh.add(thighMesh, knee);
    this.pelvis.add(thigh);
    return { thigh, knee, thighMesh, shin, shinShort, ankle, shoe };
  }

  private makeArm(side: 1 | -1, sleeve: THREE.Material, skin: THREE.Material): ArmRig {
    const { geo } = getZombieResources();
    const shoulder = new THREE.Group();
    shoulder.position.set(0.2 * side, 0.45, 0.02);
    const upper = new THREE.Mesh(geo.upperArm, sleeve);
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    const fore = new THREE.Mesh(geo.forearm, sleeve);
    const foreSkin = new THREE.Mesh(geo.forearmSkin, skin);
    const cuff = new THREE.Mesh(geo.tornCuff, sleeve);
    cuff.position.y = -0.03;
    cuff.rotation.x = Math.PI; // ragged edge flares downward
    const hand = new THREE.Mesh(geo.hand, skin);
    hand.position.y = -FOREARM - 0.03;
    hand.scale.set(0.85, 1.25, 0.55);
    // Long bony fingers: three claws.
    const fingers = [-0.025, 0, 0.025].map((x, i) => {
      const f = new THREE.Mesh(geo.finger, skin);
      f.position.set(x, -FOREARM - 0.1 - (i === 1 ? 0.01 : 0), 0.01);
      f.rotation.set(Math.PI + 0.2, 0, x * 4);
      return f;
    });
    elbow.add(fore, foreSkin, cuff, hand, ...fingers);
    shoulder.add(upper, elbow);
    this.spine.add(shoulder);
    return { shoulder, elbow, upper, fore, foreSkin, cuff, hand, fingers };
  }
}
