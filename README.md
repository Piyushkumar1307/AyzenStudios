# HandGesture Web Navigation — Gesture Games Store (FastAPI + Razorpay)

Gesture-controlled web game store with **login + Postgres** and **Razorpay paywall** for premium games.

- **Cursor**: point with index finger
- **Click**: pinch gesture
- **Hand skeleton overlay**: drawn in the browser

## Games & pricing

- **Fruit-Ninja** (`/game`): **Free**
- **Neon Pop** (`/puzzle`): **₹10** (locked until purchased)
- **Neon Runner** (`/runner`): **₹10** (locked until purchased)

Purchases are stored as **entitlements per user** in Postgres.

## Features

- **Auth**: register/login with JWT
- **Payments**: Razorpay Checkout + server-side signature verification
- **Entitlements**: unlock games per user (Postgres)
- **Gesture UI**: hand tracking + pinch-to-click controls

## Tech stack

- **Backend**: Python, FastAPI, SQLAlchemy, Postgres, Razorpay SDK
- **Frontend**: HTML/CSS/JS + Canvas (static pages in `static/`)

## Local setup

### Prerequisites

- Python 3.10+ (recommended 3.11)
- A Postgres database (local or hosted)
- A Razorpay account (Test keys are enough for local testing)

### 1) Install dependencies

```bash
pip install -r requirements.txt
```

### 2) Configure environment

Create `.env` in the project root (use `.env.example` as a template):

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_MINUTES=10080

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

Notes:
- Some platforms provide `postgres://...`; the app converts it to `postgresql://...`.
- **Never commit** `.env` (contains secrets).

### 3) Run

```bash
uvicorn main:app --reload
```

Open:
- `http://127.0.0.1:8000/login` (register/login)
- `http://127.0.0.1:8000/` (store)

## Razorpay payment flow

1. Store calls `POST /api/payments/create-order` with `game_id`
2. Backend creates an order for **₹10**
3. Browser opens Razorpay Checkout
4. On success, store calls `POST /api/payments/verify`
5. Backend verifies the signature and writes entitlement to Postgres
6. Store refreshes `/api/entitlements` and unlocks the game

## API

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`

### Entitlements / payments (requires `Authorization: Bearer <token>`)
- `GET /api/entitlements`
- `POST /api/payments/create-order`
- `POST /api/payments/verify`

### Gesture endpoints (optional / legacy)
- `GET /health`
- `GET /gesture`
- `GET /video`
- `WS /ws/gesture`

## Deployment notes

Set these env vars on your host (Render/VPS/etc):
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_MINUTES` (optional)
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

Use **Test keys** in development; switch to **Live keys** only when ready to accept real payments.

## Security notes

- Razorpay secret stays **server-side only** (frontend only uses `key_id`)
- Game unlock is granted **only after** server-side signature verification

## Troubleshooting

- **Paid games show locked after login**: entitlements load from `/api/entitlements` (first load may take a moment on cold start).
- **Camera not working**: allow camera permission; on mobile use HTTPS or localhost.
