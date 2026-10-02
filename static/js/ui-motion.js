/* Shared enhancement layer for all non-canvas Ayzen pages. */
(function () {
  "use strict";
  if (window.__ayzenUiMotion) return;
  window.__ayzenUiMotion = true;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealSelector = [
    "main > section", "main > article", ".section-head", ".card", ".product-tile",
    ".fs-card", ".wa-card", ".pb-card", ".gr-card", ".contact-aside",
    ".package-card", ".service-card", ".game-card", ".reg-mode-card", ".caps .cap"
  ].join(",");
  var interactiveSelector = [
    ".card", ".fs-card", ".wa-card", ".pb-card", ".gr-card", ".contact-aside",
    ".package-card", ".service-card", ".game-card", ".reg-mode-card"
  ].join(",");

  function initParallax() {
    if (reduce || !document.body.classList.contains("apple-home")) return;
    var main = document.querySelector("main");
    if (!main) return;

    var progress = document.createElement("div");
    progress.className = "ui-scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    document.body.appendChild(progress);

    main.querySelectorAll(":scope > section").forEach(function (section, index) {
      if (section.hidden) return;
      var orb = document.createElement("span");
      orb.className = "ui-section-orb ui-section-orb--" + (index % 3);
      orb.setAttribute("aria-hidden", "true");
      orb.dataset.parallax = "";
      orb.dataset.parallaxSpeed = index % 2 ? "-0.09" : "0.1";
      section.insertBefore(orb, section.firstChild);
    });

    var layers = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
    var hero = document.querySelector(".apple-home .hero");
    var work = document.getElementById("work");
    var frame = null;

    function paint() {
      frame = null;
      var viewport = window.innerHeight || 1;
      var doc = document.documentElement;
      var scrollable = Math.max(1, doc.scrollHeight - viewport);
      progress.style.setProperty("--ui-scroll-progress", (window.scrollY / scrollable * 100).toFixed(2) + "%");

      layers.forEach(function (layer) {
        var speed = parseFloat(layer.dataset.parallaxSpeed || "0.1");
        var rect = layer.getBoundingClientRect();
        var centerOffset = viewport / 2 - (rect.top + rect.height / 2);
        var amount = Math.max(-130, Math.min(130, centerOffset * speed));
        layer.style.setProperty("--parallax-y", amount.toFixed(1) + "px");
      });

      // The hero recedes only as the work surface reaches the viewport. This
      // creates depth without translating the content the visitor is reading.
      if (hero && work) {
        var workTop = work.getBoundingClientRect().top;
        var reveal = Math.max(0, Math.min(1, (viewport - workTop) / (viewport * .8)));
        hero.style.setProperty("--hero-scroll-opacity", (1 - reveal * .62).toFixed(3));
        hero.style.setProperty("--hero-scroll-scale", (1 - reveal * .055).toFixed(3));
        hero.style.setProperty("--hero-scroll-blur", (reveal * 3).toFixed(2) + "px");
      }
    }
    function requestPaint() {
      if (!frame) frame = requestAnimationFrame(paint);
    }
    window.addEventListener("scroll", requestPaint, { passive: true });
    window.addEventListener("resize", requestPaint, { passive: true });
    paint();
  }

  function start() {
    var revealItems = Array.prototype.slice.call(document.querySelectorAll(revealSelector));
    document.querySelectorAll(interactiveSelector).forEach(function (item) {
      item.dataset.uiInteractive = "";
    });

    initParallax();

    if (reduce || !revealItems.length) {
      revealItems.forEach(function (item) { item.classList.add("is-ui-visible"); });
      return;
    }

    document.documentElement.classList.add("ui-motion-ready");
    revealItems.forEach(function (item, index) {
      item.dataset.uiReveal = "";
      item.style.setProperty("--ui-delay", Math.min(index % 5, 4) * 65 + "ms");
    });

    if (!("IntersectionObserver" in window)) {
      revealItems.forEach(function (item) { item.classList.add("is-ui-visible"); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-ui-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: .09, rootMargin: "0px 0px -5% 0px" });

    revealItems.forEach(function (item) {
      var rect = item.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) item.classList.add("is-ui-visible");
      else observer.observe(item);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
