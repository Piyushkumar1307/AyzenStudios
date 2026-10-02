/* Force the same Ayzen Studios "A" tab icon on every route (avoids per-path Safari cache). */
(function () {
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<defs>' +
    '<linearGradient id="st" x1="32" y1="22" x2="96" y2="108" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#f4f8ff"/><stop offset="0.55" stop-color="#aebccd"/><stop offset="1" stop-color="#5d6b7e"/></linearGradient>' +
    '<linearGradient id="bl" x1="64" y1="20" x2="92" y2="104" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#7fdcff"/><stop offset="1" stop-color="#1f6dff"/></linearGradient>' +
    '<filter id="gl" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#2e9bff" flood-opacity="0.55"/></filter></defs>' +
    '<rect width="128" height="128" rx="28" fill="#05070d"/>' +
    '<g filter="url(#gl)">' +
    '<path d="M64 22 30 104h17l17-44 9 24h-9l-6 16h31L64 22z" fill="url(#st)"/>' +
    '<path d="M64 22l34 82H81L64 60v-2l0-36z" fill="url(#bl)" opacity="0.92"/>' +
    '<path d="M48 78c14-6 26-18 40-40-8 22-20 36-34 44z" fill="#bfe6ff" opacity="0.9"/></g></svg>';
  var href = "data:image/svg+xml," + encodeURIComponent(svg);

  function applyStoredTheme() {
    try {
      var saved = localStorage.getItem("ayzen-studios-theme");
      document.documentElement.setAttribute("data-theme", saved === "light" || saved === "dark" ? saved : "dark");
    } catch (_) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }

  function apply() {
    var head = document.head;
    if (!head) return;
    head.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(function (n) {
      n.remove();
    });
    var icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = href;
    icon.setAttribute("sizes", "any");
    head.insertBefore(icon, head.firstChild);
    var touch = document.createElement("link");
    touch.rel = "apple-touch-icon";
    touch.href = href;
    head.appendChild(touch);
  }

  // Add the shared UI enhancement layer after each page has declared its own
  // styles, so it can consistently enhance every normal site route.
  function installUiLayer() {
    if (document.getElementById("ayzen-ui-motion-css")) return;
    var head = document.head;
    if (!head) return;
    var css = document.createElement("link");
    css.id = "ayzen-ui-motion-css";
    css.rel = "stylesheet";
    css.href = "/css/ui-motion.css?v=3";
    head.appendChild(css);

    var script = document.createElement("script");
    script.id = "ayzen-ui-motion-js";
    script.src = "/js/ui-motion.js?v=3";
    script.async = false;
    head.appendChild(script);
  }

  function installThemeLayer() {
    if (document.getElementById("ayzen-theme-toggle-css")) return;
    var head = document.head;
    if (!head) return;
    var css = document.createElement("link");
    css.id = "ayzen-theme-toggle-css";
    css.rel = "stylesheet";
    css.href = "/css/theme-toggle.css?v=1";
    head.appendChild(css);

    var script = document.createElement("script");
    script.id = "ayzen-theme-toggle-js";
    script.src = "/js/theme-toggle.js?v=1";
    script.async = false;
    head.appendChild(script);
  }

  applyStoredTheme();
  apply();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      installThemeLayer();
      installUiLayer();
    }, { once: true });
  } else {
    installThemeLayer();
    installUiLayer();
  }
})();
