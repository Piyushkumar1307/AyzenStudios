/* Ayzen Studios — mobile navigation (hamburger menus) */
(function () {
  "use strict";

  var BP = 900;

  function toggleHtml() {
    return (
      '<span class="mobile-nav-toggle__bars" aria-hidden="true">' +
        '<span class="mobile-nav-toggle__bar"></span>' +
        '<span class="mobile-nav-toggle__bar"></span>' +
        '<span class="mobile-nav-toggle__bar"></span>' +
      "</span>"
    );
  }

  function makeBackdrop() {
    var el = document.querySelector(".mobile-nav-backdrop");
    if (el) return el;
    el = document.createElement("div");
    el.className = "mobile-nav-backdrop";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    return el;
  }

  function bindDrawer(toggle, panel, backdrop) {
    if (!toggle || !panel || toggle.dataset.bound) return;
    toggle.dataset.bound = "1";

    function close() {
      panel.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      backdrop.classList.remove("is-open");
      document.body.classList.remove("mobile-nav-open");
    }

    function open() {
      panel.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
      backdrop.classList.add("is-open");
      document.body.classList.add("mobile-nav-open");
    }

    toggle.addEventListener("click", function () {
      if (panel.classList.contains("is-open")) close();
      else open();
    });

    backdrop.addEventListener("click", close);

    panel.querySelectorAll("a, button.nav-link").forEach(function (el) {
      el.addEventListener("click", function () {
        if (window.innerWidth <= BP) close();
      });
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > BP) close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
  }

  function initSiteHeader() {
    var header = document.querySelector(".site-header");
    if (!header || header.dataset.mobileNav) return;
    var nav = header.querySelector(".nav-main");
    if (!nav) return;
    header.dataset.mobileNav = "1";

    var inner = header.querySelector(".site-header__inner") || header;
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mobile-nav-toggle";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = toggleHtml();
    inner.appendChild(toggle);

    bindDrawer(toggle, nav, makeBackdrop());
  }

  function initTopNav() {
    document.querySelectorAll(".top").forEach(function (top) {
      if (top.dataset.mobileNav) return;
      var nav = top.querySelector(".nav");
      if (!nav || !nav.querySelector("a")) return;
      top.dataset.mobileNav = "1";
      top.classList.add("top--mobile-nav");

      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mobile-nav-toggle";
      toggle.setAttribute("aria-label", "Open menu");
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = toggleHtml();
      top.appendChild(toggle);

      bindDrawer(toggle, nav, makeBackdrop());
    });
  }

  function boot() {
    initSiteHeader();
    initTopNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
