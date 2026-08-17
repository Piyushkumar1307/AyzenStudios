import asyncio
import json
import logging
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import hmac
import hashlib
import secrets
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import ProgrammingError

from gesture_detector import GestureDetector
from models import HandState
from auth import create_access_token, get_current_user, hash_password, verify_password
from auth_models import Base, EmailOtp, GameEntitlement, GameScore, SoundoraTrack, User
from auth_schemas import (
    ContactRequest,
    LoginRequest,
    MeResponse,
    OtpStatusResponse,
    RegisterRequest,
    RequestEmailOtp,
    SoundoraGenerateRequest,
    SoundoraStatsResponse,
    SoundoraTrackItem,
    SoundoraTrackListResponse,
    TokenResponse,
    VerifyEmailOtp,
)
from db import engine, get_db

logger = logging.getLogger("ayzenstudios")

# --- Password policy ---
def _validate_password_or_400(pw: str) -> None:
    """
    Require:
    - min 6 characters
    - 1 uppercase, 1 lowercase, 1 digit
    """
    s = (pw or "").strip()
    if len(s) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    has_upper = any("A" <= c <= "Z" for c in s)
    has_lower = any("a" <= c <= "z" for c in s)
    has_digit = any("0" <= c <= "9" for c in s)
    if not (has_upper and has_lower and has_digit):
        raise HTTPException(
            status_code=400,
            detail="Password must include 1 uppercase letter, 1 lowercase letter, and 1 number",
        )


# --- OTP policy ---
OTP_EXPIRY_HOURS = 3
OTP_RATE_LIMIT_HOURS = 3

# --- Soundora / Suno API proxy (key must stay server-side only) ---
SUNO_API_BASE = "https://api.sunoapi.org/api/v1"
# Cloudflare on api.sunoapi.org blocks default Python urllib (error 1010) without a browser UA.
SUNO_HTTP_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _otp_rate_limit_or_429(*, db: Session, email: str) -> None:
    """Allow at most one verification OTP per email every OTP_RATE_LIMIT_HOURS."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=OTP_RATE_LIMIT_HOURS)
    latest = (
        db.query(EmailOtp)
        .filter(
            EmailOtp.email == email.strip().lower(),
            EmailOtp.purpose == "verify_email",
            EmailOtp.created_at >= cutoff,
        )
        .order_by(EmailOtp.created_at.desc())
        .first()
    )
    if not latest:
        return
    retry_at = _as_utc(latest.created_at) + timedelta(hours=OTP_RATE_LIMIT_HOURS)
    if retry_at <= now:
        return
    remaining = retry_at - now
    total_minutes = max(1, int(remaining.total_seconds() // 60))
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        wait_msg = f"{hours}h {minutes}m" if minutes else f"{hours} hour{'s' if hours != 1 else ''}"
    else:
        wait_msg = f"{minutes} minute{'s' if minutes != 1 else ''}"
    raise HTTPException(
        status_code=429,
        detail=f"OTP already sent recently. Please wait {wait_msg} before requesting another.",
    )


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
    title="Ayzen Studios",
    description="MediaPipe hand gesture API for Unity",
    version="1.0.0",
    lifespan=lifespan
)

def _cors_origins() -> list[str]:
    """Comma-separated FRONTEND_ORIGINS for Netlify/custom domain; default * for local dev."""
    raw = os.environ.get("FRONTEND_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return ["*"]


def _cors_middleware_kwargs() -> dict:
    origins = _cors_origins()
    kwargs: dict = {
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if origins == ["*"]:
        kwargs["allow_origins"] = ["*"]
        return kwargs
    kwargs["allow_origins"] = origins
    # Any Netlify preview/production subdomain (e.g. ayzen-studios vs piyush-store).
    if os.environ.get("CORS_ALLOW_NETLIFY", "1").strip().lower() in ("1", "true", "yes"):
        kwargs["allow_origin_regex"] = (
            r"https://[a-zA-Z0-9][a-zA-Z0-9-]*\.netlify\.app"
            r"|http://(localhost|127\.0\.0\.1)(:\d+)?"
        )
    return kwargs


# Allow Unity (localhost), Netlify static site, and legacy same-origin Render HTML
app.add_middleware(CORSMiddleware, **_cors_middleware_kwargs())

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML = os.path.join(BASE_DIR, "static", "index.html")
GAMES_HTML = os.path.join(BASE_DIR, "static", "games.html")
GAME_INSTRUCTIONS_HTML = os.path.join(BASE_DIR, "static", "game-instructions.html")
GAME_HTML = os.path.join(BASE_DIR, "static", "game.html")
PUZZLE_HTML = os.path.join(BASE_DIR, "static", "puzzle.html")
RUNNER_HTML = os.path.join(BASE_DIR, "static", "runner.html")
TICTACTOE_HTML = os.path.join(BASE_DIR, "static", "tictactoe.html")
TRAFFIC_HTML = os.path.join(BASE_DIR, "static", "traffic.html")
TEMPLE_RUN_HTML = os.path.join(BASE_DIR, "static", "temple-run.html")
LOGIN_HTML = os.path.join(BASE_DIR, "static", "login.html")
PROFILE_HTML = os.path.join(BASE_DIR, "static", "profile.html")
LEADERBOARD_HTML = os.path.join(BASE_DIR, "static", "leaderboard.html")
HOLO_HTML = os.path.join(BASE_DIR, "static", "holo.html")
KAMEHAMEHA_HTML = os.path.join(BASE_DIR, "static", "kamehameha.html")
SLINGSHOT_HTML = os.path.join(BASE_DIR, "static", "slingshot.html")
WEBGL_HTML = os.path.join(BASE_DIR, "static", "webgl.html")
WEBGL_PLAY_HTML = os.path.join(BASE_DIR, "static", "webgl-play.html")
FACE_SWAP_HTML = os.path.join(BASE_DIR, "static", "face-swap.html")
WEBAR_HTML = os.path.join(BASE_DIR, "static", "webar.html")
PHOTOBOOTH_HTML = os.path.join(BASE_DIR, "static", "photobooth.html")
GEO_REGISTRATION_HTML = os.path.join(BASE_DIR, "static", "geo-registration.html")
QUIZ_MASTER_HTML = os.path.join(BASE_DIR, "static", "quiz-master.html")
SOUNDORA_HTML = os.path.join(BASE_DIR, "static", "soundora.html")
CONTROLLER_HTML = os.path.join(BASE_DIR, "static", "controller.html")
SUPPORT_HTML = os.path.join(BASE_DIR, "static", "support.html")
TERMS_HTML = os.path.join(BASE_DIR, "static", "terms.html")
REFUNDS_HTML = os.path.join(BASE_DIR, "static", "refunds.html")
PRIVACY_HTML = os.path.join(BASE_DIR, "static", "privacy.html")
FAVICON_SVG = os.path.join(BASE_DIR, "static", "favicon.svg")
FAVICON_VERSION = "4"


def _favicon_response() -> FileResponse:
    return FileResponse(
        FAVICON_SVG,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "no-cache, must-revalidate",
            "X-Favicon-Version": FAVICON_VERSION,
        },
    )


@app.get("/favicon.svg")
@app.get("/favicon.ico")
def favicon():
    """Browsers often request /favicon.ico directly (ignores HTML link tags)."""
    return _favicon_response()


# --- Store / Razorpay config ---
PAID_GAMES: dict[str, dict] = {}

# If set, skip all entitlement checks (dev / demo mode).
# This ensures UI and gameplay consistently show all games as unlocked.
UNLOCK_ALL_GAMES = os.environ.get("UNLOCK_ALL_GAMES", "1").strip().lower() in ("1", "true", "yes")

FREE_GAMES = {
    # category:
    # - "gesture-games": leaderboard enabled
    # - "gesture-effect": no leaderboard
    "fruit_ninja": {"route": "/game", "title": "Fruit-Ninja", "category": "gesture-games", "leaderboard": True},
    "neon_pop": {"route": "/puzzle", "title": "Neon Pop", "category": "gesture-games", "leaderboard": True},
    "neon_runner": {"route": "/runner", "title": "Neon Runner", "category": "gesture-games", "leaderboard": True},
    "tictactoe": {"route": "/tictactoe", "title": "Neon Tic-Tac-Toe", "category": "gesture-games", "leaderboard": False},
    "traffic": {"route": "/traffic", "title": "Traffic Rush", "category": "gesture-games", "leaderboard": True},
    "temple_lean_run": {"route": "/temple-run", "title": "Temple Lean Run", "category": "gesture-games", "leaderboard": False},
    "sky_sling_birds": {"route": "/slingshot", "title": "Sky Sling Birds", "category": "gesture-games", "leaderboard": True},
    "holo": {"route": "/holo", "title": "Holo Hand FX", "category": "gesture-effect", "leaderboard": False},
    "kamehameha": {"route": "/kamehameha", "title": "Kamehameha Beam", "category": "gesture-effect", "leaderboard": False},
}


def _paid_game_meta(game_id: str) -> dict:
    meta = PAID_GAMES[game_id]
    return {
        "route": meta["route"],
        "title": meta["title"],
        "amount_paise": meta["amount_paise"],
        "category": "gesture-games",
        "leaderboard": game_id != "tictactoe",
    }


def _game_meta_or_none(game_id: str) -> dict | None:
    gid = (game_id or "").strip()
    if gid in FREE_GAMES:
        return FREE_GAMES[gid]
    if gid in PAID_GAMES:
        return _paid_game_meta(gid)
    return None

@app.get("/")
def index():
    return FileResponse(INDEX_HTML)

@app.get("/index")
def index_alt():
    """Same page as `/` — some people expect `/index` in the URL bar."""
    return FileResponse(INDEX_HTML)


@app.get("/games")
def games_catalog():
    """Gesture games & AI tools catalog (requires login in-page)."""
    return FileResponse(GAMES_HTML)


@app.get("/game-instructions")
def game_instructions():
    """Pre-game setup wizard (webcam + controls) before launching a gesture game."""
    return FileResponse(GAME_INSTRUCTIONS_HTML)


@app.get("/marketplace")
def marketplace():
    """Back-compat alias for the games catalog."""
    return FileResponse(GAMES_HTML)


@app.get("/store")
def store_alias():
    """Back-compat alias for the games catalog."""
    return FileResponse(GAMES_HTML)


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

@app.get("/traffic")
def traffic():
    return FileResponse(TRAFFIC_HTML)

@app.get("/temple-run")
def temple_run():
    return FileResponse(TEMPLE_RUN_HTML)

@app.get("/login")
def login_page():
    return FileResponse(LOGIN_HTML)

@app.get("/profile")
def profile_page():
    return FileResponse(PROFILE_HTML)

@app.get("/leaderboard")
def leaderboard_page():
    return FileResponse(LEADERBOARD_HTML)

@app.get("/holo")
def holo_page():
    return FileResponse(HOLO_HTML)

@app.get("/kamehameha")
def kamehameha_page():
    return FileResponse(KAMEHAMEHA_HTML)

@app.get("/slingshot")
def slingshot_page():
    return FileResponse(SLINGSHOT_HTML)


@app.get("/webgl")
def webgl_catalog_page():
    return FileResponse(WEBGL_HTML)


@app.get("/webgl-play")
def webgl_play_page():
    return FileResponse(WEBGL_PLAY_HTML)


@app.get("/face-swap")
def face_swap_page():
    return FileResponse(FACE_SWAP_HTML)


@app.get("/webar")
def webar_page():
    return FileResponse(WEBAR_HTML)


@app.get("/photobooth")
def photobooth_page():
    return FileResponse(PHOTOBOOTH_HTML)


@app.get("/geo-registration")
def geo_registration_page():
    return FileResponse(GEO_REGISTRATION_HTML)


@app.get("/quiz-master")
@app.get("/kbc-quiz")
def quiz_master_page():
    return FileResponse(QUIZ_MASTER_HTML)


@app.get("/soundora")
def soundora_page():
    return FileResponse(SOUNDORA_HTML)


@app.get("/controller")
def phone_controller_page():
    return FileResponse(CONTROLLER_HTML)


@app.get("/support")
def support_page():
    return FileResponse(SUPPORT_HTML)

@app.get("/terms")
def terms_page():
    return FileResponse(TERMS_HTML)

@app.get("/refunds")
def refunds_page():
    return FileResponse(REFUNDS_HTML)

@app.get("/privacy")
def privacy_page():
    return FileResponse(PRIVACY_HTML)


@app.get("/api/public-config")
def public_config():
    """Public config for the static frontend (no secrets)."""
    contact_url = _env_str("CONTACT_API_URL")
    api_base = _env_str("PUBLIC_API_BASE") or _env_str("SPOOKY_API_BASE")
    return {
        "contact_api_url": contact_url or None,
        "api_base_url": api_base or None,
        "brand": "Ayzen Studios",
        "soundora_configured": bool(_env_str("SUNO_API_KEY")),
        "bot_configured": bool(_env_str("NVIDIA_API_KEY") or _env_str("OPENROUTER_API_KEY")),
    }


# --- AYZEN Bot (NVIDIA NIM / Nemotron 3.5 Lightning) ---
from pydantic import BaseModel, Field


class BotChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=2000)


class BotChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)
    history: list[BotChatMessage] = Field(default_factory=list, max_length=20)


AYZEN_BOT_SYSTEM = """You are AYZEN Bot — a helpful live chat assistant on the Ayzen Studios website.

