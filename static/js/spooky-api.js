/**
 * Resolve API paths for split deploy: static on Netlify, FastAPI on Render.
 * Load /js/runtime-config.js first to set window.SPOOKY_API_BASE.
 */
(function (global) {
  var DEFAULT_RENDER_API = "https://piyush-store.onrender.com";

  function isLocalDevHost() {
    if (typeof global.location === "undefined") return false;
    var host = (global.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  function apiBase() {
    // Local uvicorn: always same-origin (ignore runtime-config Render URL).
    if (isLocalDevHost()) return "";

    var b = global.SPOOKY_API_BASE;
    if (typeof b === "string" && b.trim()) return b.trim().replace(/\/$/, "");

    // Netlify static host: hit Render API (not Netlify /api 404).
    if (typeof global.location !== "undefined") {
      var host = global.location.hostname || "";
      if (host.endsWith(".netlify.app")) {
        return DEFAULT_RENDER_API.replace(/\/$/, "");
      }
    }
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
