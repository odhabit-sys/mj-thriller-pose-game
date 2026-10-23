export type CameraErrorKind = "insecure" | "denied" | "not-found" | "in-use" | "unknown";

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface CameraSession {
  stream: MediaStream;
  width: number;
  height: number;
  /** Called if the camera stops on its own (unplugged, revoked, taken by another app). */
  onEnded(cb: () => void): void;
  stop(): void;
}

/** Starts the webcam into `video`. Must be called from a user gesture (the ENABLE CAMERA button). */
export async function startCamera(video: HTMLVideoElement): Promise<CameraSession> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      "insecure",
      "Camera access needs a secure page. Open it via http://localhost (not a LAN IP) or HTTPS.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  } catch (err) {
    throw toCameraError(err);
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError("unknown", `Could not start the video element: ${(err as Error).message}`);
  }
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
  }

  const endedCallbacks: (() => void)[] = [];
  let stopped = false;
  for (const track of stream.getVideoTracks()) {
    track.addEventListener("ended", () => {
      if (!stopped) endedCallbacks.forEach((cb) => cb());
    });
  }

  return {
    stream,
    width: video.videoWidth,
    height: video.videoHeight,
    onEnded: (cb) => endedCallbacks.push(cb),
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

function toCameraError(err: unknown): CameraError {
  const name = (err as DOMException)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new CameraError(
        "denied",
        "Camera permission was denied. Allow camera access in your browser's address bar (and in System Settings → Privacy & Security → Camera on macOS), then try again.",
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return new CameraError("not-found", "No webcam was found. Connect a camera and try again.");
    case "NotReadableError":
    case "AbortError":
      return new CameraError("in-use", "The webcam couldn't be started. It may be in use by another app (Zoom, FaceTime…).");
    default:
      return new CameraError("unknown", `Camera error: ${(err as Error)?.message ?? String(err)}`);
  }
}
