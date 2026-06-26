(function () {
  "use strict";

  var YEAR = new Date().getFullYear();
  var contact = (typeof window !== "undefined" && window.AYZEN_CONTACT) || {
    telegram: "https://t.me/ayzenstudios",
    telegramHandle: "Telegram",
    whatsapp: "https://wa.me/919205726749",
    linkedin: "https://www.linkedin.com/in/piyush-kumar-42a745172/",
    linkedinLabel: "LinkedIn",
  };

  function footerMarkup() {
    return (
      '<footer class="site-footer site-footer--rich" aria-label="Site footer">' +
        '<div class="site-footer__inner">' +
          '<div class="site-footer__top">' +
            '<div class="site-footer__brand">' +
              '<a class="site-footer__logo" href="/">Ayzen Studios</a>' +
              '<p class="site-footer__tagline">Independent game studio building Unity games, gesture web experiences, and practical AI tools.</p>' +
            "</div>" +
            '<div class="site-footer__cols">' +
              '<div class="site-footer__col">' +
                "<h3>Studio</h3>" +
                "<ul>" +
                  '<li><a href="/#about">About</a></li>' +
                  '<li><a href="/#work">Our work</a></li>' +
                  '<li><a href="/#playstore">Play Store</a></li>' +
                  '<li><a href="/#contact">Contact</a></li>' +
                "</ul>" +
              "</div>" +
              '<div class="site-footer__col">' +
                "<h3>Play</h3>" +
                "<ul>" +
                  '<li><a href="/games">Gesture games</a></li>' +
                  '<li><a href="/soundora">Soundora</a></li>' +
                  '<li><a href="/leaderboard">Leaderboard</a></li>' +
                  '<li><a href="/login">Login</a></li>' +
                "</ul>" +
              "</div>" +
              '<div class="site-footer__col">' +
                "<h3>Legal</h3>" +
                "<ul>" +
                  '<li><a href="/support">Support</a></li>' +
                  '<li><a href="/terms">Terms</a></li>' +
                  '<li><a href="/privacy">Privacy</a></li>' +
                  '<li><a href="/refunds">Refunds</a></li>' +
                "</ul>" +
              "</div>" +
              '<div class="site-footer__col">' +
                "<h3>Connect</h3>" +
                "<ul>" +
                  '<li><a href="' + contact.whatsapp + '" target="_blank" rel="noopener noreferrer">WhatsApp</a></li>' +
                  '<li><a href="' + contact.telegram + '" target="_blank" rel="noopener noreferrer">' + contact.telegramHandle + '</a></li>' +
                  '<li><a href="' + contact.linkedin + '" target="_blank" rel="noopener noreferrer">' + contact.linkedinLabel + '</a></li>' +
                "</ul>" +
              "</div>" +
            "</div>" +
          "</div>" +
          '<div class="site-footer__bottom">' +
            "<p>© " + YEAR + " Ayzen Studios. All rights reserved.</p>" +
            '<p class="site-footer__made">Crafted with care in India</p>' +
          "</div>" +
        "</div>" +
      "</footer>"
    );
  }

  function mount() {
    if (document.querySelector(".site-footer--rich")) return;

    var html = footerMarkup();
    var root = document.getElementById("site-footer-root");
    var existing = document.querySelector(".site-footer");

    if (root) {
      root.innerHTML = html;
      return;
    }
    if (existing) {
      existing.outerHTML = html;
      return;
    }

    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
