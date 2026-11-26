// lib/keep-place.js - B-2407. A page that rebuilds its whole list on every state change keeps the reader's place.
// Classic script (self.ShopperKeepPlace); remote/keep-place.js is a byte copy (the phone publishes top-level remote/ files only).
//   snap = ShopperKeepPlace.capture(listEl, rowSelector, keyAttr)   BEFORE the list is emptied
//   ShopperKeepPlace.restore(snap, { focus })                       AFTER the list is rebuilt (focus:false = leave focus alone)
// capture records window.scrollY and an anchor row: the row holding the focused button (the one just pressed) if any, else the first row whose top is
// in the window. restore scrolls so the same row (by its key, e.g. data-asin) sits where it was - it may have moved section - else back to the saved scrollY.
(function () {
  "use strict";
  var root = typeof self !== "undefined" ? self : globalThis;
  function keyOf(row, keyAttr) {
    try { return String(row.getAttribute("data-" + keyAttr) || ""); } catch (e) { return ""; }
  }
  function topOf(row) {
    try { return Number(row.getBoundingClientRect().top); } catch (e) { return NaN; }
  }
  function rowsOf(listEl, sel) {
    try { return Array.prototype.slice.call(listEl.querySelectorAll(sel)); } catch (e) { return []; }
  }
  // The box the list scrolls inside, if it has its own scroll bars (the Buylist's WIDE mode); null when the page itself scrolls.
  function scrollerOf(listEl) {
    try {
      for (var el = listEl.parentNode; el && el.nodeType === 1 && el !== document.documentElement && el !== document.body; el = el.parentNode) {
        var oy = String(window.getComputedStyle(el).overflowY || "");
        if (/(auto|scroll)/.test(oy) && el.scrollHeight > el.clientHeight) return el;
      }
    } catch (e) { /* no computed style: the page scrolls */ }
    return null;
  }
  function capture(listEl, rowSelector, keyAttr) {
    try {
      if (!listEl || !rowSelector) return null;
      var snap = { listEl: listEl, rowSelector: rowSelector, keyAttr: keyAttr || "asin", scrollY: Number(window.scrollY) || 0, key: "", top: 0, focusAction: "", focusRow: false, scroller: null, sTop: 0, sLeft: 0, minTop: 0 };
      var sc = scrollerOf(listEl);
      if (sc) { snap.scroller = sc; snap.sTop = Number(sc.scrollTop) || 0; snap.sLeft = Number(sc.scrollLeft) || 0; snap.minTop = Math.max(0, topOf(sc) || 0); }
      var rows = rowsOf(listEl, rowSelector);
      var active = typeof document !== "undefined" ? document.activeElement : null;
      var anchor = null;
      if (active && active !== document.body && typeof active.closest === "function" && listEl.contains(active)) {
        var r = active.closest(rowSelector);
        if (r && keyOf(r, snap.keyAttr)) {
          anchor = r;
          var ctl = active.closest("[data-action]");
          if (ctl) snap.focusAction = String(ctl.getAttribute("data-action") || "");
          snap.focusRow = active.tagName === "BUTTON" || !!ctl; // a typed-in box keeps its own focus restore
        }
      }
      if (!anchor) {
        for (var i = 0; i < rows.length; i++) {
          var t = topOf(rows[i]);
          if (t >= snap.minTop && keyOf(rows[i], snap.keyAttr)) { anchor = rows[i]; break; }
        }
        snap.focusRow = false;
      }
      if (anchor) { snap.key = keyOf(anchor, snap.keyAttr); snap.top = topOf(anchor); }
      return snap;
    } catch (e) { return null; }
  }
  function restore(snap, opts) {
    try {
      if (!snap || !snap.listEl) return;
      var wantFocus = !(opts && opts.focus === false);
      var rows = rowsOf(snap.listEl, snap.rowSelector);
      var found = null;
      if (snap.key) {
        for (var i = 0; i < rows.length; i++) if (keyOf(rows[i], snap.keyAttr) === snap.key) { found = rows[i]; break; }
      }
      if (found && wantFocus && snap.focusRow) {
        var el = snap.focusAction ? found.querySelector('[data-action="' + snap.focusAction.replace(/(["\\])/g, "\\$1") + '"]') : null;
        if (!el) { found.setAttribute("tabindex", "-1"); el = found; }
        try { el.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
      }
      var sc = snap.scroller;
      var diff = found && isFinite(snap.top) ? topOf(found) - snap.top : NaN;
      if (sc) { // the list's own scroll box first (its position was clamped when the list was emptied), then whatever is left on the page
        var sTo = isFinite(diff) ? (Number(sc.scrollTop) || 0) + diff : snap.sTop;
        sc.scrollTo({ left: snap.sLeft, top: sTo, behavior: "instant" });
        diff = found && isFinite(snap.top) ? topOf(found) - snap.top : NaN;
      }
      var left = Number(window.scrollX) || 0;
      var to = isFinite(diff) ? (Number(window.scrollY) || 0) + diff : snap.scrollY;
      if (to !== (Number(window.scrollY) || 0)) window.scrollTo({ left: left, top: to, behavior: "instant" });
    } catch (e) { /* the page just stays where the browser left it */ }
  }
  root.ShopperKeepPlace = { capture: capture, restore: restore };
})();
