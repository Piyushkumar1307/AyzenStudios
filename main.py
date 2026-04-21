import asyncio
import json
import os
import time
import hmac
import hashlib
import secrets
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import ProgrammingError

from gesture_detector import GestureDetector
from models import HandState
from auth import create_access_token, get_current_user, hash_password, verify_password
from auth_models import Base, EmailOtp, GameEntitlement, User
from auth_schemas import (
    LoginRequest,
    MeResponse,
    OtpStatusResponse,
    RegisterRequest,
    RequestEmailOtp,
    TokenResponse,
    VerifyEmailOtp,
)
from db import engine, get_db

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
        try:
            detector.start()
        except Exception as e:
            # Don't fail app startup if server camera / mediapipe isn't available.
            # The web UI uses browser hand tracking.
            skip_cam = True
            print(f"Server-side camera unavailable; continuing without it. ({type(e).__name__}: {e})")
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
PUZZLE_HTML = os.path.join(BASE_DIR, "static", "puzzle.html")
RUNNER_HTML = os.path.join(BASE_DIR, "static", "runner.html")
TICTACTOE_HTML = os.path.join(BASE_DIR, "static", "tictactoe.html")
LOGIN_HTML = os.path.join(BASE_DIR, "static", "login.html")
PROFILE_HTML = os.path.join(BASE_DIR, "static", "profile.html")

# --- Store / Razorpay config ---
PAID_GAMES = {
    "neon_pop": {"route": "/puzzle", "title": "Neon Pop", "amount_paise": 1000},       # ₹10
    "neon_runner": {"route": "/runner", "title": "Neon Runner", "amount_paise": 1000}, # ₹10
    "tictactoe": {"route": "/tictactoe", "title": "Neon Tic-Tac-Toe", "amount_paise": 1000},  # ₹10
}

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

@app.get("/puzzle")
def puzzle():
    return FileResponse(PUZZLE_HTML)

@app.get("/runner")
def runner():
    return FileResponse(RUNNER_HTML)

@app.get("/tictactoe")
def tictactoe():
    return FileResponse(TICTACTOE_HTML)

@app.get("/login")
def login_page():
    return FileResponse(LOGIN_HTML)

@app.get("/profile")
def profile_page():
    return FileResponse(PROFILE_HTML)

app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "static")),
    name="static",
)


def _ensure_auth_tables():
    Base.metadata.create_all(bind=engine)
    _migrate_auth_schema()


