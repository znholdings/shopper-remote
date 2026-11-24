// B-2322 (v2.0.203): ShopperStoreBadge - the phone's store badge for the Buylist card's Supplier stat.
// The phone is a flat PWA push (no image files), so it keeps a coloured letter roundel per store - the same six
// stores and colours as lib/store-logos.js BADGES (the laptop shows each store's own site icon there; a test keeps
// the two key lists equal). Replen Pulse's supplier name is all the phone has (no Source Database map), read with
// the same name patterns as the laptop's forName. Unknown name -> the name itself, escaped.
(function (root) {
  "use strict";
  var BADGES = {
    walmart: { letter: "W", color: "#0071ce", label: "Walmart" },
    samsclub: { letter: "S", color: "#0067a0", label: "Sam's Club" },
    homedepot: { letter: "HD", color: "#f96302", label: "Home Depot" },
    target: { letter: "T", color: "#cc0000", label: "Target" },
    amazon: { letter: "A", color: "#232f3e", label: "Amazon Business" },
    walgreens: { letter: "Wg", color: "#e31837", label: "Walgreens" }
  };
  var NAME_PATTERNS = [
    ["walmart", /walmart/i],
    ["samsclub", /sam'?s/i],
    ["homedepot", /home ?depot/i],
    ["target", /target/i],
    ["amazon", /amazon/i],
    ["walgreens", /walgreens/i]
  ];
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function forName(text) {
    var t = String(text == null ? "" : text);
    for (var i = 0; i < NAME_PATTERNS.length; i++) if (NAME_PATTERNS[i][1].test(t)) return NAME_PATTERNS[i][0];
    return null;
  }
  function badgeHtml(text) {
    var key = forName(text);
    if (!key) return esc(text);
    var b = BADGES[key];
    return '<span class="store-badge" style="background:' + b.color + ';color:#fff" title="' + esc(b.label) + '" aria-label="' + esc(b.label) + '">' + esc(b.letter) + "</span>";
  }
  root.ShopperStoreBadge = Object.freeze({ BADGES: BADGES, keys: Object.keys(BADGES), forName: forName, badgeHtml: badgeHtml });
})(typeof self !== "undefined" ? self : globalThis);
