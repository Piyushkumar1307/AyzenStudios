# Netlify (static) + Render (API)

Split hosting so pages load instantly on Netlify while FastAPI stays on Render.

## Netlify

1. **New site** → Import your Git repo.
2. **Base directory:** `HandGesture-WebNavigation` (if the repo root is `gesture-backend`).
3. **Build command:** `node scripts/netlify-build.js` (also set in `netlify.toml`).
4. **Publish directory:** `static`.
5. **Environment variable:**
   - `SPOOKY_API_BASE` = `https://YOUR-SERVICE.onrender.com` (no trailing slash)

Deploy. Your site URL might be `https://something.netlify.app`.

## Drag-and-drop deploy (no Git)

You can deploy by dragging the **`static`** folder onto [Netlify Drop](https://app.netlify.com/drop) or **Sites → Add site → Deploy manually**.

**Before you drag:**

1. Edit `static/js/runtime-config.js` and set your Render API URL:

   ```javascript
   window.SPOOKY_API_BASE = "https://YOUR-SERVICE.onrender.com";
   ```

2. The folder must include `static/_redirects` (already in the repo) so `/games`, `/login`, and `/static/assets/...` work.
3. Pages load API config from **`/js/runtime-config.js`** (not `/static/js/...` — that path 404s on Netlify unless redirects are applied).

**Then:** drag the whole `static` folder (not the parent `HandGesture-WebNavigation` folder).

Each update: edit `runtime-config.js` if needed, then drag `static` again (or switch to Git deploy for automatic builds).

## Render (API only)

Keep the existing Web Service (`uvicorn main:app`). Set:

| Variable | Example |
|----------|---------|
| `SKIP_SERVER_CAMERA` | `1` |
| `DATABASE_URL`, `JWT_SECRET`, Razorpay, email vars | (unchanged) |
| `FRONTEND_ORIGINS` | `https://spookystudios.netlify.app` (must match your real Netlify URL; any `*.netlify.app` is also allowed after latest API deploy) |

Optional: HTML routes in `main.py` still work for backward compatibility; users should use the Netlify URL.

## Vercel contact form

Add your Netlify URL to `ALLOWED_ORIGINS` on the contact/OTP Vercel project.

## Local development

Run uvicorn as usual. On `http://127.0.0.1:8000` or `localhost`, `spooky-api.js` **automatically** uses same-origin APIs (even if `runtime-config.js` lists Render).

```bash
cd HandGesture-WebNavigation
source .venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Troubleshooting: login 404 on `yoursite.netlify.app/api/...`

That means the browser called **Netlify** instead of **Render**. Usually `runtime-config.js` or `spooky-api.js` did not load.

1. In Safari/Chrome DevTools → **Network**, confirm `runtime-config.js` and `spooky-api.js` return **200** from `/js/...`.
2. Redeploy the full `static` folder (include `_redirects` and `js/`).
3. Confirm `static/js/runtime-config.js` contains your Render URL.
4. On Render, set `FRONTEND_ORIGINS=https://spookystudios.netlify.app` (your actual Netlify hostname — a mismatch causes login to hang with no response in Safari).

## Note on cold starts

Netlify removes slow **page** loads when Render sleeps. The **first API call** (login, `/api/me`, scores) can still wait for Render to wake up.
