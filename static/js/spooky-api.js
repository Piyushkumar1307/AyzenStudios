/**
 * Resolve API paths for split deploy: static on Netlify, FastAPI on Render.
 * Set window.SPOOKY_API_BASE (e.g. https://your-app.onrender.com) before this script loads.
 */
(function (global) {
  function apiBase() {
    var b = global.SPOOKY_API_BASE;
    if (typeof b === "string" && b.trim()) return b.trim().replace(/\/$/, "");
    return "";
  }

  global.apiUrl = function (path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    if (!path.startsWith("/")) path = "/" + path;
    var base = apiBase();
    return base ? base + path : path;
  };
})(typeof window !== "undefined" ? window : globalThis);
