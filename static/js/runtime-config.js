// Auto: local uvicorn → same-origin API; Netlify/production → Render.
(function (g) {
  var host = (g.location && g.location.hostname) || "";
  var isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  g.SPOOKY_API_BASE = isLocal ? "" : "https://piyush-store.onrender.com";
  g.PHONE_CONTROLLER_BASE = "https://phonecontrollerserver.onrender.com";
})(typeof window !== "undefined" ? window : globalThis);
