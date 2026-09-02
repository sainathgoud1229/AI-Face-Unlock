import os
import urllib.request
import cv2
import config

def ensure_models_exist():
    """Ensure YuNet and SFace ONNX models are present, downloading them if missing."""
    os.makedirs(config.MODELS_DIR, exist_ok=True)

    if not os.path.exists(config.YUNET_MODEL_PATH):
        print(f"[ModelLoader] YuNet model missing. Downloading to {config.YUNET_MODEL_PATH}...")
        try:
            urllib.request.urlretrieve(config.YUNET_URL, config.YUNET_MODEL_PATH)
            print("[ModelLoader] YuNet model downloaded successfully!")
        except Exception as e:
            print(f"[ModelLoader] Error downloading YuNet model: {e}")
            raise e

    if not os.path.exists(config.SFACE_MODEL_PATH):
        print(f"[ModelLoader] SFace model missing. Downloading to {config.SFACE_MODEL_PATH}...")
        try:
            urllib.request.urlretrieve(config.SFACE_URL, config.SFACE_MODEL_PATH)
            print("[ModelLoader] SFace model downloaded successfully!")
        except Exception as e:
            print(f"[ModelLoader] Error downloading SFace model: {e}")
            raise e

def load_ai_models():
    """Ensure models exist and return initialized YuNet Detector and SFace Recognizer."""
    try:
        ensure_models_exist()
        
        detector = cv2.FaceDetectorYN_create(
            config.YUNET_MODEL_PATH,
            "",
            (320, 320),
            0.5, # score_threshold
            0.3, # nms_threshold
            5000
        )
        
        recognizer = cv2.FaceRecognizerSF_create(
            config.SFACE_MODEL_PATH,
            ""
        )
        
        return detector, recognizer
    except Exception as e:
        print(f"[ModelLoader] Warning: Could not initialize AI models ({e}). Operating in basic mode.")
        return None, None

if __name__ == "__main__":
    ensure_models_exist()
    print("All models verified and ready!")
