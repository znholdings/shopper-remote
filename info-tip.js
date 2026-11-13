// B-2069 (v2.0.158): ShopperInfoTip - one shared "ⓘ" that folds a plain explainer behind a heading. textContent only; open state in memory by id.
(function (root) {
  "use strict";
  var OPEN = new Set();
  var seq = 0;
  function add(anchor, text, opts) {
    opts = opts || {};
    if (!anchor) return null;
    var id = String(opts.id || "");
    var after = opts.after || null;
    var host = after ? after.parentNode : anchor;
    var old = host && host.querySelector('.it-btn[data-it="' + id + '"]');
    var t = String(text == null ? "" : text).trim();
    if (old) {
      var oldT = document.getElementById(old.getAttribute("aria-controls"));
      if (!t) { old.remove(); if (oldT) oldT.remove(); return null; }
      if (oldT) oldT.textContent = t;
      return old;
    }
    if (!t) return null;
    var b = document.createElement("button");
    b.type = "button"; b.className = "c55-info it-btn"; b.textContent = "ⓘ"; b.dataset.it = id;
    b.setAttribute("aria-label", opts.label || "More about this");
    var p = document.createElement("p");
    p.className = "it-text muted small"; p.id = "it-" + (++seq); p.setAttribute("role", "note"); p.textContent = t;
    b.setAttribute("aria-controls", p.id);
    function apply() { var on = OPEN.has(id); p.hidden = !on; b.setAttribute("aria-expanded", on ? "true" : "false"); }
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (OPEN.has(id)) OPEN.delete(id); else OPEN.add(id); apply(); });
    if (after) after.after(b, p);
    else {
      var first = anchor.firstElementChild;
      if (first && anchor.tagName !== "LABEL") anchor.insertBefore(b, first); else anchor.appendChild(b);
      anchor.after(p);
    }
    apply();
    return b;
  }
  function wireStatic(rootEl) {
    var els = (rootEl || document).querySelectorAll("[data-info]");
    for (var i = 0; i < els.length; i++) add(els[i], els[i].dataset.info, { id: "static:" + (els[i].id || i) });
  }
  function close(id) { OPEN.delete(String(id)); }
  root.ShopperInfoTip = Object.freeze({ add: add, wireStatic: wireStatic, isOpen: function (id) { return OPEN.has(String(id)); }, close: close });
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { wireStatic(document); });
    else wireStatic(document);
  }
})(self);
