# Unity WebGL games on Ayzen Studios

Host browser-playable Unity games with **phone-as-controller** pairing.

## Site flow

1. **`/webgl`** — card catalog; each card shows art + **Play** overlay  
2. User clicks **Play** → instruction panel with **phone controller URL** + QR  
3. User opens URL on phone → joins the same **room** via WebSocket  
4. User clicks **Launch game** → WebGL loads in fullscreen iframe  
5. Phone sends input; Unity WebGL receives it through the room relay  

Room relay: `wss://YOUR-API.onrender.com/ws/room/{ROOM_ID}`

---

## Unity build settings (WebGL)

### Player Settings → WebGL

| Setting | Recommended |
|---------|-------------|
| **Color Space** | Linear (if your art supports it) |
| **Auto Graphics API** | Off — use **WebGL 2.0** only (smaller, faster) |
| **Compression Format** | **Gzip** (works on Netlify + Render; Brotli needs server headers) |
| **Data caching** | On |
| **Name Files As Hashed** | On (cache busting) |
| **Decompression Fallback** | On (Safari / older browsers) |
| **Power Preference** | High Performance |
| **WebAssembly BigInt** | Off unless you need it |
| **Threads support** | **Off** (requires COOP/COEP headers — avoid on Netlify) |
| **Run in background** | Off |

### Publishing settings

| Setting | Value |
|---------|--------|
| **Compression** | Gzip |
| **Build** | Development off for production |
| **Code optimization** | Size or Speed (try Size first) |

### Resolution / canvas

**Match your Game view to Player Settings.** The Game tab aspect ratio (e.g. 1080×1920) does **not** change the WebGL build — only **Player Settings → Resolution and Presentation** does.

| Game type | Default canvas | Notes |
|-----------|----------------|--------|
| Portrait mobile (Beat Traffic) | **1080 × 1920** | Same as your phone-oriented UI |
| Landscape desktop | 1280 × 720 | 16:9 catalog cards |

In Unity:

1. **Edit → Project Settings → Player → WebGL → Resolution and Presentation**
   - Default Canvas Width: **1080**
   - Default Canvas Height: **1920**
2. On your **Canvas** (UI): **Canvas Scaler → UI Scale Mode = Scale With Screen Size**, Reference Resolution **1080 × 1920**, Match = **0.5** (balance width/height) or **1** (match width for portrait).
3. Replace placeholder UI text (e.g. **"New Text"** on the loading bar) with **"Loading…"** or a % label.
4. Optional: WebGL Template → **Minimal** (hides Unity logo/footer bar in the browser).
5. **File → Build Settings → WebGL → Build** and replace `static/webgl/2dCar/` on the site.

After re-export, `index.html` should contain `width=1080 height=1920` on the canvas tag.

**Important — iframe / website embed:** Unity’s default template sets `canvas.style.width = "1080px"` on desktop, which gets **center-cropped** inside the site’s portrait iframe. After each WebGL build, either:

- Copy the responsive `index.html` + `TemplateData/style.css` from your last working `static/webgl/2dCar/` commit, or  
- In the built `index.html`, remove the fixed `1080px` / `1920px` styles and make the canvas **100% width and height** of the page (see current `2dCar` template in the repo).

### Strip engine code

- **Managed Stripping Level**: Medium (test thoroughly)  
- Remove unused **Input System** backends if you only use phone relay  

---

## Folder layout on the website

Drop each Unity **WebGL build** here:

```
static/webgl/
  zombie-crusher/
    index.html          ← Unity template (from build)
    Build/
      *.wasm
      *.data.gz
      *.framework.js.gz
      *.loader.js
  tic-tac-toe/
    index.html
    Build/
      ...
```

Register the game in **`static/js/webgl-games.js`** (`slug`, `title`, `img`, `buildPath`).

---

## Phone controller + Unity

### Phone controller (Render)

QR code and phone link point to:

```
https://phonecontrollerserver.onrender.com
```

The phone app connects to `wss://phonecontrollerserver.onrender.com` and sends tilt input as JSON, e.g. `{"move":0.42}`.

### Unity WebGL

Unity should connect to the same WebSocket server:

```
wss://phonecontrollerserver.onrender.com
```

Launch from the site:

`/webgl-play?game=2d-car`

Optional legacy room relay on the API (if you add multi-room later):

`wss://piyush-store.onrender.com/ws/room/{ROOM_ID}`

---

## Hosting notes

| Asset | Host |
|-------|------|
| HTML catalog, WebGL **files**, controller page | **Netlify** (`static/`) |
| `/ws/room/*` WebSocket relay | **Render** (FastAPI) |

Netlify `_redirects` already serves `/webgl/*` build folders.

### MIME / compression

Netlify serves `.gz` with correct encoding if files end in `.gz` and Unity loader requests them — Unity WebGL gzip builds work out of the box on Netlify.

### CORS

WebSocket origin must be allowed on Render — set `FRONTEND_ORIGINS` to your Netlify domain.

---

## Checklist before publish

- [ ] Build with **Gzip**, threads **off**  
- [ ] Copy build into `static/webgl/{slug}/`  
- [ ] Add entry in `static/js/webgl-games.js`  
- [ ] Unity connects to `/ws/room/{room}` with same room as phone  
- [ ] Test on Chrome desktop + Safari iOS phone  
- [ ] Redeploy Netlify `static/` + Render API  

---

## Soundora (AI song generator)

Standalone WebGL app — **no phone controller**.

| Item | Value |
|------|--------|
| Landing page | `/soundora` |
| Catalog slug | `soundora` |
| Build folder | `static/webgl/AI-Musicapp/` |
| Config | `static/js/webgl-games.js` → `comingSoon: true` until build is uploaded |

**After Unity export:**

1. Copy WebGL build into `static/webgl/AI-Musicapp/` (`index.html` + `Build/`).
2. Ensure `comingSoon: false` for the `soundora` entry in `webgl-games.js`.
3. Redeploy Netlify — launch works from `/soundora`, `/webgl`, and `/webgl-play?game=soundora`.
