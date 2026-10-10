// remote/catalog-view.js - B-1023 (v2.0.49): the phone's "Catalog" tab.
//
// The laptop's Catalog on the phone, read-only: the products WITH STOCK
// (the laptop sends the best sellers first, capped - lib/catalog.js
// projectCatalogForRemote), a search box and a filter. Owns no rules: search,
// filter, order and how a figure is written are lib/catalog-view.js, wrapped
// unchanged in catalog-lib.js. "Refresh" is the laptop's own Quick refresh
// (the refreshAll command every other tab uses).
(function () {
  "use strict";
  const C = self.ShopperCatalog;
  const $ = (id) => document.getElementById(id);
  const VIEW_KEY = "shopperCatalogPhoneView";
  const PAGE = 80;
  const view = { filter: "stock" };
  try { Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY) || "{}")); } catch (e) { /* defaults */ }
  let data = null; // the payload's catalog
  let rows = [];
  let hay = [];
  let dataKey = "";
  let drawnKey = "";
  let limit = PAGE;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* fine */ } }
  function fig(label, value, fmt) {
    const s = el("span", "ctm-fig");
    const cls = value == null ? "ctm-fig-v ctm-blank" : fmt === "pct" && value < 0 ? "ctm-fig-v ctm-neg" : "ctm-fig-v";
    s.append(el("span", "ctm-fig-l", label), el("b", cls, C.fmtCatalog(value, fmt)));
    return s;
  }

  function card(r) {
    const c = el("div", "ctm-row");
    const top = el("div", "ctm-top");
    const src = C.thumbFromPayload(r.thumb);
    if (src) {
      const img = el("img", "ctm-img");
      img.loading = "lazy";
      img.alt = "";
      img.src = src;
      top.append(img);
    } else {
      top.append(el("span", "ctm-img ctm-img-none"));
    }
    const name = el("div", "ctm-name");
    const a = el("a", "ctm-title", r.title || r.asin);
    a.href = "https://www.amazon.com/dp/" + encodeURIComponent(r.asin);
    a.target = "_blank";
    a.rel = "noopener";
    name.append(a, el("div", "ctm-ids", r.asin + (r.sku ? " · " + r.sku : "")));
    top.append(name);
    c.append(top);
    const stock = el("div", "ctm-figs");
    stock.append(fig("Available", r.avail, "int"), fig("FC transfer", r.fcTransfer, "int"), fig("Inbound", r.inbound, "int"), fig("Ordered", r.ordered, "int"));
    const sales = el("div", "ctm-figs");
    sales.append(fig("Sold 30d", r.units30, "int"), fig("BB margin", r.bbMargin, "pct"), fig("My price", r.myPrice, "money"));
    c.append(stock, sales);
    return c;
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

  function drawList(force) {
    const q = $("ctmSearch").value;
    const key = dataKey + "|" + view.filter + "|" + q + "|" + limit;
    if (!force && key === drawnKey) return;
    drawnKey = key;
    for (const b of $("ctmFilter").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.filter === view.filter));
    const filter = view.filter === "available" ? C.CATALOG_FILTER_AVAILABLE : view.filter === "coming" ? C.CATALOG_FILTER_COMING : C.CATALOG_FILTER_STOCK;
    const shown = C.selectCatalogRows(rows, { filter: filter, query: q, hay: hay });
    $("ctmCount").textContent = C.catalogCountLine(shown.length, rows.length);
    const list = $("ctmList");
    list.replaceChildren.apply(list, shown.slice(0, limit).map(card));
    if (!shown.length) list.append(el("div", "ctm-empty", rows.length ? "Nothing matches." : "No product with stock in the last catalog."));
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
      b.addEventListener("click", () => { view.filter = b.dataset.filter; limit = PAGE; saveView(); drawList(true); });
    }
    $("ctmMore").addEventListener("click", () => { limit += PAGE; drawList(true); });
    const r = $("ctmRefresh");
    if (r) r.addEventListener("click", () => self.ShopperRemote.sendCommand("refreshAll", { mode: "quick" }));
  }

  if (!C) {
    self.ShopperCatalogView = { render() {}, wire() {}, missing: true };
    return;
  }
  self.ShopperCatalogView = { render, wire };
})();
