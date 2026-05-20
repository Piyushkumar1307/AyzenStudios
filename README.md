# spookystudios — HandGesture Web Navigation

**spookystudios** — a gesture-driven web game storefront built with **FastAPI**, **PostgreSQL**, and **Razorpay**. Users sign up with email, verify via OTP, then browse free and paid games. Premium titles unlock per user as **entitlements** stored in the database; payments go through **Razorpay Checkout** with **server-side signature verification**.

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` (and optional `SMTP_TLS`) | **Yes** for signup + contact | Registration OTP and the home page **contact form** (`POST /api/contact`). Without SMTP, APIs return **500** / **503**. |
| `CONTACT_EMAIL` | No (falls back to `SMTP_FROM`) | Inbox that receives contact form messages. |

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

## Split deploy: Netlify + Render

Host **HTML/CSS/JS** on [Netlify](https://www.netlify.com) (instant loads) and keep **FastAPI** on Render (API only). See **[DEPLOY-NETLIFY.md](./DEPLOY-NETLIFY.md)** for setup (`SPOOKY_API_BASE`, `FRONTEND_ORIGINS`, redirects).

---

## Deployment notes (Render)

Your local `.env` file is **not** uploaded to Render. You must add every variable in **Render Dashboard → your Web Service → Environment**.

Minimum for contact form + auth email:

1. `DATABASE_URL`, `JWT_SECRET`
2. `SMTP_HOST` = `smtp.gmail.com`, `SMTP_PORT` = `587`, `SMTP_TLS` = `true`
3. `SMTP_USERNAME` = your Gmail address
4. `SMTP_PASSWORD` = [Gmail App Password](https://myaccount.google.com/apppasswords) (16 characters, **not** your normal Gmail password)
5. `SMTP_FROM` = same Gmail address
6. `CONTACT_EMAIL` = where contact form messages should arrive (can match `SMTP_FROM`)

After deploy, open **Logs** and look for `Email ready:` on startup. If you see `Email NOT configured`, a variable is missing.

**Render Free plan:** outbound SMTP to ports **587, 465, and 25 is blocked** (you get `502` / `OSError`). Your Gmail SMTP env vars can be correct and still fail. Fix:

1. Sign up at [resend.com](https://resend.com) → **API Keys** → create a key.
2. On Render, add `RESEND_API_KEY=re_...` and `CONTACT_EMAIL=your@gmail.com`.
3. For testing, set `RESEND_FROM=Spooky Studios <onboarding@resend.dev>` (Resend’s test sender).
4. Redeploy. Check `GET /api/email/status` — `resend_configured` should be `true`.

Or upgrade Render to a **paid** instance to use Gmail SMTP directly.

**Vercel + Nodemailer (same pattern as your other project):** deploy `vercel-email-api/` to Vercel, set Gmail SMTP env vars there, then on Render set:

`CONTACT_API_URL=https://<your-vercel-project>.vercel.app/api/contact`

See `vercel-email-api/README.md`.

Redeploy after changing Environment variables.

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
| `500` / `503` on contact form | Set all `SMTP_*` + `CONTACT_EMAIL` (or `SMTP_FROM`) on **Render Environment**, not only local `.env`. Redeploy. |
| `502` on contact form | SMTP login failed from Render — use Gmail **App Password**, check Render logs for `SMTP send failed`. |
| `500` on register: SMTP not configured | Set all `SMTP_*` vars in Render Environment (see `.env.example`). |
| Registration OTP not received | Correct `SMTP_*`, Gmail App Password, spam folder; confirm `Email ready` in Render logs. |
| Camera blocked | Permission, use **localhost** or **HTTPS** on mobile. |
| No server webcam in cloud | Expected — set `SKIP_SERVER_CAMERA=1` or deploy without expecting `/video`. |

---

## License

This repository does not include a default license; add a `LICENSE` file if you want to specify terms for others using your code.
