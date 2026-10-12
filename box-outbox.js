// remote/box-outbox.js - B-1089 (v2.0.55): the phone's outbox for box words.
//
// Zach: "when I start packing up the boxes at 2 pm, when I go to upload
// everything to Scanpower at midnight, it's all still going to be there."
//
// Every Read on the Stock tab's Box contents and on the Ship tab puts the
// words HERE first (localStorage "shopperBoxOutbox", written and read back
// before the text box is emptied), then sends them to the laptop. They stay
// here - shown under the text box as "Unsent on this phone" - until the
// laptop's payload lists them (payload.boxes.stored: "<hash>|<key>" for the
// last 50 messages it saved). Until then they are sent again: when the app
// opens, comes back to the front, gets its connection back, and every 60 s -
// a new command each time (the previous one, if still waiting in the relay,
// is taken back). The laptop recognises a message it already has by its
// hash + key and does not read it twice (background/box-contents-handlers.js).
// So the relay's command life, the laptop sleeping, the phone being offline
// or the app being updated or reloaded no longer matter.
//
// Owns no rules and no DOM: remote/boxes.js (Stock) and remote/wizard-view.js
// (Ship, through dictateFor) draw what is here.
(function () {
  "use strict";
  var OUTBOX_KEY = "shopperBoxOutbox";
  var OUTBOX_CORRUPT_KEY = "shopperBoxOutboxCorrupt";
  var SEQ_KEY = "shopperBoxOutboxSeq";
  var PHONE_KEY = "shopperBoxPhoneId";
  var RESEND_MS = 60 * 1000;
  var TICK_MS = 15 * 1000;
  var MAX_PER_TICK = 10;
  // Same as BOX_TEXT_MAX_CHARS on the laptop (lib/box-contents.js).
  var MAX_CHARS = 60000;
  var listeners = [];

  function R() { return self.ShopperRemote || null; }
  // Same as textHash in lib/box-contents-steps.js (a test checks parity).
  function textHash(s) {
    var t = String(s == null ? "" : s).trim();
    var h = 5381;
    for (var k = 0; k < t.length; k++) h = ((h * 33) ^ t.charCodeAt(k)) >>> 0;
    return h.toString(16);
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
      return localStorage.getItem(k) === v;
    } catch (e) {
      return false;
    }
  }
  function valid(e) { return !!e && typeof e === "object" && typeof e.key === "string" && typeof e.words === "string" && !!e.words; }
  function load() {
    var raw = lsGet(OUTBOX_KEY);
    if (!raw) return [];
    try {
      var v = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter(valid);
    } catch (e) { /* below */ }
    // Never overwritten: an unreadable outbox is copied aside first.
    if (lsGet(OUTBOX_CORRUPT_KEY).indexOf(raw) < 0) lsSet(OUTBOX_CORRUPT_KEY, lsGet(OUTBOX_CORRUPT_KEY) + "\n" + raw);
    return [];
  }
  function save(list) { return lsSet(OUTBOX_KEY, JSON.stringify(list)); }
  function emit() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* a listener never breaks the outbox */ } }); }
  function phoneId() {
    var id = lsGet(PHONE_KEY);
    if (!id) {
      id = "ph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      lsSet(PHONE_KEY, id);
    }
    return id;
  }
  function nextSeq(list) {
    var n = Number(lsGet(SEQ_KEY)) || 0;
    (list || []).forEach(function (e) { if (Number(e.phoneSeq) > n) n = Number(e.phoneSeq); });
    n += 1;
    lsSet(SEQ_KEY, String(n));
    return n;
  }
  function find(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function patch(key, fields) {
    var list = load();
    var e = find(list, key);
    if (!e) return;
    for (var k in fields) e[k] = fields[k];
    save(list);
  }

  // The words -> the outbox (verified), then sent. { ok, entry } / { ok:false, error }.
  function add(words, opts) {
    opts = opts || {};
    var text = String(words == null ? "" : words).trim();
    if (!text) return { ok: false, error: "Nothing typed." };
    if (text.length > MAX_CHARS) return { ok: false, error: "That is " + text.length + " characters - one message holds " + MAX_CHARS + ". Say it in two parts." };
    var list = load();
    var seq = nextSeq(list);
    var e = {
      key: phoneId() + ":" + seq,
      phoneSeq: seq,
      hash: textHash(text),
      words: text,
      batchId: String(opts.batchId || ""),
      source: opts.source === "phone-ship" ? "phone-ship" : "phone-stock",
      at: Date.now(),
      sends: 0,
      lastSentAt: 0,
      lastError: "",
      cmdId: "",
    };
    list.push(e);
    if (!save(list)) return { ok: false, error: "This phone could not save the words (its storage is full or blocked) - they are still in the text box." };
    emit();
    // In order: any earlier message whose copy did not go is sent again first.
    sendRound(true);
    return { ok: true, entry: e };
  }

  function seqOf(e) { return Number(e && e.phoneSeq) || 0; }
  function phoneOf(e) { return String((e && e.key) || "").split(":")[0]; }
  // v2.0.55 review: the earlier messages from this phone still unsent - the
  // laptop holds this one until they arrive (bounded), so it reads in order.
  function waitForOf(list, e) {
    return list.filter(function (x) { return phoneOf(x) === phoneOf(e) && seqOf(x) < seqOf(e); }).map(seqOf);
  }

  // One copy of one message. Resolves true when the relay took it.
  function sendOne(key) {
    var r = R();
    var list = load();
    var e = find(list, key);
    if (!e) return Promise.resolve(true);
    if (!r || typeof r.sendQuiet !== "function") {
      patch(key, { lastError: "not connected yet" });
      return Promise.resolve(false);
    }
    var prevCmd = e.cmdId;
    // Marked before the send, so two ticks never send the same words at once.
    patch(key, { lastSentAt: Date.now(), sends: (Number(e.sends) || 0) + 1 });
    var check = prevCmd && typeof r.readCommand === "function"
      ? Promise.resolve(r.readCommand(prevCmd)).catch(function () { return null; })
      : Promise.resolve(null);
    return check
      .then(function (row) {
        // What the laptop said about the last copy (shown if it keeps refusing).
        if (row && (row.status === "rejected" || row.status === "failed" || row.status === "error")) patch(key, { laptopSaid: String(row.reason || row.status).slice(0, 200) });
        // The last copy, if it is still waiting in the relay, is taken back -
        // at most one copy waits at a time.
        if (prevCmd && (!row || row.status === "pending") && typeof r.cancelPending === "function") {
          return Promise.resolve(r.cancelPending(prevCmd, "sent again by the phone (B-1089)")).catch(function () { return false; });
        }
        return null;
      })
      .then(function () {
        // saidAt = when he said it (this phone's clock); waitFor = earlier
        // messages still unsent here (v2.0.55 review: read in the order said).
        return r.sendQuiet("boxesSend", { text: e.words, batchId: e.batchId, source: e.source, hash: e.hash, phoneSeq: e.phoneSeq, phoneKey: e.key, saidAt: e.at, waitFor: waitForOf(load(), e) });
      })
      .then(function (id) {
        patch(key, { cmdId: id || "", lastError: id ? "" : "not sent - no connection" });
        emit();
        return !!id;
      }, function () {
        patch(key, { lastError: "not sent - no connection" });
        emit();
        return false;
      });
  }

  // v2.0.55 review (B-1089): messages go oldest first, one after another, and
  // a round sends again every unsent message AFTER the first one due - so the
  // relay always holds them in the order they were said (a resend never lands
  // behind a later message). A copy the relay did not take stops the round:
  // nothing later goes ahead of it.
  var round = { busy: false, again: false, force: false };
  function sendRound(force) {
    if (round.busy) { round.again = true; round.force = round.force || !!force; return Promise.resolve(0); }
    var list = load().slice().sort(function (a, b) { return seqOf(a) - seqOf(b); });
    var now = Date.now();
    var first = -1;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.lastSentAt || now - e.lastSentAt >= RESEND_MS || (force && e.lastError)) { first = i; break; }
    }
    if (first < 0) return Promise.resolve(0);
    var keys = list.slice(first, first + MAX_PER_TICK).map(function (x) { return x.key; });
    round.busy = true;
    var n = 0;
    function step(k) {
      if (k >= keys.length) return Promise.resolve();
      return sendOne(keys[k]).then(function (took) {
        n++;
        if (!took) return undefined;
        return step(k + 1);
      });
    }
    return step(0).then(null, function () {}).then(function () {
      round.busy = false;
      if (!round.again) return n;
      var f = round.force;
      round.again = false;
      round.force = false;
      return sendRound(f).then(function (m) { return n + m; });
    });
  }

  function tick(force) { return sendRound(!!force); }

  // The laptop's list of what it has: those messages leave the outbox.
  function confirm(stored) {
    if (!Array.isArray(stored)) return 0;
    var have = {};
    stored.forEach(function (s) { have[String(s)] = true; });
    var list = load();
    var keep = list.filter(function (e) { return !have[e.hash + "|" + e.key]; });
    if (keep.length === list.length) return 0;
    if (!save(keep)) return 0;
    emit();
    return list.length - keep.length;
  }

  function unsent(source) {
    return load().filter(function (e) { return !source || e.source === source; });
  }

  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  // For the Ship tab's text box (remote/wizard-view.js opts.dictate).
  function dictateFor(source, draftKey) {
    var dk = draftKey || (source === "phone-ship" ? "shopperShipBoxesText" : "shopperBoxesText");
    return {
      load: function () { return lsGet(dk); },
      save: function (t) { lsSet(dk, String(t == null ? "" : t)); },
      submit: function (text, input) {
        var r = add(text, { source: source, batchId: input && input.batchId ? input.batchId : "" });
        return Promise.resolve(r.ok ? { ok: true, queued: true } : { ok: false, error: r.error });
      },
      pending: function () { return unsent(source); },
      // v2.0.55 review: every source (Stock tab too) - the Ship tab's Upload waits for all of them.
      pendingAny: function () { return unsent(); },
      laptopOnline: function () { var r = R(); return !r || typeof r.laptopOnline !== "function" ? true : !!r.laptopOnline(); },
      stamp: function () { return JSON.stringify(unsent(source).map(function (e) { return [e.key, e.lastError, e.laptopSaid || "", e.sends > 0]; })); },
    };
  }

  // Sent again when the app opens, comes to the front, or is back online.
  try {
    setInterval(function () { tick(false); }, TICK_MS);
    setTimeout(function () { tick(true); }, 1500);
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") tick(true); });
    }
    if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("online", function () { tick(true); });
    // Ask the browser to keep this site's storage (iOS / Chrome may evict it otherwise).
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  } catch (e) {
    /* timers are best-effort; a Read sends at once anyway */
  }

  self.ShopperBoxOutbox = Object.freeze({ add: add, tick: tick, confirm: confirm, unsent: unsent, onChange: onChange, dictateFor: dictateFor, textHash: textHash, OUTBOX_KEY: OUTBOX_KEY, RESEND_MS: RESEND_MS });
})();
