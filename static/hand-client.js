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

  const pinchDist = dist2d(thumbTip, indexTip);
  if (pinchDist < 0.05) {
    return ["pinch", Math.round((1.0 - pinchDist / 0.05) * 100) / 100];
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
    numHands: 1
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
      timestamp: t
    };

    if (video.readyState >= 2) {
      const result = handLandmarker.detectForVideo(video, performance.now());
      if (result.landmarks && result.landmarks.length > 0) {
        const raw = result.landmarks[0];
        const arr = normalizedLandmarksFromResult(raw);
        // Mirror horizontally so motion matches a front-facing / selfie view (same as server flip).
        const landmarks = arr.map((p) => ({
          x: 1 - p.x,
          y: p.y,
          z: p.z
        }));
        const [gesture, confidence] = classifyGesture(landmarks);
        const indexTip = landmarks[8];
        payload = {
          detected: true,
          gesture,
          confidence,
          cursor_x: indexTip.x,
          cursor_y: indexTip.y,
          landmarks,
          hand: "unknown",
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
