// API base: same-origin on localhost + Render; external API on Netlify/static hosts.
(function (g) {
  var host = ((g.location && g.location.hostname) || "").toLowerCase();
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  var isRenderApp = host.endsWith(".onrender.com");
  g.SPOOKY_API_BASE = isLocal || isRenderApp ? "" : "https://ayzenstudios.onrender.com";
})(typeof window !== "undefined" ? window : globalThis);
