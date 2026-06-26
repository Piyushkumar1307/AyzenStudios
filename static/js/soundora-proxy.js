/**
 * Redirect Unity WebGL Suno calls to the Render proxy (no API key in the browser).
 * Load after runtime-config.js and spooky-api.js, before the Unity loader.
 */
(function (g) {
  "use strict";

  var SUNO_HOST = "api.sunoapi.org";

  function rewriteSunoUrl(url) {
    if (!url || typeof url !== "string") return null;
    var hostIdx = url.indexOf(SUNO_HOST);
    if (hostIdx === -1) return null;
    var rest = url.slice(hostIdx + SUNO_HOST.length);
    var match = rest.match(/^\/api\/v1\/?([^?#]*)/);
    if (!match) return null;
    var subPath = match[1] || "";
    var suffix = rest.indexOf("?") >= 0 ? rest.slice(rest.indexOf("?")) : "";
    var proxied =
      typeof g.apiUrl === "function"
        ? g.apiUrl("/api/soundora/" + subPath)
        : "/api/soundora/" + subPath;
    if (suffix) {
      proxied += proxied.indexOf("?") === -1 ? suffix : "&" + suffix.slice(1);
    }
    return proxied;
  }

  function stripAuthHeaders(headers) {
    if (!headers) return headers;
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      var h = new Headers(headers);
      h.delete("Authorization");
      h.delete("authorization");
      return h;
    }
    if (Array.isArray(headers)) {
      return headers.filter(function (row) {
        return row && String(row[0]).toLowerCase() !== "authorization";
      });
    }
    var out = Object.assign({}, headers);
    delete out.Authorization;
    delete out.authorization;
    return out;
  }

  var origFetch = g.fetch && g.fetch.bind(g);
  if (origFetch) {
    g.fetch = function (input, init) {
      var url =
        typeof input === "string"
          ? input
          : input && input.url
            ? input.url
            : "";
      var proxied = rewriteSunoUrl(url);
      if (proxied) {
        init = init ? Object.assign({}, init) : {};
        init.headers = stripAuthHeaders(init.headers);
        if (typeof input === "string") {
          return origFetch(proxied, init);
        }
        return origFetch(new Request(proxied, input), init);
      }
      return origFetch(input, init);
    };
  }

  if (g.XMLHttpRequest) {
    var origOpen = g.XMLHttpRequest.prototype.open;
    var origSetHeader = g.XMLHttpRequest.prototype.setRequestHeader;

    g.XMLHttpRequest.prototype.open = function (method, url) {
      var rewritten = rewriteSunoUrl(String(url || "")) || url;
      this.__sunoSkipAuth = rewritten !== url;
      return origOpen.apply(this, [method, rewritten].concat([].slice.call(arguments, 2)));
    };

    g.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__sunoSkipAuth && String(name).toLowerCase() === "authorization") {
        return;
      }
      return origSetHeader.apply(this, arguments);
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
