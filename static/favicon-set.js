/* Force the same Ayzen Studios "A" tab icon on every route (avoids per-path Safari cache). */
(function () {
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<defs>' +
    '<linearGradient id="st" x1="32" y1="22" x2="96" y2="108" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#f4f8ff"/><stop offset="0.55" stop-color="#aebccd"/><stop offset="1" stop-color="#5d6b7e"/></linearGradient>' +
    '<linearGradient id="bl" x1="64" y1="20" x2="92" y2="104" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#7fdcff"/><stop offset="1" stop-color="#1f6dff"/></linearGradient>' +
    '<filter id="gl" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#2e9bff" flood-opacity="0.55"/></filter></defs>' +
    '<rect width="128" height="128" rx="28" fill="#05070d"/>' +
    '<g filter="url(#gl)">' +
    '<path d="M64 22 30 104h17l17-44 9 24h-9l-6 16h31L64 22z" fill="url(#st)"/>' +
    '<path d="M64 22l34 82H81L64 60v-2l0-36z" fill="url(#bl)" opacity="0.92"/>' +
    '<path d="M48 78c14-6 26-18 40-40-8 22-20 36-34 44z" fill="#bfe6ff" opacity="0.9"/></g></svg>';
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
