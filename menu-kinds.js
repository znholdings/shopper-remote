// v2.0.198 B-2280b: the phone twin of lib/s-menu-kinds.js - orders a sheet's action list by kind.
// root.ShopperMenuKinds.group(listEl): children carry dataset.menuKind = nav | setting | action | danger;
// they are ordered nav > setting > action > danger (stable inside a kind), a divider sits between groups,
// danger items get .pg-menu-danger. Nodes are moved, never cloned; a list with no marked child is left alone.
(function (root) {
  "use strict";
  var ORDER = ["nav", "setting", "action", "danger"];
  function kind(el) { var k = el && el.dataset && el.dataset.menuKind; return ORDER.indexOf(k) >= 0 ? k : ""; }
  function isSep(el) { return !!(el.classList && el.classList.contains("pg-menu-sep")); }
  function group(list) {
    if (!list || !list.children) return false;
    var kids = Array.prototype.slice.call(list.children).filter(function (c) { return !isSep(c); });
    if (!kids.some(kind)) return false;
    Array.prototype.slice.call(list.children).forEach(function (c) { if (isSep(c)) list.removeChild(c); });
    var groups = ORDER.map(function () { return []; });
    kids.forEach(function (c) { groups[ORDER.indexOf(kind(c) || "action")].push(c); if (kind(c) === "danger") c.classList.add("pg-menu-danger"); });
    var first = true;
    groups.forEach(function (g) {
      if (!g.length) return;
      if (!first) { var sep = document.createElement("div"); sep.className = "pg-menu-sep"; sep.setAttribute("role", "separator"); list.appendChild(sep); }
      first = false;
      g.forEach(function (c) { list.appendChild(c); });
    });
    return true;
  }
  root.ShopperMenuKinds = { group: group };
})(typeof window !== "undefined" ? window : this);
