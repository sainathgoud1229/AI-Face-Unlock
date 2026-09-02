import os
import tempfile
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Detect if running in read-only environment like Vercel Serverless
IS_VERCEL = os.environ.get("VERCEL") == "1" or not os.access(BASE_DIR, os.W_OK)

if IS_VERCEL:
    TEMP_DIR = tempfile.gettempdir()
    MODELS_DIR = os.path.join(TEMP_DIR, "models")
    DATA_DIR = os.path.join(TEMP_DIR, "data")
    LOGS_DIR = os.path.join(TEMP_DIR, "logs")
else:
    MODELS_DIR = os.path.join(BASE_DIR, "models")
    DATA_DIR = os.path.join(BASE_DIR, "data")
    LOGS_DIR = os.path.join(BASE_DIR, "logs")

# Ensure directories exist safely
for d in [MODELS_DIR, DATA_DIR, LOGS_DIR]:
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass

# ONNX Models & URLs
YUNET_MODEL_PATH = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_MODEL_PATH = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"

# Database & Logs
USERS_DB_PATH = os.path.join(DATA_DIR, "users_db.json")
AUDIT_LOG_PATH = os.path.join(LOGS_DIR, "audit_log.json")
LEGACY_FEATURE_FILE = os.path.join(DATA_DIR, "face_features.npy")

# Recognition Thresholds
COSINE_SIMILARITY_THRESHOLD = 0.363
L2_MATCH_THRESHOLD = 1.128

# Liveness Thresholds
EYE_CLOSE_THRESHOLD = 0.20
EYE_OPEN_THRESHOLD = 0.25
SMILE_THRESHOLD = 0.45
HEAD_TURN_YAW_THRESHOLD = 18.0 # degrees

# Auto-relock duration (seconds)
AUTO_LOCK_DELAY = 10.0
