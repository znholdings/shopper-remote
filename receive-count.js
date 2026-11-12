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
// existing setCount command). B-1912: the tally STAYS after { ok: true } (it now matches
// the new House figure); on a failure the tally stays and the sentence is shown.
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
  // B-843 (v2.0.22): when each tally was last CLEARED (or confirmed), per ASIN, so a clear on one
  // device beats an older tally on the other. { "<ASIN>": <ms> }
  var CLEARS_KEY = "shopperReceiveTallyClears";
  var MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
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

  // B-2040 (v2.0.154): a Pack Of > 1 product counts in Amazon units but can be counted in pieces. The pack size
  // comes from the host (opts.packOf / row.packOf - the Pipeline's own pack rule); this file never reads titles.
  function validPack(v) {
    var n = Number(v);
    return isFinite(n) && Math.floor(n) === n && n > 1 && n <= 999 ? n : 0;
  }
  // " (16 pcs)" for a count of Amazon units on a Pack Of > 1 product; "" otherwise.
  function pcsOf(units, pack) {
    var p = validPack(pack), u = Number(units);
    if (!p || !isFinite(u)) return "";
    return " (" + fmtNum(u * p) + " pcs)";
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

  // B-868 (v2.0.25): the "Full count (N)" button. N = what is still to go (expected - counted) when
  // that is a whole number of 1..9999; null otherwise (nothing left, over, no expected, or a
  // fractional remainder such as "1 1/3" - a chunk is always whole, so the button is hidden).
  function fullCountChunk(expected, total) {
    if (expected == null || expected === "") return null;
    var e = Number(expected);
    var t = Number(total) || 0;
    if (!isFinite(e) || !isFinite(t)) return null;
    var d = e - t;
    var r = Math.round(d);
    if (Math.abs(d - r) > 0.0005) return null;
    return isChunk(r) ? r : null;
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
  // its life. Entries older than 45 days are dropped (B-1529: was 14); at most 200 are kept; a new product's count is refused when full (B-1940).
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

  // B-1920 (v2.0.146): a stored tally is ALWAYS current - on this computer, the other one and the phone alike.
  // Only a clear ends a count: the x on the chip, Start over, or the B-1003 rule (lib/receive-ship-clear.js)
  // when a HOUSE shipment holding this product goes out. History: B-1415 (v2.0.89) hid every count at midnight;
  // B-1529 (v2.0.108) hid every count older than "the newest House batch this computer saw ship" (per computer,
  // any product, and a prep-built "sc" batch counted as House) - Zach 11/09: 27 counts made 2:59-3:23 PM all read
  // "Not counted yet". Both rules are gone. A tally lives 45 days (MAX_AGE_MS).
  function countInProgress(now) {
    var map = readMap(now), n = 0;
    for (var k in map) if (has(map, k)) n++;
    return n;
  }

  function getChunks(asin, now) {
    var e = readMap(now)[normAsin(asin)];
    return e ? e.chunks.slice() : [];
  }

  // ---- B-843 (v2.0.22): the clears (tombstones) and the sync with the other device.
  //
  // This file still sends nothing itself. A host (Pipeline page / phone app) registers
  // onStoreChange(fn) to hear every LOCAL edit, and hands what the other device holds to
  // applyRemote(). NEWEST EDIT WINS PER ASIN; a clear / confirm is an edit too, so it wins over
  // an older tally. Storage failures fall back to memory exactly like the tallies do.
  var memoryClears = {};
  var clearsDegraded = false;
  var storeListeners = [];
  var openWatchers = [];

  function pruneClears(map, now) {
    var t = typeof now === "number" ? now : Date.now();
    var out = {};
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (var key in map) {
        if (!has(map, key)) continue;
        var at = Number(map[key]);
        if (!isFinite(at) || at <= 0 || t - at > MAX_AGE_MS) continue;
        out[key] = at;
      }
    }
    return out;
  }

  function readClears(now) {
    var map = null;
    if (!clearsDegraded) {
      try {
        var s = self.localStorage;
        var raw = s ? s.getItem(CLEARS_KEY) : null;
        map = raw ? JSON.parse(raw) : {};
      } catch (e) {
        clearsDegraded = true;
        map = null;
      }
    }
    if (map == null) map = memoryClears;
    var clean = pruneClears(map, now);
    memoryClears = clean;
    return clean;
  }

  function writeClears(map) {
    memoryClears = map;
    if (clearsDegraded) return;
    try {
      self.localStorage.setItem(CLEARS_KEY, JSON.stringify(map));
    } catch (e) {
      clearsDegraded = true;
    }
  }

  function emitStoreChange(asin, chunks, at) {
    for (var i = 0; i < storeListeners.length; i++) {
      try { storeListeners[i]({ asin: asin, chunks: chunks.slice(), updatedAt: at, cleared: chunks.length === 0 }); } catch (e) { /* a host must never break counting */ }
    }
  }

  // fn({asin, chunks, updatedAt, cleared}) after every edit made on THIS device.
  function onStoreChange(fn) {
    if (typeof fn !== "function") return function () {};
    storeListeners.push(fn);
    return function () { var k = storeListeners.indexOf(fn); if (k >= 0) storeListeners.splice(k, 1); };
  }

  function setChunks(asin, chunks, now, quiet) {
    var key = normAsin(asin);
    if (!key) return;
    var at = typeof now === "number" ? now : Date.now();
    var map = readMap(now);
    var had = has(map, key);
    var clean = [];
    for (var i = 0; i < (chunks || []).length; i++) if (isChunk(chunks[i])) clean.push(chunks[i]);
    if (clean.length) map[key] = { chunks: clean, updatedAt: at };
    else delete map[key];
    writeMap(prune(map, now));
    if (!clean.length && had) {
      var clears = readClears(now);
      clears[key] = at;
      writeClears(clears);
    }
    if (!quiet && (clean.length || had)) emitStoreChange(key, clean, at);
  }

  // What this device holds, in the shape the sync channel carries.
  function exportSync(now) {
    return { tallies: readMap(now), clears: readClears(now) };
  }

  function sameChunks(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Merge two {tallies, clears} (pure). Per ASIN the newest edit wins; a tie keeps the tally.
  function mergeSync(a, b, now) {
    var ta = prune(a && a.tallies, now), tb = prune(b && b.tallies, now);
    var ca = pruneClears(a && a.clears, now), cb = pruneClears(b && b.clears, now);
    var keys = {}, k;
    for (k in ta) if (has(ta, k)) keys[k] = 1;
    for (k in tb) if (has(tb, k)) keys[k] = 1;
    for (k in ca) if (has(ca, k)) keys[k] = 1;
    for (k in cb) if (has(cb, k)) keys[k] = 1;
    var tallies = {}, clears = {};
    for (k in keys) {
      if (!has(keys, k)) continue;
      var best = null;
      if (ta[k]) best = ta[k];
      if (tb[k] && (!best || tb[k].updatedAt > best.updatedAt)) best = tb[k];
      var clearAt = Math.max(ca[k] || 0, cb[k] || 0);
      if (clearAt) clears[k] = clearAt;
      if (best && best.updatedAt >= clearAt) tallies[k] = { chunks: best.chunks.slice(), updatedAt: best.updatedAt };
    }
    return { tallies: prune(tallies, now), clears: pruneClears(clears, now) };
  }

  // Take what the other device holds. Returns the ASINs whose tally changed here; host redraws.
  function applyRemote(remote, now) {
    if (!remote || typeof remote !== "object") return [];
    var local = exportSync(now);
    var merged = mergeSync(local, remote, now);
    var changed = [], k;
    for (k in merged.tallies) if (has(merged.tallies, k) && (!has(local.tallies, k) || !sameChunks(local.tallies[k].chunks, merged.tallies[k].chunks))) changed.push(k);
    for (k in local.tallies) if (has(local.tallies, k) && !has(merged.tallies, k)) changed.push(k);
    writeMap(merged.tallies);
    writeClears(merged.clears);
    for (var i = 0; i < changed.length; i++) {
      for (var j = 0; j < openWatchers.length; j++) {
        try { openWatchers[j](changed[i]); } catch (e) { /* never break counting */ }
      }
    }
    return changed;
  }

  // The local edits the other device does not have yet (newer than what it reported):
  // [{asin, chunks, updatedAt, cleared}] - the host resends these.
  function diffNewer(remote, now) {
    var local = exportSync(now);
    var rt = prune(remote && remote.tallies, now);
    var rc = pruneClears(remote && remote.clears, now);
    var out = [], k;
    for (k in local.tallies) {
      if (!has(local.tallies, k)) continue;
      var e = local.tallies[k];
      var theirs = Math.max(rt[k] ? rt[k].updatedAt : 0, rc[k] || 0);
      if (e.updatedAt > theirs) out.push({ asin: k, chunks: e.chunks.slice(), updatedAt: e.updatedAt, cleared: false });
    }
    for (k in local.clears) {
      if (!has(local.clears, k) || has(local.tallies, k)) continue;
      var theirsAt = Math.max(rt[k] ? rt[k].updatedAt : 0, rc[k] || 0);
      if (local.clears[k] > theirsAt) out.push({ asin: k, chunks: [], updatedAt: local.clears[k], cleared: true });
    }
    return out;
  }

  // B-844 (v2.0.22): every <span class="rc-badge" data-asin="..."> under `root` shows "Counted N"
  // while a count is in progress for that ASIN, and is hidden otherwise.
  // B-933 (v2.0.35): with a small x that clears that product's tally at once - no confirm, nothing
  // written anywhere but this tally store (Zach 10/8: 7 rows still showed yesterday's counts). The
  // clear is clearFor(), the same call "Make this the House count" makes after its write, so the
  // host's onStoreChange sync carries it to the other device (newest edit wins, B-843); the host's
  // onBadgeClear(fn) redraws its Receive button labels.
  var badgeClearWatchers = [];
  function onBadgeClear(fn) {
    if (typeof fn !== "function") return function () {};
    badgeClearWatchers.push(fn);
    return function () { var k = badgeClearWatchers.indexOf(fn); if (k >= 0) badgeClearWatchers.splice(k, 1); };
  }
  function clearFromBadge(asin) {
    var key = normAsin(asin);
    if (!key) return;
    clearFor(key);
    if (typeof document !== "undefined") paintBadges(document);
    for (var i = 0; i < badgeClearWatchers.length; i++) {
      try { badgeClearWatchers[i](key); } catch (e) { /* a host redraw must never stop the clear */ }
    }
  }
  function badgeParts(node) {
    // a host without a real DOM (the tests' small fakes) keeps the plain "Counted N" text
    if (typeof document === "undefined" || typeof document.createElement !== "function" || typeof node.appendChild !== "function") return null;
    var text = null, x = null;
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.classList && c.classList.contains("rc-badge-n")) text = c;
      if (c.classList && c.classList.contains("rc-badge-x")) x = c;
    }
    if (!text || !x) {
      node.textContent = "";
      text = document.createElement("span");
      text.className = "rc-badge-n";
      x = document.createElement("button");
      x.type = "button";
      x.className = "rc-badge-x";
      x.textContent = "\u00d7";
      x.addEventListener("click", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        clearFromBadge(node.getAttribute("data-asin"));
      });
      node.appendChild(text);
      node.appendChild(x);
    }
    return { text: text, x: x };
  }
  function paintBadges(root) {
    if (typeof document === "undefined") return;
    var r0 = root || document;
    var nodes = r0.classList && r0.classList.contains("rc-badge") ? [r0] : r0.querySelectorAll(".rc-badge");
    for (var i = 0; i < nodes.length; i++) {
      var t = totalFor(nodes[i].getAttribute("data-asin"));
      // B-1090 (v2.0.56): Zach 10/12 - "it should just say 'not counted yet' and be in red, just so
      // it's really easy to see which ones I haven't yet received". A product with units at the
      // house (data-house > 0) and NO count in progress shows a solid red "Not counted yet" chip,
      // with no x (there is nothing to clear). No House figure / House 0 = no chip, as before.
      var anyHouse = nodes[i].getAttribute("data-count-any") === "1"; // B-1789 (v2.0.134): pipeline chips count any non-zero House
      if (t == null && (anyHouse ? houseNonZero(nodes[i].getAttribute("data-house")) : houseAbove0(nodes[i].getAttribute("data-house")))) { paintNotCounted(nodes[i]); continue; }
      if (nodes[i].classList && typeof nodes[i].classList.toggle === "function") nodes[i].classList.toggle("rc-badge-none", false);
      if (t == null) { nodes[i].hidden = true; nodes[i].textContent = ""; }
      else {
        var parts = badgeParts(nodes[i]);
        nodes[i].hidden = false;
        if (parts) {
          parts.text.textContent = "Counted " + fmtNum(t);
          parts.x.title = "Clear this count (" + fmtNum(t) + ") - nothing is saved";
          parts.x.setAttribute("aria-label", "Clear the count of " + fmtNum(t));
        } else nodes[i].textContent = "Counted " + fmtNum(t);
        nodes[i].title = "A count of " + fmtNum(t) + " is in progress for this product";
        // B-950 (v2.0.37): green when the count equals the row's House figure, yellow when it
        // doesn't. B-1090 (v2.0.56): mismatch is now solid red with white text (receive-count.css) (the host puts House on data-house - and may put its own wording of it on
        // data-house-text; no data-house = the plain green chip).
        var vs = badgeVsHouse(t, nodes[i].getAttribute("data-house"));
        if (nodes[i].classList && typeof nodes[i].classList.toggle === "function") {
          nodes[i].classList.toggle("rc-badge-match", vs === "match");
          nodes[i].classList.toggle("rc-badge-off", vs === "off");
        }
        if (vs === "match") nodes[i].title = "Count matches the house";
        else if (vs === "off") nodes[i].title = "Counted " + fmtNum(t) + " of " + (nodes[i].getAttribute("data-house-text") || fmtNum(Number(nodes[i].getAttribute("data-house")))) + " at the house";
      }
    }
  }
  // B-1090 (v2.0.56): House above half a thousandth of a unit (the fractional House figures, never a
  // negative row) - the rows that should get a "Not counted yet" chip when nothing is counted.
  function houseAbove0(house) {
    if (house == null || house === "") return false;
    var h = Number(house);
    return isFinite(h) && h > 0.0005;
  }
  function houseNonZero(house) {
    if (house == null || house === "") return false;
    var h = Number(house);
    return isFinite(h) && Math.abs(h) > 0.0005;
  }
  function paintNotCounted(node) {
    node.hidden = false;
    if (typeof document !== "undefined" && typeof document.createElement === "function" && typeof node.appendChild === "function") {
      // the text alone - the x is dropped (badgeParts rebuilds both once a count starts)
      node.textContent = "";
      var text = document.createElement("span");
      text.className = "rc-badge-n";
      text.textContent = "Not counted yet";
      node.appendChild(text);
    } else node.textContent = "Not counted yet";
    if (node.classList && typeof node.classList.toggle === "function") {
      node.classList.toggle("rc-badge-match", false);
      node.classList.toggle("rc-badge-off", false);
      node.classList.toggle("rc-badge-none", true);
    }
    if (node.getAttribute("data-count-any") === "1") { node.title = "Not counted yet - click to count it (Receive)"; return; }
    node.title = "Not counted yet - " + (node.getAttribute("data-house-text") || fmtNum(Number(node.getAttribute("data-house")))) + " at the house, none received with Receive";
  }
  // "match" | "off" | null (no House figure). Same thousandth-of-a-unit test as openSetAll's
  // "already the House count" check.
  function badgeVsHouse(total, house) {
    if (house == null || house === "") return null;
    var h = Number(house);
    var t = Number(total);
    if (!isFinite(h) || !isFinite(t)) return null;
    return Math.round(h * 1000) === Math.round(t * 1000) ? "match" : "off";
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
    // B-2040: Pack Of > 1 -> a Packs / Pieces switch. The tally stays whole Amazon units; pieces that do not fill a
    // pack yet wait in `loose` (this pop-up only) and show as a fraction - nothing is rounded.
    var pack = validPack(opts.packOf);
    var mode = pack && opts.mode === "pieces" ? "pieces" : "packs";
    var loose = 0;
    var ops = []; // what each add did, so Undo last takes back pieces and packs alike: { chunk, prevLoose }
    // B-843: the other device changed THIS product's tally while the pop-up is open - show it.
    var watcher = function (changedAsin) {
      if (closed || sending || changedAsin !== asin) return;
      loose = 0; ops = [];
      tally.clear();
      var fresh = getChunks(asin);
      for (var q = 0; q < fresh.length; q++) tally.add(fresh[q]);
      closeAsks();
      render();
    };
    openWatchers.push(watcher);
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

    var modeRow = h("div", "rc-mode");
    modeRow.setAttribute("role", "group");
    modeRow.setAttribute("aria-label", "Count in packs or pieces");
    modeRow.hidden = !pack;
    var modePacks = h("button", "rc-btn rc-quiet rc-mode-btn rc-mode-packs", "Packs (Amazon units)");
    modePacks.type = "button";
    var modePieces = h("button", "rc-btn rc-quiet rc-mode-btn rc-mode-pieces", "Pieces");
    modePieces.type = "button";
    modeRow.appendChild(modePacks);
    modeRow.appendChild(modePieces);

    var totalBox = h("div", "rc-totalbox");
    var totalLine = h("div", "rc-total");
    totalLine.setAttribute("aria-live", "polite");
    var totalN = h("span", "rc-total-n", "0");
    var totalOf = h("span", "rc-total-of", "");
    totalLine.appendChild(totalN);
    totalLine.appendChild(totalOf);
    var gapEl = h("div", "rc-gap", "");
    var pcsEl = h("div", "rc-pcs", "");
    pcsEl.hidden = true;
    var fracEl = h("div", "rc-frac", "");
    fracEl.hidden = true;
    totalBox.appendChild(totalLine);
    totalBox.appendChild(pcsEl);
    totalBox.appendChild(gapEl);
    totalBox.appendChild(fracEl);

    var entriesEl = h("div", "rc-entries", "");

    var plusBtn = h("button", "rc-btn rc-plus", "+" + QUICK);
    plusBtn.type = "button";

    // B-868: one tap = everything still to go, as ONE chunk (Undo last takes it back).
    var fullBtn = h("button", "rc-btn rc-full", "Full count");
    fullBtn.type = "button";
    fullBtn.hidden = true;

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
    var doneBtn = h("button", "rc-btn rc-primary rc-done", "Done");
    doneBtn.type = "button";
    var makeBtn = h("button", "rc-btn rc-quiet rc-make", "Make this the " + where + " count");
    makeBtn.type = "button";
    makeBtn.hidden = !canConfirm;
    foot.appendChild(doneBtn);
    foot.appendChild(makeBtn);

    var makeAsk = h("div", "rc-ask");
    makeAsk.hidden = true;
    makeAsk.setAttribute("role", "group");
    var makeQ = h("div", "rc-ask-text", "");
    var makeYes = h("button", "rc-btn rc-make-yes", "Yes, set it");
    makeYes.type = "button";
    var makeNo = h("button", "rc-btn rc-quiet", "No");
    makeNo.type = "button";
    makeAsk.appendChild(makeQ);
    var makeAskBtns = h("div", "rc-ask-btns");
    makeAskBtns.appendChild(makeYes);
    makeAskBtns.appendChild(makeNo);
    makeAsk.appendChild(makeAskBtns);

    card.appendChild(head);
    card.appendChild(modeRow);
    card.appendChild(totalBox);
    card.appendChild(entriesEl);
    card.appendChild(plusBtn);
    card.appendChild(fullBtn);
    card.appendChild(customRow);
    card.appendChild(tools);
    card.appendChild(clearAsk);
    card.appendChild(voiceBox);
    card.appendChild(msg);
    card.appendChild(foot);
    card.appendChild(makeAsk);
    overlay.appendChild(card);

    var focusables = [xBtn, modePacks, modePieces, plusBtn, fullBtn, input, addBtn, undoBtn, clearBtn, voiceBtn, clearYes, clearNo,
      voiceText, voiceAdd, voiceClose, doneBtn, makeBtn, makeYes, makeNo];

    // ---- state -> screen
    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "rc-msg" + (kind ? " rc-msg-" + kind : "");
    }

    var inPieces = function () { return pack > 0 && mode === "pieces"; };
    // The count in Amazon units, with the pieces that do not fill a pack yet as a fraction of one.
    var unitsNow = function () { return tally.total() + (loose ? loose / pack : 0); };
    var piecesNow = function () { return tally.total() * pack + loose; };
    var hasAny = function () { return tally.size() > 0 || loose > 0; };

    function render() {
      var n = tally.size();
      var total = unitsNow();
      var pieces = inPieces();
      totalN.textContent = loose ? format(total) : fmtNum(total);
      var ofText = expectedText;
      if (ofText && pack && expected != null && isFinite(Number(expected))) ofText += pcsOf(expected, pack);
      totalOf.textContent = ofText ? " of " + ofText : "";
      var gap = gapInfo(expected, total, n + (loose ? 1 : 0), format);
      var gapText = gap.text;
      if (pack && (gap.kind === "short" || gap.kind === "over")) gapText += pcsOf(Math.abs(Number(expected) - total), pack);
      gapEl.textContent = gapText;
      gapEl.className = "rc-gap rc-gap-" + gap.kind;
      gapEl.hidden = !gapText;
      pcsEl.hidden = !pack;
      pcsEl.textContent = pack ? fmtNum(piecesNow()) + " pcs = " + (loose ? format(total) : fmtNum(total)) + " units" : "";
      fracEl.hidden = !loose;
      fracEl.textContent = loose ? fmtNum(piecesNow()) + " pcs is not a whole number of " + pack + "-packs" : "";
      modePacks.setAttribute("aria-pressed", pieces ? "false" : "true");
      modePieces.setAttribute("aria-pressed", pieces ? "true" : "false");
      modePacks.className = "rc-btn rc-quiet rc-mode-btn rc-mode-packs" + (pieces ? "" : " rc-on");
      modePieces.className = "rc-btn rc-quiet rc-mode-btn rc-mode-pieces" + (pieces ? " rc-on" : "");
      modePacks.disabled = sending;
      modePieces.disabled = sending;
      var list = tally.chunks();
      var shown = pieces ? list.map(function (c) { return c * pack; }) : list.slice();
      if (loose) shown.push(pieces ? loose : loose + "/" + pack);
      entriesEl.textContent = shown.length ? shown.join(" + ") + (pieces ? " pcs" : "") : "Nothing counted yet. Count a box, then tap +" + QUICK + (pieces ? " pcs" : "") + ".";
      entriesEl.className = "rc-entries" + (shown.length ? "" : " rc-entries-empty");
      plusBtn.textContent = "+" + QUICK + (pieces ? " pcs" : "");
      plusBtn.disabled = sending;
      var full = fullCountChunk(expected, tally.total());
      if (loose) full = null;
      fullBtn.hidden = full == null;
      fullBtn.disabled = sending || full == null;
      fullBtn.textContent = full == null ? "Full count" : "Full count (" + (pieces ? fmtNum(full * pack) + " pcs" : fmtNum(full)) + ")";
      input.setAttribute("placeholder", pieces ? "Other number of pieces" : "Other number");
      input.setAttribute("aria-label", pieces ? "Other number of pieces to add" : "Other amount to add");
      addBtn.disabled = sending;
      input.disabled = sending;
      undoBtn.disabled = sending || !hasAny();
      clearBtn.disabled = sending || !hasAny();
      voiceBtn.disabled = sending;
      makeBtn.disabled = sending || !hasAny() || !makeAsk.hidden;
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
    function changed(looseOnly) {
      // B-2040: only the waiting pieces moved - the stored tally is the same, so nothing is rewritten or synced.
      if (looseOnly) { closeAsks(); render(); return; }
      // B-1940: the store is full and this product has no count yet - nothing is stored and nothing older is dropped
      if (tally.size() && !getChunks(asin).length && storeRoom() === 0) {
        tally.clear(); loose = 0; ops = [];
        closeAsks();
        render();
        say(storeFullText(), "bad");
        return;
      }
      setChunks(asin, tally.chunks());
      closeAsks();
      render();
      notify();
    }

    function closeAsks() {
      clearAsk.hidden = true;
      makeAsk.hidden = true;
      makeBtn.disabled = sending || !hasAny();
      clearBtn.disabled = sending || !hasAny();
    }

    // B-2040: add n counted things in the current mode. Packs: n Amazon units. Pieces: n pieces, whole packs go to
    // the tally and the rest waits in `loose`. -> false when the tally is full.
    function addCount(n) {
      var prev = loose;
      if (!inPieces()) {
        if (!tally.add(n)) return false;
        ops.push({ chunk: true, prevLoose: prev });
        return true;
      }
      var all = loose + n;
      var whole = Math.floor(all / pack);
      if (whole > 0 && !tally.add(whole)) return false;
      loose = all % pack;
      ops.push({ chunk: whole > 0, prevLoose: prev });
      return true;
    }

    function setMode(m) {
      if (sending || !pack || (m !== "packs" && m !== "pieces") || m === mode) return;
      mode = m;
      if (typeof opts.onModeChange === "function") {
        try { opts.onModeChange(m); } catch (e) { /* a host failing to remember the choice must never break counting */ }
      }
      say("");
      render();
    }

    // ---- actions
    function addQuick() {
      if (sending) return;
      if (!addCount(QUICK)) { say("That is more entries than this counter keeps.", "bad"); return; }
      say("");
      changed(!ops[ops.length - 1].chunk);
    }

    function addFull() {
      if (sending) return;
      var n = loose ? null : fullCountChunk(expected, tally.total());
      if (n == null) return;
      var prevLoose = loose;
      if (tally.add(n)) ops.push({ chunk: true, prevLoose: prevLoose }); else { say("That is more entries than this counter keeps.", "bad"); return; }
      say("");
      changed();
    }

    function addTyped() {
      if (sending) return;
      var n = parseTyped(input.value);
      if (n == null) { say("Type a whole number from 1 to " + MAX_CHUNK + ".", "bad"); focusEl(input); return; }
      if (!addCount(n)) { say("That is more entries than this counter keeps.", "bad"); return; }
      input.value = "";
      say("");
      changed(!ops[ops.length - 1].chunk);
      focusEl(input);
    }

    function undo() {
      if (sending || !hasAny()) return;
      var op = ops.pop();
      if (op) {
        if (op.chunk) tally.undo();
        loose = op.prevLoose;
      } else if (loose) {
        loose = 0; // pieces left over from before the stack began: only a leftover is waiting
        say(""); changed(true); return;
      } else tally.undo();
      say("");
      changed(op && !op.chunk);
    }

    function askClear() {
      if (sending || !hasAny()) return;
      makeAsk.hidden = true;
      clearAsk.hidden = false;
      clearBtn.disabled = true;
      say("");
      render();
      focusEl(clearNo);
    }

    function doClear() {
      if (sending) return;
      tally.clear(); loose = 0; ops = [];
      say("");
      changed();
    }

    function askMake() {
      if (sending || !canConfirm || !hasAny()) return;
      clearAsk.hidden = true;
      makeQ.textContent = "Set " + where + " for " + title + " from " + (expectedText || "?") + " to " + (loose ? format(unitsNow()) : fmtNum(unitsNow())) + (pack ? " (" + fmtNum(piecesNow()) + " pcs)" : "") + "? Only this product changes." + (loose ? " " + fmtNum(piecesNow()) + " pcs is not a whole number of " + pack + "-packs, so this is a fraction of a pack." : "");
      makeAsk.hidden = false;
      say("");
      render();
      focusEl(makeNo);
    }

    function confirmMake() {
      if (sending || !canConfirm || !hasAny()) return;
      var units = unitsNow();
      sending = true;
      say("Sending to the laptop ...");
      render();
      var settled = function (res) {
        sending = false;
        if (res && res.ok) {
          expected = units; expectedText = format(units); // B-1912: the count stays; it now matches the new figure
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
      var pcsWord = inPieces() ? " pcs" : "";
      voiceLive.textContent = r.numbers.length ? r.numbers.join(" + ") + " = " + fmtNum(r.sum) + pcsWord : (voiceText.value.trim() ? "No numbers found yet." : "Nothing heard yet.");
      voiceBad.textContent = r.unknown.length ? "Didn't understand: " + r.unknown.join(", ") : "";
      voiceBad.hidden = !r.unknown.length;
      voiceAdd.textContent = "Add " + fmtNum(r.sum) + pcsWord + " to the count";
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
      var onlyLoose = true;
      for (var i = 0; i < r.numbers.length; i++) { if (addCount(r.numbers[i])) { added++; if (ops[ops.length - 1].chunk) onlyLoose = false; } else break; }
      voiceText.value = "";
      var text = added < r.numbers.length ? "Added " + added + " of " + r.numbers.length + " - that is as many entries as this counter keeps." : "";
      if (r.unknown.length) text = (text ? text + " " : "") + "Didn't understand: " + r.unknown.join(", ") + ".";
      say(text, text ? "bad" : "");
      changed(onlyLoose);
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
      var wi = openWatchers.indexOf(watcher);
      if (wi >= 0) openWatchers.splice(wi, 1);
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
    modePacks.addEventListener("click", function () { setMode("packs"); });
    modePieces.addEventListener("click", function () { setMode("pieces"); });
    plusBtn.addEventListener("click", addQuick);
    fullBtn.addEventListener("click", addFull);
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

  // ------------------------------------------------------------ B-875 (v2.0.25)
  //
  // Zach, 2026-10-06: one button that sets EVERY House count to its Receive tally - "same as
  // pressing 'Make this the House count' -> 'Yes, set it' for every product that has a Receive
  // tally" (House on hand = the counted number; arrivals untouched). Products with no tally are not
  // touched. This file still sends nothing: the host's write(asin, units) does, one product at a
  // time, with the SAME message / command the single confirm uses. B-1912: every count
  // stays on its row (it matches the new House figure); a failure keeps its tally too.

  // rows: [{ asin, title, house }] (the host's list). -> { changes: [{asin, title, houseNow, counted}],
  // notListed: [{asin, counted}] } - a tally whose product is not on the host's list is left alone.
  function planSetAll(rows, now) {
    var map = readMap(now);
    var byAsin = {};
    var list = Array.isArray(rows) ? rows : [];
    var changes = [];
    var same = []; // B-885 (v2.0.28): tally already equals the figure - nothing to set
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var a = normAsin(r.asin);
      if (!a || has(byAsin, a)) continue;
      byAsin[a] = 1;
      var e = map[a];
      if (!e || !e.chunks.length) continue;
      var t = 0;
      for (var j = 0; j < e.chunks.length; j++) t += e.chunks[j];
      var h = Number(r.house);
      if (r.house != null && r.house !== "" && isFinite(h) && Math.round(h * 1000) === Math.round(t * 1000)) {
        same.push({ asin: a, title: String(r.title || a), houseNow: h, counted: t });
        continue;
      }
      var chg = { asin: a, title: String(r.title || a), houseNow: isFinite(h) ? h : null, counted: t };
      if (validPack(r.packOf)) chg.packOf = validPack(r.packOf); // B-2040: the list can show pieces next to House
      changes.push(chg);
    }
    var notListed = [];
    for (var k in map) {
      if (!has(map, k) || has(byAsin, k)) continue;
      var c = map[k].chunks, tt = 0;
      for (var q = 0; q < c.length; q++) tt += c[q];
      notListed.push({ asin: k, counted: tt });
    }
    notListed.sort(function (x, y) { return x.asin < y.asin ? -1 : x.asin > y.asin ? 1 : 0; });
    return { changes: changes, same: same, notListed: notListed };
  }

  // What the list on screen says, so "Yes" only sends what Zach read (a tally edited on the other
  // device while the list is open redraws it instead).
  function setAllKey(plan) {
    var parts = [];
    for (var i = 0; i < plan.changes.length; i++) parts.push(plan.changes[i].asin + ":" + plan.changes[i].counted);
    return parts.join(",");
  }

  // opts: { rows, write(asin, units) -> Promise<{ok, error}>, format?, where? ("House"), onDone? }
  function openSetAll(opts) {
    opts = opts || {};
    if (typeof document === "undefined" || !document.body || typeof opts.write !== "function") return null;
    closeCurrent();
    var where = String(opts.where || "House");
    var format = typeof opts.format === "function" ? opts.format : fmtNum;
    var plan = planSetAll(opts.rows);
    var shownKey = setAllKey(plan);
    var sending = false;
    var finished = false;
    var closed = false;
    var downOnBackdrop = false;
    var opener = document.activeElement;
    var uid = "rc-" + (++seq);

    var overlay = h("div", "rc-overlay");
    var card = h("div", "rc-card rc-all");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", uid + "-title");
    card.setAttribute("tabindex", "-1");
    var head = h("div", "rc-head");
    var heads = h("div", "rc-heads");
    var titleEl = h("div", "rc-title", "Set every " + where + " count from Receive");
    titleEl.setAttribute("id", uid + "-title");
    heads.appendChild(titleEl);
    var xBtn = h("button", "rc-x", "\u2715");
    xBtn.type = "button";
    xBtn.setAttribute("aria-label", "Close");
    head.appendChild(heads);
    head.appendChild(xBtn);
    var intro = h("div", "rc-all-intro", "");
    var listEl = h("ul", "rc-all-list");
    var restEl = h("div", "rc-all-rest", "");
    var sameEl = h("div", "rc-all-rest rc-all-same", ""); // B-885: muted, like the line above
    var msg = h("div", "rc-msg", "");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    var msgList = h("ul", "rc-msg-list"); // B-1500: "Not set:" names, one per line
    msgList.hidden = true;
    var foot = h("div", "rc-foot");
    var yesBtn = h("button", "rc-btn rc-primary rc-all-yes", "");
    yesBtn.type = "button";
    var cancelBtn = h("button", "rc-btn rc-quiet rc-all-cancel", "Cancel");
    cancelBtn.type = "button";
    foot.appendChild(yesBtn);
    foot.appendChild(cancelBtn);
    card.appendChild(head);
    card.appendChild(intro);
    card.appendChild(listEl);
    card.appendChild(restEl);
    card.appendChild(sameEl);
    card.appendChild(msg);
    card.appendChild(msgList);
    card.appendChild(foot);
    overlay.appendChild(card);
    var statusEls = {};
    var results = {}; // asin -> { text, good } - kept across redraws so every line keeps its answer

    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "rc-msg" + (kind ? " rc-msg-" + kind : "");
      msgList.textContent = "";
      msgList.hidden = true;
    }

    function draw() {
      listEl.textContent = "";
      statusEls = {};
      var n = plan.changes.length;
      intro.textContent = n
        ? "Each product below gets the same change as \"Make this the " + where + " count\" -> \"Yes, set it\": " + where + " on hand becomes the counted number. Arrivals are not changed. Products with no Receive count are not touched."
        : (plan.same && plan.same.length
          ? "Every counted product on this list already matches its " + where + " count, so there is nothing to set."
          : "No product on this list has a Receive count in progress, so there is nothing to set.");
      for (var i = 0; i < n; i++) {
        var c = plan.changes[i];
        var li = h("li", "rc-all-row");
        li.setAttribute("data-asin", c.asin);
        li.appendChild(h("div", "rc-all-name", c.asin + " \u00b7 " + c.title));
        var line = h("div", "rc-all-change", where + " " + (c.houseNow == null ? "?" : format(c.houseNow) + pcsOf(c.houseNow, c.packOf)) + " \u2192 " + fmtNum(c.counted));
        var st = h("span", "rc-all-status", "");
        st.hidden = true;
        if (has(results, c.asin)) {
          st.hidden = false;
          st.textContent = results[c.asin].text;
          st.className = "rc-all-status " + (results[c.asin].good ? "rc-all-ok" : "rc-all-bad");
        }
        line.appendChild(st);
        li.appendChild(line);
        listEl.appendChild(li);
        statusEls[c.asin] = st;
      }
      listEl.hidden = !n;
      // B-1500 (v2.0.104): the headline stays one sentence; the names are a short list under it (not a comma wall).
      var nameList = function (host, items) {
        var ul = h("ul", "rc-all-names");
        for (var q = 0; q < items.length && q < 10; q++) ul.appendChild(h("li", "", items[q]));
        if (items.length > 10) ul.appendChild(h("li", "rc-all-more", "+" + (items.length - 10) + " more"));
        host.appendChild(ul);
      };
      var rest = [];
      for (var k = 0; k < plan.notListed.length; k++) rest.push(plan.notListed[k].asin + " (" + fmtNum(plan.notListed[k].counted) + ")");
      restEl.textContent = rest.length ? "Counted but not on this list, so left alone:" : "";
      if (rest.length) nameList(restEl, rest);
      restEl.hidden = !rest.length;
      var same = plan.same || [];
      var sameNames = [];
      for (var s = 0; s < same.length; s++) sameNames.push(same[s].asin + " (" + fmtNum(same[s].counted) + ")");
      sameEl.textContent = same.length ? same.length + " already match their " + where + " count, so they are left out:" : "";
      if (same.length) nameList(sameEl, sameNames);
      sameEl.hidden = !same.length;
      yesBtn.textContent = "Yes - set " + n + " " + where + " count" + (n === 1 ? "" : "s");
      yesBtn.hidden = finished || !n;
      yesBtn.disabled = sending || !n;
      cancelBtn.textContent = finished || !n ? "Done" : "Cancel";
      cancelBtn.disabled = sending;
      xBtn.disabled = sending;
    }

    function mark(asin, text, good) {
      results[asin] = { text: text, good: good };
      var st = statusEls[asin];
      if (!st) return;
      st.hidden = false;
      st.textContent = text;
      st.className = "rc-all-status " + (good ? "rc-all-ok" : "rc-all-bad");
    }

    function run() {
      if (sending || finished) return;
      var fresh = planSetAll(opts.rows);
      if (setAllKey(fresh) !== shownKey) {
        plan = fresh;
        shownKey = setAllKey(fresh);
        draw();
        say("A count changed while this was open. Check the list again, then press Yes.", "bad");
        return;
      }
      var list = plan.changes.slice();
      if (!list.length) return;
      sending = true;
      draw();
      var okCount = 0;
      var bad = [];
      var i = 0;
      var next = function () {
        if (i >= list.length) {
          sending = false;
          finished = true;
          draw();
          if (!bad.length) say("Set " + okCount + " of " + list.length + ". Each count stays on its row.", "ok");
          else {
            say("Set " + okCount + " of " + list.length + ". " + bad.length + " not set - those counts are kept:", "bad");
            for (var bi = 0; bi < bad.length && bi < 10; bi++) msgList.appendChild(h("li", "", bad[bi]));
            if (bad.length > 10) msgList.appendChild(h("li", "rc-all-more", "+" + (bad.length - 10) + " more"));
            msgList.hidden = false;
          }
          if (typeof opts.onDone === "function") { try { opts.onDone({ set: okCount, failed: bad.length }); } catch (e) { /* the host redraw must never break this */ } }
          if (!closed) focusEl(cancelBtn);
          return;
        }
        var c = list[i++];
        say("Setting " + i + " of " + list.length + ": " + c.asin + " ...");
        var settled = function (res) {
          if (res && res.ok) {
            okCount++;
            mark(c.asin, "set", true);
          } else {
            var why = res && res.error ? String(res.error) : "It was not saved.";
            bad.push(c.asin + " (" + why + ")");
            mark(c.asin, "not set - " + why, false);
          }
          next();
        };
        var p;
        try { p = Promise.resolve(opts.write(c.asin, c.counted)); } catch (e) { p = Promise.reject(e); }
        p.then(settled, function (e) { settled({ ok: false, error: e && e.message ? e.message : "Something went wrong." }); });
      };
      next();
    }

    function focusEl(el) {
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* nothing to focus */ } }
    }

    function onKey(e) {
      if (e.key === "Escape") { dismiss(); return; }
      if (e.key !== "Tab") return;
      var all = [xBtn, yesBtn, cancelBtn];
      var list = [];
      for (var i = 0; i < all.length; i++) if (!all[i].disabled && !hiddenWithin(all[i], card)) list.push(all[i]);
      if (!list.length) { e.preventDefault(); return; }
      var at = list.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); focusEl(list[list.length - 1]); }
      else if (!e.shiftKey && (at === list.length - 1 || at < 0)) { e.preventDefault(); focusEl(list[0]); }
    }

    // Never closed while it is writing: every product gets its answer on screen.
    function dismiss() {
      if (closed || sending) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (current && current.overlay === overlay) current = null;
      if (opener && typeof opener.focus === "function" && opener !== document.body && opener.isConnected !== false) focusEl(opener);
    }

    xBtn.addEventListener("click", dismiss);
    cancelBtn.addEventListener("click", dismiss);
    yesBtn.addEventListener("click", run);
    overlay.addEventListener("pointerdown", function (e) { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", function (e) { if (e.target === overlay && downOnBackdrop) dismiss(); downOnBackdrop = false; });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    draw();
    focusEl(plan.changes.length ? cancelBtn : card);
    current = { overlay: overlay, close: dismiss };
    return { close: dismiss, isOpen: function () { return !closed; } };
  }

  // B-1921 (v2.0.146): "Set Receive counts to House on hand" - every House row gets a Receive count equal to its
  // House number, as if it had just been counted. Tallies only: this never writes a House count.
  function houseWhole(house) {
    if (house == null || house === "") return null;
    var h0 = Number(house);
    if (!isFinite(h0)) return null;
    var r = Math.round(h0);
    if (Math.abs(h0 - r) > 0.0005) return null;
    return isChunk(r) ? r : null;
  }

  // B-1940 (v2.0.147): the store keeps MAX_ENTRIES counts. A count for a product that has none is REFUSED when the
  // store is full - an older count is never pushed out without a word.
  function storeRoom(now) { return Math.max(0, MAX_ENTRIES - countInProgress(now)); }
  function storeFullText(now) {
    return "Shopper keeps at most " + MAX_ENTRIES + " Receive counts and " + countInProgress(now) + " are stored. Clear counts you no longer need (the \u2715 on a chip), then try again.";
  }

  // rows: [{ asin, title, house }] -> { set, replace, same, skipped, noRoom, stored }, each [{ asin, title, house, counted }].
  function planFillHouse(rows, now) {
    var set = [], replace = [], same = [], skipped = [], noRoom = [];
    var room = storeRoom(now);
    var seen = {};
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var asin = normAsin(r.asin);
      if (!asin || has(seen, asin)) continue;
      var hv = r.house;
      if (hv == null || hv === "" || !isFinite(Number(hv)) || Math.abs(Number(hv)) < 0.0005) continue;
      seen[asin] = true;
      var title = r.title != null && r.title !== "" ? String(r.title) : asin;
      var whole = houseWhole(hv);
      if (whole == null) { skipped.push({ asin: asin, title: title, house: Number(hv), counted: 0 }); continue; }
      var counted = totalFor(asin, now);
      var item = { asin: asin, title: title, house: whole, counted: counted };
      if (validPack(r.packOf)) item.packOf = validPack(r.packOf); // B-2040
      if (counted === whole) { same.push(item); continue; }
      var hasTally = getChunks(asin, now).length > 0;
      if (hasTally) replace.push(item);
      else if (set.length < room) set.push(item);
      else noRoom.push(item); // B-1940: would push an older count out
    }
    return { set: set, replace: replace, same: same, skipped: skipped, noRoom: noRoom, stored: MAX_ENTRIES - room };
  }

  function fillKey(plan) {
    var parts = [], all = plan.replace.concat(plan.set);
    for (var i = 0; i < all.length; i++) parts.push(all[i].asin + ":" + all[i].house + ":" + all[i].counted);
    return parts.join(",");
  }

  // opts: { rows, format?, where? ("House"), onDone? } - rows: the list, or a function returning the host's CURRENT list
  // (Opus review v2.0.146: Yes re-plans from the current House figures, so a refresh that changed House while the card
  // was open redraws instead of writing the old number).
  function openFillHouse(opts) {
    opts = opts || {};
    if (typeof document === "undefined" || !document.body) return null;
    closeCurrent();
    var where = String(opts.where || "House");
    var format = typeof opts.format === "function" ? opts.format : fmtNum;
    var fillRows = function () {
      try { return typeof opts.rows === "function" ? opts.rows() : opts.rows; } catch (e) { return []; }
    };
    var plan = planFillHouse(fillRows());
    var shownKey = fillKey(plan);
    var finished = false;
    var closed = false;
    var downOnBackdrop = false;
    var opener = document.activeElement;
    var uid = "rc-" + (++seq);

    var overlay = h("div", "rc-overlay");
    var card = h("div", "rc-card rc-all");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", uid + "-title");
    card.setAttribute("tabindex", "-1");
    var head = h("div", "rc-head");
    var heads = h("div", "rc-heads");
    var titleEl = h("div", "rc-title", "Set every Receive count to " + where + " on hand");
    titleEl.setAttribute("id", uid + "-title");
    heads.appendChild(titleEl);
    var xBtn = h("button", "rc-x", "\u2715");
    xBtn.type = "button";
    xBtn.setAttribute("aria-label", "Close");
    head.appendChild(heads);
    head.appendChild(xBtn);
    var intro = h("div", "rc-all-intro", "");
    var listEl = h("ul", "rc-all-list");
    var restEl = h("div", "rc-all-rest", "");
    var sameEl = h("div", "rc-all-rest rc-all-same", "");
    var msg = h("div", "rc-msg", "");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    var foot = h("div", "rc-foot");
    var yesBtn = h("button", "rc-btn rc-primary rc-all-yes", "");
    yesBtn.type = "button";
    var cancelBtn = h("button", "rc-btn rc-quiet rc-all-cancel", "Cancel");
    cancelBtn.type = "button";
    foot.appendChild(yesBtn);
    foot.appendChild(cancelBtn);
    card.appendChild(head);
    card.appendChild(intro);
    card.appendChild(listEl);
    card.appendChild(restEl);
    card.appendChild(sameEl);
    card.appendChild(msg);
    card.appendChild(foot);
    overlay.appendChild(card);

    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "rc-msg" + (kind ? " rc-msg-" + kind : "");
    }

    function draw() {
      listEl.textContent = "";
      var todo = plan.replace.concat(plan.set);
      var n = todo.length;
      intro.textContent = n
        ? "Each product below gets a Receive count equal to its " + where + " on hand, as if you had just counted it. " + where + " on hand itself is not changed."
        : (plan.noRoom.length ? "No Receive count can be set right now." : "Every " + where + " row already has a matching Receive count, so there is nothing to set.");
      for (var i = 0; i < n; i++) {
        var c = todo[i];
        var isReplace = i < plan.replace.length;
        var li = h("li", "rc-all-row");
        li.setAttribute("data-asin", c.asin);
        li.appendChild(h("div", "rc-all-name", c.asin + " \u00b7 " + c.title));
        li.appendChild(h("div", "rc-all-change", (isReplace ? "Counted " + format(c.counted) + " \u2192 " + format(c.house) + pcsOf(c.house, c.packOf) + " (replaces your count)" : "Not counted yet \u2192 " + format(c.house) + pcsOf(c.house, c.packOf))));
        listEl.appendChild(li);
      }
      listEl.hidden = !n;
      var nameList = function (host, items) {
        var ul = h("ul", "rc-all-names");
        for (var q = 0; q < items.length && q < 10; q++) ul.appendChild(h("li", "", items[q]));
        if (items.length > 10) ul.appendChild(h("li", "rc-all-more", "+" + (items.length - 10) + " more"));
        host.appendChild(ul);
      };
      var rest = [];
      for (var k = 0; k < plan.skipped.length; k++) rest.push(plan.skipped[k].asin + " (" + plan.skipped[k].house + ")");
      restEl.textContent = rest.length ? "Left alone - " + where + " on hand is not a whole number from 1 to 9,999:" : "";
      if (rest.length) nameList(restEl, rest);
      // B-1940: rows that would push an older count out of the store are refused, and named
      if (plan.noRoom.length) {
        restEl.appendChild(h("div", "rc-all-full", "Not set - " + storeFullText() + " These were left alone:"));
        var full = [];
        for (var m = 0; m < plan.noRoom.length; m++) full.push(plan.noRoom[m].asin + " \u00b7 " + plan.noRoom[m].title);
        nameList(restEl, full);
      }
      restEl.hidden = !rest.length && !plan.noRoom.length;
      sameEl.textContent = plan.same.length ? plan.same.length + " already match, so they are left as they are." : "";
      sameEl.hidden = !plan.same.length;
      yesBtn.textContent = "Yes - set " + n + " Receive count" + (n === 1 ? "" : "s");
      yesBtn.hidden = finished || !n;
      yesBtn.disabled = !n;
      cancelBtn.textContent = finished || !n ? "Done" : "Cancel";
    }

    function run() {
      if (finished) return;
      var fresh = planFillHouse(fillRows());
      if (fillKey(fresh) !== shownKey) {
        plan = fresh;
        shownKey = fillKey(fresh);
        draw();
        say("A count changed while this was open. Check the list again, then press Yes.", "bad");
        return;
      }
      var todo = plan.replace.concat(plan.set);
      if (!todo.length) return;
      var at = Date.now();
      for (var i = 0; i < todo.length; i++) setChunks(todo[i].asin, [todo[i].house], at);
      finished = true;
      draw();
      say("Set " + todo.length + " Receive count" + (todo.length === 1 ? "" : "s") + " to " + where + " on hand.", "ok");
      if (typeof opts.onDone === "function") { try { opts.onDone({ set: todo.length }); } catch (e) { /* the host redraw must never break this */ } }
      if (!closed) focusEl(cancelBtn);
    }

    function focusEl(el) {
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* nothing to focus */ } }
    }

    function onKey(e) {
      if (closed) return;
      if (e.key === "Escape") { dismiss(); return; }
      if (e.key !== "Tab") return;
      var all = [xBtn, yesBtn, cancelBtn];
      var list = [];
      for (var i = 0; i < all.length; i++) if (!all[i].disabled && !hiddenWithin(all[i], card)) list.push(all[i]);
      if (!list.length) { e.preventDefault(); return; }
      var at = list.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); focusEl(list[list.length - 1]); }
      else if (!e.shiftKey && (at === list.length - 1 || at < 0)) { e.preventDefault(); focusEl(list[0]); }
    }

    function dismiss() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (current && current.overlay === overlay) current = null;
      if (opener && typeof opener.focus === "function" && opener !== document.body && opener.isConnected !== false) focusEl(opener);
    }

    xBtn.addEventListener("click", dismiss);
    cancelBtn.addEventListener("click", dismiss);
    yesBtn.addEventListener("click", run);
    overlay.addEventListener("pointerdown", function (e) { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", function (e) { if (e.target === overlay && downOnBackdrop) dismiss(); downOnBackdrop = false; });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    draw();
    focusEl(plan.replace.length + plan.set.length ? cancelBtn : card);
    current = { overlay: overlay, close: dismiss };
    return { close: dismiss, isOpen: function () { return !closed; } };
  }

  function closeCurrent() { if (current) current.close(); }
  function isOpen() { return !!current; }

  // Test hook: forget what the memory fallback holds and re-try real storage.
  function _reset() { memory = {}; degraded = false; memoryClears = {}; clearsDegraded = false; storeListeners = []; openWatchers = []; badgeClearWatchers = []; }

  self.ShopperReceive = Object.freeze({
    QUICK: QUICK,
    MIN_CHUNK: MIN_CHUNK,
    MAX_CHUNK: MAX_CHUNK,
    MAX_CHUNKS: MAX_CHUNKS,
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_ENTRIES: MAX_ENTRIES,
    STORE_KEY: STORE_KEY,
    CLEARS_KEY: CLEARS_KEY,
    onStoreChange: onStoreChange,
    exportSync: exportSync,
    mergeSync: mergeSync,
    applyRemote: applyRemote,
    diffNewer: diffNewer,
    paintBadges: paintBadges,
    badgeVsHouse: badgeVsHouse,
    onBadgeClear: onBadgeClear,
    clearFromBadge: clearFromBadge,
    isChunk: isChunk,
    parseTyped: parseTyped,
    createTally: createTally,
    gapInfo: gapInfo,
    fullCountChunk: fullCountChunk,
    validPack: validPack,
    pcsOf: pcsOf,
    planSetAll: planSetAll,
    planFillHouse: planFillHouse,
    storeRoom: storeRoom,
    openFillHouse: openFillHouse,
    openSetAll: openSetAll,
    parseSpoken: parseSpoken,
    prune: prune,
    getChunks: getChunks,
    countInProgress: countInProgress,
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
