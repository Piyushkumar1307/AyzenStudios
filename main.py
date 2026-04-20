import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from gesture_detector import GestureDetector
from models import HandState

# --- Global detector instance ---
detector = GestureDetector()

# --- Lifespan: start/stop camera with app ---
# On cloud hosts (e.g. Render) there is no webcam; web UI uses browser hand tracking.
# - SKIP_SERVER_CAMERA=1: skip server camera (set in render.yaml).
# - Render sets RENDER=true; we skip server camera unless FORCE_SERVER_CAMERA=1 (rare).
def _skip_server_camera() -> bool:
    if os.environ.get("FORCE_SERVER_CAMERA", "").lower() in ("1", "true", "yes"):
        return False
    sk = os.environ.get("SKIP_SERVER_CAMERA", "").strip().lower()
    if sk in ("1", "true", "yes"):
        return True
    if sk in ("0", "false", "no"):
        return False
    return os.environ.get("RENDER", "").lower() == "true"


@asynccontextmanager
async def lifespan(app: FastAPI):
    skip_cam = _skip_server_camera()
    if skip_cam:
        print("Server-side camera skipped (browser / cloud: use SKIP_SERVER_CAMERA or RENDER).")
    else:
        detector.start()
    yield
    if not skip_cam:
        detector.stop()

app = FastAPI(
    title="Gesture Backend",
    description="MediaPipe hand gesture API for Unity",
    version="1.0.0",
    lifespan=lifespan
)

# Allow Unity (localhost) and any frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML = os.path.join(BASE_DIR, "static", "index.html")
GAME_HTML = os.path.join(BASE_DIR, "static", "game.html")

@app.get("/")
def index():
    return FileResponse(INDEX_HTML)

@app.get("/index")
def index_alt():
    """Same page as `/` — some people expect `/index` in the URL bar."""
    return FileResponse(INDEX_HTML)

@app.get("/game")
def game():
    return FileResponse(GAME_HTML)

app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "static")),
    name="static",
)

def _mjpeg_generator():
    boundary = b"frame"
    while True:
        frame = detector.get_jpeg_frame()
        if frame is None:
            # camera not ready yet
            time.sleep(0.05)
            continue
        yield (
            b"--" + boundary + b"\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
            frame + b"\r\n"
        )
        time.sleep(0.033)

@app.get("/video")
def video():
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )

# --- REST: health check ---
@app.get("/health")
def health():
    return {"status": "ok", "camera": detector.cap is not None}

# --- REST: single snapshot of current gesture ---
@app.get("/gesture", response_model=HandState)
def get_gesture():
    data = detector.get_frame_data()
    if data is None:
        return HandState(detected=False, gesture="none", cursor_x=0.5, cursor_y=0.5)
    return HandState(
        detected=data["detected"],
        gesture=data.get("gesture"),
        cursor_x=data.get("cursor_x"),
        cursor_y=data.get("cursor_y")
    )

# --- WebSocket: stream gesture events to Unity in real time ---
@app.websocket("/ws/gesture")
async def gesture_stream(websocket: WebSocket):
    await websocket.accept()
    print(f"🔌 Unity connected: {websocket.client}")

    try:
        while True:
            # Run blocking camera read in thread pool
            data = await asyncio.get_event_loop().run_in_executor(
                None, detector.get_frame_data
            )

            if not data:
                data = {
                    "detected": False,
                    "gesture": "none",
                    "confidence": 0.0,
                    "cursor_x": 0.5,
                    "cursor_y": 0.5,
                    "landmarks": None,
                    "hand": "none",
                    "timestamp": time.time(),
                }

            await websocket.send_text(json.dumps(data))

            # ~30fps stream
            await asyncio.sleep(0.033)

    except WebSocketDisconnect:
        print("🔌 Unity disconnected")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")