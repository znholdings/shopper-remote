// remote/listing-health-view.js - B-1125 (v2.0.58): the phone Pricing tab's
// "Aged inventory" and "No sales" sections, compact.
//
// Data: p.belowMin.listingHealth from the laptop (lib/listing-health-store.js
// projectListingHealthForRemote - the 7-day candidates, stalest first, capped
// at 40; the totals per window from the laptop's full list; the aged rows
// capped at 40). The window filter and the words are lib/listing-health.js,
// the laptop page's own code (remote/belowmin-lib.js wraps it unchanged).
// Read-only: no command, nothing sent. The 7 / 14 / 30 choice is remembered
// on this phone (localStorage, same key name as the laptop's).
(function () {
  "use strict";
  const P = self.ShopperPrice;
  const $ = (id) => document.getElementById(id);
  const SHOW_FIRST = 5;
  const KEY = (P && P.NO_SALES_WINDOW_KEY) || "shopperPricingNoSalesWindow";
  let data = null;
  let lastKey = "";
  let win = 30;
  try { win = P && P.lhNormalizeWindow ? P.lhNormalizeWindow(localStorage.getItem(KEY)) : 30; } catch (e) { /* default */ }
  let nsAll = false;
  let agedAll = false;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const plural = (n, one) => `${n} ${n === 1 ? one : one + "s"}`;
  function ago(ms) {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }
  function nameLine(r) {
    const d = el("div", "lhm-name");
    const a = el("a", "lhm-title", r.title || r.asin);
    a.href = `https://www.amazon.com/dp/${encodeURIComponent(r.asin || "")}`;
    a.target = "_blank";
    a.rel = "noopener";
    d.append(a);
    const ids = el("div", "muted small lhm-ids");
    ids.append(el("span", null, r.asin || ""));
    if (r.asin && P && P.makeCopyButton) ids.append(P.makeCopyButton(document, { value: r.asin, what: "ASIN", className: "s-plain-btn" }));
    d.append(ids);
    return d;
  }
  function more(all, n, toggle) {
    const b = el("button", "mini-btn lhm-more", all ? "Show fewer" : `Show all ${n}`);
    b.type = "button";
    b.addEventListener("click", toggle);
    return b;
  }

  function drawAged(box, a) {
    box.append(el("h3", "ai-h2", "Aged inventory"));
    const st = P.lhAgedStatus(a, Date.now());
    box.append(el("p", "muted small" + (st.bad ? " warn-text" : ""), st.text));
    if (!st.known || !a || !a.summary) return;
    const tiles = el("div", "lhm-levels");
    for (const lv of P.AGED_LEVELS) {
      const s = a.summary[lv] || { skus: 0, units: 0, fee: null };
      const t = el("div", "lhm-level lhm-" + lv);
      t.append(el("div", "t-label", P.AGED_LEVEL_LABEL[lv]), el("div", "t-value", String(s.units)),
        el("div", "muted small", `units · ${plural(s.skus, "SKU")}${lv !== "old" && s.fee != null ? ` · ${P.lhMoney(s.fee)}` : ""}`));
      tiles.append(t);
    }
    box.append(tiles);
    const rows = a.rows || [];
    if (!rows.length) { box.append(el("p", "muted small", "Amazon's report shows no unit over 90 days old.")); return; }
    const list = el("div", "lhm-list");
    for (const r of agedAll ? rows : rows.slice(0, SHOW_FIRST)) {
      const row = el("div", "lhm-row");
      row.append(nameLine(r));
      const line = el("div", "lhm-line");
      line.append(el("span", "s-pill lhm-pill-" + r.level, P.AGED_LEVEL_LABEL[r.level] || r.level), el("span", "muted small", " " + P.lhAgedLine(r)));
      row.append(line);
      list.append(row);
    }
    box.append(list);
    const total = Math.max(rows.length, a.total || 0);
    if (rows.length > SHOW_FIRST) box.append(more(agedAll, rows.length, () => { agedAll = !agedAll; lastKey = ""; render(data); }));
    if (total > rows.length) box.append(el("p", "muted small", `${total - rows.length} more on the laptop's Pricing page.`));
  }

  function drawNoSales(box, lh) {
    const head = el("div", "lhm-head");
    head.append(el("h3", "ai-h2", "No sales"));
    const chips = el("div", "ctm-chipset lhm-win");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "No sales in the last");
    for (const w of P.NO_SALES_WINDOWS) {
      const b = el("button", "ctm-seg s-plain-btn", `${w} days`);
      b.type = "button";
      b.dataset.window = String(w);
      b.setAttribute("aria-pressed", String(w === win));
      b.addEventListener("click", () => {
        win = P.lhNormalizeWindow(w);
        nsAll = false;
        try { localStorage.setItem(KEY, String(win)); } catch (e) { /* fine */ }
        lastKey = "";
        render(data);
      });
      chips.append(b);
    }
    head.append(chips);
    box.append(head);
    const base = lh.base;
    const ns = P.noSalesFor(base, win);
    const tot = (lh.totals && lh.totals[win]) || null;
    const total = tot && tot.known ? Math.max(tot.total, ns.total) : ns.total;
    if (!base.stock || !base.stock.source) { box.append(el("p", "muted small", "No stock figures on file yet.")); return; }
    if (!ns.known) { box.append(el("p", "muted small warn-text", ns.reason)); return; }
    box.append(el("p", "muted small", `${plural(total, "listing")} with stock, no sale in ${win} days${ns.through ? ` through ${ns.through}` : ""} · ${tot ? `${tot.units} units · ${P.lhMoney(tot.value)} at cost` : ""}${ns.warn ? " · " + ns.warn : ""}`));
    box.append(el("p", "muted small lhm-src", `Stock ${ago(base.stock.at)} (${base.stock.source === "amazon" ? "Amazon" : "Replen Pulse"}) · sales: ${ns.sourceText}`));
    if (!ns.rows.length) { box.append(el("p", "muted small", `Every listing with stock sold at least once in the last ${win} days${ns.through ? ` (through ${ns.through})` : ""}.`)); return; }
    const list = el("div", "lhm-list");
    for (const r of nsAll ? ns.rows : ns.rows.slice(0, SHOW_FIRST)) {
      const row = el("div", "lhm-row");
      row.append(nameLine(r));
      const nums = el("div", "lhm-nums");
      const cell = (label, value) => { const c = el("div", "lhm-num"); c.append(el("div", "t-label", label), el("div", "lhm-v", value)); return c; };
      nums.append(cell("Stock", String(r.avail)), cell("At cost", r.value == null ? "-" : P.lhMoney(r.value)), cell("Last sale", r.sinceText), cell("Price", P.lhPriceVsBb(r.my, r.bb)));
      row.append(nums);
      if (r.restock) row.append(el("div", "muted small", `Last restock ${P.lhShortDay(r.restock)}`));
      list.append(row);
    }
    box.append(list);
    if (ns.rows.length > SHOW_FIRST) box.append(more(nsAll, ns.rows.length, () => { nsAll = !nsAll; lastKey = ""; render(data); }));
    if (total > ns.rows.length) box.append(el("p", "muted small", `${total - ns.rows.length} more on the laptop's Pricing page.`));
  }

  function render(lh) {
    data = lh || null;
    const box = $("lhmBox");
    if (!box || !P || !P.noSalesFor) return;
    const key = JSON.stringify([data && data.at, win, nsAll, agedAll]);
    if (key === lastKey) return;
    lastKey = key;
    box.textContent = "";
    box.hidden = !data;
    if (!data) return;
    const aged = el("section", "lhm-card");
    drawAged(aged, data.aged);
    const ns = el("section", "lhm-card");
    if (data.base) drawNoSales(ns, data);
    box.append(aged, ns);
  }

  self.ShopperListingHealthView = { render };
})();
