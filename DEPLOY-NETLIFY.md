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

**Then:** drag the whole `static` folder (not the parent `HandGesture-WebNavigation` folder).

Each update: edit `runtime-config.js` if needed, then drag `static` again (or switch to Git deploy for automatic builds).

## Render (API only)

Keep the existing Web Service (`uvicorn main:app`). Set:

| Variable | Example |
|----------|---------|
| `SKIP_SERVER_CAMERA` | `1` |
| `DATABASE_URL`, `JWT_SECRET`, Razorpay, email vars | (unchanged) |
| `FRONTEND_ORIGINS` | `https://your-site.netlify.app,https://spookystudios.com` |

Optional: HTML routes in `main.py` still work for backward compatibility; users should use the Netlify URL.

## Vercel contact form

Add your Netlify URL to `ALLOWED_ORIGINS` on the contact/OTP Vercel project.

## Local development

Run uvicorn as usual. Leave `SPOOKY_API_BASE` empty — `apiUrl("/api/...")` stays same-origin.

```bash
cd HandGesture-WebNavigation
source .venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Note on cold starts

Netlify removes slow **page** loads when Render sleeps. The **first API call** (login, `/api/me`, scores) can still wait for Render to wake up.
