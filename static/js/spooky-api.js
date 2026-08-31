/**
 * Resolve API paths for split deploy: static on Netlify, FastAPI on Render.
 * Load /js/runtime-config.js first to set window.SPOOKY_API_BASE.
 */
(function (global) {
  var DEFAULT_RENDER_API = "https://ayzenstudios.onrender.com";

  function isLocalDevHost() {
    if (typeof global.location === "undefined") return false;
    var host = (global.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  function apiBase() {
    if (isLocalDevHost()) return "";

    // Netlify build bakes SPOOKY_API_BASE via scripts/netlify-build.js — prefer that.
    var configured = global.SPOOKY_API_BASE;
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim().replace(/\/$/, "");
    }

    if (typeof global.location !== "undefined") {
      var host = (global.location.hostname || "").toLowerCase();
      // Netlify static → Render API (split deploy).
      if (host.endsWith(".netlify.app")) {
        return DEFAULT_RENDER_API.replace(/\/$/, "");
      }
      // Render unified deploy: FastAPI serves static on the same host.
      if (host.endsWith(".onrender.com")) {
        return "";
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

  global.phoneControllerUrl = function (override) {
    if (typeof override === "string" && override.trim()) {
      return override.trim().replace(/\/$/, "");
    }
    var base = global.PHONE_CONTROLLER_BASE || "https://phonecontrollerserver.onrender.com";
    return String(base).trim().replace(/\/$/, "");
  };
})(typeof window !== "undefined" ? window : globalThis);