Tone: warm, clear, conversational. Short paragraphs. Ask a follow-up when useful. At most 1–2 light emojis.

Help with Ayzen products, demos, hiring/quotes (never invent fixed prices), games, and support basics.
Never invent prices, fake clients, or claim you can run demos inside this chat.

When mentioning a product, include its path:
- Gesture games: /games
- WebGL + phone controller: /webgl
- Soundora (AI music; typos like "sounder" count): /soundora
- Face Swap Studio: /face-swap
- Web AR: /webar
- PhotoBooth AI: /photobooth
- Geo-Fenced Registration: /geo-registration
- Quiz Master (KBC-style quiz): /quiz-master
Also: Play Store /#playstore, Leaderboard /leaderboard, Login /login, Support /support, Contact /#contact
WhatsApp https://wa.me/919205726749 · Telegram https://t.me/ayzenstudios

If asked what powers you: AYZEN Bot powered by NVIDIA Nemotron 3.5 Lightning.

CRITICAL: Reply with ONLY the final chat message to the user. No JSON. No thinking, planning, drafts, analysis labels, or product-list dumps.
"""


def _looks_like_reasoning(text: str) -> bool:
    import re

    return bool(
        re.search(
            r"(check rules|formulate response|final output|self-correction|thinking process|"
            r"analyze user|identify role|draft response|constraints?:|numbered analysis|"
            r"output generation|verification during thought|\*\*check rules|\*\*formulate|"
            r"here's a thinking|chain[- ]of[- ]thought)",
            text or "",
            flags=re.I,
        )
    )


def _is_placeholder_reply(text: str) -> bool:
    import re

    s = (text or "").strip()
    if not s:
        return True
    if re.search(r"<\s*(your|user|chat|message|reply|text|response)[^>]*>", s, flags=re.I):
        return True
    if re.fullmatch(r"\.+|…+", s):
        return True
    return False


def _is_truncated_reply(text: str) -> bool:
    import re

    s = (text or "").strip()
    if len(s) < 12:
        return True
    # Cut off mid-phrase / mid-parenthesis / dangling connector
    if re.search(r"\b(as|to|for|and|or|with|the|a|an|at|of|in)\s*$", s, flags=re.I):
        return True
    if s.endswith(("(", "[", "{", ",", ";", "—", "-", "/", "...", "…")):
        return True
    if s.count('"') % 2 == 1:
        return True
    # Too vague / incomplete for a product answer
    if len(s) < 40 and s.endswith("?"):
        return True
    return False


def _is_prompt_leak(text: str) -> bool:
    import re

    s = (text or "").strip()
    if not s:
        return False
    if re.search(
        r"(products\s*\(include path|output format \(mandatory\)|ayzen_bot_system|"
        r"return only (a )?json|known paths:|tone:\s*warm|when mentioning a product)",
        s,
        flags=re.I,
    ):
        return True
    # Bullet dump of internal product map
    if s.count("→ /") >= 1 and not re.search(r"[.!?]", s):
        return True
    if s.count("→ /") >= 2 or s.count("-> /") >= 2:
        return True
    if re.match(r"^products\b", s, flags=re.I):
        return True
    return False


def _reply_unusable(text: str) -> bool:
    return (
        not (text or "").strip()
        or _looks_like_reasoning(text)
        or _is_placeholder_reply(text)
        or _is_truncated_reply(text)
        or _is_prompt_leak(text)
        or len((text or "").strip()) > 700
    )


def _missing_expected_product(user_msg: str, reply: str) -> bool:
    """True when the user asked about a known product but the reply never names it."""
    um = (user_msg or "").lower()
    rl = (reply or "").lower()
    expectations: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
        (("sounder", "soundora"), ("soundora", "/soundora")),
        (("photobooth", "photo booth"), ("photobooth", "/photobooth", "photo booth")),
        (("web ar", "webar"), ("web ar", "webar", "/webar", "augmented")),
        (("face swap",), ("face swap", "/face-swap")),
        (("geo", "geofenc"), ("geo", "/geo-registration", "geofenc")),
        (("quiz", "kbc", "crorepati"), ("quiz", "/quiz-master", "kbc")),
        (("gesture", "games"), ("gesture", "/games", "game")),
    ]
    for triggers, must_any in expectations:
        if any(t in um for t in triggers):
            if not any(m in rl for m in must_any):
                return True
    return False


def _extract_json_reply(text: str) -> str | None:
    import re

    s = (text or "").strip()
    if not s:
        return None
    # fenced json
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s, flags=re.I)
    if fence:
        s = fence.group(1)
    # first {...} object
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except Exception:
        # try last reply-looking string field
        rm = re.search(r'"reply"\s*:\s*"((?:\\.|[^"\\])*)"', s)
        if rm:
            try:
                return json.loads('"' + rm.group(1) + '"')
            except Exception:
                return rm.group(1).encode("utf-8").decode("unicode_escape")
        return None
    reply = data.get("reply") if isinstance(data, dict) else None
    if isinstance(reply, str) and reply.strip():
        return reply.strip()
    return None


def _strip_model_thinking(text: str) -> str:
    """Keep only the user-facing chat reply from noisy Nemotron outputs."""
    import re

    s = (text or "").strip()
    if not s:
        return s

    # Preferred: JSON {"reply":"..."} when present
    extracted = _extract_json_reply(s)
    if extracted and not _reply_unusable(extracted):
        return extracted

    s = re.sub(r"<think>[\s\S]*?</think>", "", s, flags=re.I).strip()
    s = re.sub(r"<thinking>[\s\S]*?</thinking>", "", s, flags=re.I).strip()

    # Quoted final messages (common in leaked CoT)
    quotes = re.findall(r'"([^"\n]{25,400})"', s)
    for q in reversed(quotes):
        q = q.strip()
        if _looks_like_reasoning(q):
            continue
        if re.search(r"soundora|/soundora|photobooth|web ar|ayzen|gesture|whatsapp", q, flags=re.I):
            return q
        if not re.search(r"^\d+\.|check rules|formulate|draft", q, flags=re.I):
            # prefer last quote that looks like a chat reply
            if "?" in q or "!" in q or q.endswith("."):
                return q
    if quotes:
        last = quotes[-1].strip()
        if last and not _looks_like_reasoning(last):
            return last

    for pat in (
        r"(?:Final\s+(?:decision|answer|output)|Output)\s*:\s*[\"']?(.+?)[\"']?\s*$",
        r'Draft(?:\s+Response)?\s*:\s*"([^"]+)"',
        r"Draft(?:\s+Response)?\s*:\s*(.+)$",
    ):
        m = re.search(pat, s, flags=re.I | re.S)
        if m:
            out = m.group(1).strip().strip('"').strip()
            if len(out) > 15 and not _looks_like_reasoning(out):
                return out

    # Drop meta / planning lines, keep conversational leftovers
    keep: list[str] = []
    for line in s.splitlines():
        if re.match(
            r"^\s*(\d+\.|[-*•]|✅|->|→)\s*",
            line,
        ) and re.search(
            r"check|rule|formul|draft|analy|identif|determin|constraint|strategy|output|verification|assume|proceed|self-correction",
            line,
            flags=re.I,
        ):
            continue
        if _looks_like_reasoning(line) and len(line) < 220:
            continue
        if re.match(r"^\s*(wait,|actually,|let'?s |re-reading|self-correction)", line, flags=re.I):
            continue
        keep.append(line)
    cleaned = "\n".join(keep).strip()
    if cleaned and not _looks_like_reasoning(cleaned):
        return cleaned.strip().strip('"')

    # Last non-meta paragraph
    parts = [p.strip() for p in re.split(r"\n{2,}", s) if p.strip()]
    for part in reversed(parts):
        if _looks_like_reasoning(part):
            continue
        if len(part) > 20:
            return part.strip().strip('"')

    if extracted:
        return extracted
    return s.strip().strip('"')


NVIDIA_BOT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
NVIDIA_BOT_BASE_URL = "https://integrate.api.nvidia.com/v1"
OPENROUTER_BOT_MODEL = "nvidia/nemotron-3.5-lightning:free"
OPENROUTER_BOT_BASE_URL = "https://openrouter.ai/api/v1"
_bot_openai_client = None
_bot_openai_client_sig = None


def _bot_llm_config() -> tuple[str, str, str, str]:
    """Return (provider, api_key, base_url, model). OpenRouter keys may be pasted as NVIDIA_API_KEY."""
    nvidia = _env_str("NVIDIA_API_KEY")
    openrouter = _env_str("OPENROUTER_API_KEY")
    if nvidia and nvidia.startswith("sk-or-"):
        openrouter = nvidia
        nvidia = ""
    if nvidia:
        return (
            "nvidia",
            nvidia,
            NVIDIA_BOT_BASE_URL,
            _env_str("NVIDIA_MODEL") or NVIDIA_BOT_MODEL,
        )
    if openrouter:
        return (
            "openrouter",
            openrouter,
            OPENROUTER_BOT_BASE_URL,
            _env_str("OPENROUTER_MODEL") or OPENROUTER_BOT_MODEL,
        )
    raise HTTPException(
        status_code=503,
        detail="Chat bot is not configured. Set NVIDIA_API_KEY or OPENROUTER_API_KEY and redeploy.",
    )


def _bot_model_name() -> str:
    try:
        return _bot_llm_config()[3]
    except HTTPException:
        return NVIDIA_BOT_MODEL


def _bot_client():
    """OpenAI-compatible client for NVIDIA NIM or OpenRouter. Key stays server-side."""
    global _bot_openai_client, _bot_openai_client_sig
    provider, key, base_url, _model = _bot_llm_config()
    sig = (provider, key, base_url)
    if _bot_openai_client is None or _bot_openai_client_sig != sig:
        import httpx
        from openai import OpenAI

        verify: bool | str = True
        try:
            import certifi

            verify = certifi.where()
        except Exception:
            pass
        timeout = httpx.Timeout(60.0)
        headers = {}
        if provider == "openrouter":
            headers = {
                "HTTP-Referer": "https://ayzenstudios.com",
                "X-Title": "Ayzen Studios Bot",
            }
        _bot_openai_client = OpenAI(
            base_url=base_url,
            api_key=key,
            timeout=60.0,
            default_headers=headers or None,
            http_client=httpx.Client(verify=verify, timeout=timeout),
        )
        _bot_openai_client_sig = sig
    return _bot_openai_client


def _nvidia_chat(messages: list[dict]) -> str:
    """Stream Nemotron; keep only visible content (drop reasoning_content)."""
    provider, _key, _base, model = _bot_llm_config()
    client = _bot_client()
    extra_body: dict = {}
    if provider == "nvidia":
        extra_body = {"chat_template_kwargs": {"enable_thinking": False}}
    elif provider == "openrouter":
        extra_body = {"reasoning": {"exclude": True}}
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.6,
            top_p=0.95,
            max_tokens=1024,
            extra_body=extra_body or None,
            stream=True,
        )
        parts: list[str] = []
        for chunk in completion:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if getattr(delta, "content", None):
                parts.append(delta.content)
        content = "".join(parts).strip()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Bot LLM error (%s): %s: %s", provider, type(e).__name__, e)
        raise HTTPException(
            status_code=502,
            detail="The assistant is temporarily unavailable. Try again or WhatsApp us.",
        ) from e
    if not content:
        raise HTTPException(status_code=502, detail="Empty assistant response.")
    return _strip_model_thinking(content)


@app.post("/api/bot/chat")
async def bot_chat(body: BotChatRequest):
    """AYZEN Bot chat via NVIDIA Nemotron. Key stays server-side."""
    user_msg = (body.message or "").strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="Message is required.")

    messages: list[dict] = [{"role": "system", "content": AYZEN_BOT_SYSTEM}]
    for m in body.history[-12:]:
        role = (m.role or "").strip()
        content = (m.content or "").strip()
        if role in ("user", "assistant") and content:
            if role == "assistant" and _reply_unusable(content):
                continue
            messages.append({"role": role, "content": content[:1500]})
    messages.append({"role": "user", "content": user_msg})

    reply = await asyncio.to_thread(_nvidia_chat, messages)
    reply = (reply or "").strip()
    if _reply_unusable(reply) or _missing_expected_product(user_msg, reply):
        extracted = _extract_json_reply(reply)
        if (
            extracted
            and not _reply_unusable(extracted)
            and not _missing_expected_product(user_msg, extracted)
        ):
            reply = extracted.strip()
        else:
            reply = (_strip_model_thinking(reply) or "").strip()
    if _reply_unusable(reply) or _missing_expected_product(user_msg, reply):
        plain_messages = [
            {
                "role": "system",
                "content": (
                    "You are AYZEN Bot. Write 1–3 complete chat sentences that answer the user. "
                    "Name the product and include its path. No JSON/thinking/drafts. "
                    "Soundora=/soundora (sounder typo ok), PhotoBooth=/photobooth, "
                    "Web AR=/webar, games=/games, Face Swap=/face-swap, geo=/geo-registration, "
                    "Quiz Master=/quiz-master (KBC quiz)."
                ),
            },
            {"role": "user", "content": user_msg},
        ]
        reply = await asyncio.to_thread(_nvidia_chat, plain_messages)
        reply = (_strip_model_thinking(reply) or "").strip()
    if _reply_unusable(reply) or _missing_expected_product(user_msg, reply):
        raise HTTPException(
            status_code=502,
            detail="The assistant returned an unusable reply. Please try again.",
        )
    return {
        "reply": reply,
        "model": _bot_model_name(),
    }


def _suno_api_key_or_503() -> str:
    key = _env_str("SUNO_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Soundora is not configured. Set SUNO_API_KEY on Render and redeploy.",
        )
    return key


def _suno_ssl_context() -> ssl.SSLContext:
    """Use certifi CA bundle (fixes macOS Python.org SSL verify failures)."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _suno_upstream_request(
    *,
    method: str,
    path: str,
    query: str,
    body: bytes,
    content_type: str | None,
) -> tuple[int, bytes, str]:
    subpath = path.lstrip("/")
    url = f"{SUNO_API_BASE}/{subpath}" if subpath else SUNO_API_BASE
    if query:
        url = f"{url}?{query}"
    headers = {
        "Authorization": f"Bearer {_suno_api_key_or_503()}",
        "Accept": "application/json, */*",
        "User-Agent": SUNO_HTTP_USER_AGENT,
    }
    if body:
        headers["Content-Type"] = content_type or "application/json"
    req = urllib.request.Request(
        url,
        data=body if body else None,
        headers=headers,
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=120, context=_suno_ssl_context()) as resp:
            media_type = resp.headers.get_content_type() or "application/json"
            return resp.status, resp.read(), media_type
    except urllib.error.HTTPError as e:
        err_body = e.read()
        media_type = "application/json"
        if e.headers:
            media_type = e.headers.get_content_type() or media_type
        logger.warning("Suno API HTTP %s for %s %s", e.code, method, subpath)
        return e.code, err_body, media_type
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        logger.exception("Suno proxy failed for %s %s: %s", method, subpath, e)
        if isinstance(reason, ssl.SSLError):
            raise HTTPException(
                status_code=502,
                detail="Could not reach Suno API (SSL certificate error on this machine).",
            )
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Suno API ({reason}).",
        )
    except Exception as e:
        logger.exception("Suno proxy failed for %s %s: %s", method, subpath, e)
        raise HTTPException(
            status_code=502,
            detail=f"Soundora upstream error ({type(e).__name__}).",
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
        conn.execute(
            text(
                "ALTER TABLE users "
                "ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE users "
                "ADD COLUMN IF NOT EXISTS soundora_max_tracks INTEGER"
            )
        )


def _ensure_tables_or_503():
    try:
        _ensure_auth_tables()
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")


def _require_auth_tables() -> None:
    """
    Run before get_current_user on auth routes.
    If we open a session and SELECT users first, then _migrate_auth_schema() runs
    ALTER TABLE users on another connection, Postgres can block or time out
    (statement_timeout) while the ORM still holds a transaction.
    """
    _ensure_tables_or_503()


@app.get("/api/soundora/status")
def soundora_status():
    """Check Soundora proxy is configured (never exposes the API key)."""
    return {
        "configured": bool(_env_str("SUNO_API_KEY")),
        "max_tracks": _soundora_max_tracks(),
    }


def _soundora_max_tracks() -> int:
    raw = _env_str("SOUNDORA_MAX_TRACKS") or "3"
    try:
        return max(1, min(int(raw), 500))
    except Exception:
        return 3


def _user_soundora_max_tracks(user: User) -> int:
    """Per-user override on users.soundora_max_tracks, else global SOUNDORA_MAX_TRACKS."""
    override = getattr(user, "soundora_max_tracks", None)
    if override is not None and override > 0:
        return min(int(override), 500)
    return _soundora_max_tracks()


def _purge_incomplete_soundora_tracks(db: Session, user_id: uuid.UUID) -> int:
    """Remove pending/failed demo clutter; keep completed and in-flight processing."""
    deleted = (
        db.query(SoundoraTrack)
        .filter(
            SoundoraTrack.user_id == user_id,
            SoundoraTrack.status.in_(("pending", "failed")),
        )
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
    return deleted


def _completed_soundora_count(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.query(SoundoraTrack)
        .filter(SoundoraTrack.user_id == user_id, SoundoraTrack.status == "completed")
        .count()
    )


def _processing_soundora_count(db: Session, user_id: uuid.UUID) -> int:
    return (
        db.query(SoundoraTrack)
        .filter(SoundoraTrack.user_id == user_id, SoundoraTrack.status == "processing")
        .count()
    )


def _soundora_callback_url() -> str:
    base = _env_str("PUBLIC_API_BASE") or _env_str("SPOOKY_API_BASE") or "https://piyush-store.onrender.com"
    return base.rstrip("/") + "/api/soundora/webhook"


def _suno_json_request(
    *,
    method: str,
    path: str,
    query: str = "",
    body: dict | None = None,
) -> tuple[int, dict]:
    payload = json.dumps(body).encode("utf-8") if body is not None else b""
    status, resp_body, _ = _suno_upstream_request(
        method=method,
        path=path,
        query=query,
        body=payload,
        content_type="application/json" if body is not None else None,
    )
    try:
        data = json.loads(resp_body.decode("utf-8"))
    except Exception:
        data = {"raw": resp_body.decode("utf-8", errors="replace")[:500]}
    return status, data


def _extract_suno_clips(data: dict) -> list[dict]:
    """Pull audio clip objects from varied Suno record-info payloads."""
    clips: list[dict] = []
    root = data.get("data") if isinstance(data, dict) else None
    if not isinstance(root, dict):
        return clips
    response = root.get("response")
    if isinstance(response, dict):
        for key in ("sunoData", "data", "clips", "tracks"):
            val = response.get(key)
            if isinstance(val, list):
                clips.extend([c for c in val if isinstance(c, dict)])
    if not clips and isinstance(response, list):
        clips.extend([c for c in response if isinstance(c, dict)])
    return clips


def _clip_audio_url(clip: dict) -> str | None:
    for key in ("audioUrl", "audio_url", "sourceAudioUrl", "source_audio_url", "streamAudioUrl"):
        val = clip.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _clip_image_url(clip: dict) -> str | None:
    for key in ("imageUrl", "image_url", "sourceImageUrl", "coverUrl"):
        val = clip.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _track_to_item(row: SoundoraTrack) -> SoundoraTrackItem:
    created = row.created_at.isoformat() if row.created_at else ""
    completed = row.completed_at.isoformat() if row.completed_at else None
    display_title = (row.title or "").strip() or (row.prompt[:60] + ("…" if len(row.prompt) > 60 else ""))
    return SoundoraTrackItem(
        id=str(row.id),
        prompt=row.prompt,
        style=row.style or "",
        title=display_title,
        status=row.status,
        audio_url=row.audio_url,
        image_url=row.image_url,
        error_message=row.error_message,
        created_at=created,
        completed_at=completed,
    )


def _refresh_soundora_track_from_suno(db: Session, track: SoundoraTrack) -> SoundoraTrack:
    if track.status in ("completed", "failed") or not track.suno_task_id:
        return track
    status, data = _suno_json_request(
        method="GET",
        path="generate/record-info",
        query=f"taskId={urllib.parse.quote(track.suno_task_id, safe='')}",
    )
    if status >= 400:
        track.status = "failed"
        track.error_message = f"Suno status check failed (HTTP {status})"
        track.completed_at = datetime.now(timezone.utc)
        db.add(track)
        db.commit()
        db.refresh(track)
        return track

    root = data.get("data") if isinstance(data, dict) else {}
    task_status = str((root or {}).get("status") or "").upper()
    if task_status in ("PENDING", "PROCESSING", "TEXT_SUCCESS", "FIRST_SUCCESS", "RUNNING"):
        track.status = "processing"
        db.add(track)
        db.commit()
        db.refresh(track)
        return track

    if task_status in ("FAILED", "ERROR", "CREATE_TASK_FAILED"):
        track.status = "failed"
        track.error_message = str((root or {}).get("errorMessage") or "Generation failed")
        track.completed_at = datetime.now(timezone.utc)
        db.add(track)
        db.commit()
        db.refresh(track)
        return track

    clips = _extract_suno_clips(data)
    audio = _clip_audio_url(clips[0]) if clips else None
    if task_status == "SUCCESS" and audio:
        track.status = "completed"
        track.audio_url = audio
        track.image_url = _clip_image_url(clips[0]) if clips else track.image_url
        if clips and not track.title:
            clip_title = clips[0].get("title")
            if isinstance(clip_title, str) and clip_title.strip():
                track.title = clip_title.strip()[:200]
        track.completed_at = datetime.now(timezone.utc)
        track.error_message = None
    elif task_status == "SUCCESS":
        track.status = "processing"
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


def _require_verified_user(user: User) -> None:
    if not getattr(user, "email_verified", False):
        raise HTTPException(status_code=403, detail="Email not verified. Please verify via OTP.")


@app.get(
    "/api/soundora/stats",
    response_model=SoundoraStatsResponse,
    dependencies=[Depends(_require_auth_tables)],
)
def soundora_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_verified_user(user)
    _purge_incomplete_soundora_tracks(db, user.id)
    completed = _completed_soundora_count(db, user.id)
    processing = _processing_soundora_count(db, user.id)
    return SoundoraStatsResponse(
        total_generated=completed,
        completed=completed,
        processing=processing,
        max_tracks=_user_soundora_max_tracks(user),
    )


@app.get(
    "/api/soundora/tracks",
    response_model=SoundoraTrackListResponse,
    dependencies=[Depends(_require_auth_tables)],
)
def soundora_list_tracks(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_verified_user(user)
    _purge_incomplete_soundora_tracks(db, user.id)
    rows = (
        db.query(SoundoraTrack)
        .filter(
            SoundoraTrack.user_id == user.id,
            SoundoraTrack.status.in_(("completed", "processing")),
        )
        .order_by(SoundoraTrack.created_at.desc())
        .limit(100)
        .all()
    )
    items: list[SoundoraTrackItem] = []
    for row in rows:
        if row.status == "processing":
            row = _refresh_soundora_track_from_suno(db, row)
            if row.status == "failed":
                db.delete(row)
                db.commit()
                continue
        if row.status == "completed":
            items.append(_track_to_item(row))
        elif row.status == "processing":
            items.append(_track_to_item(row))
    total = _completed_soundora_count(db, user.id)
    return SoundoraTrackListResponse(tracks=items, total_generated=total)


@app.get(
    "/api/soundora/tracks/{track_id}",
    response_model=SoundoraTrackItem,
    dependencies=[Depends(_require_auth_tables)],
)
def soundora_get_track(
    track_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_verified_user(user)
    try:
        tid = uuid.UUID(track_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Track not found")
    row = (
        db.query(SoundoraTrack)
        .filter(SoundoraTrack.id == tid, SoundoraTrack.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    if row.status == "processing":
        row = _refresh_soundora_track_from_suno(db, row)
    return _track_to_item(row)


def _safe_audio_filename(title: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in " -_" else "" for c in (title or "").strip())
    return (cleaned[:80].strip() or "soundora-track") + ".mp3"


def _fetch_external_audio(url: str) -> tuple[bytes, str]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": SUNO_HTTP_USER_AGENT, "Accept": "*/*"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=120, context=_suno_ssl_context()) as resp:
        body = resp.read()
        media_type = resp.headers.get_content_type() or "audio/mpeg"
        return body, media_type


@app.get(
    "/api/soundora/tracks/{track_id}/download",
    dependencies=[Depends(_require_auth_tables)],
)
def soundora_download_track(
    track_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Proxy audio with Content-Disposition so browsers save instead of opening the CDN URL."""
    _require_verified_user(user)
    try:
        tid = uuid.UUID(track_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Track not found")
    row = (
        db.query(SoundoraTrack)
        .filter(SoundoraTrack.id == tid, SoundoraTrack.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
    if row.status != "completed" or not row.audio_url:
        raise HTTPException(status_code=404, detail="Track not ready for download")
    try:
        audio_bytes, media_type = _fetch_external_audio(row.audio_url)
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Audio host returned HTTP {e.code}")
    except Exception:
        raise HTTPException(status_code=502, detail="Could not fetch audio file")
    filename = _safe_audio_filename(_track_to_item(row).title)
    return Response(
        content=audio_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@app.post(
    "/api/soundora/tracks/generate",
    response_model=SoundoraTrackItem,
    status_code=201,
    dependencies=[Depends(_require_auth_tables)],
)
def soundora_generate_track(
    payload: SoundoraGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_verified_user(user)
    if not _env_str("SUNO_API_KEY"):
        raise HTTPException(status_code=503, detail="Soundora is not configured on the server.")

    _purge_incomplete_soundora_tracks(db, user.id)
    max_tracks = _user_soundora_max_tracks(user)
    completed = _completed_soundora_count(db, user.id)
    if completed >= max_tracks:
        raise HTTPException(
            status_code=429,
            detail=f"Demo limit reached ({max_tracks} songs). Download your tracks or contact support.",
        )
    if _processing_soundora_count(db, user.id) > 0:
        raise HTTPException(
            status_code=429,
            detail="A song is still generating. Please wait for it to finish.",
        )

    prompt = payload.prompt.strip()
    style = payload.style.strip()
    full_prompt = prompt if not style else f"{prompt}. Style: {style}"

    track = SoundoraTrack(
        user_id=user.id,
        prompt=prompt,
        style=style,
        title=(payload.title.strip()[:200] if payload.title else ""),
        status="pending",
    )
    db.add(track)
    try:
        db.commit()
    except OperationalError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Database unavailable")
    db.refresh(track)

    suno_body = {
        "prompt": full_prompt,
        "customMode": False,
        "instrumental": payload.instrumental,
        "model": _env_str("SUNO_MODEL") or "V4_5ALL",
        "callBackUrl": _soundora_callback_url(),
    }
    status, data = _suno_json_request(method="POST", path="generate", body=suno_body)
    task_id = None
    if isinstance(data, dict):
        inner = data.get("data")
        if isinstance(inner, dict):
            task_id = inner.get("taskId") or inner.get("task_id")

    if status >= 400 or not task_id:
        raw = str(data.get("raw") or "") if isinstance(data, dict) else ""
        if status == 403 and "1010" in raw:
            err = "Suno API blocked this server (Cloudflare). Retry after redeploy."
        else:
            err = (
                str(data.get("msg") or data.get("message") or f"Suno rejected the request (HTTP {status})")
                if isinstance(data, dict)
                else f"Suno rejected the request (HTTP {status})"
            )
        db.delete(track)
        db.commit()
        raise HTTPException(status_code=502, detail=err)

    track.suno_task_id = str(task_id)
    track.status = "processing"
    db.add(track)
    db.commit()
    db.refresh(track)
    return _track_to_item(track)


@app.post("/api/soundora/webhook")
async def soundora_webhook(request: Request):
    """Optional Suno callback target (polling is used by default)."""
    await request.body()
    return {"ok": True}


@app.api_route(
    "/api/soundora/upstream/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def soundora_upstream_proxy(path: str, request: Request):
    """Low-level Suno API proxy (legacy/debug). Prefer /api/soundora/tracks/*."""
    body = await request.body()
    status, resp_body, media_type = _suno_upstream_request(
        method=request.method,
        path=path,
        query=request.url.query or "",
        body=body,
        content_type=request.headers.get("content-type"),
    )
    return Response(content=resp_body, status_code=status, media_type=media_type)


@app.get("/api/email/status")
def email_status():
    """Lightweight check: is email configured for contact/OTP (no secrets exposed)."""
    cfg = _smtp_settings_or_none()
    inbox = _contact_inbox_email()
    resend = bool(_env_str("RESEND_API_KEY"))
    vercel = _vercel_email_configured()
    on_render = _is_render_host()
    return {
        "vercel_email_configured": vercel,
        "vercel_email_base": _vercel_email_api_base() or None,
        "resend_configured": resend,
        "smtp_configured": cfg is not None,
        "contact_inbox_configured": bool(inbox),
        "smtp_host": cfg["host"] if cfg else None,
        "smtp_port": cfg["port"] if cfg else None,
        "smtp_mode": cfg["mode"] if cfg else None,
        "render_free_smtp_blocked": on_render and not vercel and not resend,
        "hint": (
            "Set EMAIL_API_SECRET on Render (match Vercel) and redeploy. SMTP is blocked on Render Free."
            if on_render and not vercel and not resend
            else None
        ),
    }


@app.post("/api/contact", response_model=OtpStatusResponse)
def submit_contact(payload: ContactRequest):
    """Public contact form — emails studio inbox via SMTP."""
    to = _contact_inbox_email()
    if not to:
        raise HTTPException(
            status_code=503,
            detail="Contact form is not configured. Set CONTACT_EMAIL or SMTP_FROM in Render Environment.",
        )
    name = payload.name.strip()
    subject = payload.subject.strip() or "Studio inquiry"
    body = (
        f"New message from Ayzen Studios contact form\n\n"
        f"Name: {name}\n"
        f"Email: {payload.email}\n"
        f"Subject: {subject}\n\n"
        f"{payload.message.strip()}\n"
    )
    _send_email_or_500(
        to_email=to,
        subject=f"[Ayzen Studios] {subject}",
        body=body,
        reply_to=str(payload.email),
    )
    return OtpStatusResponse(ok=True, detail="Thanks — we received your message and will reply soon.")

_STATIC_DIR = os.path.join(BASE_DIR, "static")
app.mount("/assets", StaticFiles(directory=os.path.join(_STATIC_DIR, "assets")), name="assets")
app.mount("/css", StaticFiles(directory=os.path.join(_STATIC_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(_STATIC_DIR, "js")), name="js")
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.on_event("startup")
def _startup_db():
    _log_email_config_status()
    try:
        _ensure_auth_tables()
    except OperationalError as e:
        # Allow app to start even if DB is temporarily unavailable.
        print(f"Database unavailable on startup; continuing. ({type(e).__name__}: {e})")


@app.post("/api/auth/register", response_model=OtpStatusResponse, status_code=201)
def api_register(payload: RegisterRequest, db: Session = Depends(get_db)):
    # Ensure table exists even if DB was down at startup.
    _ensure_tables_or_503()
    _validate_password_or_400(payload.password)
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


def _env_str(key: str) -> str:
    """Read env var; strip whitespace, quotes, and accidental newlines from Render UI."""
    raw = os.environ.get(key, "")
    if raw is None:
        return ""
    v = str(raw).strip().strip('"').strip("'")
    return v


def _contact_inbox_email() -> str:
    return _env_str("CONTACT_EMAIL") or _env_str("SMTP_FROM")


def _smtp_settings_or_none():
    host = _env_str("SMTP_HOST")
    port_raw = _env_str("SMTP_PORT")
    user = _env_str("SMTP_USERNAME")
    # Gmail app passwords are often pasted with spaces; strip them for Render/env UIs.
    pwd = _env_str("SMTP_PASSWORD").replace(" ", "")
    from_email = _env_str("SMTP_FROM") or user
    use_tls = _env_str("SMTP_TLS").lower() in ("1", "true", "yes", "")
    if not host or not port_raw or not user or not pwd or not from_email:
        return None
    try:
        port = int(port_raw)
    except Exception:
        return None
    # Port 465 = implicit SSL; 587 = STARTTLS (Gmail default).
    if port == 465:
        mode = "ssl"
    elif use_tls:
        mode = "starttls"
    else:
        mode = "plain"
    return {
        "host": host,
        "port": port,
        "user": user,
        "pwd": pwd,
        "from": from_email,
        "mode": mode,
    }


def _is_render_host() -> bool:
    return _env_str("RENDER").lower() == "true"


def _vercel_email_api_base() -> str:
    base = _env_str("EMAIL_API_URL").rstrip("/")
    if base:
        return base
    contact = _env_str("CONTACT_API_URL")
    if not contact:
        return ""
    if "/api/" in contact:
        return contact.rsplit("/api/", 1)[0]
    return contact.rstrip("/")


def _vercel_email_api_secret() -> str:
    return _env_str("EMAIL_API_SECRET")


def _vercel_email_configured() -> bool:
    secret = _vercel_email_api_secret()
    if not secret or secret.startswith("<") or "same value" in secret.lower():
        return False
    return bool(_vercel_email_api_base() and secret)


def _send_via_vercel_mail(*, to_email: str, subject: str, body: str) -> None:
    base = _vercel_email_api_base()
    secret = _vercel_email_api_secret()
    if not base or not secret:
        raise HTTPException(
            status_code=500,
            detail="Vercel email not configured. Set EMAIL_API_SECRET on Render (same as Vercel).",
        )
    url = f"{base}/api/send-mail"
    payload = {"to": to_email, "subject": subject, "text": body}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Api-Key": secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:500]
        logger.error("Vercel send-mail HTTP %s: %s", e.code, err_body)
        raise HTTPException(
            status_code=502,
            detail=f"Email API failed (HTTP {e.code}). Check EMAIL_API_SECRET matches Vercel.",
        )
    except Exception as e:
        logger.exception("Vercel send-mail failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail=f"Email API failed ({type(e).__name__}). Is /api/send-mail deployed on Vercel?",
        )


def _log_email_config_status() -> None:
    cfg = _smtp_settings_or_none()
    inbox = _contact_inbox_email()
    resend = bool(_env_str("RESEND_API_KEY"))
    vercel = _vercel_email_configured()
    on_render = _is_render_host()
    if vercel:
        logger.info("Email ready: provider=vercel base=%s", _vercel_email_api_base())
        return
    if on_render and _vercel_email_api_base() and not _vercel_email_api_secret():
        logger.error(
            "EMAIL_API_SECRET missing on Render. OTP/contact server mail will fail. "
            "Set the same secret as on Vercel (not the placeholder text)."
        )
    if resend and inbox:
        logger.info("Email ready: provider=resend inbox=%s", inbox)
        return
    if cfg and inbox and not on_render:
        logger.info(
            "Email ready: provider=smtp %s:%s mode=%s from=%s inbox=%s",
            cfg["host"],
            cfg["port"],
            cfg["mode"],
            cfg["from"],
            inbox,
        )
        return
    if cfg and inbox and on_render:
        logger.warning(
            "SMTP vars present but Render Free blocks SMTP. Set EMAIL_API_SECRET for Vercel send-mail."
        )
        return
    missing = []
    if not vercel and not resend and not cfg:
        missing.append("EMAIL_API_SECRET + Vercel /api/send-mail, RESEND_API_KEY, or SMTP_*")
    if not inbox:
        missing.append("CONTACT_EMAIL or SMTP_FROM")
    logger.warning(
        "Email NOT configured (contact form + OTP will fail until set): %s",
        "; ".join(missing),
    )


def _otp_signing_key() -> bytes:
    # Use JWT_SECRET as the signing key source to avoid introducing another secret.
    s = os.environ.get("JWT_SECRET", "").strip()
    if not s:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    return s.encode()


def _otp_hash(email: str, code: str) -> str:
    msg = (email.strip().lower() + "|" + code.strip()).encode()
    return hmac.new(_otp_signing_key(), msg, hashlib.sha256).hexdigest()


def _smtp_send(cfg: dict, message: EmailMessage) -> None:
    ctx = ssl.create_default_context()
    timeout = 30
    debug = _env_str("SMTP_DEBUG").lower() in ("1", "true", "yes")
    if cfg["mode"] == "ssl":
        with smtplib.SMTP_SSL(
            cfg["host"], cfg["port"], timeout=timeout, context=ctx
        ) as s:
            if debug:
                s.set_debuglevel(1)
            s.login(cfg["user"], cfg["pwd"])
            s.send_message(message)
        return
    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=timeout) as s:
        if debug:
            s.set_debuglevel(1)
        s.ehlo()
        if cfg["mode"] == "starttls":
            s.starttls(context=ctx)
            s.ehlo()
        s.login(cfg["user"], cfg["pwd"])
        s.send_message(message)


def _smtp_error_detail(exc: Exception) -> str:
    name = type(exc).__name__
    base = f"Email send failed ({name})."
    if name == "SMTPAuthenticationError":
        return (
            base
            + " Gmail rejected the login — set SMTP_PASSWORD to a 16-character "
            "App Password (Google Account → Security → App passwords), not your normal password."
        )
    if name in ("SMTPConnectError", "TimeoutError", "OSError"):
        if _is_render_host():
            return (
                base
                + " Render Free blocks SMTP. Set EMAIL_API_SECRET on Render (same as Vercel) "
                "and redeploy — OTP uses https://spooky-studios-contactform.vercel.app/api/send-mail."
            )
        return (
            base
            + " Could not reach the mail server — try SMTP_PORT=465, or set RESEND_API_KEY."
        )
    return base + " See Render service logs for the full error."


def _send_via_resend(*, to_email: str, subject: str, body: str, reply_to: str | None = None) -> None:
    api_key = _env_str("RESEND_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="RESEND_API_KEY is not set.",
        )
    from_addr = _env_str("RESEND_FROM") or "Ayzen Studios <onboarding@resend.dev>"
    payload: dict = {
        "from": from_addr,
        "to": [to_email],
        "subject": subject,
        "text": body,
    }
    if reply_to:
        payload["reply_to"] = reply_to
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:500]
        logger.error("Resend API HTTP %s: %s", e.code, err_body)
        raise HTTPException(
            status_code=502,
            detail=f"Resend rejected the send (HTTP {e.code}). Check RESEND_FROM and domain verification at resend.com.",
        )
    except Exception as e:
        logger.exception("Resend API failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Resend send failed ({type(e).__name__}).")


def _send_email_or_500(*, to_email: str, subject: str, body: str, reply_to: str | None = None):
    if _vercel_email_configured():
        _send_via_vercel_mail(to_email=to_email, subject=subject, body=body)
        return

    on_render = _is_render_host()

    if on_render and _vercel_email_api_base():
        raise HTTPException(
            status_code=500,
            detail=(
                "EMAIL_API_SECRET is missing or invalid on Render. "
                "Set it to the same random string as on Vercel, then redeploy."
            ),
        )

    if _env_str("RESEND_API_KEY"):
        _send_via_resend(
            to_email=to_email,
            subject=subject,
            body=body,
            reply_to=reply_to,
        )
        return

    if on_render:
        raise HTTPException(
            status_code=500,
            detail=(
                "Render cannot send SMTP. Set CONTACT_API_URL + EMAIL_API_SECRET "
                "(Vercel /api/send-mail) or RESEND_API_KEY."
            ),
        )

    cfg = _smtp_settings_or_none()
    if not cfg:
        raise HTTPException(
            status_code=500,
            detail=(
                "Email not configured. Set EMAIL_API_SECRET (Vercel), RESEND_API_KEY, or SMTP_*."
            ),
        )
    m = EmailMessage()
    m["From"] = cfg["from"]
    m["To"] = to_email
    m["Subject"] = subject
    if reply_to:
        m["Reply-To"] = reply_to
    m.set_content(body)
    try:
        _smtp_send(cfg, m)
    except Exception as e:
        logger.exception(
            "SMTP send failed to %s via %s:%s mode=%s: %s",
            to_email,
            cfg["host"],
            cfg["port"],
            cfg["mode"],
            e,
        )
        raise HTTPException(status_code=502, detail=_smtp_error_detail(e))


def _send_verification_otp_or_500(*, db: Session, email: str) -> None:
    _otp_rate_limit_or_429(db=db, email=email)
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=OTP_EXPIRY_HOURS)

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
        subject="Your OTP for Ayzen Studios",
        body=f"Your OTP is: {code}\n\nThis code expires in {OTP_EXPIRY_HOURS} hours.\n",
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
    if _as_utc(otp.expires_at) < now:
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
    # Free games should always be playable (no purchase / entitlement required).
    free = set(FREE_GAMES.keys())
    if UNLOCK_ALL_GAMES:
        return {"games": sorted(free | set(PAID_GAMES.keys()))}
    rows = _entitlements_for_user_or_503(db, user)
    paid = {r.game_id for r in rows}
    return {"games": sorted(free | paid)}


def _scores_for_game_or_503(db: Session, game_id: str) -> list[tuple[GameScore, User]]:
    try:
        return (
            db.query(GameScore, User)
            .join(User, User.id == GameScore.user_id)
            .filter(GameScore.game_id == game_id)
            .order_by(GameScore.best_score.desc(), GameScore.updated_at.asc(), User.name.asc())
            .all()
        )
    except ProgrammingError as e:
        # If a new table was added after the DB already existed, create it and retry.
        if "relation \"game_scores\" does not exist" in str(e):
            db.rollback()
            _ensure_tables_or_503()
            return (
                db.query(GameScore, User)
                .join(User, User.id == GameScore.user_id)
                .filter(GameScore.game_id == game_id)
                .order_by(GameScore.best_score.desc(), GameScore.updated_at.asc(), User.name.asc())
                .all()
            )
        raise
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")


@app.get(
    "/api/leaderboard/games",
    dependencies=[Depends(_require_auth_tables)],
)
def api_leaderboard_games(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ent = set(PAID_GAMES.keys()) if UNLOCK_ALL_GAMES else {r.game_id for r in _entitlements_for_user_or_503(db, user)}
    games = []
    for gid, meta in FREE_GAMES.items():
        # Leaderboard page should only list gesture-games (leaderboard enabled).
        if not bool(meta.get("leaderboard", True)):
            continue
        games.append(
            {
                "game_id": gid,
                "title": meta["title"],
                "route": meta["route"],
                "category": meta.get("category", "gesture-games"),
                "leaderboard": bool(meta.get("leaderboard", True)),
                "unlocked": True,
            }
        )
    for gid, meta in PAID_GAMES.items():
        if gid == "tictactoe":
            continue
        m = _paid_game_meta(gid)
        if not bool(m.get("leaderboard", True)):
            continue
        games.append(
            {
                "game_id": gid,
                "title": m["title"],
                "route": m["route"],
                "category": m["category"],
                "leaderboard": bool(m["leaderboard"]),
                "unlocked": gid in ent,
            }
        )
    return {"games": games}


@app.get(
    "/api/leaderboard/{game_id}",
    dependencies=[Depends(_require_auth_tables)],
)
def api_leaderboard_for_game(
    game_id: str,
    limit: int = 200,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    gid = (game_id or "").strip()
    meta = _game_meta_or_none(gid)
    if not meta:
        raise HTTPException(status_code=400, detail="Unknown game")
    if not bool(meta.get("leaderboard", True)):
        raise HTTPException(status_code=400, detail="Leaderboard not available for this category")

    limit = max(1, min(int(limit or 200), 2000))
    rows = _scores_for_game_or_503(db, gid)

    entries = []
    dense_rank = 0
    prev_score = None
    me = None
    for idx, (s, u) in enumerate(rows):
        if prev_score is None or int(s.best_score) != int(prev_score):
            dense_rank += 1
            prev_score = int(s.best_score)
        row = {
            "rank": dense_rank,
            "user_id": str(u.id),
            "name": u.name,
            "score": int(s.best_score),
            "is_me": u.id == user.id,
        }
        if row["is_me"]:
            me = {"rank": dense_rank, "score": int(s.best_score)}
        if idx < limit:
            entries.append(row)

    if me is None:
        me = {"rank": None, "score": None}

    return {
        "game": {
            "game_id": gid,
            "title": meta["title"],
        },
        "total_players": len(rows),
        "entries": entries,
        "me": me,
    }


@app.post(
    "/api/scores/submit",
    dependencies=[Depends(_require_auth_tables)],
)
def api_submit_score(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    gid = (payload.get("game_id") or "").strip()
    meta = _game_meta_or_none(gid)
    if not meta:
        raise HTTPException(status_code=400, detail="Unknown game")
    if not bool(meta.get("leaderboard", True)):
        raise HTTPException(status_code=400, detail="Leaderboard not available for this category")
    if (not UNLOCK_ALL_GAMES) and gid in PAID_GAMES and not _has_game_entitlement_or_503(db, user, gid):
        raise HTTPException(status_code=403, detail="Game locked")

    try:
        score = int(payload.get("score"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid score")
    score = max(0, min(score, 2_000_000_000))

    try:
        row = db.query(GameScore).filter(GameScore.user_id == user.id, GameScore.game_id == gid).first()
    except ProgrammingError as e:
        if "relation \"game_scores\" does not exist" in str(e):
            db.rollback()
            _ensure_tables_or_503()
            row = db.query(GameScore).filter(GameScore.user_id == user.id, GameScore.game_id == gid).first()
        else:
            raise
    except OperationalError:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if row is None:
        row = GameScore(user_id=user.id, game_id=gid, best_score=score)
        db.add(row)
    else:
        if score > int(row.best_score or 0):
            row.best_score = score
            db.add(row)

    try:
        db.commit()
    except OperationalError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Database unavailable")

    return {"ok": True}


@app.post(
    "/api/payments/create-order",
    dependencies=[Depends(_require_auth_tables)],
)
def api_create_order(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    key_id, key_secret = _razorpay_keypair_or_500()

    game_id = (payload.get("game_id") or "").strip()
    if game_id not in PAID_GAMES:
        raise HTTPException(status_code=400, detail="Unknown game")

    if UNLOCK_ALL_GAMES:
        return {"already_unlocked": True, "game_id": game_id}

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

# --- REST: health / keep-alive (for Render free-tier cron pings) ---
_STARTED_AT = time.time()


@app.get("/health")
@app.get("/ping")
def health():
    """
    Lightweight liveness probe for uptime monitors / cron keep-alive.
    Always returns 200 quickly — no DB or camera work.
    Cron example (every 10–14 min): curl -fsS https://YOUR-SERVICE.onrender.com/health
    """
    camera_on = False
    try:
        camera_on = bool(getattr(detector, "cap", None) is not None)
    except Exception:
        camera_on = False
    return {
        "status": "ok",
        "ok": True,
        "service": "ayzen-studios",
        "uptime_sec": round(time.time() - _STARTED_AT, 1),
        "camera": camera_on,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/keepalive")
async def keepalive_fanout(request: Request):
    """
    Hit this from one cron job to wake multiple Render services.
    Set KEEPALIVE_URLS to a comma-separated list of health URLs, e.g.:
      KEEPALIVE_URLS=https://webar-jwly.onrender.com/,https://photobooth-urbj.onrender.com/,https://geolocation-based-registration.onrender.com/,https://kbc-quiz-8ocm.onrender.com/
    If unset, only this service is reported as alive.
    """
    raw = (os.environ.get("KEEPALIVE_URLS") or "").strip()
    urls = [u.strip() for u in raw.split(",") if u.strip()]
    results = [
        {
            "url": str(request.base_url).rstrip("/") + "/health",
            "ok": True,
            "status": 200,
            "self": True,
        }
    ]

    async def _ping(url: str) -> dict:
        try:
            def _fetch() -> tuple[int, str]:
                req = urllib.request.Request(
                    url,
                    method="GET",
                    headers={"User-Agent": "Ayzen-Keepalive/1.0"},
                )
                with urllib.request.urlopen(req, timeout=20) as resp:
                    return resp.getcode() or 200, (resp.read(256) or b"").decode("utf-8", "ignore")

            code, _body = await asyncio.to_thread(_fetch)
            return {"url": url, "ok": 200 <= code < 400, "status": code}
        except Exception as e:
            return {"url": url, "ok": False, "status": 0, "error": type(e).__name__}

    if urls:
        results.extend(await asyncio.gather(*[_ping(u) for u in urls]))

    all_ok = all(r.get("ok") for r in results)
    return {
        "status": "ok" if all_ok else "partial",
        "ok": all_ok,
        "checked": len(results),
        "results": results,
        "ts": datetime.now(timezone.utc).isoformat(),
    }

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

# --- WebGL phone controller room relay (phone ↔ Unity WebGL) ---
_room_peers: dict[str, set[WebSocket]] = {}


def _normalize_room_id(room_id: str) -> str:
    return "".join(c for c in (room_id or "").upper() if c.isalnum())[:12]


@app.websocket("/ws/room/{room_id}")
async def room_relay(websocket: WebSocket, room_id: str):
    rid = _normalize_room_id(room_id)
    if not rid:
        await websocket.close(code=4400)
        return
    await websocket.accept()
    peers = _room_peers.setdefault(rid, set())
    peers.add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            dead: list[WebSocket] = []
            for peer in list(peers):
                if peer is websocket:
                    continue
                try:
                    await peer.send_text(data)
                except Exception:
                    dead.append(peer)
            for p in dead:
                peers.discard(p)
    except WebSocketDisconnect:
        pass
    finally:
        peers.discard(websocket)
        if not peers:
            _room_peers.pop(rid, None)


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
