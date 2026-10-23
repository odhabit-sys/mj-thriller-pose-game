import { diagonalReachPose } from "../pose/diagonalReachPose";
import { faceCoverPose } from "../pose/faceCoverPose";
import {
  armsOverheadPose,
  crossBodyPose,
  doubleSidePose,
  historyStancePose,
  overheadDiagonalPose,
  powerStancePose,
  skyPointPose,
  thrillerClawPose,
} from "../pose/poseLibrary";
import type { PoseClassifier } from "../pose/poseTypes";
import { sidePointPose } from "../pose/sidePointPose";
import { smoothCriminalPose } from "../pose/smoothCriminalPose";

/**
 * EASY: big, very different arm shapes, simple stance.
 * MEDIUM: more asymmetry, a bent-arm detail, or a stance requirement.
 * HARD: body lean, cross-body shapes, more precise angles.
 */
export type PoseDifficulty = "easy" | "medium" | "hard";

/**
 * Everything the game (and the debug tools) need to know about a pose.
 * The classifier is the LOCKED recognition logic; everything else is presentation.
 * Adding a pose = write a classifier + add one entry here.
 */
export interface PoseDefinition {
  id: string;
  displayName: string;
  classifier: PoseClassifier;
  /** Short instruction shown with the reference. */
  instruction: string;
  /** Drives wave-based selection (see poseSelector.ts). */
  difficulty: PoseDifficulty;
  /**
   * Image shown on the pose card: public/poses/ in production, the identical local copy in
   * dev-reference/ during development. Null = no image (the card shows the text instruction).
   */
  referenceImage: string | null;
  /** Alt text for the reference photo. */
  referenceImageAlt: string;
  /** CSS object-position for the photo inside the card (default "center"). */
  referenceImagePosition: string;
  /** Photo size multiplier inside the card (default 1 = fit the card, never cropped). */
  referenceImageScale: number;
  /**
   * No real Michael Jackson reference photo has been supplied for this pose yet.
   * The classifier is kept, but the pose is NOT selected in normal gameplay
   * (every prompt must show a real MJ photo). See PLAYABLE_POSES.
   */
  missingReference: boolean;
  /** Production pose image, relative to public/ (null for poses that aren't playable). */
  publicCard: string | null;
  /** Free-form gameplay metadata for later (e.g. attack strength). */
  meta?: Record<string, unknown>;
}

/**
 * Pose-card images: one reference photo per playable pose in public/poses/ (shipped with the
 * game). `npm run dev` reads the same photos from the local dev-reference/ folder (git-ignored);
 * `?cards=public` makes the dev server use public/poses/ instead. A missing image falls back
 * to the written instruction on the card (see GameHud).
 */
export const PUBLIC_POSE_CARD_DIR = "poses";
const previewPublicCards = typeof location !== "undefined" && new URLSearchParams(location.search).get("cards") === "public";
const usePhotos = import.meta.env.DEV && !previewPublicCards;
const devRef = (file: string) => `/dev-reference/${file}`;
const publicCard = (file: string) => `${import.meta.env.BASE_URL ?? "/"}${PUBLIC_POSE_CARD_DIR}/${file}`;

interface ReferencePhoto {
  /** File name in public/poses/ (and in the local dev-reference/ folder). */
  file: string;
  alt: string;
  position?: string;
  scale?: number;
}

/** `photo` = the pose's reference photo; null = none (pose disabled in gameplay). */
const entry = (classifier: PoseClassifier, displayName: string, difficulty: PoseDifficulty, photo: ReferencePhoto | null): PoseDefinition => ({
  id: classifier.id,
  displayName,
  classifier,
  instruction: classifier.description,
  difficulty,
  referenceImage: photo ? (usePhotos ? devRef(photo.file) : publicCard(photo.file)) : null,
  referenceImageAlt: photo?.alt ?? `${displayName} pose`,
  referenceImagePosition: photo?.position ?? "center",
  referenceImageScale: photo?.scale ?? 1,
  publicCard: photo ? `${PUBLIC_POSE_CARD_DIR}/${photo.file}` : null,
  missingReference: photo === null,
});

export const POSE_REGISTRY: readonly PoseDefinition[] = [
  // The original three (locked classifiers) with their original photos.
  entry(sidePointPose, "SIDE POINT", "easy", { file: "side-point.webp", alt: "Michael Jackson pointing one arm out to the side" }),
  entry(faceCoverPose, "FACE COVER", "medium", { file: "face-cover.webp", alt: "Michael Jackson with one hand up near his face" }),
  entry(diagonalReachPose, "DIAGONAL REACH", "easy", { file: "diagonal-reach.png", alt: "Michael Jackson reaching one arm up diagonally" }),
  // The three provided reference photos.
  entry(historyStancePose, "HISTORY STANCE", "medium", { file: "history-stance.webp", alt: "Michael Jackson in the black and gold military outfit, standing squared with fists down" }),
  entry(smoothCriminalPose, "SMOOTH CRIMINAL LEAN", "hard", { file: "smooth-criminal.webp", alt: "Michael Jackson in the white suit and fedora doing the Smooth Criminal lean" }),
  entry(armsOverheadPose, "ARMS OVERHEAD", "easy", { file: "arms-overhead.webp", alt: "Michael Jackson with both arms raised, hands meeting above his head" }),
  // Recognition ready, but no real MJ photo supplied yet: kept out of gameplay until one is provided.
  entry(skyPointPose, "SKY POINT", "easy", null),
  entry(doubleSidePose, "DOUBLE SIDE", "easy", null),
  entry(thrillerClawPose, "THRILLER CLAW", "medium", null),
  entry(powerStancePose, "POWER STANCE", "medium", null),
  entry(crossBodyPose, "CROSS BODY", "hard", null),
  entry(overheadDiagonalPose, "OVERHEAD DIAGONAL", "hard", null),
];

/** Poses the game may ask for: only those with a real MJ reference photo. */
export const PLAYABLE_POSES: readonly PoseDefinition[] = POSE_REGISTRY.filter((p) => !p.missingReference);

export function getPose(id: string): PoseDefinition | undefined {
  return POSE_REGISTRY.find((p) => p.id === id);
}
