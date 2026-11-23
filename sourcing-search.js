// remote/sourcing-search.js - B-2288 (v2.0.196): the search box on the phone's two Sourcing pages (Tracked Leads, Competitor ASINs).
// Same rule as the laptop (lib/sourcing-search.js) and the Stock tab (stock-search.js): every word typed must be in the row, any order, any case.
// A row's own text (select / option / button / table headers left out) plus its data-search words (brand, source link, seller ids).
// The bar (input + x + count) is created ONCE per pane and kept: each view's draw() wipes the pane, so reattach() puts the SAME node back, and if the
// input had focus before the wipe (remember()) it is focused again with the caret restored. A MutationObserver on the pane re-applies after every redraw.
// Nothing is fetched or sent. DOM API, textContent only.
(function (root) {
  "use strict";
  var MISS = "src-miss";
  var SS = root.ShopperStockSearch || null; // loaded before this file (remote/index.html)
  var ASIN_RE = /\b(B0[0-9A-Z]{8})\b/g;

  function fold(s) { s = String(s == null ? "" : s); try { return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { return s; } }
  function squeeze(s) { return String(s).toLowerCase().replace(/[^0-9a-z]+/g, ""); }
  function localTokens(q) { return String(q == null ? "" : q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8); }
  function localMatches(hay, toks) {
    if (!toks || !toks.length) return true;
    var h = String(hay).toLowerCase(), sq = null;
    for (var i = 0; i < toks.length; i++) {
      if (h.indexOf(toks[i]) >= 0) continue;
      var ct = squeeze(toks[i]);
      if (ct.length < 3) return false;
      if (sq === null) sq = squeeze(h);
      if (sq.indexOf(ct) < 0) return false;
    }
    return true;
  }
  function asinsIn(text) {
    var out = [], m, s = String(text || "").toUpperCase();
    ASIN_RE.lastIndex = 0;
    while ((m = ASIN_RE.exec(s))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }
  // what he typed -> words (a pasted Amazon link becomes its ASIN)
  function tokens(q) {
    var base = fold(q);
    var toks = SS && SS.tokens ? SS.tokens(base) : localTokens(base);
    return toks.map(function (t) {
      if (!/amazon\.|amzn\./.test(t)) return t;
      var a = asinsIn(t);
      return a.length ? a[0].toLowerCase() : t;
    });
  }
  function matches(hay, toks) { return SS && SS.matches ? SS.matches(hay, toks) : localMatches(hay, toks); }
  function hayOf(text, extra) {
    var t = String(text == null ? "" : text), e = String(extra == null ? "" : extra);
    return fold(t + " " + e + " " + asinsIn(t + " " + e).join(" "));
  }
  function rowText(row) {
    var clone = row.cloneNode(true);
    var drop = clone.querySelectorAll("select, option, button, th, [data-nosearch]"); // B-2296: boilerplate is not a search word
    for (var i = 0; i < drop.length; i++) drop[i].remove();
    return clone.textContent;
  }
  function countText(shown, total, active) {
    if (!active) return "";
    if (!(total > 0)) return "Nothing on this page to search";
    if (!(shown > 0)) return "0 of " + total + " - nothing matches";
    return shown + " of " + total;
  }

  // ---- the "also in" hint: which other Competitor ASINs tabs hold a hit (same fields as lib/sourcing-search.js compSearchTabs) ----
  var TAB_NAMES = [["leads", "Leads"], ["waiting", "Waiting for a source"], ["candidates", "Candidates"], ["sellers", "Sellers"], ["all", "All new ASINs"]];
  var SHOPS = { walmart: "Walmart", samsclub: "Sam's Club", target: "Target", homedepot: "Home Depot" };
  function leadPasses(info, b) { return !!info && isFinite(info.roi) && isFinite(info.profit) && info.roi >= b.minRoi && info.profit >= b.minProfit; }
  function tabsWithHits(data, bar, toks, pick) { // B-2296: counts, and the All tab cut to the storefront pick
    var d = data || {};
    var names = {};
    (d.sellers || []).forEach(function (s) { names[s.id] = s.name || ""; });
    function hit(rows) {
      return (rows || []).filter(function (it) {
        var li = it && it.leadInfo;
        var w = [it.asin, it.title, it.brand, it.category, (it.tags || []).join(" "), (it.sellers || []).map(function (s) { return s + " " + (names[s] || ""); }).join(" "), li && li.retailer, li && SHOPS[li.retailer]].filter(Boolean).join(" ");
        return matches(hayOf(w, ""), toks);
      }).length;
    }
    var c = d.candidates || {};
    return {
      leads: hit(((d.leads && d.leads.rows) || []).filter(function (r) { return leadPasses(r.leadInfo, bar); })),
      waiting: hit(d.waiting && d.waiting.rows),
      candidates: hit([].concat(c.today || [], c.older || [], d.filtered || [])),
      sellers: (d.sellers || []).filter(function (s) { return matches(hayOf((s.name || "") + " " + s.id, ""), toks); }).length,
      all: hit((d.all || []).filter(function (r) { return !pick || (r.sellers || []).indexOf(pick) >= 0; }))
    };
  }
  function alsoText(tabs, open) {
    var here = Number(tabs && tabs[open]) || 0; // B-2296: only tabs holding MORE hits than the open one
    var out = TAB_NAMES.filter(function (t) { return t[0] !== open && tabs && Number(tabs[t[0]]) > here; }).map(function (t) { return t[1]; });
    return out.length ? "also in: " + out.join(", ") : "";
  }

  /**
   * bar(pane, { units, placeholder, also(toks), cut() }) -> { node, apply, remember, reattach(afterNode) }
   * units = CSS selector of the rows; also = text added to the count line; cut() = true when the phone holds only part of the list.
   */
  function bar(pane, opts) {
    opts = opts || {};
    var doc = pane.ownerDocument || root.document;
    var node = doc.createElement("div"); node.className = "src-search"; node.setAttribute("role", "search");
    var input = doc.createElement("input"); input.type = "text"; input.className = "src-search-input"; input.setAttribute("inputmode", "search"); input.setAttribute("autocomplete", "off"); input.setAttribute("autocapitalize", "off"); input.setAttribute("spellcheck", "false"); input.placeholder = opts.placeholder || "Search"; input.setAttribute("aria-label", "Search this page");
    var clear = doc.createElement("button"); clear.type = "button"; clear.className = "mini-btn src-search-clear"; clear.textContent = "×"; clear.setAttribute("aria-label", "Clear the search"); clear.hidden = true;
    var count = doc.createElement("span"); count.className = "muted small src-search-count"; count.setAttribute("aria-live", "polite");
    node.appendChild(input); node.appendChild(clear); node.appendChild(count);
    var cache = new WeakMap();
    var focus = null; // { s, e } when the input had focus before a wipe

    function setText(n, t) { if (n.textContent !== t) n.textContent = t; }
    function apply() {
      var toks = tokens(input.value), active = toks.length > 0;
      if (clear.hidden !== !input.value) clear.hidden = !input.value;
      var shown = 0, total = 0;
      var rows = opts.units ? pane.querySelectorAll(opts.units) : [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var h = cache.get(row);
        if (h === undefined) { h = hayOf(rowText(row), row.getAttribute("data-search") || ""); cache.set(row, h); }
        var miss = active && !matches(h, toks);
        if (row.classList.contains(MISS) !== miss) row.classList.toggle(MISS, miss);
        total++;
        if (!miss) shown++;
      }
      var text = countText(shown, total, active);
      if (active) {
        var extra = ""; try { extra = opts.also ? opts.also(toks) || "" : ""; } catch (e) { extra = ""; }
        if (extra) text += (text ? " · " : "") + extra;
        var cut = false; try { cut = !!(opts.cut && opts.cut()); } catch (e2) { cut = false; }
        if (cut) text += " - searching the 100 shown here";
      }
      setText(count, text); // only when it changed: the pane observer must not see its own count
      return { shown: shown, total: total };
    }
    var pending = false;
    function later() {
      if (pending) return;
      pending = true;
      (root.requestAnimationFrame || function (f) { return setTimeout(f, 0); })(function () { pending = false; apply(); });
    }
    if (root.MutationObserver) new root.MutationObserver(function () { cache = new WeakMap(); later(); }).observe(pane, { childList: true, subtree: true });
    input.addEventListener("input", apply);
    input.addEventListener("keydown", function (e) { if (e.key === "Escape") { input.value = ""; apply(); } });
    clear.addEventListener("click", function () { input.value = ""; apply(); input.focus(); });

    return {
      node: node, input: input, apply: apply,
      // call BEFORE the pane is wiped: did the input have the focus?
      remember: function () { focus = doc.activeElement === input ? { s: input.selectionStart, e: input.selectionEnd } : null; },
      // after the wipe: put the same node back (after afterNode, or first) and give the focus back
      reattach: function (afterNode) {
        if (afterNode && afterNode.parentNode === pane) pane.insertBefore(node, afterNode.nextSibling); else pane.insertBefore(node, pane.firstChild);
        if (focus) { try { input.focus(); input.setSelectionRange(focus.s, focus.e); } catch (e) { /* a caret never stops the page */ } focus = null; }
        later(); // the view adds its rows after this; one pass per frame
      }
    };
  }

  root.ShopperSourcingSearch = Object.freeze({ bar: bar, tokens: tokens, matches: matches, hayOf: hayOf, tabsWithHits: tabsWithHits, alsoText: alsoText, fold: fold });
})(typeof self !== "undefined" ? self : globalThis);
