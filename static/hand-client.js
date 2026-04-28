/**
 * Hand tracking in the browser (user's camera + MediaPipe).
 * Emits the same payload shape the server WebSocket used.
 */

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Port of gesture_classifier.py classify() */
export function classifyGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return ["none", 0];

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const indexMcp = landmarks[5];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexUp = indexTip.y < indexMcp.y;
  const middleUp = middleTip.y < landmarks[9].y;
  const ringUp = ringTip.y < landmarks[13].y;
  const pinkyUp = pinkyTip.y < landmarks[17].y;

  // Pinch variants:
  // - thumb + index: "pinch" (backwards compatible; used as click)
  // - thumb + middle: "pinch_mid" (optional)
  // - thumb + ring: "pinch_ring" (used for steering / secondary actions)
  const pinchIndexDist = dist2d(thumbTip, indexTip);
  const pinchMiddleDist = dist2d(thumbTip, middleTip);
  const pinchRingDist = dist2d(thumbTip, ringTip);
  // Middle-finger pinch is typically a bit harder to "close" in camera space than index.
  // Use slightly different thresholds to make thumb+middle reliable.
  const TH_INDEX = 0.055;
  const TH_MIDDLE = 0.065;
  const TH_RING = 0.085;
  const isIndex = pinchIndexDist < TH_INDEX;
  const isMiddle = pinchMiddleDist < TH_MIDDLE;
  const isRing = pinchRingDist < TH_RING;
  if (isIndex || isMiddle || isRing) {
    // Prefer ring pinch, then middle pinch, then index pinch (so steering gestures don't get
    // overridden if the index happens to also be close).
    if (isRing && (!isMiddle || pinchRingDist <= pinchMiddleDist) && (!isIndex || pinchRingDist <= pinchIndexDist)) {
      return ["pinch_ring", Math.round((1.0 - pinchRingDist / TH_RING) * 100) / 100];
    }
    if (isMiddle && (!isIndex || pinchMiddleDist <= pinchIndexDist)) {
      return ["pinch_mid", Math.round((1.0 - pinchMiddleDist / TH_MIDDLE) * 100) / 100];
    }
    return ["pinch", Math.round((1.0 - pinchIndexDist / TH_INDEX) * 100) / 100];
  }
  if (indexUp && !middleUp && !ringUp && !pinkyUp) return ["point", 0.95];
  if (indexUp && middleUp && ringUp && pinkyUp) return ["open", 0.95];
  if (!indexUp && !middleUp && !ringUp && !pinkyUp) return ["fist", 0.9];
  if (indexUp && middleUp && !ringUp && !pinkyUp) return ["peace", 0.9];
  return ["none", 0.5];
}

function normalizedLandmarksFromResult(lm) {
  const list = Array.isArray(lm) ? lm : Array.from(lm);
  return list.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
}

/**
 * @param {(data: {
 *   detected: boolean;
 *   gesture: string;
 *   confidence: number;
 *   cursor_x: number;
 *   cursor_y: number;
 *   landmarks: Array<{x:number,y:number,z:number}> | null;
 *   hand: string;
 *   hands?: Array<{
 *     detected: true;
 *     gesture: string;
 *     confidence: number;
 *     cursor_x: number;
 *     cursor_y: number;
 *     landmarks: Array<{x:number,y:number,z:number}>;
 *     hand: "Left" | "Right" | "unknown";
 *   }>;
 *   timestamp: number;
 * }) => void} onFrame
 */
export async function startClientHandTracking(onFrame) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not supported in this browser/context (use HTTPS or localhost).");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });

  const video = document.createElement("video");
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  video.setAttribute("playsinline", "");
  await video.play();

  const { FilesetResolver, HandLandmarker } = await import(
    "https://esm.sh/@mediapipe/tasks-vision@0.10.14"
  );

  const wasmPath =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);

  const handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numHands: 2
  });

  let rafId = 0;
  const loop = () => {
    const t = performance.now() / 1000;
    let payload = {
      detected: false,
      gesture: "none",
      confidence: 0,
      cursor_x: 0.5,
      cursor_y: 0.5,
      landmarks: null,
      hand: "none",
      hands: [],
      timestamp: t
    };

    if (video.readyState >= 2) {
      const result = handLandmarker.detectForVideo(video, performance.now());
      if (result.landmarks && result.landmarks.length > 0) {
        const hands = [];

        for (let i = 0; i < result.landmarks.length; i++) {
          const raw = result.landmarks[i];
          const arr = normalizedLandmarksFromResult(raw);
          // Mirror horizontally so motion matches a front-facing / selfie view (same as server flip).
          const landmarks = arr.map((p) => ({
            x: 1 - p.x,
            y: p.y,
            z: p.z
          }));

          const [gesture, confidence] = classifyGesture(landmarks);
          const indexTip = landmarks[8];

          let handed = "unknown";
          const h = result.handednesses?.[i]?.[0];
          const name = h?.categoryName || h?.displayName;
          if (name === "Left" || name === "Right") handed = name;

          hands.push({
            detected: true,
            gesture,
            confidence,
            cursor_x: indexTip.x,
            cursor_y: indexTip.y,
            landmarks,
            hand: handed
          });
        }

        // Backward-compatible "primary" fields: pick the first detected hand.
        const primary = hands[0];
        payload = {
          detected: true,
          gesture: primary.gesture,
          confidence: primary.confidence,
          cursor_x: primary.cursor_x,
          cursor_y: primary.cursor_y,
          landmarks: primary.landmarks,
          hand: primary.hand,
          hands,
          timestamp: t
        };
      }
    }

    onFrame(payload);
    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  return function stopClientHandTracking() {
    cancelAnimationFrame(rafId);
    stream.getTracks().forEach((tr) => tr.stop());
    handLandmarker.close?.();
  };
}
