// B-2069 (v2.0.158): ShopperInfoTip - one shared "ⓘ" that folds a plain explainer behind a heading. textContent only; open state in memory by id.
(function (root) {
  "use strict";
  var OPEN = new Set();
  var BTNS = {}; // id -> its ⓘ (B-2284a: Esc closes the last one opened, focus back on its ⓘ)
  var ORDER = []; // ids in the order they were opened
  var seq = 0;
  function headingText(anchor) {
    var t = String((anchor && anchor.textContent) || "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 60) : "this section";
  }
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
      if (oldT) { var ob = oldT.querySelector(".it-body"); if (ob) ob.textContent = t; else oldT.textContent = t; }
      return old;
    }
    if (!t) return null;
    var b = document.createElement("button");
    b.type = "button"; b.className = "c55-info it-btn"; b.textContent = "ⓘ"; b.dataset.it = id;
    b.setAttribute("aria-label", opts.label || ("About " + headingText(anchor)));
    var p = document.createElement("p");
    p.className = "it-text muted small"; p.id = "it-" + (++seq); p.setAttribute("role", "note");
    var body = document.createElement("span"); body.className = "it-body"; body.textContent = t;
    var close = document.createElement("button");
    close.type = "button"; close.className = "s-btn s-btn-quiet it-close"; close.textContent = "Close";
    p.append(body, close);
    b.setAttribute("aria-controls", p.id);
    function apply() { var on = OPEN.has(id); p.hidden = !on; b.setAttribute("aria-expanded", on ? "true" : "false"); }
    BTNS[id] = b;
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (OPEN.has(id)) OPEN.delete(id); else OPEN.add(id); noteOrder(id); apply(); });
    close.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); OPEN.delete(id); noteOrder(id); apply(); try { b.focus(); } catch (er) { /* focus stays */ } });
    if (after) after.after(b, p);
    else {
      var first = anchor.firstElementChild;
      if (first && anchor.tagName !== "LABEL") anchor.insertBefore(b, first); else anchor.appendChild(b);
      anchor.after(p);
    }
    apply();
    return b;
  }
  function noteOrder(id) {
    var i = ORDER.indexOf(id);
    if (i >= 0) ORDER.splice(i, 1);
    if (OPEN.has(id)) ORDER.push(id);
  }
  function wireStatic(rootEl) {
    var els = (rootEl || document).querySelectorAll("[data-info]");
    for (var i = 0; i < els.length; i++) add(els[i], els[i].dataset.info, { id: "static:" + (els[i].id || i) });
  }
  function close(id) { OPEN.delete(String(id)); }
  // Esc closes the open panel that holds focus, else the last one opened; focus goes back to its ⓘ.
  if (typeof document !== "undefined") {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || e.defaultPrevented) return; // handled already (a search box's Esc, a dialog)
      var act = document.activeElement, free = !act || act === document.body || act === document.documentElement;
      if (free && document.querySelector("dialog[open], [role=dialog]:not([hidden]), [role=alertdialog]:not([hidden])")) return;
      OPEN.forEach(function (id) { if (ORDER.indexOf(id) < 0) ORDER.unshift(id); }); // panels reopened by a redraw
      var open = ORDER.filter(function (id) { return OPEN.has(id) && BTNS[id] && BTNS[id].isConnected; });
      if (!open.length) return;
      var a = act, pick = free ? open[open.length - 1] : null;
      for (var i = open.length - 1; i >= 0; i--) {
        var pp = document.getElementById(BTNS[open[i]].getAttribute("aria-controls"));
        if (BTNS[open[i]] === a || (pp && pp.contains(a))) { pick = open[i]; break; }
      }
      if (pick == null) return; // focus is in some other control (an input, a menu): its Esc, not ours
      e.preventDefault();
      OPEN.delete(pick); noteOrder(pick);
      var btn = BTNS[pick], p = document.getElementById(btn.getAttribute("aria-controls"));
      if (p) p.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      try { btn.focus(); } catch (er) { /* focus stays */ }
    });
  }
  root.ShopperInfoTip = Object.freeze({ add: add, wireStatic: wireStatic, isOpen: function (id) { return OPEN.has(String(id)); }, close: close });
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { wireStatic(document); });
    else wireStatic(document);
  }
})(self);