def _migrate_auth_schema():
    """
    Lightweight schema migration (no Alembic).
    create_all() won't add new columns to existing tables, so we patch forward here.
    """
    with engine.begin() as conn:
        # Add email verification column if missing.
        conn.execute(
            text(
                "ALTER TABLE users "
                "ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )

def _ensure_tables_or_503():
    try:
        _ensure_auth_tables()
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")


def _require_auth_tables() -> None:
    """
    Run before get_current_user on routes that also call _ensure_tables_or_503.
    If we open a session and SELECT users first, then _migrate_auth_schema() runs
    ALTER TABLE users on another connection, Postgres can block or time out
    (statement_timeout) while the ORM still holds a transaction.
    """
    _ensure_tables_or_503()


@app.on_event("startup")
def _startup_db():
    try:
        _ensure_auth_tables()
    except OperationalError as e:
        # Allow app to start even if DB is temporarily unavailable.
        print(f"Database unavailable on startup; continuing. ({type(e).__name__}: {e})")


@app.post("/api/auth/register", response_model=OtpStatusResponse, status_code=201)
def api_register(payload: RegisterRequest, db: Session = Depends(get_db)):
    # Ensure table exists even if DB was down at startup.
    _ensure_tables_or_503()
    email = payload.email.strip().lower()
    user = User(
        name=payload.name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
        email_verified=False,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")
    except OperationalError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Database unavailable")
    except ProgrammingError as e:
        # If the table wasn't created yet, create it and retry once.
        db.rollback()
        if "relation \"users\" does not exist" in str(e):
            _ensure_tables_or_503()
            db.add(user)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(status_code=400, detail="Email already registered")
            except OperationalError:
                db.rollback()
                raise HTTPException(status_code=503, detail="Database unavailable")
        else:
            raise
    db.refresh(user)
    # Create + send OTP for email verification; user must verify before login.
    _send_verification_otp_or_500(db=db, email=email)
    return OtpStatusResponse(ok=True, detail="Account created. OTP sent to email for verification.")


@app.post("/api/auth/login", response_model=TokenResponse)
def api_login(payload: LoginRequest, db: Session = Depends(get_db)):
    _ensure_tables_or_503()
    email = payload.email.strip().lower()
    try:
        user = db.query(User).filter(User.email == email).first()
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")
    except ProgrammingError as e:
        if "relation \"users\" does not exist" in str(e):
            _ensure_tables_or_503()
            user = db.query(User).filter(User.email == email).first()
        else:
            raise
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not getattr(user, "email_verified", False):
        raise HTTPException(status_code=403, detail="Email not verified. Please verify via OTP.")
    token = create_access_token(user_id=str(user.id))
    return TokenResponse(access_token=token)


def _smtp_settings_or_none():
    host = os.environ.get("SMTP_HOST", "").strip()
    port_raw = os.environ.get("SMTP_PORT", "").strip()
    user = os.environ.get("SMTP_USERNAME", "").strip()
    pwd = os.environ.get("SMTP_PASSWORD", "").strip()
    from_email = os.environ.get("SMTP_FROM", "").strip() or user
    use_tls = os.environ.get("SMTP_TLS", "true").strip().lower() in ("1", "true", "yes")
    if not host or not port_raw or not user or not pwd or not from_email:
        return None
    try:
        port = int(port_raw)
    except Exception:
        return None
    return {"host": host, "port": port, "user": user, "pwd": pwd, "from": from_email, "tls": use_tls}


def _otp_signing_key() -> bytes:
    # Use JWT_SECRET as the signing key source to avoid introducing another secret.
    s = os.environ.get("JWT_SECRET", "").strip()
    if not s:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    return s.encode()


def _otp_hash(email: str, code: str) -> str:
    msg = (email.strip().lower() + "|" + code.strip()).encode()
    return hmac.new(_otp_signing_key(), msg, hashlib.sha256).hexdigest()


def _send_email_or_500(*, to_email: str, subject: str, body: str):
    cfg = _smtp_settings_or_none()
    if not cfg:
        raise HTTPException(
            status_code=500,
            detail="SMTP not configured. Set SMTP_HOST/SMTP_PORT/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM.",
        )
    m = EmailMessage()
    m["From"] = cfg["from"]
    m["To"] = to_email
    m["Subject"] = subject
    m.set_content(body)
    try:
        if cfg["tls"]:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
                s.starttls()
                s.login(cfg["user"], cfg["pwd"])
                s.send_message(m)
        else:
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20) as s:
                s.login(cfg["user"], cfg["pwd"])
                s.send_message(m)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email send failed: {type(e).__name__}")


def _send_verification_otp_or_500(*, db: Session, email: str) -> None:
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=10)

    row = EmailOtp(
        email=email.strip().lower(),
        purpose="verify_email",
        code_hash=_otp_hash(email, code),
        expires_at=expires,
        attempts=0,
        consumed_at=None,
    )
    db.add(row)
    try:
        db.commit()
    except OperationalError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Database unavailable")

    _send_email_or_500(
        to_email=email,
        subject="Your OTP for Piyush-Store",
        body=f"Your OTP is: {code}\n\nThis code expires in 10 minutes.\n",
    )


@app.post("/api/auth/request-email-otp", response_model=OtpStatusResponse)
def api_request_email_otp(payload: RequestEmailOtp, db: Session = Depends(get_db)):
    _ensure_tables_or_503()
    email = payload.email.strip().lower()
    # If user doesn't exist, don't reveal it (still respond ok).
    user = db.query(User).filter(User.email == email).first()
    if user and getattr(user, "email_verified", False):
        return OtpStatusResponse(ok=True, detail="Email already verified")
    if user:
        _send_verification_otp_or_500(db=db, email=email)
    return OtpStatusResponse(ok=True, detail="If the email exists, an OTP has been sent")


@app.post("/api/auth/verify-email-otp", response_model=OtpStatusResponse)
def api_verify_email_otp(payload: VerifyEmailOtp, db: Session = Depends(get_db)):
    _ensure_tables_or_503()
    email = payload.email.strip().lower()
    code = payload.code.strip()
    now = datetime.now(timezone.utc)

    user = db.query(User).filter(User.email == email).first()
    if not user:
        return OtpStatusResponse(ok=False, detail="Invalid OTP")

    otp = (
        db.query(EmailOtp)
        .filter(
            EmailOtp.email == email,
            EmailOtp.purpose == "verify_email",
            EmailOtp.consumed_at.is_(None),
        )
        .order_by(EmailOtp.created_at.desc())
        .first()
    )
    if not otp:
        return OtpStatusResponse(ok=False, detail="Invalid OTP")
    if otp.expires_at < now:
        return OtpStatusResponse(ok=False, detail="OTP expired")
    if otp.attempts >= 5:
        return OtpStatusResponse(ok=False, detail="Too many attempts. Request a new OTP.")

    if not hmac.compare_digest(otp.code_hash, _otp_hash(email, code)):
        otp.attempts = int(otp.attempts or 0) + 1
        db.add(otp)
        db.commit()
        return OtpStatusResponse(ok=False, detail="Invalid OTP")

    otp.consumed_at = now
    user.email_verified = True
    db.add_all([otp, user])
    db.commit()
    return OtpStatusResponse(ok=True, detail="Email verified successfully")


@app.get("/api/me", response_model=MeResponse)
def api_me(user: User = Depends(get_current_user)):
    return MeResponse(id=str(user.id), name=user.name, email=user.email)


def _razorpay_keypair_or_500():
    key_id = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not key_secret:
        raise HTTPException(status_code=500, detail="Razorpay keys not configured")
    # Common local-dev mistake: pasting masked secrets like "********"
    # Treat "all non-alnum" (stars/bullets) as masked.
    if not any(ch.isalnum() for ch in key_secret):
        raise HTTPException(status_code=500, detail="Razorpay key secret looks masked; paste the real secret value")
    return key_id, key_secret


def _entitlements_for_user_or_503(db: Session, user: User) -> list[GameEntitlement]:
    """
    Like login/register: if a new model table was added after the DB already had `users`,
    create_all() may not have run for that table yet — handle missing-relation and retry.
    """
    try:
        return db.query(GameEntitlement).filter(GameEntitlement.user_id == user.id).all()
    except ProgrammingError as e:
        if "relation \"game_entitlements\" does not exist" in str(e):
            db.rollback()
            _ensure_tables_or_503()
            return db.query(GameEntitlement).filter(GameEntitlement.user_id == user.id).all()
        raise
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")


def _has_game_entitlement_or_503(db: Session, user: User, game_id: str) -> bool:
    try:
        return (
            db.query(GameEntitlement)
            .filter(GameEntitlement.user_id == user.id, GameEntitlement.game_id == game_id)
            .first()
            is not None
        )
    except ProgrammingError as e:
        if "relation \"game_entitlements\" does not exist" in str(e):
            db.rollback()
            _ensure_tables_or_503()
            return (
                db.query(GameEntitlement)
                .filter(GameEntitlement.user_id == user.id, GameEntitlement.game_id == game_id)
                .first()
                is not None
            )
        raise
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")


@app.get(
    "/api/entitlements",
    dependencies=[Depends(_require_auth_tables)],
)
def api_entitlements(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = _entitlements_for_user_or_503(db, user)
    return {"games": sorted({r.game_id for r in rows})}


@app.post(
    "/api/payments/create-order",
    dependencies=[Depends(_require_auth_tables)],
)
def api_create_order(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    key_id, key_secret = _razorpay_keypair_or_500()

    game_id = (payload.get("game_id") or "").strip()
    if game_id not in PAID_GAMES:
        raise HTTPException(status_code=400, detail="Unknown game")

    if _has_game_entitlement_or_503(db, user, game_id):
        return {"already_unlocked": True, "game_id": game_id}

    try:
        import razorpay  # type: ignore
    except Exception:
        raise HTTPException(status_code=500, detail="razorpay package missing")

    client = razorpay.Client(auth=(key_id, key_secret))
    amount = int(PAID_GAMES[game_id]["amount_paise"])
    # Razorpay receipt max length is 40 characters.
    # Keep it short but still useful for debugging.
    receipt = f"g_{game_id}_{secrets.token_hex(10)}"[:40]
    try:
        order = client.order.create(
            {
                "amount": amount,
                "currency": "INR",
                "receipt": receipt,
                "payment_capture": 1,
                "notes": {"user_id": str(user.id), "game_id": game_id},
            }
        )
    except Exception as e:
        msg = str(e).strip()
        if len(msg) > 240:
            msg = msg[:240] + "…"
        detail = f"Razorpay order failed: {type(e).__name__}"
        if msg:
            detail += f" ({msg})"
        raise HTTPException(status_code=502, detail=detail)

    return {
        "key_id": key_id,
        "order_id": order.get("id"),
        "amount": amount,
        "currency": "INR",
        "game_id": game_id,
        "title": PAID_GAMES[game_id]["title"],
    }


@app.post(
    "/api/payments/verify",
    dependencies=[Depends(_require_auth_tables)],
)
def api_verify_payment(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _, key_secret = _razorpay_keypair_or_500()

    game_id = (payload.get("game_id") or "").strip()
    order_id = (payload.get("razorpay_order_id") or "").strip()
    payment_id = (payload.get("razorpay_payment_id") or "").strip()
    signature = (payload.get("razorpay_signature") or "").strip()

    if game_id not in PAID_GAMES:
        raise HTTPException(status_code=400, detail="Unknown game")
    if not order_id or not payment_id or not signature:
        raise HTTPException(status_code=400, detail="Missing payment fields")

    msg = f"{order_id}|{payment_id}".encode()
    digest = hmac.new(key_secret.encode(), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    def _commit_ent():
        ent = GameEntitlement(
            user_id=user.id,
            game_id=game_id,
            razorpay_order_id=order_id,
            razorpay_payment_id=payment_id,
        )
        db.add(ent)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
        except ProgrammingError as e:
            if "relation \"game_entitlements\" does not exist" in str(e):
                db.rollback()
                _ensure_tables_or_503()
                ent2 = GameEntitlement(
                    user_id=user.id,
                    game_id=game_id,
                    razorpay_order_id=order_id,
                    razorpay_payment_id=payment_id,
                )
                db.add(ent2)
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
            else:
                db.rollback()
                raise
        except OperationalError:
            db.rollback()
            raise HTTPException(status_code=503, detail="Database unavailable")

    _commit_ent()

    return {"ok": True, "game_id": game_id}


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