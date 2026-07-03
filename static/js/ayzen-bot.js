/**
 * AYZEN Bot — Zomato-style assistant with predefined answers.
 * Loaded site-wide via site-footer.js.
 */
(function () {
  "use strict";

  if (document.body && document.body.hasAttribute("data-no-bot")) return;
  if (document.getElementById("ayzBot")) return;

  var contact = (typeof window !== "undefined" && window.AYZEN_CONTACT) || {
    whatsapp: "https://wa.me/919205726749",
    telegram: "https://t.me/ayzenstudios",
  };

  var WA =
    contact.whatsapp +
    (contact.whatsapp.indexOf("?") >= 0 ? "&" : "?") +
    "text=" +
    encodeURIComponent("Hi Ayzen Studios, I need help with…");

  /* ---------- knowledge base ---------- */
  var TOPICS = {
    studio: {
      label: "What is Ayzen Studios?",
      keywords: ["ayzen", "studio", "about", "who", "company", "what do you"],
      answer:
        "Ayzen Studios is an independent game & AI studio.\n\nWe build Unity games, gesture-driven web experiences, WebGL games with phone controllers, and practical AI tools like Soundora and Face Swap Studio.",
      chips: ["main", "games", "ai", "hire"],
    },
    games: {
      label: "Gesture games",
      keywords: ["gesture", "hand", "camera", "fruit", "runner", "puzzle", "tic"],
      answer:
        "Play free gesture games in your browser — use your hand via webcam.\n\n• Fruit-Ninja style slicing\n• Neon Runner\n• Neon Pop\n• Tic-Tac-Toe\n\nOpen the games catalog to start.",
      link: { href: "/games", text: "Open gesture games →" },
      chips: ["main", "webgl", "leaderboard", "contact"],
    },
    webgl: {
      label: "WebGL + phone controller",
      keywords: ["webgl", "phone", "controller", "traffic", "unity", "browser game"],
      answer:
        "Our WebGL games run on your laptop or TV. Your phone becomes the controller — scan a QR code after you press Play.\n\nTry Beat Traffic and Ayzen Fruit Ninja.",
      link: { href: "/webgl", text: "Play WebGL games →" },
      chips: ["main", "games", "hire", "contact"],
    },
    soundora: {
      label: "Soundora (AI music)",
      keywords: ["soundora", "music", "song", "suno", "audio", "track"],
      answer:
        "Soundora is our AI music service.\n\nDescribe a mood or story and get an original track you can play and download. Demo accounts have a limited number of free songs.",
      link: { href: "/soundora", text: "Open Soundora →" },
      chips: ["main", "ai", "hire", "contact"],
    },
    faceswap: {
      label: "Face Swap Studio",
      keywords: ["face", "swap", "faceswap", "event", "activation", "booth"],
      answer:
        "Face Swap Studio is a browser-based AI face-swap experience for live events and brand activations.\n\nCustom templates, mobile-first, no app download. Available on order only.",
      link: { href: "/face-swap", text: "See Face Swap Studio →" },
      chips: ["main", "hire", "contact"],
    },
    playstore: {
      label: "Play Store apps",
      keywords: ["play store", "android", "mobile app", "mad arrows", "zombie", "published"],
      answer:
        "We publish games on Google Play — including Mad Arrows, Zombie Crusher, and Tic Tac Toe.\n\nSee the Play Store section on our homepage for links.",
      link: { href: "/#playstore", text: "View Play Store games →" },
      chips: ["main", "games", "hire"],
    },
    ai: {
      label: "AI tools",
      keywords: ["ai", "artificial", "tool", "pipeline"],
      answer:
        "Our AI lineup:\n\n• Soundora — AI song generation\n• Face Swap Studio — event face-swap (order only)\n• Custom AI pipelines for clients\n\nTell us what you need and we can scope a build.",
      chips: ["soundora", "faceswap", "hire", "main"],
    },
    hire: {
      label: "Hire / pricing",
      keywords: ["hire", "price", "pricing", "cost", "quote", "commission", "project", "work with"],
      answer:
        "We take on commissions for games, kiosk experiences, event tech, and AI tools.\n\nPricing depends on scope, timeline, and platforms. Share a short brief and we’ll reply with next steps.",
      chips: ["contact", "faceswap", "webgl", "main"],
    },
    leaderboard: {
      label: "Leaderboard",
      keywords: ["leaderboard", "score", "rank", "high score"],
      answer:
        "Gesture games have a shared leaderboard. Sign in, play, and climb the ranks.",
      link: { href: "/leaderboard", text: "Open leaderboard →" },
      chips: ["main", "games", "login"],
    },
    login: {
      label: "Account / login",
      keywords: ["login", "sign in", "account", "otp", "password"],
      answer:
        "Use the login page to sign in with email OTP. Your account unlocks Soundora tracks, scores, and profile features.",
      link: { href: "/login", text: "Go to login →" },
      chips: ["main", "soundora", "support"],
    },
    support: {
      label: "Support",
      keywords: ["support", "help", "bug", "issue", "problem", "refund"],
      answer:
        "For account, purchase, or technical issues, visit Support or message us on WhatsApp.\n\nWe aim to reply within 1–2 business days.",
      link: { href: "/support", text: "Open support →" },
      chips: ["contact", "main"],
    },
    contact: {
      label: "Talk to a human",
      keywords: ["contact", "whatsapp", "telegram", "human", "agent", "chat", "call", "email"],
      answer:
        "Happy to connect you with the team.\n\n• WhatsApp — fastest reply\n• Telegram — @ayzenstudios\n• Contact form on the homepage",
      link: { href: WA, text: "Chat on WhatsApp →", external: true },
      chips: ["main", "hire", "support"],
    },
  };

  var MAIN_CHIPS = [
    "studio",
    "games",
    "webgl",
    "soundora",
    "faceswap",
    "playstore",
    "hire",
    "contact",
  ];

  var WELCOME =
    "Hey! I’m AYZEN Bot 👋\n\nI can help you explore our games, AI tools, and how to work with us. Pick a topic below — or type a short question.";

  /* ---------- DOM ---------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function loadCss() {
    if (document.querySelector('link[href*="ayzen-bot.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/ayzen-bot.css?v=2";
    document.head.appendChild(link);
  }

  function build() {
    loadCss();

    var root = el("div", "ayz-bot");
    root.id = "ayzBot";
    root.setAttribute("aria-live", "polite");

    var mark = "/assets/brand/ayzen-bot-mark.svg";

    root.innerHTML =
      '<button type="button" class="ayz-bot__launcher" id="ayzBotLauncher" aria-label="Open AYZEN Bot" aria-expanded="false" aria-controls="ayzBotPanel">' +
        '<span class="ayz-bot__launcher-badge" id="ayzBotBadge">1</span>' +
        '<img class="ayz-bot__launcher-mark" src="' + mark + '" alt="" width="44" height="44" decoding="async">' +
      "</button>" +
      '<div class="ayz-bot__panel" id="ayzBotPanel" role="dialog" aria-label="AYZEN Bot" aria-modal="false" hidden>' +
        '<header class="ayz-bot__head">' +
          '<div class="ayz-bot__avatar">' +
            '<img src="' + mark + '" alt="" width="44" height="44" decoding="async">' +
          "</div>" +
          '<div class="ayz-bot__meta">' +
            '<div class="ayz-bot__name">AYZEN Bot</div>' +
            '<div class="ayz-bot__status">Online · instant replies</div>' +
          "</div>" +
          '<button type="button" class="ayz-bot__close" id="ayzBotClose" aria-label="Close chat">✕</button>' +
        "</header>" +
        '<div class="ayz-bot__messages" id="ayzBotMessages"></div>' +
        '<div class="ayz-bot__chips" id="ayzBotChips" role="group" aria-label="Quick replies"></div>' +
        '<form class="ayz-bot__input-row" id="ayzBotForm">' +
          '<input class="ayz-bot__input" id="ayzBotInput" type="text" placeholder="Type a question…" maxlength="200" autocomplete="off" enterkeyhint="send">' +
          '<button type="submit" class="ayz-bot__send" id="ayzBotSend" aria-label="Send">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
          "</button>" +
        "</form>" +
      "</div>";

    document.body.appendChild(root);
    return root;
  }

  /* ---------- chat logic ---------- */
  var messagesEl;
  var chipsEl;
  var inputEl;
  var busy = false;
  var started = false;

  function scrollBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(text, who, link) {
    var row = el("div", "ayz-bot__row ayz-bot__row--" + who);
    var bubble = el("div", "ayz-bot__bubble");
    bubble.textContent = text;
    if (link && link.href) {
      bubble.appendChild(document.createTextNode("\n\n"));
      var a = document.createElement("a");
      a.href = link.href;
      a.textContent = link.text || "Open →";
      if (link.external) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("data-no-transition", "");
      }
      bubble.appendChild(a);
    }
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollBottom();
  }

  function showTyping() {
    var row = el("div", "ayz-bot__row ayz-bot__row--bot");
    row.id = "ayzBotTyping";
    row.innerHTML = '<div class="ayz-bot__typing" aria-hidden="true"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(row);
    scrollBottom();
  }

  function hideTyping() {
    var t = document.getElementById("ayzBotTyping");
    if (t) t.remove();
  }

  function setChips(ids) {
    chipsEl.innerHTML = "";
    (ids || MAIN_CHIPS).forEach(function (id) {
      var topic = TOPICS[id];
      if (!topic && id !== "main") return;
      var btn = el("button", "ayz-bot__chip");
      btn.type = "button";
      btn.textContent = id === "main" ? "← Main menu" : topic.label;
      btn.dataset.topic = id;
      btn.disabled = busy;
      btn.addEventListener("click", function () {
        if (busy) return;
        if (id === "main") {
          addBubble("Main menu", "user");
          replyWith(
            "Sure — what would you like to know?",
            null,
            MAIN_CHIPS
          );
          return;
        }
        pickTopic(id);
      });
      chipsEl.appendChild(btn);
    });
  }

  function setBusy(v) {
    busy = v;
    var chips = chipsEl.querySelectorAll(".ayz-bot__chip");
    chips.forEach(function (c) { c.disabled = v; });
    var send = document.getElementById("ayzBotSend");
    if (send) send.disabled = v;
    if (inputEl) inputEl.disabled = v;
  }

  function replyWith(text, link, chipIds) {
    setBusy(true);
    showTyping();
    var delay = 450 + Math.min(900, text.length * 8);
    setTimeout(function () {
      hideTyping();
      addBubble(text, "bot", link);
      setChips(chipIds || MAIN_CHIPS);
      setBusy(false);
      scrollBottom();
    }, delay);
  }

  function pickTopic(id) {
    var topic = TOPICS[id];
    if (!topic) return;
    addBubble(topic.label, "user");
    replyWith(topic.answer, topic.link, topic.chips);
  }

  function matchText(raw) {
    var q = (raw || "").toLowerCase().trim();
    if (!q) return null;
    if (/^(hi|hello|hey|hola|namaste)\b/.test(q)) {
      return {
        answer: "Hi there! Pick a topic below or ask about games, Soundora, Face Swap, or hiring us.",
        chips: MAIN_CHIPS,
      };
    }
    if (/menu|options|help|start over/.test(q)) {
      return {
        answer: "Here’s what I can help with:",
        chips: MAIN_CHIPS,
      };
    }

    var best = null;
    var bestScore = 0;
    Object.keys(TOPICS).forEach(function (id) {
      var t = TOPICS[id];
      var score = 0;
      t.keywords.forEach(function (kw) {
        if (q.indexOf(kw) >= 0) score += kw.length;
      });
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    });

    if (best && bestScore > 0) {
      return { answer: best.answer, link: best.link, chips: best.chips };
    }

    return {
      answer:
        "I’m not sure about that yet — I work best with the topics below.\n\nOr chat with the team on WhatsApp for anything custom.",
      link: { href: WA, text: "Chat on WhatsApp →", external: true },
      chips: MAIN_CHIPS.concat(["contact"]),
    };
  }

  function handleUserText(text) {
    var cleaned = (text || "").trim();
    if (!cleaned || busy) return;
    addBubble(cleaned, "user");
    inputEl.value = "";
    var hit = matchText(cleaned);
    replyWith(hit.answer, hit.link, hit.chips);
  }

  function openPanel() {
    var root = document.getElementById("ayzBot");
    var panel = document.getElementById("ayzBotPanel");
    var launcher = document.getElementById("ayzBotLauncher");
    if (!root || !panel) return;
    root.classList.add("is-open");
    panel.hidden = false;
    if (launcher) launcher.setAttribute("aria-expanded", "true");
    try { localStorage.setItem("ayz-bot-seen", "1"); } catch (_) {}
    var badge = document.getElementById("ayzBotBadge");
    if (badge) badge.style.display = "none";

    if (!started) {
      started = true;
      addBubble(WELCOME, "bot");
      setChips(MAIN_CHIPS);
    }
    setTimeout(function () {
      if (inputEl) inputEl.focus();
      scrollBottom();
    }, 50);
  }

  function closePanel() {
    var root = document.getElementById("ayzBot");
    var panel = document.getElementById("ayzBotPanel");
    var launcher = document.getElementById("ayzBotLauncher");
    if (!root || !panel) return;
    root.classList.remove("is-open");
    panel.hidden = true;
    if (launcher) launcher.setAttribute("aria-expanded", "false");
  }

  function bind(root) {
    messagesEl = document.getElementById("ayzBotMessages");
    chipsEl = document.getElementById("ayzBotChips");
    inputEl = document.getElementById("ayzBotInput");

    document.getElementById("ayzBotLauncher").addEventListener("click", function () {
      if (root.classList.contains("is-open")) closePanel();
      else openPanel();
    });
    document.getElementById("ayzBotClose").addEventListener("click", closePanel);

    document.getElementById("ayzBotForm").addEventListener("submit", function (e) {
      e.preventDefault();
      handleUserText(inputEl.value);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.classList.contains("is-open")) closePanel();
    });

    try {
      if (localStorage.getItem("ayz-bot-seen") === "1") {
        var badge = document.getElementById("ayzBotBadge");
        if (badge) badge.style.display = "none";
      }
    } catch (_) {}
  }

  function boot() {
    var root = build();
    bind(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
