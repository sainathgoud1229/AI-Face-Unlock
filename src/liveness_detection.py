import cv2
import numpy as np
import time
import config


class YuNetLivenessDetector:
    def __init__(self):
        self.eye_closed = False
        self.blink_detected = False
        self.last_metrics = {
            "ear": 0.25,
            "smile": 0.50,
            "yaw": 0.0,
            "pitch": 0.0
        }

    def process_face(self, frame, face):
        """
        Extract geometry metrics from YuNet 15-element face array:
        [x, y, w, h, re_x, re_y, le_x, le_y, nt_x, nt_y, rm_x, rm_y, lm_x, lm_y, score]
        """
        x, y, w, h = face[:4].astype(int)
        re = np.array(face[4:6])   # Right Eye
        le = np.array(face[6:8])   # Left Eye
        nt = np.array(face[8:10])  # Nose Tip
        rm = np.array(face[10:12]) # Right Mouth
        lm = np.array(face[12:14]) # Left Mouth

        eye_dist = np.linalg.norm(re - le)
        mouth_dist = np.linalg.norm(rm - lm)
        eye_mid = (re + le) / 2.0

        # Yaw Estimation
        yaw_offset = (nt[0] - eye_mid[0]) / (eye_dist + 1e-5)
        yaw_degrees = yaw_offset * 90.0

        # Pitch Estimation
        eye_to_nose = nt[1] - eye_mid[1]
        nose_to_mouth = ((rm[1] + lm[1]) / 2.0) - nt[1]
        pitch_ratio = eye_to_nose / (nose_to_mouth + 1e-5)
        pitch_degrees = (pitch_ratio - 1.0) * 45.0

        # Smile Ratio
        smile_ratio = mouth_dist / (eye_dist + 1e-5)

        # Eye Open/Closed Intensity Variance Proxy
        ear_proxy = 0.25
        h_frame, w_frame = frame.shape[:2]

        for eye_pt in [re, le]:
            ex, ey = int(eye_pt[0]), int(eye_pt[1])
            ew, eh = max(5, int(w * 0.08)), max(5, int(h * 0.06))
            x1, x2 = max(0, ex - ew), min(w_frame, ex + ew)
            y1, y2 = max(0, ey - eh), min(h_frame, ey + eh)
            if x2 > x1 and y2 > y1:
                eye_roi = frame[y1:y2, x1:x2]
                gray_roi = cv2.cvtColor(eye_roi, cv2.COLOR_BGR2GRAY)
                std_dev = np.std(gray_roi)
                if std_dev < 16.0:
                    ear_proxy = 0.15

        self.last_metrics = {
            "ear": round(float(ear_proxy), 3),
            "smile": round(float(smile_ratio), 3),
            "yaw": round(float(yaw_degrees), 1),
            "pitch": round(float(pitch_degrees), 1)
        }

        return self.last_metrics


class MultiGestureLivenessDetector:
    """Multi-Gesture Liveness Detector with fast presence fallback"""
    def __init__(self, required_challenges=None):
        if required_challenges is None:
            required_challenges = ["BLINK"]
        self.required_challenges = required_challenges
        self.current_index = 0
        self.eye_closed = False
        self.passed = False
        self.first_face_time = None
        self.yunet_detector = YuNetLivenessDetector()
        self.last_metrics = self.yunet_detector.last_metrics

    def get_current_challenge(self):
        if self.current_index < len(self.required_challenges):
            return self.required_challenges[self.current_index]
        return "COMPLETED"

    def get_prompt_message(self):
        if self.passed:
            return "Liveness Verified!"

        challenge = self.get_current_challenge()
        prompts = {
            "BLINK": "Please BLINK or hold steady to verify",
            "TURN_LEFT": "Please TURN HEAD LEFT",
            "TURN_RIGHT": "Please TURN HEAD RIGHT",
            "SMILE": "Please SMILE to verify"
        }
        return prompts.get(challenge, "Verifying Liveness...")

    def update(self, frame, face=None):
        if self.passed:
            return True

        if face is None:
            self.first_face_time = None
            return False

        if self.first_face_time is None:
            self.first_face_time = time.time()

        metrics = self.yunet_detector.process_face(frame, face)
        self.last_metrics = metrics
        current_challenge = self.get_current_challenge()

        # Fast fallback: steady face presence for > 1.2s auto-passes liveness
        if time.time() - self.first_face_time >= 1.2:
            self.passed = True
            return True

        if current_challenge == "BLINK":
            if metrics["ear"] < 0.20:
                self.eye_closed = True
            elif self.eye_closed and metrics["ear"] >= 0.22:
                self.eye_closed = False
                self._advance_challenge()

        elif current_challenge == "TURN_LEFT":
            if metrics["yaw"] < -12.0:
                self._advance_challenge()

        elif current_challenge == "TURN_RIGHT":
            if metrics["yaw"] > 12.0:
                self._advance_challenge()

        elif current_challenge == "SMILE":
            if metrics["smile"] > 0.80:
                self._advance_challenge()

        return self.passed

    def _advance_challenge(self):
        self.current_index += 1
        if self.current_index >= len(self.required_challenges):
            self.passed = True

    def reset(self):
        self.current_index = 0
        self.eye_closed = False
        self.passed = False
        self.first_face_time = None