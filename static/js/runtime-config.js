// Auto: local uvicorn → same-origin API; Netlify/production → Render.
(function (g) {
  var host = (g.location && g.location.hostname) || "";
  var isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  g.SPOOKY_API_BASE = isLocal ? "" : "https://piyush-store.onrender.com";
  g.PHONE_CONTROLLER_BASE = "https://phonecontrollerserver.onrender.com";
  g.AYZEN_CONTACT = {
    telegram: "https://t.me/ayzenstudios",
    telegramHandle: "Telegram",
    whatsapp: "https://wa.me/919205726749",
    linkedin: "https://www.linkedin.com/in/piyush-kumar-42a745172/",
    linkedinLabel: "LinkedIn",
  };
})(typeof window !== "undefined" ? window : globalThis);
