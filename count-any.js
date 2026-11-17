// lib/count-any.js - B-2130 (v2.0.167): "Count a product not listed".
// lib/count-any.js and remote/count-any.js are the same file (test v20167-b2130).
// A small search pop-up. Pick a product (or an ASIN Shopper has never seen) and the normal Receive pop-up
// opens for it - the count then goes through the existing pencil message, nothing new is written here.
// Classic script: no imports, no extension APIs, createElement / textContent only. Uses the rc-* classes of receive-count.css.
(function () {
  "use strict";
  var MAX = 8;
  var ASIN_RE = /^[A-Za-z0-9]{10}$/;
  var LINK_RE = /\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?![A-Za-z0-9])/i;

  // A 10-character ASIN, or an Amazon /dp/ or /gp/product/ link. Upper-case, or "" when it is neither.
  function parseAsin(text) {
    var t = String(text == null ? "" : text).trim();
    if (!t) return "";
    var m = LINK_RE.exec(t);
    if (m) return m[1].toUpperCase();
    return ASIN_RE.test(t) ? t.toUpperCase() : "";
  }

  function houseOf(rows, asin) {
    for (var i = 0; i < (rows || []).length; i++) {
      if (rows[i] && String(rows[i].asin || "").toUpperCase() === asin) {
        var h = Number(rows[i].house);
        return isFinite(h) ? h : 0;
      }
    }
    return null;
  }

  // The server's matches first, then local rows holding every word of the question; deduped by ASIN, max 8.
  function mergeResults(o) {
    o = o || {};
    var server = Array.isArray(o.server) ? o.server : [];
    var rows = Array.isArray(o.rows) ? o.rows : [];
    var q = String(o.q == null ? "" : o.q);
    var out = [];
    var seen = {};
    function add(asin, title) {
      asin = String(asin || "").toUpperCase();
      if (!asin || seen[asin] || out.length >= MAX) return;
      seen[asin] = 1;
      out.push({ asin: asin, title: String(title || ""), house: houseOf(rows, asin), known: true });
    }
    for (var i = 0; i < server.length; i++) if (server[i]) add(server[i].asin, server[i].title);
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && !parseAsin(q)) {
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        if (!r) continue;
        var hay = (String(r.asin || "") + " " + String(r.title || "")).toLowerCase();
        var all = true;
        for (var k = 0; k < words.length; k++) if (hay.indexOf(words[k]) < 0) { all = false; break; }
        if (all) add(r.asin, r.title);
      }
    }
    var a = parseAsin(q);
    if (a && !seen[a]) {
      var h = houseOf(rows, a);
      if (h != null) out.push({ asin: a, title: "", house: h, known: true }); // a House row Shopper already has
      else out.push({ asin: a, title: "", house: null, known: false });
    }
    return out;
  }

  // Receive tallies (chunks > 0) for ASINs that are not on the House list.
  function orphanTallies(tallies, rows, visibleSet) {
    var vis = {};
    var list = visibleSet && typeof visibleSet.forEach === "function" ? visibleSet : [];
    list.forEach(function (v) { vis[String(v && typeof v === "object" ? v.asin : v || "").toUpperCase()] = 1; });
    var titles = {};
    (rows || []).forEach(function (r) { if (r && r.asin) titles[String(r.asin).toUpperCase()] = r.title || ""; });
    var out = [];
    var t = tallies || {};
    for (var k in t) {
      if (!Object.prototype.hasOwnProperty.call(t, k)) continue;
      var ch = t[k] && t[k].chunks;
      if (!Array.isArray(ch)) continue;
      var total = 0, n = 0;
      for (var i = 0; i < ch.length; i++) { var c = Number(ch[i]); if (isFinite(c) && c > 0) { total += c; n++; } }
      var asin = String(k).toUpperCase();
      if (n > 0 && !vis[asin]) out.push({ asin: asin, total: total, title: titles[asin] || "" });
    }
    return out;
  }

  var current = null;
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function closeCurrent() { if (current) current.close(); }

  // opts: { rows(), visible(), tallies(), search(q) -> Promise<{ok, matches, error}>, openCount(item), format }
  function open(opts) {
    opts = opts || {};
    if (typeof document === "undefined" || !document.body) return null;
    closeCurrent();
    var fmt = typeof opts.format === "function" ? opts.format : function (v) { return String(v); };
    function get(fn) { try { return typeof fn === "function" ? fn() : fn; } catch (e) { return null; } }
    var opener = document.activeElement;
    var closed = false;
    var downOnBackdrop = false;
    var runId = 0;
    var armed = ""; // the unknown ASIN that has had its first tap

    var overlay = h("div", "rc-overlay");
    var card = h("div", "rc-card rc-all rc-any");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Count a product not listed");
    card.setAttribute("tabindex", "-1");
    var head = h("div", "rc-head");
    var heads = h("div", "rc-heads");
    heads.appendChild(h("div", "rc-title", "Count a product not listed"));
    var xBtn = h("button", "rc-x", "✕");
    xBtn.type = "button";
    xBtn.setAttribute("aria-label", "Close");
    head.appendChild(heads);
    head.appendChild(xBtn);
    var input = h("input", "rc-input");
    input.type = "text";
    input.value = "";
    input.setAttribute("placeholder", "ASIN, Amazon link or product name");
    input.setAttribute("aria-label", "ASIN, Amazon link or product name");
    var findBtn = h("button", "rc-btn rc-primary", "Find");
    findBtn.type = "button";
    var msg = h("div", "rc-msg", "");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    var listEl = h("ul", "rc-all-list");
    var inprogHead = h("div", "rc-all-rest", "");
    var inprogEl = h("ul", "rc-all-list");
    var hint = h("div", "rc-all-rest", "Booked under a different product? Pencil that one down too.");
    card.appendChild(head);
    card.appendChild(input);
    card.appendChild(findBtn);
    card.appendChild(msg);
    card.appendChild(listEl);
    card.appendChild(inprogHead);
    card.appendChild(inprogEl);
    card.appendChild(hint);
    overlay.appendChild(card);

    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "rc-msg" + (kind ? " rc-msg-" + kind : "");
    }
    function clear(el) { while (el.children.length) el.removeChild(el.children[0]); el.textContent = ""; }

    function pick(item) {
      var fn = opts.openCount;
      close();
      if (typeof fn === "function") fn({ asin: item.asin, title: item.title || "", house: item.house });
    }

    function paintInProgress() {
      clear(inprogEl);
      var list = orphanTallies(get(opts.tallies) || {}, get(opts.rows) || [], get(opts.visible) || []);
      inprogHead.textContent = list.length ? "Counts in progress not on the list" : "";
      inprogHead.hidden = !list.length;
      list.forEach(function (o) {
        var li = h("li", "rc-all-row");
        li.appendChild(h("div", "rc-all-name", o.title || o.asin));
        li.appendChild(h("div", "rc-asin", o.asin + " · counted " + fmt(o.total)));
        var b = h("button", "rc-btn", "Open");
        b.type = "button";
        b.addEventListener("click", function () { pick({ asin: o.asin, title: o.title, house: null }); });
        li.appendChild(b);
        inprogEl.appendChild(li);
      });
    }

    function paintResults(items) {
      clear(listEl);
      items.forEach(function (it) {
        var li = h("li", "rc-all-row");
        li.appendChild(h("div", "rc-all-name", it.title || (it.known === false ? "Unknown product" : it.asin)));
        li.appendChild(h("div", "rc-asin", it.asin));
        li.appendChild(h("div", "rc-all-rest", it.known === false ? "Not in your Catalog or Products tab - check the ASIN"
          : (it.house == null ? "Not on the House list" : "Shopper has " + fmt(it.house) + " at the House")));
        var label = it.known === false ? (armed === it.asin ? "Yes, count it anyway" : "Count it anyway") : "Count this";
        var b = h("button", "rc-btn" + (it.known === false ? "" : " rc-primary"), label);
        b.type = "button";
        b.addEventListener("click", function () {
          if (it.known === false && armed !== it.asin) { armed = it.asin; paintResults(items); return; } // the second tap
          pick(it);
        });
        li.appendChild(b);
        listEl.appendChild(li);
      });
    }

    function find() {
      var q = input.value.trim();
      armed = "";
      if (!q) { say("Type an ASIN, paste an Amazon link, or type part of the name.", "bad"); return; }
      var my = ++runId;
      say("Looking...", "");
      clear(listEl);
      var p;
      try { p = typeof opts.search === "function" ? Promise.resolve(opts.search(q)) : Promise.resolve({ ok: true, matches: [] }); }
      catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        if (closed || my !== runId) return;
        var server = res && res.ok && Array.isArray(res.matches) ? res.matches : [];
        var items = mergeResults({ server: server, rows: get(opts.rows) || [], q: q });
        paintResults(items);
        if (res && res.ok === false && !items.length) say(String(res.error || "The search did not work."), "bad");
        else say(items.length ? "" : "Nothing found. Try the ASIN or an Amazon link.", items.length ? "" : "bad");
      }, function (err) {
        if (closed || my !== runId) return;
        var items = mergeResults({ server: [], rows: get(opts.rows) || [], q: q });
        paintResults(items);
        say(String((err && err.message) || "The search did not work."), "bad");
      });
    }

    function onKey(e) {
      if (e && e.key === "Escape") { if (e.preventDefault) e.preventDefault(); close(); }
    }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (current && current.overlay === overlay) current = null;
      try { if (opener && typeof opener.focus === "function") opener.focus(); } catch (e) { /* the page moved on */ }
    }

    xBtn.addEventListener("click", close);
    findBtn.addEventListener("click", find);
    input.addEventListener("keydown", function (e) { if (e && e.key === "Enter") { if (e.preventDefault) e.preventDefault(); find(); } });
    overlay.addEventListener("mousedown", function (e) { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener("click", function (e) { if (e.target === overlay && downOnBackdrop) close(); downOnBackdrop = false; });
    document.addEventListener("keydown", onKey);
    paintInProgress();
    document.body.appendChild(overlay);
    current = { overlay: overlay, close: close };
    try { input.focus(); } catch (e) { /* not focusable yet */ }
    return { close: close, input: input, findBtn: findBtn, listEl: listEl, card: card, overlay: overlay };
  }

  self.ShopperCountAny = Object.freeze({ open: open, parseAsin: parseAsin, mergeResults: mergeResults, orphanTallies: orphanTallies, close: closeCurrent, isOpen: function () { return !!current; } });
})();
