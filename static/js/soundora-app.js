/**
 * Soundora — AI music web app (Spotify-style UI)
 */
(function () {
  var TOKEN_KEY = "piyush_token";
  var STYLE_PRESETS = [
    "Pop", "Lo-fi", "Cinematic", "Rock", "Hip-hop", "Electronic",
    "Jazz", "Acoustic", "Ambient", "R&B", "Indie", "Epic orchestral",
  ];

  var state = {
    token: null,
    user: null,
    tracks: [],
    stats: null,
    maxTracks: 50,
    configured: true,
    currentTrack: null,
    pollTimer: null,
    progressTimer: null,
    progressByTrack: {},
    generationStartedAt: {},
    view: "home",
  };

  var audio = new Audio();
  audio.preload = "metadata";

  function $(id) { return document.getElementById(id); }

  function authHeaders() {
    return { Authorization: "Bearer " + state.token, "Content-Type": "application/json" };
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (state.token) headers.Authorization = "Bearer " + state.token;
    return fetch(apiUrl(path), Object.assign({}, opts, { headers: headers }));
  }

  function showToast(msg, isError) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.add("hidden"); }, 4500);
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function loginRedirect() {
    window.location.href = "/login?next=" + encodeURIComponent("/soundora");
  }

  function showAuthGate(show) {
    var gate = $("authGate");
    if (gate) gate.classList.toggle("hidden", !show);
  }

  async function requireAuth() {
    state.token = sessionStorage.getItem(TOKEN_KEY);
    if (!state.token) {
      showAuthGate(true);
      return false;
    }
    var res = await apiFetch("/api/me");
    if (!res.ok) {
      sessionStorage.removeItem(TOKEN_KEY);
      state.token = null;
      showAuthGate(true);
      return false;
    }
    state.user = await res.json();
    showAuthGate(false);
    var userEl = $("sidebarUser");
    if (userEl && state.user) {
      userEl.textContent = state.user.name || state.user.email || "Signed in";
    }
    return true;
  }

  async function loadStatus() {
    try {
      var res = await fetch(apiUrl("/api/soundora/status"));
      if (res.ok) {
        var data = await res.json();
        state.configured = !!data.configured;
        state.maxTracks = data.max_tracks || 3;
      }
    } catch (_) {}
  }

  async function loadStats() {
    var res = await apiFetch("/api/soundora/stats");
    if (!res.ok) return;
    state.stats = await res.json();
    renderStats();
  }

  async function loadTracks() {
    var res = await apiFetch("/api/soundora/tracks");
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      showToast(err.detail || "Could not load your library.", true);
      return;
    }
    var data = await res.json();
    state.tracks = data.tracks || [];
    renderTracks();
    schedulePoll();
  }

  function isAtLimit() {
    if (!state.stats) return false;
    return state.stats.completed >= (state.stats.max_tracks || 3);
  }

  function renderLimitCards() {
    var atLimit = isAtLimit();
    var libCard = $("limitContactCard");
    var createCard = $("limitContactCreate");
    var maxEl = $("limitContactMax");
    if (maxEl && state.stats) maxEl.textContent = String(state.stats.max_tracks || 3);
    if (libCard) libCard.classList.toggle("hidden", !atLimit);
    if (createCard) createCard.classList.toggle("hidden", !atLimit);
  }

  function trackProgressPercent(t) {
    if (t.status === "completed") return 100;
    if (t.status !== "processing") return 0;
    if (state.progressByTrack[t.id] != null) return state.progressByTrack[t.id];
    return 8;
  }

  function markGenerationStarted(trackId) {
    state.generationStartedAt[trackId] = Date.now();
    state.progressByTrack[trackId] = 8;
    startProgressTicker();
  }

  function startProgressTicker() {
    clearInterval(state.progressTimer);
    state.progressTimer = setInterval(function () {
      var hasProcessing = false;
      state.tracks.forEach(function (t) {
        if (t.status === "processing") {
          hasProcessing = true;
          var started = state.generationStartedAt[t.id] || Date.now();
          var elapsed = Date.now() - started;
          var pct = Math.min(92, 8 + (elapsed / 240000) * 84);
          state.progressByTrack[t.id] = pct;
        } else if (t.status === "completed") {
          state.progressByTrack[t.id] = 100;
        }
      });
      if (hasProcessing) renderTracks();
      else clearInterval(state.progressTimer);
    }, 1000);
  }

  function renderStats() {
    if (!state.stats) return;
    $("statTotal").textContent = String(state.stats.completed);
    $("statCompleted").textContent = String(state.stats.completed);
    $("statProcessing").textContent = String(state.stats.processing);
    $("statMax").textContent = String(state.stats.max_tracks);
    var remaining = Math.max(0, state.stats.max_tracks - state.stats.completed);
    $("statRemaining").textContent = String(remaining);
    var mobRem = $("mobileStatRemaining");
    var mobComp = $("mobileStatCompleted");
    var mobProc = $("mobileStatProcessing");
    if (mobRem) mobRem.textContent = String(remaining);
    if (mobComp) mobComp.textContent = String(state.stats.completed);
    if (mobProc) mobProc.textContent = String(state.stats.processing);
    var btn = $("btnGenerate");
    if (btn) {
      var atLimit = remaining <= 0;
      var busy = state.stats.processing > 0;
      var max = state.stats.max_tracks || 3;
      btn.disabled = atLimit || busy;
      btn.textContent = atLimit
        ? "Demo limit reached"
        : busy ? "Generating…" : "Generate song";
    }
    renderLimitCards();
  }

  function syncPlayButtons() {
    var icon = audio.paused ? "▶" : "⏸";
    if ($("btnPlayMain")) $("btnPlayMain").textContent = icon;
    if ($("btnPlayMobile")) $("btnPlayMobile").textContent = icon;
  }

  function trackTitle(t) {
    return t.title || t.prompt.slice(0, 48) + (t.prompt.length > 48 ? "…" : "");
  }

  function renderTracks() {
    var grid = $("trackGrid");
    var empty = $("emptyLibrary");
    if (!grid) return;

    if (!state.tracks.length) {
      grid.innerHTML = "";
      if (empty) empty.style.display = "block";
      renderLimitCards();
      return;
    }
    if (empty) empty.style.display = "none";
    renderLimitCards();

    grid.innerHTML = state.tracks.map(function (t) {
      var playing = state.currentTrack && state.currentTrack.id === t.id;
      var isProcessing = t.status === "processing";
      var cover = t.image_url
        ? '<img src="' + escapeAttr(t.image_url) + '" alt="">'
        : '<div class="placeholder">' + (isProcessing ? "✨" : "🎵") + '</div>';
      var playBtn = t.status === "completed" && t.audio_url
        ? '<button type="button" class="play-fab" data-play="' + escapeAttr(t.id) + '">▶</button>'
        : "";
      var downloadBtn = t.status === "completed" && t.audio_url
        ? '<button type="button" class="track-download-btn" data-download="' + escapeAttr(t.id) + '" aria-label="Download ' + escapeAttr(trackTitle(t)) + '">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>' +
            '</svg></button>'
        : "";
      var pct = Math.round(trackProgressPercent(t));
      var progressHtml = isProcessing
        ? '<div class="track-progress">' +
            '<span class="track-progress-label">Generating your song… ' + pct + '%</span>' +
            '<div class="track-progress-bar"><div class="track-progress-fill" style="width:' + pct + '%"></div></div>' +
          '</div>'
        : "";
      return (
        '<article class="track-card' + (playing ? " is-playing" : "") + (isProcessing ? " is-processing" : "") + '" data-id="' + escapeAttr(t.id) + '">' +
          '<div class="track-cover">' + cover +
            '<div class="play-overlay">' + playBtn + '</div>' +
          '</div>' +
          '<h3>' + escapeHtml(trackTitle(t)) + '</h3>' +
          '<p>' + escapeHtml(t.style || t.prompt) + '</p>' +
          progressHtml +
          '<div class="track-card-foot">' +
            '<span class="status-pill ' + escapeHtml(t.status) + '">' + escapeHtml(t.status) + '</span>' +
            downloadBtn +
          '</div>' +
        '</article>'
      );
    }).join("");

    grid.querySelectorAll("[data-play]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        playTrack(btn.getAttribute("data-play"));
      });
    });
    grid.querySelectorAll("[data-download]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        downloadTrack(btn.getAttribute("data-download"), btn);
      });
    });
    grid.querySelectorAll(".track-card").forEach(function (card) {
      card.addEventListener("click", function () {
        var id = card.getAttribute("data-id");
        var t = state.tracks.find(function (x) { return x.id === id; });
        if (t && t.status === "completed" && t.audio_url) playTrack(id);
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

  function playTrack(id) {
    var t = state.tracks.find(function (x) { return x.id === id; });
    if (!t || !t.audio_url) return;
    state.currentTrack = t;
    audio.src = t.audio_url;
    audio.play().catch(function () { showToast("Could not play this track.", true); });
    updatePlayerBar();
    renderTracks();
  }

  function updatePlayerBar() {
    var t = state.currentTrack;
    var bar = $("playerBar");
    if (!bar) return;
    if (!t || !t.audio_url) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    $("playerTitle").textContent = trackTitle(t);
    $("playerSubtitle").textContent = t.style || "AI generated";
    var thumb = $("playerThumb");
    if (t.image_url) {
      thumb.innerHTML = '<img src="' + escapeAttr(t.image_url) + '" alt="">';
    } else {
      thumb.innerHTML = "";
    }
    $("btnDownload").disabled = false;
    syncPlayButtons();
  }

  function schedulePoll() {
    clearInterval(state.pollTimer);
    var pending = state.tracks.some(function (t) {
      return t.status === "processing" || t.status === "pending";
    });
    if (pending) startProgressTicker();
    if (!pending) return;
    state.pollTimer = setInterval(async function () {
      await loadTracks();
      await loadStats();
      var still = state.tracks.some(function (t) {
        return t.status === "processing" || t.status === "pending";
      });
      if (!still) {
        clearInterval(state.pollTimer);
        clearInterval(state.progressTimer);
        showToast("Your song is ready!");
      }
    }, 8000);
  }

  async function generateTrack() {
    if (!state.configured) {
      showToast("Soundora is not configured on the server yet.", true);
      return;
    }
    if (isAtLimit()) {
      setView("library");
      renderLimitCards();
      showToast("Demo limit reached — contact the owner to extend.", true);
      return;
    }
    var prompt = ($("promptInput") || {}).value || "";
    prompt = prompt.trim();
    if (prompt.length < 3) {
      showToast("Describe your song in at least 3 characters.", true);
      return;
    }
    var style = ($("styleInput") || {}).value || "";
    var title = ($("titleInput") || {}).value || "";
    var instrumental = ($("instrumentalCheck") || {}).checked || false;
    var btn = $("btnGenerate");
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      var res = await apiFetch("/api/soundora/tracks/generate", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ prompt: prompt, style: style.trim(), title: title.trim(), instrumental: instrumental }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (res.status === 429) {
          setView("library");
          await loadStats();
          renderLimitCards();
        }
        throw new Error(data.detail || ("HTTP " + res.status));
      }
      showToast("Generating your song — watch progress in your library.");
      $("promptInput").value = "";
      $("titleInput").value = "";
      markGenerationStarted(data.id);
      setView("library");
      await loadTracks();
      await loadStats();
      if (data.status === "completed" && data.audio_url) {
        state.progressByTrack[data.id] = 100;
        playTrack(data.id);
      }
    } catch (err) {
      showToast(String(err.message || err), true);
      await loadStats();
    } finally {
      renderStats();
    }
  }

  async function downloadTrack(id, triggerBtn) {
    var t = state.tracks.find(function (x) { return x.id === id; });
    if ((!t || !t.audio_url) && state.currentTrack && state.currentTrack.id === id) {
      t = state.currentTrack;
    }
    if (!t || !t.audio_url) return;

    var btn = triggerBtn || $("btnDownload");
    if (btn) {
      btn.disabled = true;
    }
    showToast("Preparing download…");

    try {
      var res = await apiFetch("/api/soundora/tracks/" + encodeURIComponent(id) + "/download");
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.detail || ("HTTP " + res.status));
      }
      var blob = await res.blob();
      var fname = (trackTitle(t).replace(/[^\w\s-]/g, "").trim() || "soundora-track") + ".mp3";
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      showToast("Download started — check your Downloads folder.");
    } catch (err) {
      showToast(String(err.message || err), true);
    } finally {
      if (btn) {
        btn.disabled = false;
        if (btn.id === "btnDownload") btn.disabled = !state.currentTrack;
      }
    }
  }

  function downloadCurrent() {
    if (!state.currentTrack) return;
    downloadTrack(state.currentTrack.id, $("btnDownload"));
  }

  function bindStyleChips() {
    var wrap = $("styleChips");
    if (!wrap) return;
    wrap.innerHTML = STYLE_PRESETS.map(function (s) {
      return '<button type="button" class="chip" data-style="' + escapeAttr(s) + '">' + escapeHtml(s) + '</button>';
    }).join("");
    wrap.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        wrap.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        var inp = $("styleInput");
        if (inp) inp.value = chip.getAttribute("data-style");
      });
    });
  }

  function bindNav() {
    document.querySelectorAll(".nav-item[data-view], .mobile-tab[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var view = btn.getAttribute("data-view");
        if (view) setView(view);
      });
    });
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".nav-item[data-view], .mobile-tab[data-view]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });
    $("panelCreate").style.display = view === "create" ? "block" : "none";
    $("panelLibrary").style.display = view === "library" || view === "home" ? "block" : "none";
    $("mainHeading").textContent = view === "create" ? "Create" : view === "library" ? "Your library" : "Good evening";
    $("mainSub").textContent = view === "create"
      ? "Describe the song you want Soundora to compose."
      : view === "library"
        ? "Your AI-generated tracks — play, download, and revisit anytime."
        : "Create original AI songs — demo limit: 3 completed tracks per account.";
    var scroll = document.querySelector(".main-scroll");
    if (scroll) scroll.scrollTop = 0;
    renderLimitCards();
  }

  function togglePlayback() {
    if (!state.currentTrack) return;
    if (audio.paused) audio.play();
    else audio.pause();
  }

  function bindPlayer() {
    audio.addEventListener("timeupdate", function () {
      $("timeCurrent").textContent = formatTime(audio.currentTime);
      $("timeTotal").textContent = formatTime(audio.duration);
      var prog = $("progressBar");
      if (prog && isFinite(audio.duration) && audio.duration > 0) {
        prog.value = (audio.currentTime / audio.duration) * 100;
      }
    });
    audio.addEventListener("ended", syncPlayButtons);
    audio.addEventListener("play", syncPlayButtons);
    audio.addEventListener("pause", syncPlayButtons);

    $("btnPlayMain").addEventListener("click", togglePlayback);
    var playMob = $("btnPlayMobile");
    if (playMob) playMob.addEventListener("click", togglePlayback);
    $("progressBar").addEventListener("input", function (e) {
      if (!isFinite(audio.duration)) return;
      audio.currentTime = (e.target.value / 100) * audio.duration;
    });
    $("btnDownload").addEventListener("click", downloadCurrent);
  }

  async function init() {
    bindStyleChips();
    bindNav();
    bindPlayer();
    setView("home");

    $("btnGenerate").addEventListener("click", generateTrack);
    $("btnLogin").addEventListener("click", loginRedirect);
    function logout() {
      sessionStorage.removeItem(TOKEN_KEY);
      loginRedirect();
    }
    $("btnLogout").addEventListener("click", logout);
    var logoutMob = $("btnLogoutMobile");
    if (logoutMob) logoutMob.addEventListener("click", logout);
    async function refreshLibrary() {
      await loadTracks();
      await loadStats();
      showToast("Library refreshed.");
    }
    $("btnRefresh").addEventListener("click", refreshLibrary);
    var refreshMob = $("btnRefreshMobile");
    if (refreshMob) refreshMob.addEventListener("click", refreshLibrary);

    await loadStatus();
    if (!state.configured) {
      showToast("AI music service is starting up — generation may be unavailable.", true);
    }

    var ok = await requireAuth();
    if (!ok) return;

    await Promise.all([loadStats(), loadTracks()]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
