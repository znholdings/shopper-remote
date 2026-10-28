// remote/do-next-rows-view.js - B-1500 (v2.0.104). The phone's Do next Details as
// one row per item (= dashboard/do-next-rows-view.js, as a classic script):
// NEW / CHANGED badge (with a worse/better arrow), ASIN + short title, coloured
// chips, the key figures, the reason, and a muted footer. The rows come from
// ShopperGlance.detailRowsFor (remote/dash-lib.js = lib/do-next-rows.js).
// Sets self.ShopperDoNextRows = { node(rows, opts), splitRows(rows, max), MAX_ROWS }.
(function (root) {
  "use strict";
  const MAX_ROWS = 10;

  function mk(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const clip = (t, max) => (t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t);

  // -> { shown: first max rows, more: how many were left off }
  function splitRows(rows, max) {
    const list = Array.isArray(rows) ? rows : [];
    const m = Number(max) > 0 ? Number(max) : MAX_ROWS;
    return { shown: list.slice(0, m), more: Math.max(0, list.length - m) };
  }

  // rows = detailRowsFor() output; opts = { moreWhere: "Pricing", footer: "..." } -> a <div> node.
  function node(rows, opts) {
    const o = opts || {};
    const wrap = mk("div", "dnr-wrap");
    const sp = splitRows(rows, MAX_ROWS);
    const ul = mk("ul", "dnr-list");
    for (const r of sp.shown) {
      const li = mk("li", "dnr-row" + (r.badge ? " dnr-" + r.badge.kind : ""));
      const head = mk("div", "dnr-head");
      if (r.badge) {
        if (r.badge.dir) head.append(mk("span", "dnr-dir", r.badge.dir === "worse" ? "▼" : "▲"));
        head.append(mk("span", "dnr-badge dnr-badge-" + r.badge.kind, r.badge.text));
      }
      if (r.asin) head.append(mk("span", "dnr-asin", r.asin));
      if (r.title) {
        const t = mk("span", "dnr-title", clip(r.title, 60));
        t.title = r.title;
        head.append(t);
      }
      if (r.sku) head.append(mk("span", "dnr-sku", "SKU " + r.sku));
      li.append(head);
      if (r.tags && r.tags.length) {
        const g = mk("div", "dnr-tags");
        for (const t of r.tags) g.append(mk("span", "dnr-chip dnr-chip-" + t.kind, t.text));
        li.append(g);
      }
      if (r.figures && r.figures.length) {
        const f = mk("div", "dnr-figs");
        for (const x of r.figures) f.append(mk("span", "dnr-fig", x));
        li.append(f);
      }
      if (r.reason) li.append(mk("div", "dnr-reason", r.reason));
      for (const m of r.meta || []) li.append(mk("div", "dnr-meta", m));
      if (o.rowExtra) { try { const x = o.rowExtra(r); if (x) li.append(x); } catch (e) { /* a row extra never breaks the list */ } } // B-1599 (v2.0.116): the phone's Fix button
      if (r.link && /^https:\/\//.test(r.link.url)) {
        const a = mk("a", "dnr-link", r.link.label);
        a.href = r.link.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        li.append(a);
      }
      ul.append(li);
    }
    if (sp.more) ul.append(mk("li", "dnr-more", "+" + sp.more + " more" + (o.moreWhere ? " on the " + o.moreWhere + " page" : "")));
    wrap.append(ul);
    if (o.footer) wrap.append(mk("div", "dnr-foot", o.footer));
    return wrap;
  }

  root.ShopperDoNextRows = Object.freeze({ node: node, splitRows: splitRows, MAX_ROWS: MAX_ROWS });
})(self);
