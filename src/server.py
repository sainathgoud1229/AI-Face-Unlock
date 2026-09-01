import cv2
import time
import os
import threading
import numpy as np
from flask import Flask, render_template, Response, jsonify, request, send_from_directory
import config
from model_loader import load_ai_models
from user_manager import UserManager
from liveness_detection import MultiGestureLivenessDetector

FACES_DIR = os.path.join(config.DATA_DIR, "faces")
os.makedirs(FACES_DIR, exist_ok=True)

app = Flask(
    __name__,
    template_folder=os.path.join(config.BASE_DIR, "templates"),
    static_folder=os.path.join(config.BASE_DIR, "static"),
)

# ─────────────────────────────────────────────────────────────
# GLOBAL SINGLETONS
# ─────────────────────────────────────────────────────────────
detector, recognizer = load_ai_models()
user_mgr = UserManager()
liveness_detector = MultiGestureLivenessDetector(required_challenges=["BLINK"])

system_state = {
    "unlocked": False,
    "unlocked_user": None,
    "similarity": 0.0,
    "message": liveness_detector.get_prompt_message(),
    "liveness_passed": False,
    "metrics": {"ear": 0.25, "smile": 0.50, "yaw": 0.0, "pitch": 0.0},
    "registered_users_count": len(user_mgr.list_users()),
    "challenge": liveness_detector.get_current_challenge(),
    "unlock_time": None,
}

audit_logs = []

reg_session = {
    "active": False,
    "name": "",
    "role": "User",
    "last_frame": None,
    "last_face": None,
    "status": "",
}


