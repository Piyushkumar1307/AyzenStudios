/* Persistent site-wide day/night theme control. */
(function () {
  "use strict";

  var KEY = "ayzen-studios-theme";
  var root = document.documentElement;

  function savedTheme() {
    try {
      var stored = localStorage.getItem(KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch (_) {}
    return "dark";
  }

  function setTheme(theme) {
    var next = theme === "light" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (_) {}

    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = next === "light" ? "#f3f7fc" : "#05070d";

    document.querySelectorAll("[data-ayz-theme-toggle]").forEach(function (button) {
      button.textContent = next === "light" ? "🌙" : "☀️";
      button.setAttribute("aria-label", next === "light" ? "Switch to night mode" : "Switch to day mode");
      button.title = button.getAttribute("aria-label");
    });
  }

  function mountToggle() {
    /* Homepage and games already own #themeBtn and their existing handlers. */
    if (document.getElementById("themeBtn") || document.querySelector("[data-ayz-theme-toggle]")) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "ayz-theme-toggle";
    button.dataset.ayzThemeToggle = "";
    button.addEventListener("click", function () {
      setTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light");
    });

    var slots = Array.prototype.slice.call(document.querySelectorAll(
      ".product-page-nav, .site-header__inner, .header-actions, .mobile-header-actions, .top, .doc-top, .bar"
    ));
    var slot = slots.find(function (candidate) {
      return candidate.getClientRects().length > 0;
    });
    if (slot) slot.appendChild(button);
    else {
      button.classList.add("ayz-theme-toggle--floating");
      document.body.appendChild(button);
    }
    setTheme(root.getAttribute("data-theme"));
  }

  /* Apply early when loaded from favicon-set.js, then add the visible control
     after the route's own markup exists. */
  setTheme(savedTheme());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountToggle, { once: true });
  else mountToggle();

  window.addEventListener("storage", function (event) {
    if (event.key === KEY) setTheme(event.newValue);
  });
})();
