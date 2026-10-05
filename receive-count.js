// lib/receive-count.js - B-840 (v2.0.21): the "Receive" counter.
//
// Zach, 2026-10-05: "When I press the button I want some kind of little pop-up
// bubble that lets me count a chunk at a time ... a +12 button and then some
// convenient way to type in a custom number ... There would be a Done button
// and that would just be to count what I have on hand. It doesn't need to
// overwrite the pipeline number ... when I'm ready I could say, 'Yes this is the
// official count on hand'." And later: "make that available on desktop as well ...
// talk into a box using Wispr Flow ... an additional bubble that pops up."
//
// ONE shared component, a CLASSIC script (no imports, no chrome.* API) so the
// Pipeline page (lib/receive-count.js) and the phone app (remote/receive-count.js,
// a byte-identical copy - test v2021) both load it as a plain <script> and get
// `self.ShopperReceive`.
//
// WHAT IT DOES NOT DO: it owns no rules and sends nothing by itself. A tally is
// only a count Zach keeps on the screen; "Done" closes and keeps it. Only the
// inline "Make this the House count" -> "Yes, set it" calls the host's
// `onConfirm(total)`, and the HOST decides how that reaches the laptop (the
// existing setCount command). The component then clears the tally only if the
// host said { ok: true }; on a failure the tally stays and the sentence is shown.
//
// DOM is built with createElement + textContent only (no innerHTML).
(function () {
  "use strict";

  var MIN_CHUNK = 1;
  var MAX_CHUNK = 9999;
  var QUICK = 12;
  // A runaway guard for the stored list (1000 boxes of 12 is 12,000 units).
  var MAX_CHUNKS = 1000;
  var STORE_KEY = "shopperReceiveTallies";
  var MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  var MAX_ENTRIES = 200;

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // ------------------------------------------------------------------ pure logic

  // A chunk is a whole number from 1 to 9999. Nothing else is ever counted.
  function isChunk(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= MIN_CHUNK && n <= MAX_CHUNK;
  }

  // What was typed into the number box: digits only. "12.5", "-3", "1e3", "" -> null.
  function parseTyped(text) {
    var s = String(text == null ? "" : text).trim();
    if (!/^\d{1,5}$/.test(s)) return null;
    var n = parseInt(s, 10);
    return isChunk(n) ? n : null;
  }

  // A tally is a list of whole-number chunks: add, undo the last, clear, total.
  function createTally(initial) {
    var chunks = [];
    if (Array.isArray(initial)) {
      for (var i = 0; i < initial.length && chunks.length < MAX_CHUNKS; i++) if (isChunk(initial[i])) chunks.push(initial[i]);
    }
    return {
      add: function (n) {
        if (!isChunk(n) || chunks.length >= MAX_CHUNKS) return false;
        chunks.push(n);
        return true;
      },
      undo: function () { return chunks.length ? chunks.pop() : null; },
      clear: function () { chunks.length = 0; },
      total: function () { var t = 0; for (var i = 0; i < chunks.length; i++) t += chunks[i]; return t; },
      size: function () { return chunks.length; },
      chunks: function () { return chunks.slice(); }
    };
  }

  function fmtNum(x) {
    var n = Number(x);
    if (!isFinite(n)) return "";
    if (Math.floor(n) === n) return n.toLocaleString("en-US");
    return String(Math.round(n * 100) / 100);
  }

  // The line under the big total: "144 to go" / "Matches" / "3 over".
  function gapInfo(expected, total, entries, format) {
    var f = typeof format === "function" ? format : fmtNum;
    var e = Number(expected);
    if (expected == null || expected === "" || !isFinite(e)) return { kind: "none", text: "" };
    var d = e - total;
    if (Math.abs(d) < 0.0005) {
      return entries > 0 ? { kind: "match", text: "Matches" } : { kind: "none", text: "Nothing counted yet" };
    }
    return d > 0 ? { kind: "short", text: f(d) + " to go" } : { kind: "over", text: f(-d) + " over" };
  }

  // ---------------------------------------------------------- speech / dictation
  //
  // Wispr Flow types text into the focused box. This turns that text into
  // chunks: "12, 12, 11", "twelve twelve eleven", "one hundred eighty",
  // "a dozen". It never guesses: anything it cannot read as a whole number from
  // 1 to 9999 goes to `unknown` and is shown to Zach.
  var SMALL = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
  };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  // Words that carry no number and are dropped without a word.
  var FILLER = {
    box: 1, boxes: 1, unit: 1, units: 1, of: 1, a: 1, the: 1, and: 1, plus: 1, then: 1, next: 1, another: 1, more: 1, count: 1
  };
  // Punctuation that only separates: "12, 12, 11" is three counts. The ONE exception is a number
  // written with thousands commas and no spaces ("1,200", "12,345"), which the tokenizer reads
  // as a single number (Wispr Flow writes a spoken "twelve hundred" that way).
  var SEP_PUNCT = ",;.:!?()[]{}\"'`+&/\\|_-\u2010\u2011\u2013\u2014\u2026\u2018\u2019\u201c\u201d";

  function tokenize(line) {
    // twenty-four -> twenty four (a hyphen BETWEEN LETTERS only, no spaces).
    var s = String(line).replace(/([A-Za-z])[-\u2010\u2011](?=[A-Za-z])/g, "$1 ");
    var re = /\d{1,3}(?:,\d{3})+(?!\d|\.\d)|\d+(?:\.\d+)+|\d+|[A-Za-z]+(?:['\u2019][A-Za-z]+)*|\S/g;
    var out = [];
    var m;
    while ((m = re.exec(s)) !== null) {
      var raw = m[0];
      var kind = /^\d{1,3}(?:,\d{3})+$|^\d+$/.test(raw) ? "int" : /^\d/.test(raw) ? "dec" : /^[A-Za-z]/.test(raw) ? "word" : "punct";
      out.push({ raw: raw, low: raw.toLowerCase(), at: m.index, end: m.index + raw.length, kind: kind, num: kind === "int" ? parseInt(raw.replace(/,/g, ""), 10) : 0 });
    }
    return out;
  }

  function wordAt(toks, k) {
    var t = toks[k];
    return t && t.kind === "word" ? t.low : "";
  }

  // 1..99 (a digit token, a teen, a tens word, or tens + unit); null if none starts here.
  function below100(toks, k) {
    var t = toks[k];
    if (!t) return null;
    if (t.kind === "int") return { v: t.num, next: k + 1 };
    if (t.kind !== "word") return null;
    var w = t.low;
    if (has(TENS, w)) {
      var u = wordAt(toks, k + 1);
      if (u && has(SMALL, u) && SMALL[u] >= 1 && SMALL[u] <= 9) return { v: TENS[w] + SMALL[u], next: k + 2 };
      return { v: TENS[w], next: k + 1 };
    }
    if (has(SMALL, w)) return { v: SMALL[w], next: k + 1 };
    return null;
  }

  function below1000(toks, k) {
    var a = below100(toks, k);
    if (!a && wordAt(toks, k) === "hundred") a = { v: 1, next: k };
    if (a && a.v >= 1 && a.v <= 99 && wordAt(toks, a.next) === "hundred") {
      var val = a.v * 100;
      var nx = a.next + 1;
      var m = nx;
      if (wordAt(toks, m) === "and") m++;
      var r = below100(toks, m);
      if (r && r.v >= 1 && r.v <= 99) { val += r.v; nx = r.next; }
      return { v: val, next: nx };
    }
    return a;
  }

  function thousands(toks, k) {
    var a = below1000(toks, k);
    if (!a && wordAt(toks, k) === "thousand") a = { v: 1, next: k };
    if (a && a.v >= 1 && a.v <= 999 && wordAt(toks, a.next) === "thousand") {
      var val = a.v * 1000;
      var nx = a.next + 1;
      var m = nx;
      if (wordAt(toks, m) === "and") m++;
      var r = below1000(toks, m);
      if (r && r.v >= 1 && r.v <= 999) { val += r.v; nx = r.next; }
      return { v: val, next: nx };
    }
    return a;
  }

  // The number that starts at token i (digits or words), or null.
  function numberAt(toks, i) {
    var a = wordAt(toks, i) === "dozen" ? { v: 1, next: i } : thousands(toks, i);
    if (!a) return null;
    var v = a.v;
    var nx = a.next;
    if (wordAt(toks, nx) === "dozen" && v >= 1) { v *= 12; nx++; }
    var parts = [];
    for (var j = i; j < nx; j++) parts.push(toks[j].raw);
    return { value: v, next: nx, text: parts.join(" ") };
  }

  function parseSpoken(text) {
    var numbers = [];
    var unknown = [];
    var lines = String(text == null ? "" : text).split(/\r\n|\r|\n/);
    for (var li = 0; li < lines.length; li++) {
      var toks = tokenize(lines[li]);
      var run = [];
      var flush = function () { if (run.length) { unknown.push(run.join(" ")); run = []; } };
      var i = 0;
      while (i < toks.length) {
        var t = toks[i];
        if (t.kind === "punct") {
          var next = toks[i + 1];
          var before = toks[i - 1];
          // "-5" (a minus sign stuck to a number) is never read as 5.
          if ((t.raw === "-" || t.raw === "\u2212") && next && (next.kind === "int" || next.kind === "dec") && next.at === t.end && (!before || before.end < t.at)) {
            flush();
            unknown.push(t.raw + next.raw);
            i += 2;
          } else if (SEP_PUNCT.indexOf(t.raw) >= 0) {
            flush();
            i++;
          } else {
            run.push(t.raw);
            i++;
          }
          continue;
        }
        if (t.kind === "dec") { flush(); unknown.push(t.raw); i++; continue; }
        if (t.kind === "word" && has(FILLER, t.low)) { flush(); i++; continue; }
        // "half a dozen" is 6, not 12: never guessed, shown to Zach instead.
        if (t.kind === "word" && t.low === "half") {
          var hk = i + 1;
          if (wordAt(toks, hk) === "a") hk++;
          if (wordAt(toks, hk) === "dozen") {
            flush();
            var hp = [];
            for (var hj = i; hj <= hk; hj++) hp.push(toks[hj].raw);
            unknown.push(hp.join(" "));
            i = hk + 1;
            continue;
          }
        }
        var r = numberAt(toks, i);
        if (r) {
          flush();
          var after = wordAt(toks, r.next);
          if (after === "point" || after === "dot") {
            // "twelve point five" is a decimal: never read as 12 and 5.
            var dj = r.next + 1;
            while (dj < toks.length && (toks[dj].kind === "int" || (toks[dj].kind === "word" && (has(SMALL, toks[dj].low) || has(TENS, toks[dj].low))))) dj++;
            var dp = [];
            for (var dq = i; dq < dj; dq++) dp.push(toks[dq].raw);
            unknown.push(dp.join(" "));
            i = dj;
            continue;
          }
          if (isChunk(r.value)) numbers.push(r.value);
          else unknown.push(r.text);
          i = r.next;
          continue;
        }
        run.push(t.raw);
        i++;
      }
      flush();
    }
    var sum = 0;
    for (var k = 0; k < numbers.length; k++) sum += numbers[k];
    return { numbers: numbers, sum: sum, unknown: unknown };
  }

  // ------------------------------------------------------------------ the store
  //
  // Tallies in progress, per ASIN, under ONE localStorage key:
  //   { "<ASIN>": { chunks: [12, 12, 11], updatedAt: <ms> } }
  // Every storage call is wrapped: a private window, a blocked store or a full
  // one never breaks counting - the page falls back to memory for the rest of
  // its life. Entries older than 14 days are dropped; at most 200 are kept.
  var memory = {};
  var degraded = false;

  function normAsin(asin) { return String(asin == null ? "" : asin).trim().toUpperCase(); }

  function prune(map, now) {
    var t = typeof now === "number" ? now : Date.now();
    var rows = [];
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (var key in map) {
        if (!has(map, key)) continue;
        var e = map[key];
        if (!e || typeof e !== "object" || !Array.isArray(e.chunks)) continue;
        var at = Number(e.updatedAt);
        if (!isFinite(at) || t - at > MAX_AGE_MS) continue;
        var chunks = [];
        for (var i = 0; i < e.chunks.length && chunks.length < MAX_CHUNKS; i++) if (isChunk(e.chunks[i])) chunks.push(e.chunks[i]);
        if (!chunks.length) continue;
        rows.push({ key: key, at: at, chunks: chunks });
      }
    }
    rows.sort(function (a, b) { return b.at - a.at; });
    var out = {};
    for (var j = 0; j < rows.length && j < MAX_ENTRIES; j++) out[rows[j].key] = { chunks: rows[j].chunks, updatedAt: rows[j].at };
    return out;
  }

  function readMap(now) {
    var map = null;
    if (!degraded) {
      try {
        var s = self.localStorage;
        var raw = s ? s.getItem(STORE_KEY) : null;
        map = raw ? JSON.parse(raw) : {};
      } catch (e) {
        degraded = true;
        map = null;
      }
    }
    if (map == null) map = memory;
    var clean = prune(map, now);
    memory = clean;
    return clean;
  }

  function writeMap(map) {
    memory = map;
    if (degraded) return;
    try {
      self.localStorage.setItem(STORE_KEY, JSON.stringify(map));
    } catch (e) {
      degraded = true; // memory still has it for the rest of this page's life
    }
  }

  function getChunks(asin, now) {
    var e = readMap(now)[normAsin(asin)];
    return e ? e.chunks.slice() : [];
  }

  function setChunks(asin, chunks, now) {
    var key = normAsin(asin);
    if (!key) return;
    var map = readMap(now);
    var clean = [];
    for (var i = 0; i < (chunks || []).length; i++) if (isChunk(chunks[i])) clean.push(chunks[i]);
    if (clean.length) map[key] = { chunks: clean, updatedAt: typeof now === "number" ? now : Date.now() };
    else delete map[key];
    writeMap(prune(map, now));
  }

  function clearFor(asin, now) { setChunks(asin, [], now); }

  // The tally total for the row button label; null when nothing is in progress.
  function totalFor(asin, now) {
    var c = getChunks(asin, now);
    if (!c.length) return null;
    var t = 0;
    for (var i = 0; i < c.length; i++) t += c[i];
    return t;
  }

  function buttonLabel(asin) {
    var t = totalFor(asin);
    return t == null ? "Receive" : "Receive \u00b7 " + fmtNum(t);
  }

  // ------------------------------------------------------------------- the pop-up

  var current = null; // { close: fn } - only one pop-up at a time
  var seq = 0;

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function btn(cls, text, onClick) {
    var b = h("button", "rc-btn " + cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function hiddenWithin(el, stop) {
    for (var n = el; n && n !== stop; n = n.parentNode) if (n.hidden) return true;
    return false;
  }

  function open(opts) {
    opts = opts || {};
    var asin = normAsin(opts.asin);
    if (!asin || typeof document === "undefined" || !document.body) return null;
    closeCurrent();

    var title = String(opts.title || asin);
    var where = String(opts.where || "House");
    var expected = opts.expected;
    // `format` (optional) writes a number the way the host page does (a fraction like "1 1/3").
    var format = typeof opts.format === "function" ? opts.format : fmtNum;
    var expectedText = opts.expectedText != null ? String(opts.expectedText) : (expected != null && isFinite(Number(expected)) ? format(Number(expected)) : "");
    var canConfirm = typeof opts.onConfirm === "function";
    var tally = createTally(getChunks(asin));
    var sending = false;
    var closed = false;
    var downOnBackdrop = false;
    var opener = document.activeElement;
    var uid = "rc-" + (++seq);

    // ---- build
    var overlay = h("div", "rc-overlay");
    var card = h("div", "rc-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", uid + "-title");
    card.setAttribute("tabindex", "-1");

    var head = h("div", "rc-head");
    var heads = h("div", "rc-heads");
    var titleEl = h("div", "rc-title", title);
    titleEl.setAttribute("id", uid + "-title");
    heads.appendChild(titleEl);
    heads.appendChild(h("div", "rc-asin", asin + " \u00b7 " + where));
    var xBtn = h("button", "rc-x", "\u2715");
    xBtn.type = "button";
    xBtn.setAttribute("aria-label", "Close the counter");
    head.appendChild(heads);
    head.appendChild(xBtn);

    var totalBox = h("div", "rc-totalbox");
    var totalLine = h("div", "rc-total");
    totalLine.setAttribute("aria-live", "polite");
    var totalN = h("span", "rc-total-n", "0");
    var totalOf = h("span", "rc-total-of", "");
    totalLine.appendChild(totalN);
    totalLine.appendChild(totalOf);
    var gapEl = h("div", "rc-gap", "");
    totalBox.appendChild(totalLine);
    totalBox.appendChild(gapEl);

    var entriesEl = h("div", "rc-entries", "");

    var plusBtn = h("button", "rc-btn rc-plus", "+" + QUICK);
    plusBtn.type = "button";

    var customRow = h("div", "rc-custom");
    var input = h("input", "rc-input", null);
    input.type = "text";
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("pattern", "[0-9]*");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("enterkeyhint", "done");
    input.setAttribute("placeholder", "Other number");
    input.setAttribute("aria-label", "Other amount to add");
    var addBtn = h("button", "rc-btn rc-add", "Add");
    addBtn.type = "button";
    customRow.appendChild(input);
    customRow.appendChild(addBtn);

    var tools = h("div", "rc-tools");
    var undoBtn = h("button", "rc-btn rc-quiet", "Undo last");
    undoBtn.type = "button";
    var clearBtn = h("button", "rc-btn rc-quiet rc-danger", "Start over");
    clearBtn.type = "button";
    var voiceBtn = h("button", "rc-btn rc-quiet rc-voice-btn", "Voice");
    voiceBtn.type = "button";
    voiceBtn.setAttribute("aria-expanded", "false");
    tools.appendChild(undoBtn);
    tools.appendChild(clearBtn);
    tools.appendChild(voiceBtn);

    var clearAsk = h("div", "rc-ask");
    clearAsk.hidden = true;
    clearAsk.setAttribute("role", "group");
    var clearQ = h("div", "rc-ask-text", "Clear this count?");
    var clearYes = h("button", "rc-btn rc-danger", "Yes");
    clearYes.type = "button";
    var clearNo = h("button", "rc-btn rc-quiet", "No");
    clearNo.type = "button";
    clearAsk.appendChild(clearQ);
    var clearAskBtns = h("div", "rc-ask-btns");
    clearAskBtns.appendChild(clearYes);
    clearAskBtns.appendChild(clearNo);
    clearAsk.appendChild(clearAskBtns);

    var voiceBox = h("div", "rc-voice");
    voiceBox.hidden = true;
    var voiceText = h("textarea", "rc-voice-text", null);
    voiceText.setAttribute("rows", "3");
    voiceText.setAttribute("placeholder", "Tap here and speak with Wispr Flow: 12, 12, 11 ...");
    voiceText.setAttribute("aria-label", "Spoken counts");
    voiceText.setAttribute("autocomplete", "off");
    voiceText.setAttribute("autocapitalize", "off");
    voiceText.setAttribute("spellcheck", "false");
    var voiceLive = h("div", "rc-voice-live", "");
    var voiceBad = h("div", "rc-voice-bad", "");
    voiceBad.hidden = true;
    var voiceBtns = h("div", "rc-voice-btns");
    var voiceAdd = h("button", "rc-btn rc-add", "Add 0 to the count");
    voiceAdd.type = "button";
    var voiceClose = h("button", "rc-btn rc-quiet", "Close");
    voiceClose.type = "button";
    voiceBtns.appendChild(voiceAdd);
    voiceBtns.appendChild(voiceClose);
    voiceBox.appendChild(voiceText);
    voiceBox.appendChild(voiceLive);
    voiceBox.appendChild(voiceBad);
    voiceBox.appendChild(voiceBtns);

    var msg = h("div", "rc-msg", "");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");

    var foot = h("div", "rc-foot");
    var doneBtn = h("button", "rc-btn rc-done", "Done");
    doneBtn.type = "button";
    var makeBtn = h("button", "rc-btn rc-primary rc-make", "Make this the " + where + " count");
    makeBtn.type = "button";
    makeBtn.hidden = !canConfirm;
    foot.appendChild(doneBtn);
    foot.appendChild(makeBtn);

    var makeAsk = h("div", "rc-ask");
    makeAsk.hidden = true;
    makeAsk.setAttribute("role", "group");
    var makeQ = h("div", "rc-ask-text", "");
    var makeYes = h("button", "rc-btn rc-primary", "Yes, set it");
    makeYes.type = "button";
    var makeNo = h("button", "rc-btn rc-quiet", "No");
    makeNo.type = "button";
    makeAsk.appendChild(makeQ);
    var makeAskBtns = h("div", "rc-ask-btns");
    makeAskBtns.appendChild(makeYes);
    makeAskBtns.appendChild(makeNo);
    makeAsk.appendChild(makeAskBtns);

    card.appendChild(head);
    card.appendChild(totalBox);
    card.appendChild(entriesEl);
    card.appendChild(plusBtn);
    card.appendChild(customRow);
    card.appendChild(tools);
    card.appendChild(clearAsk);
    card.appendChild(voiceBox);
    card.appendChild(msg);
    card.appendChild(foot);
    card.appendChild(makeAsk);
    overlay.appendChild(card);

    var focusables = [xBtn, plusBtn, input, addBtn, undoBtn, clearBtn, voiceBtn, clearYes, clearNo,
      voiceText, voiceAdd, voiceClose, doneBtn, makeBtn, makeYes, makeNo];

    // ---- state -> screen
    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "rc-msg" + (kind ? " rc-msg-" + kind : "");
    }

    function render() {
      var n = tally.size();
      var total = tally.total();
      totalN.textContent = fmtNum(total);
      totalOf.textContent = expectedText ? " of " + expectedText : "";
      var gap = gapInfo(expected, total, n, format);
      gapEl.textContent = gap.text;
      gapEl.className = "rc-gap rc-gap-" + gap.kind;
      gapEl.hidden = !gap.text;
      var list = tally.chunks();
      entriesEl.textContent = list.length ? list.join(" + ") : "Nothing counted yet. Count a box, then tap +" + QUICK + ".";
      entriesEl.className = "rc-entries" + (list.length ? "" : " rc-entries-empty");
      plusBtn.disabled = sending;
      addBtn.disabled = sending;
      input.disabled = sending;
      undoBtn.disabled = sending || n === 0;
      clearBtn.disabled = sending || n === 0;
      voiceBtn.disabled = sending;
      makeBtn.disabled = sending || n === 0 || !makeAsk.hidden;
      makeYes.disabled = sending;
      makeNo.disabled = sending;
      clearYes.disabled = sending;
      clearNo.disabled = sending;
      updateVoice();
    }

    function notify() {
      if (typeof opts.onChange === "function") {
        try { opts.onChange(tally.size() ? tally.total() : null); } catch (e) { /* a host refresh must never break counting */ }
      }
    }

    // Every change to the tally: keep it, redraw, close any open question (its
    // numbers would be stale), tell the host.
    function changed() {
      setChunks(asin, tally.chunks());
      closeAsks();
      render();
      notify();
    }

    function closeAsks() {
      clearAsk.hidden = true;
      makeAsk.hidden = true;
      makeBtn.disabled = sending || tally.size() === 0;
      clearBtn.disabled = sending || tally.size() === 0;
    }

    // ---- actions
    function addQuick() {
      if (sending) return;
      if (!tally.add(QUICK)) { say("That is more entries than this counter keeps.", "bad"); return; }
      say("");
      changed();
    }

    function addTyped() {
      if (sending) return;
      var n = parseTyped(input.value);
      if (n == null) { say("Type a whole number from 1 to " + MAX_CHUNK + ".", "bad"); focusEl(input); return; }
      if (!tally.add(n)) { say("That is more entries than this counter keeps.", "bad"); return; }
      input.value = "";
      say("");
      changed();
      focusEl(input);
    }

    function undo() {
      if (sending || !tally.size()) return;
      tally.undo();
      say("");
      changed();
    }

    function askClear() {
      if (sending || !tally.size()) return;
      makeAsk.hidden = true;
      clearAsk.hidden = false;
      clearBtn.disabled = true;
      say("");
      render();
      focusEl(clearNo);
    }

    function doClear() {
      if (sending) return;
      tally.clear();
      say("");
      changed();
    }

    function askMake() {
      if (sending || !canConfirm || !tally.size()) return;
      clearAsk.hidden = true;
      makeQ.textContent = "Set " + where + " for " + title + " from " + (expectedText || "?") + " to " + fmtNum(tally.total()) + "? Only this product changes.";
      makeAsk.hidden = false;
      say("");
      render();
      focusEl(makeNo);
    }

    function confirmMake() {
      if (sending || !canConfirm || !tally.size()) return;
      var units = tally.total();
      sending = true;
      say("Sending to the laptop ...");
      render();
      var settled = function (res) {
        sending = false;
        if (res && res.ok) {
          tally.clear();
          setChunks(asin, []);
          closeAsks();
          if (!closed) {
            render();
            say("Saved", "ok");
            setTimeout(function () { if (!closed) dismiss(); }, 900);
          }
          notify();
        } else {
          var why = res && res.error ? String(res.error) : "It was not saved.";
          if (!closed) {
            closeAsks();
            render();
            say(why + " Your count is kept.", "bad");
          }
          notify();
        }
      };
      var p;
      try { p = Promise.resolve(opts.onConfirm(units)); } catch (e) { p = Promise.reject(e); }
      p.then(settled, function (e) { settled({ ok: false, error: e && e.message ? e.message : "Something went wrong." }); });
    }

    // ---- the voice bubble
    function updateVoice() {
      var r = parseSpoken(voiceText.value);
      voiceLive.textContent = r.numbers.length ? r.numbers.join(" + ") + " = " + fmtNum(r.sum) : (voiceText.value.trim() ? "No numbers found yet." : "Nothing heard yet.");
      voiceBad.textContent = r.unknown.length ? "Didn't understand: " + r.unknown.join(", ") : "";
      voiceBad.hidden = !r.unknown.length;
      voiceAdd.textContent = "Add " + fmtNum(r.sum) + " to the count";
      voiceAdd.disabled = sending || !r.numbers.length;
    }

    function toggleVoice(show) {
      var on = typeof show === "boolean" ? show : voiceBox.hidden;
      voiceBox.hidden = !on;
      voiceBtn.setAttribute("aria-expanded", on ? "true" : "false");
      voiceBtn.className = "rc-btn rc-quiet rc-voice-btn" + (on ? " rc-on" : "");
      if (on) focusEl(voiceText);
    }

    function addVoice() {
      if (sending) return;
      var r = parseSpoken(voiceText.value);
      if (!r.numbers.length) return;
      var added = 0;
      for (var i = 0; i < r.numbers.length; i++) { if (tally.add(r.numbers[i])) added++; else break; }
      voiceText.value = "";
      var text = added < r.numbers.length ? "Added " + added + " of " + r.numbers.length + " - that is as many entries as this counter keeps." : "";
      if (r.unknown.length) text = (text ? text + " " : "") + "Didn't understand: " + r.unknown.join(", ") + ".";
      say(text, text ? "bad" : "");
      changed();
    }

    // ---- focus, keys, viewport
    function focusEl(el) {
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* nothing to focus */ } }
    }

    function onKey(e) {
      if (e.key === "Escape") { dismiss(); return; }
      if (e.key !== "Tab") return;
      var list = [];
      for (var i = 0; i < focusables.length; i++) if (!focusables[i].disabled && !hiddenWithin(focusables[i], card)) list.push(focusables[i]);
      if (!list.length) return;
      var at = list.indexOf(document.activeElement);
      var first = list[0];
      var last = list[list.length - 1];
      if (e.shiftKey && (at <= 0)) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && (at === list.length - 1 || at < 0)) { e.preventDefault(); focusEl(first); }
    }

    // The soft keyboard shrinks the VISIBLE area, not the page: keep the overlay
    // on what can be seen, and the card scrolls inside it.
    function syncViewport() {
      var vv = self.visualViewport;
      if (!vv || closed || vv.scale > 1.01) return;
      overlay.style.top = vv.offsetTop + "px";
      overlay.style.left = vv.offsetLeft + "px";
      overlay.style.width = vv.width + "px";
      overlay.style.height = vv.height + "px";
    }

    function dismiss() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      if (self.visualViewport && self.visualViewport.removeEventListener) {
        self.visualViewport.removeEventListener("resize", syncViewport);
        self.visualViewport.removeEventListener("scroll", syncViewport);
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (current && current.overlay === overlay) current = null;
      if (opener && typeof opener.focus === "function" && opener !== document.body && opener.isConnected !== false) focusEl(opener);
    }

    // ---- wire
    xBtn.addEventListener("click", dismiss);
    doneBtn.addEventListener("click", dismiss);
    overlay.addEventListener("pointerdown", function (e) { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", function (e) { if (e.target === overlay && downOnBackdrop) dismiss(); downOnBackdrop = false; });
    plusBtn.addEventListener("click", addQuick);
    addBtn.addEventListener("click", addTyped);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addTyped(); } });
    undoBtn.addEventListener("click", undo);
    clearBtn.addEventListener("click", askClear);
    clearYes.addEventListener("click", doClear);
    clearNo.addEventListener("click", function () { closeAsks(); render(); focusEl(clearBtn); });
    makeBtn.addEventListener("click", askMake);
    makeYes.addEventListener("click", confirmMake);
    makeNo.addEventListener("click", function () { closeAsks(); render(); focusEl(makeBtn); });
    voiceBtn.addEventListener("click", function () { toggleVoice(); });
    voiceClose.addEventListener("click", function () { toggleVoice(false); focusEl(voiceBtn); });
    voiceText.addEventListener("input", updateVoice);
    voiceAdd.addEventListener("click", addVoice);

    document.addEventListener("keydown", onKey);
    if (self.visualViewport && self.visualViewport.addEventListener) {
      self.visualViewport.addEventListener("resize", syncViewport);
      self.visualViewport.addEventListener("scroll", syncViewport);
    }

    document.body.appendChild(overlay);
    syncViewport();
    render();
    focusEl(card);
    current = { overlay: overlay, close: dismiss };
    return { close: dismiss, isOpen: function () { return !closed; } };
  }

  function closeCurrent() { if (current) current.close(); }
  function isOpen() { return !!current; }

  // Test hook: forget what the memory fallback holds and re-try real storage.
  function _reset() { memory = {}; degraded = false; }

  self.ShopperReceive = Object.freeze({
    QUICK: QUICK,
    MIN_CHUNK: MIN_CHUNK,
    MAX_CHUNK: MAX_CHUNK,
    MAX_CHUNKS: MAX_CHUNKS,
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_ENTRIES: MAX_ENTRIES,
    STORE_KEY: STORE_KEY,
    isChunk: isChunk,
    parseTyped: parseTyped,
    createTally: createTally,
    gapInfo: gapInfo,
    parseSpoken: parseSpoken,
    prune: prune,
    getChunks: getChunks,
    setChunks: setChunks,
    clearFor: clearFor,
    totalFor: totalFor,
    buttonLabel: buttonLabel,
    open: open,
    close: closeCurrent,
    isOpen: isOpen,
    _reset: _reset
  });
})();
