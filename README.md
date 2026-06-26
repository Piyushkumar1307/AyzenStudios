# Ayzen Studios — HandGesture Web Navigation

**Ayzen Studios** is a gesture-driven game studio site: a marketing homepage, browser game catalog, Unity WebGL titles with **phone-as-controller**, user accounts, and Razorpay paywall for premium HTML5 games.

| Layer | Host | URL |
|--------|------|-----|
| Static site (HTML, assets, WebGL builds) | **Netlify** | [spookystudios.netlify.app](https://spookystudios.netlify.app) |
| FastAPI (auth, payments, scores, WebSocket relay) | **Render** | [piyush-store.onrender.com](https://piyush-store.onrender.com) |
| Beat Traffic phone controller | **Render** | [phonecontrollerserver.onrender.com](https://phonecontrollerserver.onrender.com) |
| Fruit Ninja phone controller | **Render** | [fruit-ninja-phonecontroller.onrender.com](https://fruit-ninja-phonecontroller.onrender.com) |

---

## What’s in the project

### Marketing site (`/`)

Homepage with studio services (Smart Registration, Kiosk Application), work portfolio cards, Google Play links (Mad Arrows, Zombie Crusher, Tic Tac Toe), and a contact form.

### Gesture game catalog (`/games`)

Browser games controlled with **MediaPipe hand tracking** (point, pinch, scroll):

| Game | Path | Price | Notes |
|------|------|-------|--------|
| Fruit-Ninja (arcade) | `/game` | Free | — |
| Neon Pop | `/puzzle` | ₹10 | `game_id`: `neon_pop` |
| Neon Runner | `/runner` | ₹10 | `game_id`: `neon_runner` |
| Neon Tic-Tac-Toe | `/tictactoe` | ₹10 | `game_id`: `tictactoe` |
| Traffic dodge | `/traffic` | — | — |
| Temple Run | `/temple-run` | — | — |
| Holo / Kamehameha / Slingshot | `/holo`, `/kamehameha`, `/slingshot` | — | FX demos |

Storefront aliases: `/games`, `/marketplace`, `/store` → same catalog.

### Unity WebGL games (`/webgl`)

Unity builds run in the browser; the **phone is the controller** via separate Render apps.

| Game | Slug | Canvas | Phone controller |
|------|------|--------|------------------|
| **Beat Traffic** | `2d-car` | Portrait 1080×1920 | [phonecontrollerserver.onrender.com](https://phonecontrollerserver.onrender.com) |
| **Ayzen Fruit Ninja** | `fruit-ninja` | Landscape 1920×1080 | [fruit-ninja-phonecontroller.onrender.com](https://fruit-ninja-phonecontroller.onrender.com) |
| **Soundora** | `soundora` | Landscape (TBD) | Standalone — no phone controller |

Landing page: **`/soundora`**. Build lives in `static/webgl/AI-Musicapp/`.

**Play flow**

1. `/webgl` — pick a game → **Play**
2. Instruction modal — QR + link to the game’s phone controller URL
3. Open controller on phone → wait for **Connected**
4. **Launch game** → `/webgl-play?game={slug}` loads the Unity build in a sized iframe (portrait 9:16 or landscape 16:9)

Catalog config: `static/js/webgl-games.js`. Unity export notes: **[WEBGL-GAMES.md](./WEBGL-GAMES.md)**.

### Accounts & payments

- Register with email → **OTP verification** (SMTP or Resend on Render)
- JWT auth; premium games unlock via **Razorpay** + server-side signature verify
- Entitlements stored in PostgreSQL (`game_entitlements`)

---

## Gesture controls

| Gesture | Action |
|---------|--------|
| Point | Move cursor |
| Pinch | Tap / click |
| Index finger up/down | Scroll (store) |

Client-side [MediaPipe](https://developers.google.com/mediapipe) in `static/hand-client.js`. Server webcam is optional and usually disabled in cloud (`SKIP_SERVER_CAMERA=1`).

---

## Tech stack

| Part | Stack |
|------|--------|
| Backend | Python 3.10+, FastAPI, Uvicorn, SQLAlchemy, PostgreSQL, Razorpay, JWT |
| Frontend | Static HTML/CSS/JS in `static/` |
| Split deploy | Netlify (`static/`) + Render (API) via `static/js/spooky-api.js` + `runtime-config.js` |
| WebGL | Unity WebGL builds under `static/webgl/` |
| Phone controllers | Separate Express/React apps on Render (WebSocket tilt / slash input) |

---

## Project layout

```
HandGesture-WebNavigation/
├── main.py                 # FastAPI: pages, auth, payments, /ws/room relay
├── db.py, auth.py, auth_models.py
├── static/
│   ├── index.html          # Marketing homepage
│   ├── games.html          # Gesture game catalog
│   ├── webgl.html          # WebGL catalog + QR modal
│   ├── webgl-play.html     # Unity iframe player
│   ├── js/
│   │   ├── runtime-config.js   # SPOOKY_API_BASE (Netlify build bakes Render URL)
│   │   ├── spooky-api.js       # apiUrl(), phoneControllerUrl()
│   │   └── webgl-games.js      # WebGL catalog entries
│   ├── assets/             # Card images, studio art
│   └── webgl/
│       ├── 2dCar/          # Beat Traffic build
│       └── Fruitninjawebgl/
├── netlify.toml            # Publish static/, pretty URL redirects
├── scripts/netlify-build.js
├── requirements.txt
└── WEBGL-GAMES.md          # Unity WebGL export & embed guide
```

---

## Quick start (local)

### Prerequisites

- Python **3.10+** (3.11 recommended)
- **PostgreSQL** connection string
- **Razorpay** test keys (for paid games)
- **SMTP** or **Resend** (for registration OTP and contact form)

### 1. Clone and virtualenv

```bash
git clone https://github.com/Piyushkumar1307/HandGesture-WebNavigation.git
cd HandGesture-WebNavigation
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Optional server-side webcam (local only):

```bash
pip install -r requirements-local.txt
```

### 2. Environment

Copy `.env.example` to `.env` (never commit `.env`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL URL |
| `JWT_SECRET` | Yes | Signs JWTs and OTP material |
| `JWT_EXPIRES_MINUTES` | No | Default ~7 days |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | For paywall | Server secret only |
| `SMTP_*` or `RESEND_API_KEY` | For signup + contact | See deployment section |
| `CONTACT_EMAIL` | No | Contact form inbox |
| `FRONTEND_ORIGINS` | Production | e.g. `https://spookystudios.netlify.app` |
| `SKIP_SERVER_CAMERA` | Cloud | Set `1` on Render (no server webcam) |

On **localhost**, `spooky-api.js` uses **same-origin** for API calls (no Render URL).

### 3. Run locally

```bash
SKIP_SERVER_CAMERA=1 uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

| Page | URL |
|------|-----|
| Home | http://127.0.0.1:8000/ |
| Gesture games | http://127.0.0.1:8000/games |
| WebGL catalog | http://127.0.0.1:8000/webgl |
| Beat Traffic | http://127.0.0.1:8000/webgl-play?game=2d-car |
| Fruit Ninja | http://127.0.0.1:8000/webgl-play?game=fruit-ninja |
| Soundora | http://127.0.0.1:8000/soundora |
| Login | http://127.0.0.1:8000/login |

Use **HTTPS** or **localhost** for camera / `getUserMedia` on gesture games.

---

## Split deploy: Netlify + Render

### Netlify (frontend)

- **Publish directory:** `static`
- **Build command:** `node scripts/netlify-build.js`
- **Env:** `SPOOKY_API_BASE=https://piyush-store.onrender.com`
- Redirects: `netlify.toml` + `static/_redirects` (pretty URLs like `/webgl` → `webgl.html`)

### Render (API)

Web service running `uvicorn main:app --host 0.0.0.0 --port $PORT`.

Minimum env:

```
DATABASE_URL=...
JWT_SECRET=...
FRONTEND_ORIGINS=https://spookystudios.netlify.app
SKIP_SERVER_CAMERA=1
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RESEND_API_KEY=re_...          # preferred on Render free tier
CONTACT_EMAIL=you@example.com
```

CORS allows `FRONTEND_ORIGINS` and `*.netlify.app` for split-origin API calls from the static site.

### Phone controllers

Hosted separately on Render. Each WebGL game entry in `webgl-games.js` sets `phoneControllerUrl`. Unity WebGL and the phone app connect to the same WebSocket server for that game.

---

## Auth flow

1. `POST /api/auth/register` — creates user, sends email OTP
2. `POST /api/auth/verify-email-otp` — verifies code
3. `POST /api/auth/login` — returns JWT

Protected routes use `Authorization: Bearer <token>`.

---

## Razorpay payment flow

1. `POST /api/payments/create-order` with `{ "game_id": "neon_pop" | "neon_runner" | "tictactoe" }`
2. Razorpay Checkout modal on client
3. `POST /api/payments/verify` with order/payment/signature
4. Backend verifies HMAC and grants entitlement
5. `GET /api/entitlements` unlocks **Play** in the catalog

---

## API reference (HTTP)

**Pages:** `GET /`, `/games`, `/webgl`, `/webgl-play`, `/login`, `/profile`, `/game`, `/puzzle`, `/runner`, `/tictactoe`, `/support`, `/terms`, `/privacy`, `/refunds`, …

**Auth**

| Method | Path |
|--------|------|
| `POST` | `/api/auth/register` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/request-email-otp` |
| `POST` | `/api/auth/verify-email-otp` |
| `GET` | `/api/me` |

**Store (Bearer)**

| Method | Path |
|--------|------|
| `GET` | `/api/entitlements` |
| `POST` | `/api/payments/create-order` |
| `POST` | `/api/payments/verify` |

**Other**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/contact` | Contact form |
| `GET` | `/api/email/status` | Email config health |
| `GET` | `/health` | Health check |
| `WS` | `/ws/room/{room_id}` | Optional phone ↔ Unity room relay |
| `WS` | `/ws/gesture` | Legacy gesture stream |

---

## Adding a WebGL game

1. Export Unity WebGL → copy build to `static/webgl/{folder}/`
2. Patch `index.html` + `TemplateData/style.css` so canvas is **100% viewport** (see existing `2dCar` / `Fruitninjawebgl` or [WEBGL-GAMES.md](./WEBGL-GAMES.md))
3. Add card image under `static/assets/games/`
4. Register in `static/js/webgl-games.js`:

```javascript
{
  slug: "my-game",
  title: "My Game",
  desc: "Short description",
  img: "/assets/games/my-game.png",
  buildPath: "/static/webgl/myGame/index.html",
  phoneControllerUrl: "https://my-controller.onrender.com",
  orientation: "landscape",   // or "portrait"
  aspectRatio: "16 / 9",      // or "9 / 16"
}
```

5. Redeploy Netlify (`static/` includes WebGL binaries — first load can be large)

---

## Email on Render (free tier)

Render **blocks outbound SMTP** on the free plan. Use **Resend**:

1. [resend.com](https://resend.com) → API key
2. Render env: `RESEND_API_KEY`, `CONTACT_EMAIL`
3. Test sender: `RESEND_FROM=Ayzen Studios <onboarding@resend.dev>`
4. Check `GET /api/email/status` → `resend_configured: true`

Alternative: deploy `vercel-email-api/` to Vercel and set `CONTACT_API_URL` on Render.

---

## Soundora (Suno API)

The Suno API key **must never** live in Unity or browser code. Render proxies all calls:

1. **Rotate** your key at [sunoapi.org](https://sunoapi.org) (old keys in git/chat are compromised).
2. Render env: `SUNO_API_KEY=your_new_key`
3. Redeploy **Render** and **Netlify** (Netlify serves `soundora-proxy.js` + Unity build).
4. Check `GET https://piyush-store.onrender.com/api/soundora/status` → `{"configured":true}`

Unity WebGL still calls `api.sunoapi.org` internally; `static/js/soundora-proxy.js` (loaded in `webgl/AI-Musicapp/index.html`) rewrites those requests to `/api/soundora/*` on Render and strips the client `Authorization` header.

**Long term:** remove the API key from Unity source and rebuild WebGL so it is not embedded in binaries or git history.

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| Login/API 404 on Netlify | `SPOOKY_API_BASE` in Netlify env; `spooky-api.js` loaded |
| CORS errors | `FRONTEND_ORIGINS` on Render matches Netlify domain |
| WebGL cropped / wrong aspect | Canvas CSS must be 100% in iframe; see [WEBGL-GAMES.md](./WEBGL-GAMES.md) |
| Phone controller not connecting | Open the correct `phoneControllerUrl` for that game |
| `503` Database unavailable | `DATABASE_URL`, DB running |
| Contact/register email fails | Resend or SMTP env on Render; redeploy after changes |
| Soundora returns to prompt / CORS | Set `SUNO_API_KEY` on Render; redeploy Netlify + Render; rotate leaked Suno key |
| Camera blocked | Use localhost or HTTPS |
| Git push rejected | Push from **this repo root** (`HandGesture-WebNavigation/`), not parent `gesture-backend/` |

---

## Security

- Verify Razorpay **signatures** before granting entitlements
- Keep `JWT_SECRET`, `SUNO_API_KEY`, and Razorpay secret server-side only
- Do not commit `.env` or production keys
- If a Suno/Razorpay key was pushed to GitHub, **rotate it** at the provider dashboard (git history may still contain old values)

---

## License

No default license file — add `LICENSE` if you want to specify terms.
