/**
 * Gesture instruction panel — same polished shell for catalog + in-game.
 */
(function (global) {
  var STEPS = ["Setup", "Controls", "Play"];

  function getGame(id) {
    return global.GESTURE_GAMES && global.GESTURE_GAMES[id];
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function progressBar(step) {
    var html = '<div class="gi-progress">';
    for (var i = 0; i < 3; i++) {
      var cls = "gi-progress__step";
      if (i < step) cls += " is-done";
      if (i === step) cls += " is-active";
      html +=
        '<div class="' + cls + '">' +
        '<div class="gi-progress__bar"></div>' +
        '<div class="gi-progress__label">' + STEPS[i] + "</div></div>";
    }
    return html + "</div>";
  }

  function bodyStep0() {
    return (
      progressBar(0) +
      '<h3 class="gi-step-heading">Allow your webcam</h3>' +
      '<p class="gi-step-body">Hand tracking runs <strong>locally in your browser</strong> — video is not sent to our servers.</p>' +
      '<div class="gi-tip-card">' +
      '<span class="gi-tip-card__icon">📷</span>' +
      "<p>Click <strong>Allow</strong> when the browser asks. Chrome or Safari on laptop works best.</p></div>" +
      '<ul class="gi-list">' +
      '<li><span class="gi-list__num">1</span>Sit about an arm\'s length from the camera</li>' +
      '<li><span class="gi-list__num">2</span>Face a light source — avoid strong backlight</li>' +
      '<li><span class="gi-list__num">3</span>Keep your hand(s) in frame</li></ul>'
    );
  }

  function bodyStep1(game) {
    var gestures = (game.gestures || [])
      .map(function (g) {
        return (
          '<div class="gi-gesture">' +
          '<span class="gi-gesture__icon">' + esc(g.icon) + "</span>" +
          "<div><div class=\"gi-gesture__name\">" + esc(g.name) + "</div>" +
          '<div class="gi-gesture__desc">' + esc(g.desc) + "</div></div></div>"
        );
      })
      .join("");
    return (
      progressBar(1) +
      '<h3 class="gi-step-heading">Your controls</h3>' +
      '<p class="gi-step-body">Use these hand gestures while you play:</p>' +
      '<div class="gi-gestures">' + gestures + "</div>"
    );
  }

  function bodyStep2(game) {
    var rules = "";
    if (game.rules && game.rules.length) {
      rules =
        '<ul class="gi-rules">' +
        game.rules.map(function (r) {
          return "<li>" + esc(r) + "</li>";
        }).join("") +
        "</ul>";
    }
    var hint =
      game.startMode === "symbols"
        ? '<p class="gi-hint">Choose X or O below to begin</p>'
        : '<p class="gi-hint">Tap <strong>Start game</strong> below for camera access</p>';

    return (
      progressBar(2) +
      '<h3 class="gi-step-heading">You\'re almost there</h3>' +
      rules +
      '<div class="gi-ready"><div class="gi-ready__emoji">🎮</div>' +
      "<p>Ready to play <strong>" + esc(game.title) + "</strong></p></div>" +
      hint
    );
  }

  function footerActions(step, game, mode) {
    if (step < 2) {
      return (
        '<div class="gi-actions">' +
        (step > 0
          ? '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button>'
          : "") +
        '<button type="button" class="gi-btn gi-btn--primary" data-gi="next">' +
        (step === 0 ? "Next" : "Continue") +
        " →</button></div>"
      );
    }

    if (mode === "catalog") {
      return (
        '<div class="gi-actions">' +
        '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button>' +
        '<button type="button" class="gi-btn gi-btn--primary" data-gi="launch">Open game →</button></div>'
      );
    }

    if (mode === "page") {
      if (step < 2) {
        return (
          '<div class="gi-actions">' +
          (step > 0
            ? '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button>'
            : '<a class="gi-btn gi-btn--ghost gi-btn--link" href="/games">← Games</a>') +
          '<button type="button" class="gi-btn gi-btn--primary" data-gi="next">' +
          (step === 0 ? "Next" : "Continue") +
          " →</button></div>"
        );
      }
      return (
        '<div class="gi-actions">' +
        '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button>' +
        '<button type="button" class="gi-btn gi-btn--primary" data-gi="launch">Play now →</button></div>'
      );
    }

    if (game.startMode === "symbols") {
      return (
        '<div class="gi-actions gi-actions--stack">' +
        '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button>' +
        '<div class="gi-actions">' +
        '<button type="button" class="gi-btn gi-btn--x" id="btnPickX">Play as X</button>' +
        '<button type="button" class="gi-btn gi-btn--o" id="btnPickO">Play as O</button>' +
        "</div></div>"
      );
    }

    if (game.startMode === "button") {
      return (
        '<div class="gi-actions">' +
        '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button>' +
        '<button type="button" class="gi-btn gi-btn--primary" id="btnStart" data-gi="start">Start game</button></div>'
      );
    }

    return (
      '<div class="gi-actions">' +
      '<button type="button" class="gi-btn gi-btn--ghost" data-gi="back">Back</button></div>'
    );
  }

  function renderShell(game, step, mode, showClose) {
    var body = step === 0 ? bodyStep0() : step === 1 ? bodyStep1(game) : bodyStep2(game);
    return (
      (showClose ? '<button type="button" class="gi-close" data-gi="close" aria-label="Close">×</button>' : "") +
      '<header class="gi-shell__header">' +
      '<span class="gi-badge">Hand tracking</span>' +
      "<h2 class=\"gi-title\">" + esc(game.title) + "</h2>" +
      '<p class="gi-tagline">' + esc(game.tagline) + "</p></header>" +
      '<div class="gi-shell__scroll">' + body + "</div>" +
      '<footer class="gi-shell__footer">' + footerActions(step, game, mode) + "</footer>"
    );
  }

  function wireShell(shell, game, options) {
    var step = 0;
    var mode = options.mode || "ingame";

    function paint() {
      shell.innerHTML = renderShell(game, step, mode, !!options.showClose);
      shell.querySelectorAll("[data-gi]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var action = btn.getAttribute("data-gi");
          if (action === "next" && step < 2) {
            step++;
            paint();
          } else if (action === "back" && step > 0) {
            step--;
            paint();
          } else if (action === "launch") {
            if (options.onLaunch) options.onLaunch(game);
            else if (game.href) global.location.href = game.href;
          } else if (action === "close") {
            closeCatalogModal();
          }
        });
      });
      shell.onclick = function (e) {
        if (step < 2) e.stopPropagation();
      };
    }

    paint();
  }

  function storageKey(gameId) {
    return "gi_seen_" + gameId;
  }

  function markInstructionsSeen(gameId) {
    try {
      sessionStorage.setItem(storageKey(gameId), "1");
    } catch (e) {}
  }

  function hasSeenInstructions(gameId) {
    try {
      return sessionStorage.getItem(storageKey(gameId)) === "1";
    } catch (e) {
      return false;
    }
  }

  function minimalFooter(game) {
    if (game.startMode === "symbols") {
      return (
        '<div class="gi-actions">' +
        '<button type="button" class="gi-btn gi-btn--x" id="btnPickX">Play as X</button>' +
        '<button type="button" class="gi-btn gi-btn--o" id="btnPickO">Play as O</button>' +
        "</div>"
      );
    }
    return (
      '<div class="gi-actions">' +
      '<a class="gi-btn gi-btn--ghost gi-btn--link" href="/games">← Games</a>' +
      '<button type="button" class="gi-btn gi-btn--primary" id="btnStart">Start game</button>' +
      "</div>"
    );
  }

  function renderMinimalStart(game) {
    var hint =
      game.startMode === "symbols"
        ? '<p class="gi-hint">Choose X or O to begin</p>'
        : '<p class="gi-hint">Click <strong>Start game</strong> below to play</p>';

    return (
      '<header class="gi-shell__header">' +
      '<span class="gi-badge">Ready to play</span>' +
      "<h2 class=\"gi-title\">" + esc(game.title) + "</h2>" +
      '<p class="gi-tagline">' + esc(game.tagline) + "</p></header>" +
      '<div class="gi-shell__scroll">' +
      '<div class="gi-ready"><div class="gi-ready__emoji">🎮</div>' +
      "<p>You're set — jump in when ready.</p></div>" +
      hint +
      "</div>" +
      '<footer class="gi-shell__footer">' + minimalFooter(game) + "</footer>"
    );
  }

  function showMinimalGameStart(game, overlay) {
    overlay.classList.add("gi-backdrop");
    overlay.classList.remove("hidden");
    overlay.style.display = "";
    overlay.innerHTML = '<div class="gi-shell" role="dialog" aria-modal="true"></div>';
    overlay.querySelector(".gi-shell").innerHTML = renderMinimalStart(game);
  }

  function ensureCatalogModal() {
    var el = document.getElementById("giCatalogModal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "giCatalogModal";
    el.className = "gi-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = '<div class="gi-shell" id="giCatalogShell"></div>';
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) closeCatalogModal();
    });
    global.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeCatalogModal();
    });
    return el;
  }

  function closeCatalogModal() {
    var el = document.getElementById("giCatalogModal");
    if (el) el.classList.remove("open");
  }

  function openCatalogModal(gameId, onLaunch) {
    var game = getGame(gameId);
    if (!game) return;
    ensureCatalogModal();
    document.getElementById("giCatalogModal").classList.add("open");
    wireShell(document.getElementById("giCatalogShell"), game, {
      mode: "catalog",
      showClose: true,
      onLaunch: onLaunch || function (g) {
        closeCatalogModal();
        global.location.href = g.href;
      },
    });
  }

  function mountInstructionPage(gameId) {
    var game = getGame(gameId);
    if (!game) return false;

    document.title = "How to play — " + game.title + " — spookystudios";

    var hero = document.getElementById("gameHero");
    if (hero && game.img) {
      hero.style.backgroundImage = "url('" + String(game.img).replace(/'/g, "\\'") + "')";
    }

    var shell = document.getElementById("instructionShell");
    if (!shell) return false;

    wireShell(shell, game, {
      mode: "page",
      showClose: false,
      onLaunch: function (g) {
        markInstructionsSeen(g.id);
        global.location.href = g.href;
      },
    });
    return true;
  }

  function mountGameStart(gameId) {
    var game = getGame(gameId);
    if (!game) return;

    if (!hasSeenInstructions(gameId)) {
      global.location.replace(
        "/game-instructions?game=" + encodeURIComponent(gameId)
      );
      return;
    }

    var overlay = document.getElementById(game.overlayId || "startOverlay");
    if (!overlay) return;

    showMinimalGameStart(game, overlay);
  }

  global.GestureInstructions = {
    openCatalogModal: openCatalogModal,
    closeCatalogModal: closeCatalogModal,
    mountInstructionPage: mountInstructionPage,
    mountGameStart: mountGameStart,
    markInstructionsSeen: markInstructionsSeen,
    hasSeenInstructions: hasSeenInstructions,
    getGame: getGame,
  };
})(typeof window !== "undefined" ? window : globalThis);
