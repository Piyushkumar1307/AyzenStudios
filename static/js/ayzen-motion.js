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

  /* ---------- scroll stack helpers (one card full at a time) ---------- */
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function hideStackCard(card, i, transform) {
    card.style.opacity = "0";
    card.style.visibility = "hidden";
    card.style.filter = "none";
    card.style.pointerEvents = "none";
    card.style.transform = transform || "scale(0.96) translateY(48px)";
    card.style.zIndex = String(i);
    card.classList.remove("is-active");
  }

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function crossfadeAmount(frac, hold) {
    hold = hold == null ? 0.62 : hold;
    if (frac <= hold) return 0;
    return clamp01((frac - hold) / (1 - hold));
  }

  function scrollPhase(raw, n) {
    var idx = Math.floor(raw);
    if (idx >= n - 1) return { activeIdx: n - 1, frac: 0 };
    if (idx < 0) return { activeIdx: 0, frac: 0 };
    return { activeIdx: idx, frac: raw - idx };
  }

  function scrollStep(raw, n) {
    var phase = scrollPhase(raw, n);
    return { idx: phase.activeIdx, frac: phase.frac };
  }

  function dotIndex(raw, n) {
    return clampNum(Math.floor(raw + 0.5), 0, n - 1);
  }

  function activeDotIndex(raw, n) {
    return dotIndex(raw, n);
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
      cards.forEach(function (card) {
        card.style.opacity = "";
        card.style.visibility = "";
        card.style.transform = "";
        card.style.filter = "";
        card.style.pointerEvents = "";
        card.style.zIndex = "";
        card.classList.remove("is-active");
      });
      return;
    }

    var ticking = false;
    var segmentPx = 0;
    var pinHeight = 0;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function measure() {
      pinHeight = pin.offsetHeight;
      segmentPx = window.innerHeight * 0.68;
      wrap.style.height = ((n - 1) * segmentPx + pinHeight) + "px";
    }

    function applyCard(card, i, raw) {
      var phase = scrollPhase(raw, n);
      var activeIdx = phase.activeIdx;
      var frac = phase.frac;
      var t = crossfadeAmount(frac);

      if (i < activeIdx) {
        hideStackCard(card, i, "scale(1) translateY(-56px)");
      } else if (i === activeIdx) {
        if (activeIdx === n - 1) {
          card.style.visibility = "visible";
          card.style.pointerEvents = "";
          card.style.opacity = "1";
          card.style.filter = "none";
          card.style.transform = "scale(1) translateY(0)";
          card.style.zIndex = String(100 + i);
          card.classList.add("is-active");
        } else if (t <= 0) {
          card.style.visibility = "visible";
          card.style.pointerEvents = "";
          card.style.opacity = "1";
          card.style.filter = "none";
          card.style.transform = "scale(1) translateY(0)";
          card.style.zIndex = String(100 + i);
          card.classList.add("is-active");
        } else {
          card.style.visibility = "visible";
          card.style.pointerEvents = "none";
          card.style.opacity = String(1 - t);
          card.style.filter = "none";
          card.style.transform = "scale(" + (1 - t * 0.04) + ") translateY(" + (-t * 52) + "px)";
          card.style.zIndex = String(100 + i);
          card.classList.remove("is-active");
        }
      } else if (i === activeIdx + 1) {
        if (t <= 0) {
          hideStackCard(card, i, "scale(0.94) translateY(64px)");
        } else {
          card.style.visibility = "visible";
          card.style.filter = "none";
          card.style.zIndex = String(101 + i);
          card.style.opacity = String(t);
          card.style.pointerEvents = t > 0.85 ? "" : "none";
          card.style.transform = "scale(" + (0.94 + t * 0.06) + ") translateY(" + ((1 - t) * 64) + "px)";
          card.classList.toggle("is-active", t >= 0.85);
        }
      } else {
        hideStackCard(card, i, "scale(0.94) translateY(64px)");
      }
    }

    function update() {
      var rect = wrap.getBoundingClientRect();
      var scrollable = wrap.offsetHeight - pinHeight;
      var scrolled = clamp(-rect.top, 0, scrollable);
      var progress = scrollable <= 0 ? 0 : scrolled / scrollable;
      var raw = progress * (n - 1);

      cards.forEach(function (card, i) { applyCard(card, i, raw); });

      var activeIdx = dotIndex(raw, n);
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
      cards.forEach(function (card) {
        card.style.opacity = "";
        card.style.visibility = "";
        card.style.transform = "";
        card.style.filter = "";
        card.style.pointerEvents = "";
        card.style.zIndex = "";
        card.classList.remove("is-active");
      });
      return;
    }

    var ticking = false;
    var segmentPx = 0;
    var pinHeight = 0;

    function measure() {
      pinHeight = pin.offsetHeight;
      segmentPx = window.innerHeight * 0.65;
      wrap.style.height = ((n - 1) * segmentPx + pinHeight) + "px";
    }

    function applySlideAlt(card, i, raw) {
      var step = scrollStep(raw, n);
      var idx = step.idx;
      var t = crossfadeAmount(step.frac);
      var fromX = i % 2 === 0 ? -140 : 140;

      if (i < idx) {
        hideStackCard(card, i, "translateX(" + (-fromX * 0.25) + "px) scale(0.96)");
      } else if (i === idx) {
        card.style.visibility = "visible";
        card.style.filter = "none";
        card.style.zIndex = String(100 + i);
        if (idx === n - 1 || t <= 0) {
          card.style.opacity = "1";
          card.style.pointerEvents = "";
          card.style.transform = "translateX(0) rotateY(0deg) scale(1)";
          card.classList.add("is-active");
        } else {
          card.style.opacity = String(1 - t);
          card.style.pointerEvents = "none";
          card.style.transform = "translateX(" + (-t * fromX * 0.35) + "px) rotateY(" + (-t * (i % 2 === 0 ? -8 : 8)) + "deg) scale(" + (1 - t * 0.04) + ")";
          card.classList.remove("is-active");
        }
      } else if (i === idx + 1) {
        if (t <= 0) {
          hideStackCard(card, i, "translateX(" + fromX + "px) scale(0.92)");
        } else {
          card.style.visibility = "visible";
          card.style.filter = "none";
          card.style.zIndex = String(101 + i);
          card.style.opacity = String(t);
          card.style.pointerEvents = t > 0.85 ? "" : "none";
          card.style.transform = "translateX(" + (fromX * (1 - t)) + "px) rotateY(" + ((i % 2 === 0 ? -12 : 12) * (1 - t)) + "deg) scale(" + (0.92 + t * 0.08) + ")";
          card.classList.toggle("is-active", t >= 0.85);
        }
      } else {
        hideStackCard(card, i, "translateX(" + fromX + "px) scale(0.92)");
      }
    }

    function applyFan(card, i, raw) {
      var step = scrollStep(raw, n);
      var idx = step.idx;
      var t = crossfadeAmount(step.frac);
      var mid = (n - 1) / 2;
      var fanRot = (i - mid) * 14;
      var fanX = (i - mid) * 72;

      if (i < idx) {
        hideStackCard(card, i, "translateY(-48px) scale(0.96) rotateZ(" + (fanRot * 0.5) + "deg)");
      } else if (i === idx) {
        card.style.visibility = "visible";
        card.style.filter = "none";
        card.style.zIndex = String(100 + i);
        if (idx === n - 1 || t <= 0) {
          card.style.opacity = "1";
          card.style.pointerEvents = "";
          card.style.transform = "translate(0, 0) scale(1) rotateZ(0deg)";
          card.classList.add("is-active");
        } else {
          card.style.opacity = String(1 - t);
          card.style.pointerEvents = "none";
          card.style.transform = "translate(" + (t * fanX * 0.2) + "px, " + (-t * 48) + "px) scale(" + (1 - t * 0.04) + ") rotateZ(" + (t * fanRot * 0.3) + "deg)";
          card.classList.remove("is-active");
        }
      } else if (i === idx + 1) {
        if (t <= 0) {
          hideStackCard(card, i, "translate(" + fanX + "px, 72px) scale(0.88) rotateZ(" + fanRot + "deg)");
        } else {
          card.style.visibility = "visible";
          card.style.filter = "none";
          card.style.zIndex = String(101 + i);
          card.style.opacity = String(t);
          card.style.pointerEvents = t > 0.85 ? "" : "none";
          card.style.transform = "translate(" + (fanX * (1 - t)) + "px, " + ((1 - t) * 72) + "px) scale(" + (0.88 + t * 0.12) + ") rotateZ(" + (fanRot * t) + "deg)";
          card.classList.toggle("is-active", t >= 0.85);
        }
      } else {
        hideStackCard(card, i, "translate(" + fanX + "px, 72px) scale(0.88) rotateZ(" + fanRot + "deg)");
      }
    }

    function update() {
      var rect = wrap.getBoundingClientRect();
      var scrollable = wrap.offsetHeight - pinHeight;
      var scrolled = clampNum(-rect.top, 0, scrollable);
      var progress = scrollable <= 0 ? 0 : scrolled / scrollable;
      var raw = progress * (n - 1);

      cards.forEach(function (card, i) {
        if (effect === "slide-alt") applySlideAlt(card, i, raw);
        else applyFan(card, i, raw);
      });

      var dotIdx = activeDotIndex(raw, n);
      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === dotIdx);
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

  /* ---------- product shelf nav ---------- */
  function initProductShelves() {
    document.querySelectorAll("[data-shelf-prev], [data-shelf-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-shelf-prev") || btn.getAttribute("data-shelf-next");
        var shelf = id && document.getElementById(id);
        if (!shelf) return;
        var tile = shelf.querySelector(".product-tile");
        var step = tile ? tile.offsetWidth + 16 : 360;
        var dir = btn.hasAttribute("data-shelf-prev") ? -1 : 1;
        shelf.scrollBy({ left: dir * step, behavior: REDUCED ? "auto" : "smooth" });
      });
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    buildOverlay();
    playEnter();
    initReveal();
    initWordRotate();
    initCount();
    initProductShelves();
    if (document.getElementById("servicesScroll")) initServicesStack();
    if (document.getElementById("workScroll")) initCardScroll("workScroll", "slide-alt");
    if (document.getElementById("playScroll")) initCardScroll("playScroll", "fan");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
