/* Force the same spookystudios ghost tab icon on every route (avoids per-path Safari cache). */
(function () {
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<defs><linearGradient id="h" x1="64" y1="8" x2="64" y2="52" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#8b5cf6"/><stop offset="1" stop-color="#5b21b6"/></linearGradient>' +
    '<filter id="s" x="-20%" y="-20%" width="140%" height="140%">' +
    '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#a78bfa" flood-opacity="0.45"/></filter></defs>' +
    '<rect width="128" height="128" rx="28" fill="#0c0612"/>' +
    '<g filter="url(#s)"><path d="M44 38c0-10 8-16 20-16s20 6 20 16v6c8 2 14 10 14 20v28c0 6-5 10-12 10-4 0-7-3-10-6-3 3-6 6-10 6-7 0-12-4-12-10V64c0-10 6-18 14-20v-6z" fill="#f5f3ff" stroke="#c4b5fd" stroke-width="2"/>' +
    '<path d="M40 32c6-14 16-20 24-20s18 6 24 20c-6 2-12 2-24 2s-18 0-24-2z" fill="url(#h)"/>' +
    '<rect x="48" y="24" width="32" height="8" rx="4" fill="#fbbf24"/>' +
    '<circle cx="52" cy="58" r="7" fill="#1e1033"/><circle cx="76" cy="58" r="7" fill="#1e1033"/>' +
    '<circle cx="54" cy="56" r="2.5" fill="#fff"/><circle cx="78" cy="56" r="2.5" fill="#fff"/>' +
    '<ellipse cx="64" cy="72" rx="5" ry="6" fill="#1e1033" opacity="0.35"/></g></svg>';
  var href = "data:image/svg+xml," + encodeURIComponent(svg);

  function apply() {
    var head = document.head;
    if (!head) return;
    head.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(function (n) {
      n.remove();
    });
    var icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = href;
    icon.setAttribute("sizes", "any");
    head.insertBefore(icon, head.firstChild);
    var touch = document.createElement("link");
    touch.rel = "apple-touch-icon";
    touch.href = href;
    head.appendChild(touch);
  }

  apply();
})();
