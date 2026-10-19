// remote/phone-nav.js - B-1233 (v2.0.73): the phone's navigation is a sidebar
// like the laptop's (lib/sidenav.js NAV: the same sections, the same order),
// and it hides itself. Zach: "replace the bottom tab bar with an auto-hiding
// sidebar matching the desktop sidebar ... opened by a menu button or edge
// swipe and hiding itself after a pick".
//
//   open:  the menu button in the top bar (#navBtn - it floats at the top
//          right once the bar has scrolled away), or a swipe in from the
//          left edge of the screen.
//   close: a pick, the scrim, the X, a swipe back to the left, or Esc.
//
// ⚠ It owns NO tabs. The buttons are the <button class="tab"> list in
// index.html #phoneNav (the one list) and app.js wires each one to
// switchTab() - so a new section is one more button there; nothing here
// changes. Opening and closing move no data and send nothing. Nothing iOS
// gates behind a real tap (notifications, sound) is started from here - the
// swipe only shows and hides this list; picking a section is a real tap.
//
// Loaded after app.js. Classic script, no innerHTML.
(function () {
  "use strict";
  var doc = document;
  var nav = doc.getElementById("phoneNav");
  var burger = doc.getElementById("navBtn");
  if (!nav || !burger) return;
  var scrim = doc.getElementById("pnScrim");
  var closeBtn = doc.getElementById("pnClose");
  var main = doc.getElementById("mainView");
  var OPEN = "pn-open";
  var FLOAT = "pn-float";
  // A swipe starts within EDGE px of the left edge and must travel PULL px
  // sideways (more sideways than down) to open; the same PULL back closes.
  var EDGE = 20;
  var PULL = 56;

  function isOpen() { return doc.body.classList.contains(OPEN); }
  // Only on the main view (not on Sign in / Pick your laptop), and never over
  // a pop-up that has the screen (the run report, an enlarged snapshot).
  function canOpen() {
    if (!main || main.hidden) return false;
    var cover = doc.querySelector("#reportSheet:not([hidden]), #buyShotsFull:not([hidden])");
    return !cover;
  }
  function stamp() {
    var b = doc.getElementById("buildStamp");
    var t = doc.getElementById("pnBuild");
    if (t) t.textContent = b && b.textContent ? "Shopper Remote " + b.textContent : "Shopper Remote";
  }
  function setOpen(on, opts) {
    on = !!on;
    if (on === isOpen()) return false;
    if (on && !canOpen()) return false;
    doc.body.classList.toggle(OPEN, on);
    burger.setAttribute("aria-expanded", on ? "true" : "false");
    nav.setAttribute("aria-hidden", on ? "false" : "true");
    if (on) {
      stamp();
      // Keyboard only: a finger does not need (or want) a focus ring.
      if (opts && opts.focus) {
        var cur = nav.querySelector(".tab.active") || nav.querySelector(".tab");
        try { if (cur) cur.focus({ preventScroll: true }); } catch (e) { /* fine */ }
      }
    } else if (opts && opts.focus) {
      try { burger.focus({ preventScroll: true }); } catch (e) { /* fine */ }
    }
    return true;
  }
  function open(opts) { return setOpen(true, opts); }
  function close(opts) { return setOpen(false, opts); }
  nav.setAttribute("aria-hidden", "true");

  // event.detail === 0: the button was pressed with the keyboard.
  burger.addEventListener("click", function (e) { if (isOpen()) close(); else open({ focus: e && e.detail === 0 }); });
  if (closeBtn) closeBtn.addEventListener("click", function (e) { close({ focus: e && e.detail === 0 }); });
  if (scrim) scrim.addEventListener("click", function () { close(); });
  // Hides itself after a pick (app.js's own listener on the button switches the tab).
  nav.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".tab") : null;
    if (t && nav.contains(t)) close();
  });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) close({ focus: true }); });

  // ---- the edge swipe (passive: the page still scrolls normally) ----------
  var touch = null;
  function swipeStart(x, y) {
    var opened = isOpen();
    touch = (opened || (x <= EDGE && canOpen())) ? { x: x, y: y, opened: opened } : null;
    return !!touch;
  }
  function swipeMove(x, y) {
    if (!touch) return null;
    var dx = x - touch.x, dy = y - touch.y;
    if (Math.abs(dy) > Math.abs(dx)) { if (Math.abs(dy) > 12) touch = null; return null; }
    if (!touch.opened && dx >= PULL) { touch = null; return open() ? "opened" : null; }
    if (touch.opened && dx <= -PULL) { touch = null; return close() ? "closed" : null; }
    return null;
  }
  doc.addEventListener("touchstart", function (e) {
    if (!e.touches || e.touches.length !== 1) { touch = null; return; }
    swipeStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  doc.addEventListener("touchmove", function (e) {
    if (!touch || !e.touches || !e.touches.length) return;
    swipeMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  doc.addEventListener("touchend", function () { touch = null; }, { passive: true });
  doc.addEventListener("touchcancel", function () { touch = null; }, { passive: true });

  // ---- the floating menu button once the top bar has scrolled away --------
  var bar = doc.getElementById("topBar");
  if (bar && typeof IntersectionObserver === "function") {
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      doc.body.classList.toggle(FLOAT, !!e && !e.isIntersecting);
    }).observe(bar);
  }

  self.ShopperPhoneNav = Object.freeze({ open: open, close: close, isOpen: isOpen, swipeStart: swipeStart, swipeMove: swipeMove, EDGE: EDGE, PULL: PULL });
})();
