// remote/catalog-view.js - B-1023 (v2.0.49): the phone's "Catalog" tab.
//
// The laptop's Catalog on the phone, read-only: the products WITH STOCK
// (the laptop sends the best sellers first, capped - lib/catalog.js
// projectCatalogForRemote), a search box and a filter. Owns no rules: search,
// filter, order and how a figure is written are lib/catalog-view.js +
// lib/catalog-filters.js, wrapped unchanged in catalog-lib.js. "Refresh" is
// the laptop's own Quick refresh (the refreshAll command every other tab uses).
//
// v2.0.51:
//   B-1041 - a Table / Cards switch. Table (the default, remembered on this
//            phone) shows the laptop table's columns; it scrolls sideways
//            INSIDE its own box with the Product column pinned on the left.
//   B-1042 - the With stock / Available / On the way chips show which one is
//            on (filled + aria-pressed); one at a time; tapping the one that
//            is on goes back to With stock.
//   B-1043 - sort + per-column Min / Max (Product: contains) filters, the
//            same pure rules as the laptop (lib/catalog-filters.js). Table:
//            tap a heading to sort, the funnel to filter. Cards: a Sort
//            select + a Filter button. Active filters are chips with Clear all.
//   B-1044 - small copy buttons beside ASIN, MSKU and the title.
(function () {
  "use strict";
  const C = self.ShopperCatalog;
  const $ = (id) => document.getElementById(id);
  const VIEW_KEY = "shopperCatalogPhoneView";
  const PAGE = 80;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const view = { filter: "stock", mode: "table", sort: null, cols: {} };
  let data = null; // the payload's catalog
  let rows = [];
  let hay = [];
  let dataKey = "";
  let drawnKey = "";
  let limit = PAGE;
  let panelKey = null; // null = closed, "*" = every column, else one column

  function loadView() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); } catch (e) { raw = null; }
    const o = raw && typeof raw === "object" ? raw : {};
    view.filter = o.filter === "available" || o.filter === "coming" ? o.filter : "stock";
    view.mode = o.mode === "cards" ? "cards" : "table";
    view.sort = C.normalizeSortPref(o.sort, null);
    view.cols = C.normalizeColumnFilters(o.cols);
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* fine */ } }
  function copyBtn(value, what) { return C.makeCopyButton(document, { value: value, what: what, className: "s-plain-btn" }); }
  function funnel() {
    const svg = document.createElementNS(SVG_NS, "svg");
    const a = { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" };
    for (const k in a) svg.setAttribute(k, a[k]);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M3 5h18l-7 8v6l-4-2v-4z");
    svg.appendChild(p);
    return svg;
  }
  function fig(label, value, fmt) {
    const s = el("span", "ctm-fig");
    const cls = value == null ? "ctm-fig-v ctm-blank" : fmt === "pct" && value < 0 ? "ctm-fig-v ctm-neg" : "ctm-fig-v";
    s.append(el("span", "ctm-fig-l", label), el("b", cls, C.fmtCatalog(value, fmt)));
    return s;
  }
  // Title (2 lines, clamped) with its copy button at the end, then ASIN · MSKU, each with one.
  function nameBlock(r, cls) {
    const name = el("div", cls);
    const line = el("div", "ctm-tline");
    const a = el("a", "ctm-title", r.title || r.asin);
    a.href = "https://www.amazon.com/dp/" + encodeURIComponent(r.asin);
    a.target = "_blank";
    a.rel = "noopener";
    line.append(a);
    if (r.title) line.append(copyBtn(r.title, "title"));
    const ids = el("div", "ctm-ids");
    const asin = el("span", "ctm-id");
    asin.append(el("span", "ctm-id-v", r.asin), copyBtn(r.asin, "ASIN"));
    ids.append(asin);
    if (r.sku) {
      ids.append(el("span", "ctm-id-sep", "·"));
      const sku = el("span", "ctm-id ctm-id-sku");
      sku.append(el("span", "ctm-id-v", r.sku), copyBtn(r.sku, "MSKU"));
      ids.append(sku);
    }
    name.append(line, ids);
    return name;
  }
  function thumb(r, cls) {
    const src = C.thumbFromPayload(r.thumb);
    if (!src) return el("span", cls + " ctm-img-none");
    const img = el("img", cls);
    img.loading = "lazy";
    img.alt = "";
    img.src = src;
    return img;
  }

  function card(r) {
    const c = el("div", "ctm-row");
    const top = el("div", "ctm-top");
    top.append(thumb(r, "ctm-img"), nameBlock(r, "ctm-name"));
    c.append(top);
    const stock = el("div", "ctm-figs");
    stock.append(fig("Available", r.avail, "int"), fig("FC transfer", r.fcTransfer, "int"), fig("Inbound", r.inbound, "int"), fig("Ordered", r.ordered, "int"));
    const sales = el("div", "ctm-figs");
    sales.append(fig("Sold 30d", r.units30, "int"), fig("BB margin", r.bbMargin, "pct"), fig("My price", r.myPrice, "money"));
    c.append(stock, sales);
    return c;
  }

  // ---------------------------------------------------------------- table (B-1041)

  function tableEl(list) {
    const t = el("table", "ctm-table");
    t.setAttribute("aria-label", "Catalog");
    const head = el("thead");
    const hr = el("tr");
    for (const c of C.CATALOG_COLUMNS) {
      const th = el("th", c.type === "text" ? "ctm-th ctm-th-prod" : "ctm-th num");
      th.scope = "col";
      th.setAttribute("aria-sort", C.ariaSort(view.sort, c.key));
      const inner = el("span", "ctm-th-in");
      const b = el("button", "ctm-sort s-plain-btn", c.label);
      b.type = "button";
      b.dataset.key = c.key;
      b.title = C.columnTip(c, data && data.tips) + " - tap to sort";
      const arrow = C.sortArrow(view.sort, c.key);
      if (arrow) b.append(el("span", "ctm-arrow", " " + arrow));
      const f = el("button", "ctm-filt s-plain-btn");
      f.type = "button";
      f.dataset.key = c.key;
      const on = !!view.cols[c.key];
      f.classList.toggle("is-on", on);
      f.setAttribute("aria-pressed", String(on));
      f.setAttribute("aria-label", "Filter " + c.label);
      f.append(funnel());
      inner.append(b, f);
      th.append(inner);
      hr.append(th);
    }
    head.append(hr);
    const body = el("tbody");
    for (const r of list) {
      const tr = el("tr", "ctm-trow");
      const td = el("td", "ctm-tprod");
      const box = el("div", "ctm-tp");
      box.append(thumb(r, "ctm-timg"), nameBlock(r, "ctm-tname"));
      td.append(box);
      tr.append(td);
      for (const c of C.CATALOG_COLUMNS) {
        if (c.type === "text") continue;
        const v = r[c.key];
        const cell = el("td", "num", C.fmtCatalog(v, c.fmt));
        if (v == null) cell.classList.add("ctm-blank");
        else if (c.fmt === "pct" && v < 0) cell.classList.add("ctm-neg");
        tr.append(cell);
      }
      body.append(tr);
    }
    t.append(head, body);
    return t;
  }

  // ---------------------------------------------------------------- filter panel (B-1043)

  function drawPanel() {
    const p = $("ctmPanel");
    const btn = $("ctmFilterBtn");
    btn.setAttribute("aria-expanded", String(panelKey === "*"));
    if (panelKey == null) { p.hidden = true; p.replaceChildren(); return; }
    const cols = panelKey === "*" ? C.CATALOG_COLUMNS : C.CATALOG_COLUMNS.filter((c) => c.key === panelKey);
    p.replaceChildren();
    p.append(el("div", "ctm-panel-title", panelKey === "*" ? "Filter by column" : "Filter " + cols[0].label));
    const inputs = [];
    for (const c of cols) {
      const row = el("div", "ctm-pf");
      row.dataset.key = c.key;
      row.append(el("span", "ctm-pf-l", c.label));
      const cur = view.cols[c.key] || {};
      const box = (ph, val, num) => {
        const i = el("input", "ctm-pf-in");
        i.type = "text";
        i.placeholder = ph;
        i.autocomplete = "off";
        i.spellcheck = false;
        if (num) i.inputMode = "decimal";
        i.value = val == null ? "" : String(val);
        i.setAttribute("aria-label", c.label + " " + ph.toLowerCase());
        i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyPanel(inputs); } });
        return i;
      };
      if (c.type === "text") {
        const i = box("Contains", cur.contains, false);
        i.classList.add("ctm-pf-wide");
        inputs.push({ key: c.key, text: i });
        row.append(i);
      } else {
        const lo = box("Min", cur.min, true), hi = box("Max", cur.max, true);
        inputs.push({ key: c.key, lo: lo, hi: hi });
        row.append(lo, hi);
      }
      p.append(row);
    }
    p.append(el("p", "ctm-panel-hint", "Both ends included; leave one blank for no limit. A blank figure (—) never matches a range."));
    const act = el("div", "ctm-panel-actions");
    const go = el("button", "primary-btn", "Apply");
    go.type = "button";
    go.addEventListener("click", () => applyPanel(inputs));
    const clear = el("button", "secondary-btn", panelKey === "*" ? "Clear all" : "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => {
      if (panelKey === "*") view.cols = {};
      else view.cols = C.setColumnFilter(view.cols, panelKey, null);
      panelKey = null;
      changed();
    });
    const close = el("button", "secondary-btn", "Close");
    close.type = "button";
    close.addEventListener("click", () => { panelKey = null; drawPanel(); });
    act.append(go, clear, close);
    p.append(act);
    p.hidden = false;
  }
  function applyPanel(inputs) {
    let cols = view.cols;
    for (const i of inputs) cols = C.setColumnFilter(cols, i.key, i.text ? { contains: i.text.value } : { min: i.lo.value, max: i.hi.value });
    view.cols = cols;
    panelKey = null;
    changed();
  }
  function changed() {
    limit = PAGE;
    saveView();
    drawPanel();
    drawList(true);
  }

  function drawChips() {
    const box = $("ctmChips");
    const chips = C.activeFilterChips(view.cols);
    box.replaceChildren();
    box.hidden = !chips.length;
    for (const ch of chips) {
      const b = el("button", "ctm-chip s-plain-btn");
      b.type = "button";
      b.dataset.key = ch.key;
      b.setAttribute("aria-label", "Remove filter: " + ch.text);
      b.append(el("span", "ctm-chip-t", ch.text), el("span", "ctm-chip-x", "×"));
      box.append(b);
    }
    if (chips.length) {
      const all = el("button", "ctm-chip-clear s-plain-btn", "Clear all");
      all.type = "button";
      all.dataset.key = "*";
      box.append(all);
    }
  }

  function drawStatus() {
    const st = $("ctmStatus");
    const banner = $("ctmBanner");
    if (!data) {
      st.textContent = "The laptop has not sent the catalog yet - it is built on each refresh.";
      banner.hidden = true;
      return;
    }
    const rp = (data.sources || []).find((s) => s.key === "rp");
    st.textContent = (data.withStock || 0).toLocaleString("en-US") + " with stock of " + (data.total || 0).toLocaleString("en-US") + " products" +
      (rp && rp.at ? " · updated " + C.agoText(rp.at) : "") +
      (data.capped ? " · the " + (data.sent || 0).toLocaleString("en-US") + " best sellers are here, every listing is on the laptop" : "");
    const warn = C.sourceLines(data.sources || []).filter((l) => l.stale).map((l) => l.text).concat(data.notes || []);
    banner.replaceChildren.apply(banner, warn.map((t) => el("div", null, t)));
    banner.hidden = !warn.length;
  }

  function drawControls() {
    for (const b of $("ctmFilter").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.filter === view.filter));
    for (const b of $("ctmMode").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === view.mode));
    const sel = $("ctmSort");
    if (!sel.options.length) {
      for (const o of C.sortOptions()) { const op = el("option", null, o.label); op.value = o.value; sel.append(op); }
    }
    sel.value = C.sortToToken(view.sort);
    if (sel.selectedIndex < 0) sel.value = "";
    // Cards: the Sort select (a Table sorts from its headings).
    $("ctmSortWrap").hidden = view.mode !== "cards";
    const n = C.activeFilterCount(view.cols);
    $("ctmFilterBtn").textContent = n ? "Filter (" + n + ")" : "Filter";
  }

  function drawList(force) {
    const q = $("ctmSearch").value;
    const key = [dataKey, view.filter, view.mode, C.sortToToken(view.sort), JSON.stringify(view.cols), q, limit].join("|");
    if (!force && key === drawnKey) return;
    drawnKey = key;
    drawControls();
    const filter = view.filter === "available" ? C.CATALOG_FILTER_AVAILABLE : view.filter === "coming" ? C.CATALOG_FILTER_COMING : C.CATALOG_FILTER_STOCK;
    const shown = C.queryCatalog(rows, { filter: filter, query: q, hay: hay, colFilters: view.cols, sort: view.sort });
    $("ctmCount").textContent = C.catalogCountLine(shown.length, rows.length);
    drawChips();
    const list = $("ctmList");
    const wrap = $("ctmTableWrap");
    const page = shown.slice(0, limit);
    const empty = !shown.length ? el("div", "ctm-empty", rows.length ? (C.activeFilterCount(view.cols) ? "Nothing matches - remove a column filter or Clear all." : "Nothing matches.") : "No product with stock in the last catalog.") : null;
    if (view.mode === "table") {
      list.replaceChildren();
      list.hidden = !empty;
      if (empty) list.append(empty);
      const x = wrap.scrollLeft;
      wrap.replaceChildren();
      if (page.length) wrap.append(tableEl(page));
      wrap.hidden = !page.length;
      wrap.scrollLeft = x;
    } else {
      wrap.replaceChildren();
      wrap.hidden = true;
      list.hidden = false;
      list.replaceChildren.apply(list, page.map(card));
      if (empty) list.append(empty);
    }
    const more = $("ctmMore");
    more.hidden = shown.length <= limit;
    more.textContent = "Show more (" + (shown.length - limit).toLocaleString("en-US") + " left)";
  }

  function render(catalog) {
    data = catalog && typeof catalog === "object" ? catalog : null;
    const cols = (data && data.cols) || [];
    const first = data && data.rows && data.rows[0] ? data.rows[0][0] : "";
    const rp = data && (data.sources || []).find((s) => s.key === "rp");
    const key = data ? [data.sent, first, rp && rp.at, (data.sources || []).map((s) => (s.at || 0) + ":" + (s.errorAt || 0)).join(",")].join("|") : "none";
    drawStatus();
    if (key !== dataKey) {
      dataKey = key;
      rows = data && Array.isArray(data.rows) ? data.rows.map((a) => C.unpackCatalogRow(cols, a)) : [];
      hay = rows.map(C.searchText);
    }
    drawList(false);
  }

  function wire() {
    $("ctmSearch").addEventListener("input", () => { limit = PAGE; drawList(true); });
    for (const b of $("ctmFilter").querySelectorAll("button")) {
      // B-1042: one chip at a time; the one that is on, tapped again, goes back to With stock.
      b.addEventListener("click", () => {
        view.filter = b.dataset.filter === view.filter ? "stock" : b.dataset.filter;
        limit = PAGE;
        saveView();
        drawList(true);
      });
    }
    for (const b of $("ctmMode").querySelectorAll("button")) {
      b.addEventListener("click", () => { view.mode = b.dataset.mode === "cards" ? "cards" : "table"; saveView(); drawList(true); });
    }
    $("ctmSort").addEventListener("change", (e) => { view.sort = C.sortFromToken(e.target.value); limit = PAGE; saveView(); drawList(true); });
    $("ctmFilterBtn").addEventListener("click", () => { panelKey = panelKey === "*" ? null : "*"; drawPanel(); });
    // Table headings: tap = sort (low to high, high to low, off); the funnel = that column's filter.
    $("ctmTableWrap").addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t || !t.dataset.key) return;
      if (t.classList.contains("ctm-sort")) {
        view.sort = C.cycleSort(view.sort, t.dataset.key);
        saveView();
        drawList(true);
      } else if (t.classList.contains("ctm-filt")) {
        panelKey = panelKey === t.dataset.key ? null : t.dataset.key;
        drawPanel();
        if (panelKey) { const p = $("ctmPanel"); if (p.scrollIntoView) p.scrollIntoView({ block: "nearest" }); }
      }
    });
    $("ctmChips").addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t || !t.dataset.key) return;
      view.cols = t.dataset.key === "*" ? {} : C.setColumnFilter(view.cols, t.dataset.key, null);
      changed();
    });
    $("ctmMore").addEventListener("click", () => { limit += PAGE; drawList(true); });
    const r = $("ctmRefresh");
    if (r) r.addEventListener("click", () => self.ShopperRemote.sendCommand("refreshAll", { mode: "quick" }));
  }

  if (!C) {
    self.ShopperCatalogView = { render() {}, wire() {}, missing: true };
    return;
  }
  loadView();
  self.ShopperCatalogView = { render, wire };
})();
