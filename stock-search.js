// remote/stock-search.js - B-1309 (v2.0.78, builder D): the phone's Stock tab
// search. One box under the House / Prep / In transit tiles (index.html
// #invFilter - the Products filter, moved up and widened) that filters, as he
// types, every list on the tab: the House / Prep / In transit list, Needs you,
// Latest arrivals, Arrivals and Products. Same rule as the laptop's Pipeline
// search (lib/pipeline-search.js): every word typed must be in the row (any
// order, any case; order numbers with or without dashes), the row's ASIN
// included. The phone's payload carries ASIN, title, retailer and the visible
// order numbers - not FNSKUs or every order behind a product (that stays on
// the laptop).
//
// Nothing is fetched or sent: it only hides rows already drawn (a class), and
// re-applies whenever a list redraws (MutationObserver). app.js renderInventory
// still narrows Products with the same words on its next redraw (matches()).
// Shows "N of M" and an x; Esc clears. Built with textContent only.
(function (root) {
  "use strict";

  const MAX_TOKENS = 8;
  const MISS = "inv-search-miss";
  const HIDE = "inv-search-hide";
  // The rows on the Stock tab.
  const UNITS = ["#invBucketTable tbody > tr", "#needsSection .need-card", "#latestSection .inv-arrival", "#invArrivals .inv-arrival", "#invRows > .inv-product"];

  const lower = (s) => String(s == null ? "" : s).toLowerCase();
  const squeeze = (s) => lower(s).replace(/[^0-9a-z]+/g, "");

  function tokens(q) {
    return lower(q).split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  }

  // Every token in the text (as typed, or squeezed to letters + digits when it has 3+).
  function matches(hay, toks) {
    if (!toks || !toks.length) return true;
    const h = lower(hay);
    let sq = null;
    for (const t of toks) {
      if (h.includes(t)) continue;
      const ct = squeeze(t);
      if (ct.length < 3) return false;
      if (sq === null) sq = squeeze(h);
      if (!sq.includes(ct)) return false;
    }
    return true;
  }

  // B-1339 (v2.0.79): hidden words by ASIN (FNSKU, older order numbers) from the laptop's payload.
  let findWords = {};
  function setFind(map) {
    findWords = map && typeof map === "object" ? map : {};
  }

  function rowText(row) {
    const ids = [];
    if (row.dataset && row.dataset.asin) ids.push(row.dataset.asin);
    for (const el of row.querySelectorAll("[data-asin]")) ids.push(el.getAttribute("data-asin"));
    for (const id of ids.slice()) {
      const extra = findWords[String(id || "").toUpperCase()];
      if (extra) ids.push(extra);
    }
    // Drop-down menus are left out (an option in every row would match them all).
    const clone = row.cloneNode(true);
    for (const s of clone.querySelectorAll("select, option")) s.remove();
    return clone.textContent + " " + ids.join(" ");
  }

  const $ = (id) => document.getElementById(id);
  let input = null;
  let clear = null;
  let count = null;

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setHidden(node, hidden) {
    if (node && node.hidden !== hidden) node.hidden = hidden;
  }

  function apply() {
    if (!input) return { shown: 0, total: 0 };
    const toks = tokens(input.value);
    const active = toks.length > 0;
    setHidden(clear, !input.value);
    let shown = 0;
    let total = 0;
    for (const sel of UNITS) {
      for (const row of document.querySelectorAll(sel)) {
        const miss = active && !matches(rowText(row), toks);
        if (row.classList.contains(MISS) !== miss) row.classList.toggle(MISS, miss);
        total++;
        if (!miss) shown++;
      }
    }
    // An Arrivals day box with nothing left in it folds away.
    for (const box of document.querySelectorAll("#invArrivals .inv-box")) {
      const rows = box.querySelectorAll(".inv-arrival");
      const hide = active && rows.length > 0 && ![...rows].some((r) => !r.classList.contains(MISS));
      if (box.classList.contains(HIDE) !== hide) box.classList.toggle(HIDE, hide);
    }
    setText(count, !active ? "" : !total ? "Nothing on this tab to search" : shown ? shown + " of " + total : "0 of " + total + " - nothing matches");
    setHidden(count, !active);
    return { shown, total };
  }

  let pending = false;
  function later() {
    if (pending) return;
    pending = true;
    (root.requestAnimationFrame || ((f) => setTimeout(f, 0)))(() => {
      pending = false;
      apply();
    });
  }

  function mount() {
    input = $("invFilter");
    clear = $("invFilterClear");
    count = $("invSearchCount");
    if (!input) return;
    input.addEventListener("input", apply);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      input.value = "";
      apply();
    });
    if (clear) {
      clear.addEventListener("click", () => {
        input.value = "";
        apply();
        // Products is narrowed on app.js's next redraw - redraw now that the words are gone.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
    }
    const pane = $("inventoryPane");
    if (pane && root.MutationObserver) new root.MutationObserver(later).observe(pane, { childList: true, subtree: true });
    apply();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  root.ShopperStockSearch = Object.freeze({ tokens, matches, apply, UNITS, setFind });
})(typeof self !== "undefined" ? self : globalThis);
