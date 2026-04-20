import cv2
import time
import threading
from gesture_classifier import GestureClassifier

class GestureDetector:
    def __init__(self):
        # MediaPipe is loaded lazily in _ensure_mediapipe() so cloud hosts
        # (e.g. Render, no webcam) can boot without initializing the graph.
        self.mp_hands = None
        self.hands = None
        self.mp_draw = None
        self.classifier = GestureClassifier()
        self.cap = None
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._latest_frame = None  # BGR numpy array
        # Always have a payload ready so WebSocket clients receive data
        # even before the first successful camera frame.
        self._latest_data: dict | None = {
            "detected": False,
            "gesture": "none",
            "confidence": 0.0,
            "cursor_x": 0.5,
            "cursor_y": 0.5,
            "landmarks": None,
            "hand": "none",
            "timestamp": time.time(),
        }
        self._camera_index = 0

    def _ensure_mediapipe(self):
        if self.hands is not None:
            return
        import mediapipe as mp

        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=1,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.mp_draw = mp.solutions.drawing_utils

    def start(self):
        self._ensure_mediapipe()
        # On macOS, AVFoundation is usually the most reliable backend.
        # Try a couple of options before giving up.
        self._open_camera()

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def _open_camera(self):
        # Always release before reopening
        try:
            if self.cap:
                self.cap.release()
        except Exception:
            pass

        cap = None
        tried = []
        for idx in (self._camera_index, 0, 1):
            if idx in tried:
                continue
            tried.append(idx)
            try:
                cap = cv2.VideoCapture(idx, cv2.CAP_AVFOUNDATION)
                if cap is not None and cap.isOpened():
                    self._camera_index = idx
                    break
            except Exception:
                cap = None

        if cap is None or not cap.isOpened():
            try:
                cap = cv2.VideoCapture(0)
            except Exception:
                cap = None

        self.cap = cap

        if not self.cap or not self.cap.isOpened():
            print("❌ Camera failed to open. macOS may need camera permission for your terminal/Python.")
            return

        # Reasonable defaults for performance + stability.
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap.set(cv2.CAP_PROP_FPS, 30)

        # Warm up: sometimes the first few reads fail even when opened.
        ok_any = False
        for _ in range(10):
            ok, _frame = self.cap.read()
            if ok:
                ok_any = True
                break
            time.sleep(0.03)
        if ok_any:
            print("✅ Camera started")
        else:
            print("⚠️ Camera opened but no frames yet; will keep retrying…")

    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self.cap:
            self.cap.release()
        print("🛑 Camera stopped")

    def _capture_loop(self):
        consecutive_failures = 0
        last_reopen = 0.0
        while not self._stop_event.is_set():
            if not self.cap or not self.cap.isOpened():
                now = time.time()
                if now - last_reopen > 1.0:
                    last_reopen = now
                    self._open_camera()
                time.sleep(0.1)
                continue

            ret, frame = self.cap.read()
            if not ret:
                consecutive_failures += 1
                # If we're not receiving frames, attempt a reopen periodically.
                now = time.time()
                if consecutive_failures >= 60 and now - last_reopen > 1.0:
                    last_reopen = now
                    consecutive_failures = 0
                    print("⚠️ No frames from camera; reopening…")
                    self._open_camera()
                # Publish a default state so websocket clients don't stall.
                with self._lock:
                    if self._latest_data is None:
                        self._latest_data = {
                            "detected": False,
                            "gesture": "none",
                            "confidence": 0.0,
                            "cursor_x": 0.5,
                            "cursor_y": 0.5,
                            "landmarks": None,
                            "hand": "none",
                            "timestamp": time.time(),
                        }
                time.sleep(0.02)
                continue
            consecutive_failures = 0

            annotated_frame, data = self._process_frame(frame)
            with self._lock:
                self._latest_frame = annotated_frame
                self._latest_data = data

            time.sleep(0.01)

    def _process_frame(self, frame):
        # Flip for mirror effect (feels natural for user)
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb)

        now = time.time()
        if not results.multi_hand_landmarks:
            cv2.putText(
                frame, "none",
                (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2
            )
            return frame, {
                "detected": False,
                "gesture": "none",
                "confidence": 0.0,
                "cursor_x": 0.5,
                "cursor_y": 0.5,
                "landmarks": None,
                "hand": "none",
                "timestamp": now
            }

        # Take first detected hand
        hand_landmarks = results.multi_hand_landmarks[0]
        handedness = results.multi_handedness[0].classification[0].label.lower()

        # Classify gesture
        gesture, confidence = self.classifier.classify(hand_landmarks.landmark)

        # Use index fingertip as cursor position (landmark 8)
        index_tip = hand_landmarks.landmark[8]

        landmarks = [
            {"x": float(lm.x), "y": float(lm.y), "z": float(lm.z)}
            for lm in hand_landmarks.landmark
        ]

        self.mp_draw.draw_landmarks(frame, hand_landmarks, self.mp_hands.HAND_CONNECTIONS)
        cv2.putText(
            frame, f"{gesture} ({confidence})",
            (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2
        )

        return frame, {
            "detected": True,
            "gesture": gesture,
            "confidence": confidence,
            "cursor_x": round(index_tip.x, 4),
            "cursor_y": round(index_tip.y, 4),
            "landmarks": landmarks,
            "hand": handedness,
            "timestamp": round(now, 3)
        }

    def get_frame_data(self) -> dict | None:
        with self._lock:
            return dict(self._latest_data) if self._latest_data else None

    def get_jpeg_frame(self) -> bytes | None:
        with self._lock:
            frame = self._latest_frame.copy() if self._latest_frame is not None else None
        if frame is None:
            return None
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            return None
        return buf.tobytes()