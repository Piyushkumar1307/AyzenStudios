/* ============================================================
   Ayzen Studios — motion engine
   - Next.js-style page transitions (animated wipe between routes)
   - Scroll reveals for [data-reveal] and legacy .reveal
   - Subtle entrance animation on load
   Respects prefers-reduced-motion. Skips canvas/game pages via
   <body data-no-transition> if needed.
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MOBILE = window.matchMedia &&
    window.matchMedia("(max-width: 768px)").matches;
  var LOGO = "/assets/brand/ayzen-logo.png";

  /* ---------- overlay ---------- */
  var overlay;
  function buildOverlay() {
    if (document.querySelector(".ayz-transition")) return;
    overlay = document.createElement("div");
    overlay.className = "ayz-transition";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<img class="ayz-transition__mark" src="' + LOGO + '" alt="" width="64" height="64">';
    document.body.appendChild(overlay);
  }

  /* ---------- entrance ---------- */
  function playEnter() {
    if (REDUCED) return;
    var main = document.querySelector("main") ||
      document.querySelector(".page-shell") ||
      document.body;
    if (!main) return;
    main.classList.add("ayz-page-enter");
    main.addEventListener("animationend", function () {
      main.classList.remove("ayz-page-enter");
    }, { once: true });
  }

  /* ---------- route transitions ---------- */
  function sameOrigin(href) {
    try {
      var u = new URL(href, window.location.href);
      return u.origin === window.location.origin;
    } catch (_) { return false; }
  }

  function isInternalNav(a) {
    if (!a) return false;
    if (a.target && a.target !== "_self") return false;
    if (a.hasAttribute("download")) return false;
    if (a.dataset.noTransition !== undefined) return false;
    var href = a.getAttribute("href");
    if (!href) return false;
    if (href[0] === "#") return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    if (!sameOrigin(href)) return false;
    var u = new URL(href, window.location.href);
    // ignore in-page anchors to same path
    if (u.pathname === window.location.pathname && u.hash) return false;
    return true;
  }

  function go(href) {
    if (REDUCED || !overlay) { window.location.href = href; return; }
    overlay.classList.add("is-active");
    var done = false;
    function navigate() {
      if (done) return;
      done = true;
      window.location.href = href;
    }
    setTimeout(navigate, 480);
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a");
    if (!isInternalNav(a)) return;
    e.preventDefault();
    go(a.href);
  });

  // Clear overlay when restored from bfcache (back/forward)
  window.addEventListener("pageshow", function (ev) {
    if (overlay) overlay.classList.remove("is-active");
    if (ev.persisted) playEnter();
  });

  /* ---------- scroll reveal ---------- */
  function initReveal() {
    var els = document.querySelectorAll("[data-reveal], .reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window) || REDUCED) {
      els.forEach(function (el) {
        el.classList.add("is-in", "visible");
      });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("is-in", "visible");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        el.classList.add("is-in", "visible");
      } else {
        io.observe(el);
      }
    });
  }

  /* ---------- kinetic word rotator ---------- */
  function initWordRotate() {
    document.querySelectorAll(".word-rotate").forEach(function (el) {
      var words = (el.getAttribute("data-words") || "")
        .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var cur = el.querySelector(".word-rotate__cur") || el;
      if (words.length < 2) return;
      if (REDUCED) { cur.textContent = words[0]; return; }
      var i = 0;
      setInterval(function () {
        cur.style.transition = "transform 0.32s ease, opacity 0.32s ease";
        cur.style.transform = "translateY(-0.65em)";
        cur.style.opacity = "0";
        setTimeout(function () {
          i = (i + 1) % words.length;
          cur.textContent = words[i];
          cur.style.transition = "none";
          cur.style.transform = "translateY(0.65em)";
          cur.style.opacity = "0";
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              cur.style.transition = "transform 0.42s cubic-bezier(0.22,1,0.36,1), opacity 0.42s ease";
              cur.style.transform = "translateY(0)";
              cur.style.opacity = "1";
            });
          });
        }, 340);
      }, 2600);
    });
  }

  /* ---------- count-up numbers ---------- */
  function runCount(el) {
    var target = parseFloat(el.getAttribute("data-count")) || 0;
    var suffix = el.getAttribute("data-suffix") || "";
    if (REDUCED) { el.textContent = target + suffix; return; }
    var dur = 1500, start = null;
    function tick(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + (p === 1 ? suffix : "");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function initCount() {
    var els = document.querySelectorAll("[data-count]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach(runCount);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { runCount(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- services scroll stack ---------- */
  function initServicesStack() {
    var wrap = document.getElementById("servicesScroll");
    if (!wrap) return;
    var pin = wrap.querySelector(".services-scroll__pin");
    var cards = wrap.querySelectorAll(".service-stack-card");
    var dots = wrap.querySelectorAll(".services-scroll__dot");
    var n = cards.length;
    if (!n || !pin) return;

    if (REDUCED || MOBILE) {
      wrap.classList.add("is-reduced");
      return;
    }

    var ticking = false;
    var segmentPx = 0;
    var pinHeight = 0;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function measure() {
      pinHeight = pin.offsetHeight;
      segmentPx = window.innerHeight * 0.52;
      wrap.style.height = (n * segmentPx + pinHeight) + "px";
    }

    function applyCard(card, i, raw) {
      var cardRaw = raw - i;
      if (cardRaw < 0) {
        card.style.transform = "scale(0.86) translateY(90px)";
        card.style.opacity = "0";
        card.style.filter = "blur(8px)";
        card.style.zIndex = String(i);
        card.classList.remove("is-active");
      } else if (cardRaw <= 1) {
        var p = cardRaw;
        var scale = 0.86 + p * 0.14;
        var y = 90 * (1 - p);
        card.style.transform = "scale(" + scale + ") translateY(" + y + "px)";
        card.style.opacity = String(p);
        card.style.filter = "blur(" + (8 * (1 - p)) + "px)";
        card.style.zIndex = String(100 + i);
        card.classList.toggle("is-active", p > 0.55);
      } else {
        var behind = cardRaw - 1;
        var scale = 1 - behind * 0.045;
        var y = -behind * 34;
        var op = clamp(1 - behind * 0.42, 0.08, 1);
        card.style.transform = "scale(" + scale + ") translateY(" + y + "px)";
        card.style.opacity = String(op);
        card.style.filter = "blur(" + clamp(behind * 2.5, 0, 5) + "px)";
        card.style.zIndex = String(i);
        card.classList.remove("is-active");
      }
    }

    function update() {
      var rect = wrap.getBoundingClientRect();
      var scrollable = wrap.offsetHeight - pinHeight;
      var scrolled = clamp(-rect.top, 0, scrollable);
      var progress = scrollable <= 0 ? 0 : scrolled / scrollable;
      var raw = progress * n;

      cards.forEach(function (card, i) { applyCard(card, i, raw); });

      var activeIdx = clamp(Math.floor(raw), 0, n - 1);
      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === activeIdx);
      });

      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    measure();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
      measure();
      update();
    });
  }

  /* ---------- work / play scroll stacks (different effects) ---------- */
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function initCardScroll(wrapId, effect) {
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    var pin = wrap.querySelector(".card-scroll__pin");
    var cards = wrap.querySelectorAll(".card-scroll-item");
    var dots = wrap.querySelectorAll(".card-scroll__dot");
    var n = cards.length;
    if (!n || !pin) return;

    if (REDUCED || MOBILE) {
      wrap.classList.add("is-reduced");
      return;
    }

    var ticking = false;
    var segmentPx = 0;
    var pinHeight = 0;

    function measure() {
      pinHeight = pin.offsetHeight;
      segmentPx = window.innerHeight * 0.46;
      wrap.style.height = (n * segmentPx + pinHeight) + "px";
    }

    function applySlideAlt(card, i, raw) {
      var cardRaw = raw - i;
      var fromX = i % 2 === 0 ? -180 : 180;
      var rotY = i % 2 === 0 ? -24 : 24;
      if (cardRaw < 0) {
        card.style.transform = "translateX(" + fromX + "px) rotateY(" + rotY + "deg) scale(0.8)";
        card.style.opacity = "0";
        card.style.filter = "blur(12px)";
        card.style.zIndex = String(i);
        card.classList.remove("is-active");
      } else if (cardRaw <= 1) {
        var p = cardRaw;
        var x = fromX * (1 - p);
        var ry = rotY * (1 - p);
        var scale = 0.8 + p * 0.2;
        card.style.transform = "translateX(" + x + "px) rotateY(" + ry + "deg) scale(" + scale + ")";
        card.style.opacity = String(p);
        card.style.filter = "blur(" + (12 * (1 - p)) + "px)";
        card.style.zIndex = String(100 + i);
        card.classList.toggle("is-active", p > 0.55);
      } else {
        var behind = cardRaw - 1;
        var exitX = (i % 2 === 0 ? -1 : 1) * behind * 32;
        card.style.transform = "translateX(" + exitX + "px) scale(" + (1 - behind * 0.05) + ") translateY(" + (-behind * 30) + "px)";
        card.style.opacity = String(clampNum(1 - behind * 0.45, 0.1, 1));
        card.style.filter = "blur(" + clampNum(behind * 2.5, 0, 5) + "px)";
        card.style.zIndex = String(i);
        card.classList.remove("is-active");
      }
    }

    function applyFan(card, i, raw) {
      var cardRaw = raw - i;
      var mid = (n - 1) / 2;
      var fanRot = (i - mid) * 16;
      var fanX = (i - mid) * 90;
      if (cardRaw < 0) {
        card.style.transform = "translateY(110px) scale(0.62) rotateZ(" + fanRot + "deg) rotateX(22deg)";
        card.style.opacity = "0";
        card.style.filter = "blur(10px)";
        card.style.zIndex = String(i);
        card.classList.remove("is-active");
      } else if (cardRaw <= 1) {
        var p = cardRaw;
        var y = 110 * (1 - p);
        var scale = 0.62 + p * 0.38;
        var rx = 22 * (1 - p);
        card.style.transform = "translateY(" + y + "px) scale(" + scale + ") rotateZ(" + (fanRot * p) + "deg) rotateX(" + rx + "deg)";
        card.style.opacity = String(p);
        card.style.filter = "blur(" + (10 * (1 - p)) + "px)";
        card.style.zIndex = String(100 + i);
        card.classList.toggle("is-active", p > 0.55);
      } else {
        var behind = cardRaw - 1;
        var scale = 0.94 - behind * 0.05;
        card.style.transform = "translate(" + fanX + "px, " + (-behind * 22) + "px) scale(" + scale + ") rotateZ(" + fanRot + "deg)";
        card.style.opacity = String(clampNum(0.88 - behind * 0.38, 0.12, 1));
        card.style.filter = "blur(" + clampNum(behind * 2, 0, 4) + "px)";
        card.style.zIndex = String(i);
        card.classList.remove("is-active");
      }
    }

    function update() {
      var rect = wrap.getBoundingClientRect();
      var scrollable = wrap.offsetHeight - pinHeight;
      var scrolled = clampNum(-rect.top, 0, scrollable);
      var progress = scrollable <= 0 ? 0 : scrolled / scrollable;
      var raw = progress * n;

      cards.forEach(function (card, i) {
        if (effect === "slide-alt") applySlideAlt(card, i, raw);
        else applyFan(card, i, raw);
      });

      var activeIdx = clampNum(Math.floor(raw), 0, n - 1);
      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === activeIdx);
      });
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    measure();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
      measure();
      update();
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    buildOverlay();
    playEnter();
    initReveal();
    initWordRotate();
    initCount();
    initServicesStack();
    initCardScroll("workScroll", "slide-alt");
    initCardScroll("playScroll", "fan");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