# ─────────────────────────────────────────────────────────────
# THREAD-SAFE CAMERA STREAM MANAGER
# ─────────────────────────────────────────────────────────────
class CameraStream:
    def __init__(self, src=0):
        self.src = src
        self.cap = None
        self.frame = None
        self.stopped = False
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.update, daemon=True)
        self.thread.start()

    def _open_camera(self):
        try:
            cap = cv2.VideoCapture(self.src, cv2.CAP_DSHOW) if os.name == 'nt' else cv2.VideoCapture(self.src)
            if cap.isOpened():
                return cap
        except Exception:
            pass
        try:
            cap = cv2.VideoCapture(self.src)
            if cap.isOpened():
                return cap
        except Exception:
            pass
        return None

    def update(self):
        while not self.stopped:
            if self.cap is None or not self.cap.isOpened():
                self.cap = self._open_camera()
                if self.cap is None:
                    # Generate a placeholder frame if camera is unavailable
                    img = np.zeros((480, 640, 3), dtype=np.uint8)
                    cv2.putText(img, "CAMERA UNAVAILABLE / BUSY", (120, 230),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
                    cv2.putText(img, "Check camera connection or permissions", (130, 270),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)
                    with self.lock:
                        self.frame = img
                    time.sleep(1.0)
                    continue

            ret, frame = self.cap.read()
            if not ret or frame is None:
                if self.cap:
                    self.cap.release()
                self.cap = None
                time.sleep(0.5)
                continue

            frame = cv2.flip(frame, 1)
            with self.lock:
                self.frame = frame
            time.sleep(0.03) # ~30 FPS

    def read(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def stop(self):
        self.stopped = True
        if self.cap:
            self.cap.release()

camera_stream = CameraStream(0)


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def log_event(event_type, details, user=None):
    entry = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "type": event_type,
        "details": details,
        "user": user["name"] if user else "Unknown",
    }
    audit_logs.insert(0, entry)
    if len(audit_logs) > 100:
        audit_logs.pop()


# ─────────────────────────────────────────────────────────────
# MJPEG VIDEO STREAM GENERATOR
# ─────────────────────────────────────────────────────────────
def generate_frames():
    while True:
        frame = camera_stream.read()
        if frame is None:
            time.sleep(0.05)
            continue

        height, width = frame.shape[:2]

        # ── Auto-lock check ───────────────────────────────────
        if system_state["unlocked"] and system_state["unlock_time"]:
            if time.time() - system_state["unlock_time"] >= config.AUTO_LOCK_DELAY:
                system_state["unlocked"] = False
                system_state["unlocked_user"] = None
                system_state["similarity"] = 0.0
                system_state["unlock_time"] = None
                liveness_detector.reset()
                system_state["message"] = liveness_detector.get_prompt_message()
                system_state["challenge"] = liveness_detector.get_current_challenge()
                log_event("AUTO_LOCK", "System automatically re-locked after timeout")

        # ── Face Detection ────────────────────────────────────
        faces = None
        try:
            detector.setInputSize((width, height))
            _, faces = detector.detect(frame)
        except Exception as e:
            pass

        detected_face = None
        if faces is not None and len(faces) > 0:
            detected_face = max(faces, key=lambda f: f[2] * f[3])

        # Store for registration session
        reg_session["last_frame"] = frame.copy()
        reg_session["last_face"] = detected_face

        # ── Liveness update ───────────────────────────────────
        is_live = liveness_detector.update(frame, detected_face)
        system_state["liveness_passed"] = is_live
        system_state["challenge"] = liveness_detector.get_current_challenge()
        system_state["message"] = liveness_detector.get_prompt_message()

        if liveness_detector.last_metrics:
            m = liveness_detector.last_metrics
            system_state["metrics"] = {
                "ear": round(m["ear"], 3),
                "smile": round(m["smile"], 3),
                "yaw": round(m["yaw"], 1),
                "pitch": round(m["pitch"], 1),
            }

        # ── Face Recognition ──────────────────────────────────
        if detected_face is not None:
            x, y, w, h = detected_face[:4].astype(int)

            if is_live and not system_state["unlocked"]:
                aligned = recognizer.alignCrop(frame, detected_face)
                feat = recognizer.feature(aligned)
                matched_user, sim = user_mgr.match_face(feat, recognizer)
                system_state["similarity"] = round(sim, 3)

                if matched_user:
                    system_state["unlocked"] = True
                    system_state["unlocked_user"] = matched_user
                    system_state["unlock_time"] = time.time()
                    system_state["message"] = f"ACCESS GRANTED - Welcome {matched_user['name']}"
                    log_event("ACCESS_GRANTED", f"Similarity: {sim:.3f}", matched_user)
                else:
                    system_state["message"] = "IDENTITY NOT RECOGNIZED"
                    log_event("ACCESS_DENIED", f"Similarity: {sim:.3f}")

            color = (
                (0, 255, 0) if system_state["unlocked"]
                else ((0, 255, 255) if is_live else (0, 165, 255))
            )
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(frame, system_state["message"], (x, max(30, y - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        # ── Registration session overlay ──────────────────────
        if reg_session["active"]:
            label = f"REG: {reg_session['name']} | FACE: {'DETECTED' if detected_face is not None else 'MISSING'}"
            cv2.putText(frame, label, (10, height - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 255), 2)

        # ── Encode & yield ────────────────────────────────────
        _, buf = cv2.imencode(".jpg", frame)
        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
        time.sleep(0.03)


# ─────────────────────────────────────────────────────────────
# ROUTES - Pages
# ─────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")


# ─────────────────────────────────────────────────────────────
# ROUTES - System Status & Control
# ─────────────────────────────────────────────────────────────
@app.route("/api/status")
def api_status():
    system_state["registered_users_count"] = len(user_mgr.list_users())
    return jsonify(system_state)

@app.route("/api/lock", methods=["POST"])
def api_lock():
    system_state["unlocked"] = False
    system_state["unlocked_user"] = None
    system_state["similarity"] = 0.0
    system_state["unlock_time"] = None
    liveness_detector.reset()
    system_state["message"] = liveness_detector.get_prompt_message()
    system_state["challenge"] = liveness_detector.get_current_challenge()
    log_event("MANUAL_LOCK", "System locked manually")
    return jsonify({"status": "success"})


# ─────────────────────────────────────────────────────────────
# ROUTES - Users
# ─────────────────────────────────────────────────────────────
@app.route("/api/users", methods=["GET"])
def api_get_users():
    return jsonify(user_mgr.list_users())

@app.route("/api/users/<user_id>", methods=["DELETE"])
def api_delete_user(user_id):
    ok = user_mgr.delete_user(user_id)
    if ok:
        log_event("USER_DELETED", f"User '{user_id}' removed")
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route("/api/users/<user_id>", methods=["PUT"])
def api_update_user(user_id):
    data = request.json
    new_name = data.get("name")
    new_role = data.get("role")
    ok = user_mgr.update_user(user_id, new_name, new_role)
    if ok:
        log_event("USER_UPDATED", f"User '{user_id}' updated")
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "User not found"}), 404


# ─────────────────────────────────────────────────────────────
# ROUTES - Registration via Webcam
# ─────────────────────────────────────────────────────────────
@app.route("/api/register/start", methods=["POST"])
def api_register_start():
    data = request.json
    reg_session["active"] = True
    reg_session["name"] = data.get("name", "New User").strip()
    reg_session["role"] = data.get("role", "User").strip()
    reg_session["status"] = "ready"
    return jsonify({"status": "started"})

@app.route("/api/register/capture", methods=["POST"])
def api_register_capture():
    if not reg_session["active"]:
        return jsonify({"status": "error", "message": "No registration session active"}), 400

    frame = reg_session["last_frame"]
    face = reg_session["last_face"]

    if frame is None:
        return jsonify({"status": "error", "message": "No camera frame available"}), 400
    if face is None:
        return jsonify({"status": "error", "message": "No face detected. Please face the camera."}), 400

    try:
        aligned = recognizer.alignCrop(frame, face)
        feat = recognizer.feature(aligned)
        
        # Save the actual face image
        filename = f"{int(time.time())}_{reg_session['name'].lower().replace(' ', '_')}.jpg"
        filepath = os.path.join(FACES_DIR, filename)
        cv2.imwrite(filepath, aligned)

        user_id = user_mgr.register_user(
            reg_session["name"], 
            feat, 
            role=reg_session["role"],
            face_image=filename
        )
        reg_session["active"] = False
        reg_session["status"] = "done"
        log_event("USER_REGISTERED", f"New user registered: {reg_session['name']}")
        return jsonify({"status": "success", "user_id": user_id, "name": reg_session["name"]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/register/cancel", methods=["POST"])
def api_register_cancel():
    reg_session["active"] = False
    reg_session["status"] = "cancelled"
    return jsonify({"status": "cancelled"})


# ─────────────────────────────────────────────────────────────
# ROUTES - Per-User Shortcuts
# ─────────────────────────────────────────────────────────────
@app.route("/api/shortcuts/<user_id>", methods=["GET"])
def api_get_shortcuts(user_id):
    return jsonify(user_mgr.get_shortcuts(user_id))

@app.route("/api/shortcuts/<user_id>", methods=["POST"])
def api_add_shortcut(user_id):
    data = request.json
    name = data.get("name", "").strip()
    url = data.get("url", "").strip()
    icon = data.get("icon", "🔗")
    color = data.get("color", "#4facfe")
    stype = data.get("type", "link")

    if not name or not url:
        return jsonify({"status": "error", "message": "Name and URL are required"}), 400

    sc = user_mgr.add_shortcut(user_id, name, url, icon, color, stype)
    if sc:
        log_event("SHORTCUT_ADDED", f"Shortcut '{name}' added for user '{user_id}'")
        return jsonify({"status": "success", "shortcut": sc})
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route("/api/shortcuts/<user_id>/<shortcut_id>", methods=["PUT"])
def api_update_shortcut(user_id, shortcut_id):
    data = request.json
    ok = user_mgr.update_shortcut(
        user_id,
        shortcut_id,
        name=data.get("name"),
        url=data.get("url"),
        icon=data.get("icon"),
        color=data.get("color")
    )
    if ok:
        log_event("SHORTCUT_UPDATED", f"Shortcut '{shortcut_id}' updated for user '{user_id}'")
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Shortcut or User not found"}), 404

@app.route("/api/shortcuts/<user_id>/<shortcut_id>", methods=["DELETE"])
def api_delete_shortcut(user_id, shortcut_id):
    ok = user_mgr.delete_shortcut(user_id, shortcut_id)
    if ok:
        log_event("SHORTCUT_DELETED", f"Shortcut '{shortcut_id}' removed for user '{user_id}'")
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Shortcut or User not found"}), 404


# ─────────────────────────────────────────────────────────────
# ROUTES - PDF & Document Storage (1GB Storage Plan)
# ─────────────────────────────────────────────────────────────
USER_FILES_DIR = os.path.join(config.DATA_DIR, "user_files")
os.makedirs(USER_FILES_DIR, exist_ok=True)

@app.route("/api/files/<user_id>", methods=["GET"])
def api_get_user_files(user_id):
    user = user_mgr.get_user(user_id)
    if not user:
        return jsonify({"status": "error", "message": "User not found"}), 404
    files = user.get("files", [])
    stats = user_mgr.get_storage_stats(user_id)
    return jsonify({"files": files, "storage": stats})

@app.route("/api/files/<user_id>/upload", methods=["POST"])
def api_upload_user_file(user_id):
    user = user_mgr.get_user(user_id)
    if not user:
        return jsonify({"status": "error", "message": "User not found"}), 404

    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file uploaded"}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({"status": "error", "message": "Empty file name"}), 400

    u_dir = os.path.join(USER_FILES_DIR, user_id)
    os.makedirs(u_dir, exist_ok=True)

    safe_filename = f"{int(time.time())}_{f.filename.replace(' ', '_')}"
    save_path = os.path.join(u_dir, safe_filename)
    f.save(save_path)

    file_size = os.path.getsize(save_path)
    record = user_mgr.add_file(user_id, f.filename, safe_filename, file_size)

    log_event("FILE_UPLOADED", f"File '{f.filename}' ({round(file_size/(1024*1024),2)}MB) uploaded for user '{user_id}'")
    return jsonify({"status": "success", "file": record})

@app.route("/api/files/<user_id>/download/<file_id>")
def api_download_user_file(user_id, file_id):
    user = user_mgr.get_user(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    for f in user.get("files", []):
        if f["id"] == file_id:
            u_dir = os.path.join(USER_FILES_DIR, user_id)
            return send_from_directory(u_dir, f["path"], as_attachment=True, download_name=f["name"])
    return jsonify({"error": "File not found"}), 404

@app.route("/api/files/<user_id>/<file_id>", methods=["DELETE"])
def api_delete_user_file(user_id, file_id):
    user = user_mgr.get_user(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    for f in user.get("files", []):
        if f["id"] == file_id:
            u_dir = os.path.join(USER_FILES_DIR, user_id)
            fpath = os.path.join(u_dir, f["path"])
            if os.path.exists(fpath):
                os.remove(fpath)
            user_mgr.delete_file(user_id, file_id)
            log_event("FILE_DELETED", f"File '{f['name']}' deleted for user '{user_id}'")
            return jsonify({"status": "success"})
    return jsonify({"error": "File not found"}), 404



# ─────────────────────────────────────────────────────────────
# ROUTES - Liveness Mode
# ─────────────────────────────────────────────────────────────
@app.route("/api/set_liveness", methods=["POST"])
def set_liveness():
    data = request.json
    mode = data.get("mode", "BLINK")
    if mode == "STRICT":
        liveness_detector.__init__(required_challenges=["BLINK", "SMILE"])
    else:
        liveness_detector.__init__(required_challenges=["BLINK"])
    liveness_detector.reset()
    log_event("CONFIG_CHANGE", f"Liveness mode -> {mode}")
    return jsonify({"status": "success", "mode": mode})


# ─────────────────────────────────────────────────────────────
# ROUTES - Logs & Assets
# ─────────────────────────────────────────────────────────────
@app.route("/api/logs")
def api_logs():
    return jsonify(audit_logs)

@app.route("/api/faces/<filename>")
def api_get_face_image(filename):
    return send_from_directory(FACES_DIR, filename)

@app.route("/api/export/csv")
def api_export_csv():
    user_mgr.export_excel()
    return send_from_directory(config.DATA_DIR, "users_database.csv", as_attachment=True, download_name="users_database.csv")

@app.route("/api/export/excel")
def api_export_excel():
    user_mgr.export_excel()
    return send_from_directory(config.DATA_DIR, "users_database.xlsx", as_attachment=True, download_name="users_database.xlsx")




# ─────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("[Server] Starting AI Face Unlock Web Server -> http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
