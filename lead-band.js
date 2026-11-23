// remote/lead-band.js - B-2242 (v2.0.182): the phone's Leads band (Source / Cost / Profit / Margin % bar / ROI bar / Sold) and the Buy Box / Lowest FBA table of a pick.
// The same scales and words as lib/lead-bars.js + sourcing/lead-strip.js (kept in step by test/v20182-b2242-lead-table.test.mjs). DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  if (!P || !P.ui) return;
  var U = P.ui;
  var MARGIN_SCALE = 100, ROI_SCALE = 200;
  var SHOPS = { walmart: "Walmart", samsclub: "Sam's Club", target: "Target", homedepot: "Home Depot" };
  function money(v) { return v == null ? "-" : "$" + Number(v).toFixed(2); }
  function barFill(v, scale) {
    if (v == null || v === "" || !isFinite(Number(v)) || !(scale > 0)) return null;
    return Math.min(1, Math.max(0, Number(v) / scale)) * 100;
  }
  function pctText(v) { return v == null || v === "" || !isFinite(Number(v)) ? "-" : Number(v).toFixed(2) + "%"; }
  function metric(label, v, scale) {
    var box = U.el("div", "pg-lt-metric");
    box.appendChild(U.el("span", "pg-lt-pct", pctText(v)));
    var track = U.el("div", "pg-lt-track"); track.setAttribute("aria-label", label + " " + pctText(v));
    var w = barFill(v, scale);
    if (w != null) { var f = U.el("div", "pg-lt-fill"); f.style.width = w + "%"; track.appendChild(f); }
    box.appendChild(track);
    return box;
  }
  function cell(label, node) { var c = U.el("div", "pg-lt-cell"); c.appendChild(U.el("span", "pg-lt-label", label)); c.appendChild(node); return c; }
  function band(li, sold) {
    var b = U.el("div", "pg-lt-band");
    b.appendChild(cell("Source", U.el("span", "pg-lt-val", SHOPS[li.retailer] || li.retailer || "-")));
    b.appendChild(cell("Cost / unit", U.el("span", "pg-lt-val", money(li.cost))));
    b.appendChild(cell("Profit / unit", U.el("span", "pg-lt-val", money(li.profit))));
    b.appendChild(cell("Margin %", metric("Margin", li.margin, MARGIN_SCALE)));
    b.appendChild(cell("ROI", metric("ROI", li.roi, ROI_SCALE)));
    b.appendChild(cell("Sold/mo", U.el("span", "pg-lt-val", sold == null ? "-" : String(sold))));
    return b;
  }
  function scenRow(name, price, profit, roi, margin, note, feesNote) {
    var tr = U.el("tr", "");
    tr.appendChild(U.el("th", "", name));
    if (price == null) { var n = U.el("td", "pg-lt-note", note || "price not read yet"); n.colSpan = 4; tr.appendChild(n); return tr; }
    tr.appendChild(U.el("td", "num", money(price)));
    if (profit == null) { var f = U.el("td", "pg-lt-note", feesNote || "profit not worked out"); f.colSpan = 3; tr.appendChild(f); return tr; }
    tr.appendChild(U.el("td", "num", money(profit)));
    tr.appendChild(U.el("td", "num", pctText(roi)));
    tr.appendChild(U.el("td", "num", pctText(margin)));
    return tr;
  }
  function feeLineText(fl) {
    if (!fl || (fl.referral == null && fl.fba == null && fl.inbound == null && !fl.note)) return "";
    var m = function (v) { return "$" + Number(v).toFixed(2); };
    var parts = [];
    if (fl.referral != null) parts.push("referral " + m(fl.referral));
    if (fl.fba != null) parts.push("FBA " + m(fl.fba));
    if (fl.inbound != null) parts.push("inbound " + m(fl.inbound));
    return "Fees: " + parts.join(" \u00b7 ") + (fl.src === "keepa" ? " (fees from Keepa)" : "") + (fl.note ? " \u00b7 " + fl.note : "");
  }
  function scenarioTable(c) {
    var e = c && (c.bestVariant || c);
    if (!c || c.notSource || !e || e.cost == null) return null;
    if (c.size !== undefined && !(c.size && c.size.ok)) return null; // B-2238: failed the size check - no money to show
    if (c.dead) return null; // B-2270: not available on the store - no money to show
    var t = U.el("table", "pg-lt-scen");
    var hd = U.el("tr", "");
    ["Scenario", "Price", "Profit", "ROI", "Margin"].forEach(function (h, i) { hd.appendChild(U.el("th", i ? "num" : "", h)); });
    var th = U.el("thead", ""); th.appendChild(hd); t.appendChild(th);
    var tb = U.el("tbody", "");
    tb.appendChild(scenRow("Buy Box", e.bbPrice, e.profitBb, e.roiBb, e.marginBb, c.bbNote, c.feesNote));
    tb.appendChild(scenRow("Lowest FBA", e.fbaPrice, e.profitFba, e.roiFba, e.marginFba, c.fbaNote, c.feesNote));
    t.appendChild(tb);
    var ft = feeLineText(c.fees); // B-2271: the same words as lib/inbound-cost.js feeLineText (pinned by test)
    if (ft) { var tf = U.el("tfoot", ""); var fr = U.el("tr", ""); var fd = U.el("td", "pg-lt-note", ft); fd.colSpan = 5; fr.appendChild(fd); tf.appendChild(fr); t.appendChild(tf); }
    return t;
  }
  // B-2245: a table from plain rows [{ name, price, profit, roi, margin, note, feesNote }] (Tracked Leads: Buy Box / Lowest FBA / At your price)
  function rowsTable(rows) {
    var t = U.el("table", "pg-lt-scen");
    var hd = U.el("tr", "");
    ["Scenario", "Price", "Profit", "ROI", "Margin"].forEach(function (h, i) { hd.appendChild(U.el("th", i ? "num" : "", h)); });
    var th = U.el("thead", ""); th.appendChild(hd); t.appendChild(th);
    var tb = U.el("tbody", "");
    rows.forEach(function (r) { tb.appendChild(scenRow(r.name, r.price, r.profit, r.roi, r.margin, r.note, r.feesNote)); });
    t.appendChild(tb);
    return t;
  }
  root.ShopperLeadBand = { MARGIN_SCALE: MARGIN_SCALE, ROI_SCALE: ROI_SCALE, barFill: barFill, pctText: pctText, band: band, scenarioTable: scenarioTable, rowsTable: rowsTable };
})(self);
