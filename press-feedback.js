// lib/press-feedback.js - B-1321 (v2.0.79). Classic script, no imports.
// remote/press-feedback.js is a byte-identical copy (the phone loads it; test v2079-h).
//
// Zach 10/19: "Every action button ... answers slowly and the row stays put until
// the next redraw, so there is no telling it worked." ONE helper every action
// button uses (Pipeline page, Print labels pop-up, Dashboard Do next, the phone):
//
//   press  -> the button is disabled at once and says "Saving…" (the phone:
//             "Sent to the laptop…" - its press goes through the Main computer);
//   saved  -> "Done - drops off": the row is greyed and struck, then taken off
//             the list (and off any count given) a moment later - not at the next
//             full refresh. A press that leaves its row in place (a part
//             quantity, a count, Mark printed) says "Done - saved" instead;
//   failed -> the button comes back as it was, with the plain reason beside it.
//
// It never says Done before the caller's write answered ok: `run` is the write,
// and only its { ok: true } answer turns the row grey.
//
// A row taken off stays off when the page redraws from figures older than the
// press (the rebuild runs after the answer - lib/answer-then-rebuild.js): rows
// drawn again with exactly the same words are hidden for a few minutes, until
// the rebuilt figures leave them out. A row whose words changed (fewer units
// open, a new date) is a different row and is shown.
(function (root) {
  "use strict";
  if (root.ShopperPress) return;

  var SAVING = "Saving…";
  var SENT = "Sent to the laptop…";
  var DONE_DROP = "Done - drops off";
  var DONE_SAVED = "Done - saved";
  var LINGER_MS = 1200;
  var KEEP_HIDDEN_MS = 5 * 60 * 1000;
  var ROW_SELECTOR = ".press-row, .pp-need, .pp-mismatch, .pp-stayed-row, .notif, .need-stayed-row, .need-card, .inv-arrival, tr, li";

  var dropped = new Map(); // key -> { until, sel }
  var watcher = null;

  function now() { return Date.now(); }

  // FNV-1a over the row's own words - the same row drawn again gives the same key.
  function hash(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  function words(el) {
    return String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  }
  function selectorOf(el) {
    if (!el || !el.tagName) return "";
    if (el.tagName === "TR") return "tr";
    if (el.tagName === "LI") return "li";
    var cls = String(el.className || "").split(/\s+/).filter(function (c) { return c && c.indexOf("press-") !== 0; });
    return cls.length ? "." + cls[0] : el.tagName.toLowerCase();
  }
  function keyOf(el) {
    if (!el) return "";
    if (el.dataset && el.dataset.pressKey) return "k:" + el.dataset.pressKey;
    return selectorOf(el) + ":" + hash(words(el));
  }

  function prune() {
    var t = now();
    dropped.forEach(function (v, k) { if (v.until <= t) dropped.delete(k); });
    if (!dropped.size && watcher) { watcher.disconnect(); watcher = null; }
  }

  function hideIfDropped(el) {
    if (!el || el.nodeType !== 1) return false;
    var k = keyOf(el);
    var hit = dropped.get(k);
    if (!hit || hit.until <= now()) return false;
    el.hidden = true;
    if (el.style) el.style.display = "none";
    if (el.dataset) el.dataset.pressGone = "1";
    return true;
  }

  // Rows drawn again from figures older than the press stay off (see top).
  function hideDropped(scope) {
    prune();
    if (!dropped.size || !scope) return 0;
    var sels = [];
    dropped.forEach(function (v) { if (v.sel && sels.indexOf(v.sel) < 0) sels.push(v.sel); });
    var n = 0;
    if (scope.matches && sels.length && scope.matches(sels.join(","))) n += hideIfDropped(scope) ? 1 : 0;
    if (scope.querySelectorAll && sels.length) {
      var list = scope.querySelectorAll(sels.join(","));
      for (var i = 0; i < list.length; i++) n += hideIfDropped(list[i]) ? 1 : 0;
    }
    return n;
  }

  function watch() {
    if (watcher || typeof MutationObserver === "undefined" || typeof document === "undefined" || !document.documentElement) return;
    watcher = new MutationObserver(function (records) {
      prune();
      if (!dropped.size) return;
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) hideDropped(added[j]);
      }
    });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
  }

  // `key` / `sel` are taken when the button is pressed, before its words change.
  function remember(key, sel) {
    if (!key) return;
    dropped.set(key, { until: now() + KEEP_HIDDEN_MS, sel: sel });
    watch();
  }

  function rowFor(button, row) {
    if (typeof row === "function") return row();
    if (row) return row;
    return button && button.closest ? button.closest(ROW_SELECTOR) : null;
  }

  function dropCount(el) {
    if (!el) return;
    var v = parseInt(String(el.textContent || "").replace(/[^0-9-]/g, ""), 10);
    if (!isFinite(v)) return;
    el.textContent = String(Math.max(0, v - 1));
  }

  var UNCONFIRMED = "Not confirmed - check the row before pressing again";
  var WAIT_REDRAW = "Wait - updating\u2026";
  var LOCK_MAX_MS = 90 * 1000;

  function errorWords(res) {
    // B-1321 review L6: an answer that never came may still have been saved - never "Not saved".
    if (res && res.unconfirmed) return UNCONFIRMED + (res.error ? " (" + String(res.error) + ")" : "") + ".";
    // B-1321 review H1: part of it was booked - the answer's own words say what was and was not.
    if (res && res.partial && res.error) return String(res.error);
    var why = res && (res.error || res.reason);
    why = why ? String(why) : "it did not go through";
    return /^not saved/i.test(why) ? why : "Not saved: " + why;
  }

  function clearError(button) {
    var next = button && button.nextSibling;
    if (next && next.nodeType === 1 && next.classList && next.classList.contains("press-error")) next.remove();
  }
  function showError(button, text) {
    clearError(button);
    if (!button || !button.parentNode || typeof document === "undefined") return null;
    var span = document.createElement("span");
    span.className = "press-error";
    span.setAttribute("role", "alert");
    span.textContent = text;
    button.parentNode.insertBefore(span, button.nextSibling);
    return span;
  }

  // opts: run() -> Promise<{ok, error?}> (the write - required)
  //       sending ("Saving…"), drop (true | fn(res)), row (element | fn), counts ([elements]),
  //       lingerMs, onDone(res, row), onDropped(row), onError(res)
  // -> Promise<the answer> (null when the button was already busy)
  function press(button, opts) {
    opts = opts || {};
    if (!button || button.disabled || (button.dataset && button.dataset.pressBusy === "1")) return Promise.resolve(null);
    var row = rowFor(button, opts.row);
    clearError(button);
    var key = row ? keyOf(row) : "";
    var sel = row ? (row.dataset && row.dataset.pressKey ? "[data-press-key]" : selectorOf(row)) : "";
    var label = button.dataset && button.dataset.pressLabel ? button.dataset.pressLabel : button.textContent;
    if (button.dataset) { button.dataset.pressLabel = label; button.dataset.pressBusy = "1"; }
    button.disabled = true;
    button.textContent = opts.sending || SAVING;
    if (button.classList) button.classList.add("press-busy");
    if (row && row.classList) row.classList.add("press-saving");
    var started = now();
    var p;
    try { p = Promise.resolve(opts.run()); } catch (e) { p = Promise.reject(e); }
    return p.then(null, function (e) { return { ok: false, error: (e && e.message) || String(e) }; }).then(function (res) {
      var ok = !!(res && res.ok === true);
      if (button.dataset) button.dataset.pressMs = String(now() - started);
      if (row && row.classList) row.classList.remove("press-saving");
      if (button.classList) button.classList.remove("press-busy");
      if (!ok) {
        // B-1321 review H1: part of the press was booked - the button stays off until the row
        // is drawn again from the rebuilt figures (that redraw replaces it), so a second press
        // cannot book the booked part again. A redraw that never comes frees it after 90 s.
        if (res && res.lockUntilRedraw) {
          button.textContent = WAIT_REDRAW;
          showError(button, errorWords(res));
          setTimeout(function () {
            if (!button.isConnected && button.isConnected !== undefined) return;
            if (button.dataset) button.dataset.pressBusy = "";
            button.disabled = false;
            button.textContent = label;
          }, LOCK_MAX_MS);
          if (typeof opts.onError === "function") { try { opts.onError(res); } catch (e) { /* the error is already shown */ } }
          return res;
        }
        if (button.dataset) button.dataset.pressBusy = "";
        button.disabled = false;
        button.textContent = label;
        showError(button, errorWords(res));
        if (typeof opts.onError === "function") { try { opts.onError(res); } catch (e) { /* the error is already shown */ } }
        return res;
      }
      var drop = typeof opts.drop === "function" ? !!opts.drop(res) : !!opts.drop;
      button.textContent = drop ? DONE_DROP : DONE_SAVED;
      if (button.classList) button.classList.add("press-done-btn");
      if (typeof opts.onDone === "function") { try { opts.onDone(res, row); } catch (e) { /* the press is saved either way */ } }
      if (drop && row) {
        if (row.classList) row.classList.add("press-done");
        remember(key, sel);
        var counts = opts.counts || [];
        for (var i = 0; i < counts.length; i++) dropCount(typeof counts[i] === "function" ? counts[i]() : counts[i]);
        setTimeout(function () {
          var parent = row.parentNode;
          if (parent) parent.removeChild(row);
          if (typeof opts.onDropped === "function") { try { opts.onDropped(row); } catch (e) { /* gone either way */ } }
          // The list the row left hears about it (a card goes with its last row).
          if (parent && typeof parent.dispatchEvent === "function" && typeof Event === "function") {
            try { parent.dispatchEvent(new Event("press-dropped", { bubbles: true })); } catch (e) { /* nothing listens */ }
          }
        }, opts.lingerMs == null ? LINGER_MS : opts.lingerMs);
      } else {
        // The row stays: the button can be pressed again at once (a pencil / Mark
        // printed box that closes keeps it off - keepDone); "Done - saved" shows a moment.
        if (row && row.classList) row.classList.add("press-saved");
        if (!opts.keepDone) {
          if (button.dataset) button.dataset.pressBusy = "";
          button.disabled = false;
        }
        setTimeout(function () {
          if (row && row.classList) row.classList.remove("press-saved");
          if (opts.keepDone) return;
          if (button.textContent === DONE_SAVED) button.textContent = label;
          if (button.classList) button.classList.remove("press-done-btn");
        }, opts.lingerMs == null ? LINGER_MS : opts.lingerMs);
      }
      return res;
    });
  }

  // The phone: a command's outcome -> { ok, error } in plain words.
  // `result` - the laptop's own answer from the command row (a part-way booking says so).
  function phoneAnswer(status, reason, result) {
    if (status === "done") return { ok: true };
    var why = reason ? String(reason) : "";
    if (result && result.partial) return { ok: false, partial: true, lockUntilRedraw: true, error: String(result.error || why) };
    // B-1321 review L6: no answer is not a "no" - the laptop may have saved it.
    if (status === "timeout") return { ok: false, unconfirmed: true, error: "no answer from the laptop in 5 minutes" };
    if (status === "not sent") return { ok: false, error: "not sent - check the phone's connection" };
    if (status === "rejected") return { ok: false, error: why || "the laptop refused it" };
    if (status === "cancelled") return { ok: false, error: why || "taken back before the laptop ran it" };
    if (status === "failed") return { ok: false, error: why || "the laptop said no" };
    return { ok: false, unconfirmed: true, error: why || "the laptop's answer was \"" + String(status || "none") + "\"" };
  }

  root.ShopperPress = Object.freeze({
    press: press,
    phoneAnswer: phoneAnswer,
    hideDropped: hideDropped,
    isDropped: function (el) { prune(); var v = dropped.get(keyOf(el)); return !!(v && v.until > now()); },
    forget: function () { dropped.clear(); prune(); },
    keyOf: keyOf,
    SAVING: SAVING,
    SENT: SENT,
    DONE_DROP: DONE_DROP,
    DONE_SAVED: DONE_SAVED,
    LINGER_MS: LINGER_MS,
    UNCONFIRMED: UNCONFIRMED,
    WAIT_REDRAW: WAIT_REDRAW,
  });
})(typeof self !== "undefined" ? self : this);
