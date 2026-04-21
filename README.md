# Game-Store

**Piyush-Store** — a gesture-driven web game storefront built with **FastAPI**, **PostgreSQL**, and **Razorpay**. Users sign up with email, verify via OTP, then browse free and paid games. Premium titles unlock per user as **entitlements** stored in the database; payments go through **Razorpay Checkout** with **server-side signature verification**.

| Gesture | Action        |
|--------|----------------|
| Point  | Move cursor   |
| Pinch  | Tap / click   |
| (Browser) | MediaPipe hand overlay on supported pages |

---

## Games & routes

| Game                 | Path          | Price   | Notes |
|----------------------|---------------|---------|--------|
| Fruit-Ninja (arcade) | `/game`       | **Free** | — |
| Neon Pop             | `/puzzle`     | **₹10**  | Paywall; `game_id`: `neon_pop` |
| Neon Runner          | `/runner`     | **₹10**  | Paywall; `game_id`: `neon_runner` |
| Neon Tic-Tac-Toe     | `/tictactoe`  | **₹10**  | Paywall; `game_id`: `tictactoe` |

Storefront: `/` (or `/index`). **Login / register**: `/login`. **Profile**: `/profile`.

---

## Features

- **Account**: Register with name, email, password → **email OTP** to verify (**configure SMTP** in `.env` or registration returns an error).
- **Auth**: JWT bearer tokens; protected APIs use `Authorization: Bearer <token>`.
- **Payments**: Razorpay order creation, hosted checkout, verify payment + grant entitlement.
- **Entitlements**: `game_entitlements` in Postgres; `/api/entitlements` returns unlocked `game_id`s.
- **Gestures**: Client-side [MediaPipe](https://developers.google.com/mediapipe) hands (`/static/hand-client.js`) on store and games; **server** camera is optional and skipped on many cloud hosts.

---

## Tech stack

- **Backend**: Python 3.10+ (3.11 recommended), FastAPI, Uvicorn, SQLAlchemy, `psycopg2`, `python-jose`, Passlib, Razorpay Python SDK
- **DB**: PostgreSQL (e.g. local, [Neon](https://neon.tech), Render, etc.)
- **Frontend**: Static HTML/CSS/JS in `static/`, Razorpay Checkout (loaded from their CDN on the store page)

---

## Quick start (local)

### Prerequisites

- Python **3.10+**
- **PostgreSQL** (connection string)
- **Razorpay** [test keys](https://razorpay.com/docs/) (Key ID + Key Secret) for paid-game checkout
- **SMTP** (e.g. Gmail app password) — **required** to complete registration, because signup sends a verification OTP by email (see env table below).

### 1. Clone and virtualenv

```bash
git clone <your-fork-or-repo-url>.git
cd HandGesture-WebNavigation
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Environment

Copy `.env.example` to `.env` and fill in real values (never commit `.env`):

| Variable | Required | Purpose |
|----------|----------|--------|
| `DATABASE_URL` | Yes | PostgreSQL URL (`postgresql://...`). `postgres://` is normalized to `postgresql://`. |
| `JWT_SECRET` | Yes | Long random string; signs JWTs and OTP material. |
| `JWT_EXPIRES_MINUTES` | No | Default ~7 days if omitted. |
| `RAZORPAY_KEY_ID` | Yes for paywall | e.g. `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | Yes for paywall | **Server only** — never expose to the client. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` (and optional `SMTP_TLS`) | **Yes** for signup | Registration calls `POST /api/auth/register`, which emails a 6-digit OTP. Without SMTP, the API returns **500** (`SMTP not configured…`). |

Optional **runtime** (see `main.py`):

- `SKIP_SERVER_CAMERA=1` — skip server OpenCV/MediaPipe camera (typical in cloud / no webcam).
- `RENDER=true` — treated like skip server camera unless overridden.

The app uses `python-dotenv` in `db.py` so a local `.env` is picked up when you run `uvicorn` from the project root.

### 3. Run the API

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- **Store**: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- **Login**: [http://127.0.0.1:8000/login](http://127.0.0.1:8000/login)

### 4. Camera / gestures

The browser will prompt for **camera** permission. Use **HTTPS** or **localhost** so `getUserMedia` works. On the store, you can also **scroll** by pointing and moving the index finger up/down.

---

## Auth flow (summary)

1. `POST /api/auth/register` — creates user (unverified) and sends **OTP to email** (if SMTP is configured and sending succeeds).
2. `POST /api/auth/verify-email-otp` — verifies the code, sets `email_verified`.
3. `POST /api/auth/login` — returns JWT if email is verified and password matches.

Additional: `POST /api/auth/request-email-otp` for resend-style flows (see `main.py`).

---

## Razorpay payment flow

1. Logged-in store calls `POST /api/payments/create-order` with JSON `{ "game_id": "neon_pop" | "neon_runner" | "tictactoe" }`.
2. Backend creates a **₹10** order (amount in **paise** in code) and returns `key_id`, `order_id`, etc. for the Razorpay Checkout script.
3. User pays in the Razorpay modal.
4. On success, frontend calls `POST /api/payments/verify` with the Razorpay `order_id`, `payment_id`, and `signature`.
5. Backend verifies **HMAC-SHA256** with the **key secret** and inserts an entitlement row.
6. Client refreshes `GET /api/entitlements` and enables **Play** for that game.

Use **Test mode** keys until you go live; switch to **Live** keys and real KYC/activation only when ready to charge customers.

---

## API reference (HTTP)

**Public pages**: `GET /`, `/login`, `/game`, `/puzzle`, `/runner`, `/tictactoe`, `/profile`, etc.

**Auth**

| Method | Path | Body / notes |
|--------|------|----------------|
| `POST` | `/api/auth/register` | Register; sends OTP if mail works |
| `POST` | `/api/auth/login` | Email + password → JWT |
| `POST` | `/api/auth/request-email-otp` | Request / resend email OTP |
| `POST` | `/api/auth/verify-email-otp` | Email + code → verify |
| `GET`  | `/api/me` | Current user (Bearer) |

**Store / payments (Bearer required)**

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/entitlements` | List unlocked `game_id`s |
| `POST` | `/api/payments/create-order` | Create Razorpay order for a `game_id` |
| `POST` | `/api/payments/verify` | Verify payment and grant entitlement |

**Legacy / Unity-style (optional)**

| Method | Path |
|--------|------|
| `GET`  | `/health` |
| `GET`  | `/gesture` |
| `GET`  | `/video` |
| `WS`   | `/ws/gesture` |

---

## Project layout (high level)

```
HandGesture-WebNavigation/
├── main.py              # FastAPI app, routes, payments, auth glue
├── db.py                # Engine, sessions, DATABASE_URL
├── auth.py              # JWT, password hash, get_current_user
├── auth_models.py       # SQLAlchemy models
├── static/              # Store + games + hand-client.js
└── requirements.txt
```

---

## Deployment notes

- Set the same **env vars** as in `.env.example` on your host (Render, Fly.io, VPS, etc.).
- Point `DATABASE_URL` at a **managed Postgres** with `sslmode=require` if the provider requires TLS.
- If connections fail from Python, try **dropping** `channel_binding=require` from the URL (some libpq / driver stacks are picky).
- `RAZORPAY_KEY_SECRET` must **only** run on the server.
- For production, restrict CORS (`main.py` currently allows `*` for simplicity).

---

## Security

- Payment **signature verification** is required before an entitlement is stored.
- **JWT** and **Razorpay secret** are sensitive; use secrets management in production.
- Do **not** commit `.env` or real API keys. Rotate credentials if they are exposed.

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| `503` + `"Database unavailable"` on APIs | `DATABASE_URL`, DB running, network/firewall, SSL params; see server logs. |
| Paid games always locked | `GET /api/entitlements` response; Razorpay verify step; user logged in. |
| `500` on register: SMTP not configured | Set all `SMTP_*` vars in `.env` (see `.env.example`). |
| Registration OTP not received | Correct `SMTP_*`, Gmail “app password”, spam folder. |
| Camera blocked | Permission, use **localhost** or **HTTPS** on mobile. |
| No server webcam in cloud | Expected — set `SKIP_SERVER_CAMERA=1` or deploy without expecting `/video`. |

---

## License

This repository does not include a default license; add a `LICENSE` file if you want to specify terms for others using your code.
