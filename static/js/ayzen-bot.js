/**
 * AYZEN Bot — proper conversational chatbot (Nemotron via /api/bot/chat).
 * Loaded site-wide via site-footer.js. API key stays server-side.
 */
(function () {
  "use strict";

  if (document.body && document.body.hasAttribute("data-no-bot")) return;
  if (document.getElementById("ayzBot")) return;

  var WA = "https://wa.me/919205726749?text=" + encodeURIComponent("Hi Ayzen Studios, I need help with…");
  var MARK = "/assets/brand/ayzen-bot-mark.svg";

  var SUGGESTIONS = [
    "What does Ayzen Studios build?",
    "Tell me about PhotoBooth AI",
    "How does Web AR work?",
    "I want to hire you for an event",
    "Where can I play gesture games?",
  ];

  var WELCOME =
    "Hey! I’m AYZEN Bot 👋\n\nI can help you explore our games, AI tools, Web AR, PhotoBooth, and how to work with the studio. What’s on your mind?";

  function apiUrl(path) {
    if (typeof window !== "undefined" && typeof window.apiUrl === "function") {
      return window.apiUrl(path);
    }
    var base =
      (typeof window !== "undefined" && (window.SPOOKY_API_BASE || window.AYZEN_API_BASE)) || "";
    return String(base).replace(/\/$/, "") + path;
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Light formatting: URLs, site paths, newlines */
  function formatMessage(text) {
    var safe = escapeHtml(text || "");
    safe = safe.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" data-no-transition>$1</a>'
    );
    safe = safe.replace(
      /(^|[\s(])(\/[a-z0-9#\-/_]+)(?=[\s).,!?]|$)/gi,
      function (_, pre, path) {
        return pre + '<a href="' + path + '">' + path + "</a>";
      }
    );
    return safe.replace(/\n/g, "<br>");
  }

  function loadCss() {
    if (document.querySelector('link[href*="ayzen-bot.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/ayzen-bot.css?v=5";
    document.head.appendChild(link);
  }

  function build() {
    loadCss();
    var root = el("div", "ayz-bot");
    root.id = "ayzBot";
    root.setAttribute("aria-live", "polite");

    root.innerHTML =
      '<button type="button" class="ayz-bot__launcher" id="ayzBotLauncher" aria-label="Open AYZEN Bot" aria-expanded="false" aria-controls="ayzBotPanel">' +
        '<span class="ayz-bot__launcher-badge" id="ayzBotBadge">1</span>' +
        '<img class="ayz-bot__launcher-mark" src="' + MARK + '" alt="" width="44" height="44" decoding="async">' +
      "</button>" +
      '<div class="ayz-bot__panel" id="ayzBotPanel" role="dialog" aria-label="AYZEN Bot chat" hidden>' +
        '<header class="ayz-bot__head">' +
          '<div class="ayz-bot__avatar"><img src="' + MARK + '" alt="" width="44" height="44" decoding="async"></div>' +
          '<div class="ayz-bot__meta">' +
            '<div class="ayz-bot__name">AYZEN Bot</div>' +
            '<div class="ayz-bot__status" id="ayzBotStatus">Online · usually replies in seconds</div>' +
          "</div>" +
          '<button type="button" class="ayz-bot__icon-btn" id="ayzBotNew" title="New chat" aria-label="New chat">↻</button>' +
          '<button type="button" class="ayz-bot__close" id="ayzBotClose" aria-label="Close chat">✕</button>' +
        "</header>" +
        '<div class="ayz-bot__messages" id="ayzBotMessages"></div>' +
        '<div class="ayz-bot__suggestions" id="ayzBotSuggestions" hidden></div>' +
        '<form class="ayz-bot__composer" id="ayzBotForm">' +
          '<textarea class="ayz-bot__input" id="ayzBotInput" rows="1" placeholder="Message AYZEN Bot…" maxlength="500" enterkeyhint="send"></textarea>' +
          '<button type="submit" class="ayz-bot__send" id="ayzBotSend" aria-label="Send">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
          "</button>" +
        "</form>" +
        '<div class="ayz-bot__footer-note">AI assistant · <a href="' + WA + '" target="_blank" rel="noopener noreferrer" data-no-transition>WhatsApp a human</a></div>' +
      "</div>";

    document.body.appendChild(root);
    return root;
  }

  var messagesEl;
  var suggestionsEl;
  var inputEl;
  var statusEl;
  var busy = false;
  var started = false;
  var history = [];

  function setStatus(text, typing) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("is-typing", !!typing);
  }

  function scrollBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(text, who) {
    var row = el("div", "ayz-bot__row ayz-bot__row--" + who);
    if (who === "bot") {
      var av = el("div", "ayz-bot__msg-avatar");
      av.innerHTML = '<img src="' + MARK + '" alt="" width="28" height="28">';
      row.appendChild(av);
    }
    var bubble = el("div", "ayz-bot__bubble");
    if (who === "bot") bubble.innerHTML = formatMessage(text);
    else bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollBottom();
    return bubble;
  }

  function showTyping() {
    var row = el("div", "ayz-bot__row ayz-bot__row--bot");
    row.id = "ayzBotTyping";
    row.innerHTML =
      '<div class="ayz-bot__msg-avatar"><img src="' + MARK + '" alt="" width="28" height="28"></div>' +
      '<div class="ayz-bot__typing" aria-hidden="true"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(row);
    scrollBottom();
    setStatus("Typing…", true);
  }

  function hideTyping() {
    var t = document.getElementById("ayzBotTyping");
    if (t) t.remove();
    setStatus("Online · usually replies in seconds", false);
  }

  function showSuggestions(show) {
    if (!suggestionsEl) return;
    if (!show) {
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = "";
      return;
    }
    suggestionsEl.innerHTML = "";
    var label = el("div", "ayz-bot__suggestions-label");
    label.textContent = "Try asking";
    suggestionsEl.appendChild(label);
    SUGGESTIONS.forEach(function (prompt) {
      var btn = el("button", "ayz-bot__suggestion");
      btn.type = "button";
      btn.textContent = prompt;
      btn.addEventListener("click", function () {
        if (busy) return;
        handleUserText(prompt);
      });
      suggestionsEl.appendChild(btn);
    });
    suggestionsEl.hidden = false;
  }

  function setBusy(v) {
    busy = v;
    var send = document.getElementById("ayzBotSend");
    if (send) send.disabled = v;
    if (inputEl) inputEl.disabled = v;
    suggestionsEl && suggestionsEl.querySelectorAll("button").forEach(function (b) {
      b.disabled = v;
    });
  }

  function autoSize() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(120, inputEl.scrollHeight) + "px";
  }

  function typeOut(bubble, fullText) {
    return new Promise(function (resolve) {
      var i = 0;
      var step = Math.max(1, Math.floor(fullText.length / 60));
      function tick() {
        i = Math.min(fullText.length, i + step);
        bubble.innerHTML = formatMessage(fullText.slice(0, i));
        scrollBottom();
        if (i < fullText.length) requestAnimationFrame(tick);
        else resolve();
      }
      tick();
    });
  }

  function handleUserText(text) {
    var cleaned = (text || "").trim();
    if (!cleaned || busy) return;

    showSuggestions(false);
    addBubble(cleaned, "user");
    history.push({ role: "user", content: cleaned });
    if (inputEl) {
      inputEl.value = "";
      autoSize();
    }

    setBusy(true);
    showTyping();

    var histForApi = history.slice(0, -1).slice(-12);

    fetch(apiUrl("/api/bot/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message: cleaned, history: histForApi }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) {
            var err = (data && data.detail) || "Assistant unavailable";
            throw new Error(typeof err === "string" ? err : "Assistant unavailable");
          }
          return (data && data.reply) || "";
        });
      })
      .then(function (reply) {
        hideTyping();
        if (!reply) throw new Error("Empty reply");
        var bubble = addBubble("", "bot");
        return typeOut(bubble, reply).then(function () {
          history.push({ role: "assistant", content: reply });
          if (history.length > 24) history = history.slice(-24);
          setBusy(false);
          if (inputEl) inputEl.focus();
        });
      })
      .catch(function () {
        hideTyping();
        var fallback =
          "Sorry — I couldn’t reply just now. Try again in a moment, or message the team on WhatsApp.";
        addBubble(fallback, "bot");
        history.push({ role: "assistant", content: fallback });
        setBusy(false);
        var wa = document.createElement("div");
        wa.className = "ayz-bot__row ayz-bot__row--bot";
        wa.innerHTML =
          '<div class="ayz-bot__msg-avatar"></div><div class="ayz-bot__quick-actions">' +
          '<a class="ayz-bot__pill" href="' + WA + '" target="_blank" rel="noopener noreferrer" data-no-transition>Chat on WhatsApp</a>' +
          "</div>";
        messagesEl.appendChild(wa);
        scrollBottom();
      });
  }

  function resetChat() {
    if (busy) return;
    history = [];
    if (messagesEl) messagesEl.innerHTML = "";
    started = true;
    addBubble(WELCOME, "bot");
    history.push({ role: "assistant", content: WELCOME });
    showSuggestions(true);
    if (inputEl) inputEl.focus();
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

    if (!started) resetChat();
    setTimeout(function () {
      if (inputEl) inputEl.focus();
      scrollBottom();
    }, 40);
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
    suggestionsEl = document.getElementById("ayzBotSuggestions");
    inputEl = document.getElementById("ayzBotInput");
    statusEl = document.getElementById("ayzBotStatus");

    document.getElementById("ayzBotLauncher").addEventListener("click", function () {
      if (root.classList.contains("is-open")) closePanel();
      else openPanel();
    });
    document.getElementById("ayzBotClose").addEventListener("click", closePanel);
    document.getElementById("ayzBotNew").addEventListener("click", resetChat);

    document.getElementById("ayzBotForm").addEventListener("submit", function (e) {
      e.preventDefault();
      handleUserText(inputEl.value);
    });

    inputEl.addEventListener("input", autoSize);
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleUserText(inputEl.value);
      }
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
    bind(build());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
