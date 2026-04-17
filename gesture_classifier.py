import numpy as np

class GestureClassifier:

    def classify(self, landmarks) -> tuple[str, float]:
        """
        landmarks: list of 21 mediapipe landmark objects
        returns: (gesture_name, confidence)
        """
        if not landmarks:
            return "none", 0.0

        # Extract key landmarks
        wrist         = landmarks[0]
        thumb_tip     = landmarks[4]
        index_tip     = landmarks[8]
        index_mcp     = landmarks[5]   # index base
        middle_tip    = landmarks[12]
        ring_tip      = landmarks[16]
        pinky_tip     = landmarks[20]

        # --- Finger extended checks ---
        index_up  = index_tip.y  < index_mcp.y
        middle_up = middle_tip.y < landmarks[9].y
        ring_up   = ring_tip.y   < landmarks[13].y
        pinky_up  = pinky_tip.y  < landmarks[17].y

        # --- Pinch detection (thumb + index close together) ---
        pinch_dist = self._distance(thumb_tip, index_tip)
        if pinch_dist < 0.05:
            return "pinch", round(1.0 - (pinch_dist / 0.05), 2)

        # --- Point (only index up, others curled) ---
        if index_up and not middle_up and not ring_up and not pinky_up:
            return "point", 0.95

        # --- Open hand (all fingers up) ---
        if index_up and middle_up and ring_up and pinky_up:
            return "open", 0.95

        # --- Fist (no fingers up) ---
        if not index_up and not middle_up and not ring_up and not pinky_up:
            return "fist", 0.90

        # --- Peace / two fingers ---
        if index_up and middle_up and not ring_up and not pinky_up:
            return "peace", 0.90

        return "none", 0.5

    def _distance(self, a, b) -> float:
        return np.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)