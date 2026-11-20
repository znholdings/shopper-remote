// remote/match-block.js - B-2108 (v2.0.163): the "Source found" block on the phone (a Competitor ASINs row, a Tracked Leads card with no link).
// ShopperMatchBlock.block(asin, m) -> a node or null. m = lib/source-match-view.js matchView() (thinned). Writes: matchConfirm / matchReject {asin, url}, matchFindAgain {asin}
// (each one laptop handler). DOM API, textContent only. The same words as sourcing/source-match-block.js.
// B-2220 (v2.0.178): cost, then profit / ROI / margin at the Buy Box and at the lowest FBA (moneyLines = the desktop's, same words); a cheaper pack variant leads.
// B-2222 (v2.0.178): Reject asks why with one tap (REASONS = lib/source-match-lessons.js REJECT_REASONS, kept in step by a test); "Other" takes an optional note (120).
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  if (!P || !P.ui) return;
  var U = P.ui;
  var doc = root.document;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { matchConfirm: "Source: confirm", matchReject: "Source: reject", matchFindAgain: "Source: find again" });
  var SHOP = { walmart: "Walmart", samsclub: "Sam's Club", target: "Target", homedepot: "Home Depot" };
  function money(v) { return v == null ? "-" : "$" + Number(v).toFixed(2); }
  function packWords(c) {
    if (!c || (c.buyUnits === 1 && c.sellUnits === 1)) return "";
    return c.sellUnits === 1 ? "buy " + c.buyUnits + ", sell as 1" : c.buyUnits === 1 ? "buy 1, sell as " + c.sellUnits : "buy " + c.buyUnits + ", sell as " + c.sellUnits;
  }
  var REASONS = [["different_product", "Different product"], ["wrong_size", "Wrong size / count"], ["wrong_variant", "Wrong flavor / scent / variant"], ["packaging", "Packaging too different"], ["third_party", "Not sold by the store (3rd party)"], ["price_wrong", "Price wrong"], ["out_of_stock", "Out of stock / limited"], ["other", "Other"]];
  // B-2225: the laptop handler's answer is in res.result (pages-view send() -> { ok, started, reason, result }) - one reader for every toast
  function said(res, dflt) { return (res && res.result && res.result.text) || dflt; }
  function pct(v) { return v == null ? "-" : v + "%"; }
  function priceLine(name, price, profit, roi, margin, note, feesNote) {
    if (price == null) return name + ": " + (note || "-");
    if (profit == null) return name + " " + money(price) + ": " + (feesNote || "profit not worked out");
    return name + " " + money(price) + ": profit " + money(profit) + " \u00b7 ROI " + pct(roi) + " \u00b7 margin " + pct(margin);
  }
  function moneyLines(c) {
    var v = c && c.bestVariant ? c.bestVariant : null;
    var e = v || c;
    var out = [];
    if (c && c.notSource) {
      out.push(c.notSource);
      if (c.price != null) out.push("page price " + money(c.price));
      return out;
    }
    if (!c || (c.price == null && !v) || e.cost == null) {
      out.push("price not read yet");
      var pk0 = packWords(c); if (pk0) out.push(pk0);
    } else {
      if (v) out.push(v.label + " at " + money(v.price) + " = " + money(v.perPiece) + " each (cheaper than the single)");
      var pk = v ? "" : packWords(c);
      out.push("cost per item you sell " + money(e.cost) + (pk ? " \u00b7 " + pk : ""));
      out.push(priceLine("Buy Box", e.bbPrice, e.profitBb, e.roiBb, e.marginBb, c.bbNote, c.feesNote));
      out.push(priceLine("Lowest FBA", e.fbaPrice, e.profitFba, e.roiFba, e.marginFba, c.fbaNote, c.feesNote));
      if (v) out.push("the single on this listing: cost " + money(c.cost) + " \u00b7 ROI " + pct(c.roiBb != null ? c.roiBb : c.roiFba));
      if (v) out.push("Confirm saves this listing; choose the " + v.label + " on the first buy"); // B-2230: the URL opens on the single
    }
    if (c && c.tags && c.tags.length) out.push(c.tags.join(" \u00b7 "));
    return out;
  }
  function reasonRow(asin, c) {
    var row = U.el("div", "pg-sm-why"); row.hidden = true;
    row.appendChild(U.el("div", "small", "Why doesn't this source work?"));
    var chips = U.el("div", "pg-sm-chips");
    var noteRow = U.el("div", "pg-row"); noteRow.hidden = true;
    var box = U.input("text", { maxlength: "120", placeholder: "What was wrong? (optional)", "aria-label": "What was wrong with this source (optional)" });
    var save = U.btn("Save", "mini-btn", function () { U.send("matchReject", { asin: asin, url: c.url, reason: "other", note: box.value }, save).then(function (res) { U.say(res, said(res, "Rejected")); }); });
    noteRow.appendChild(box); noteRow.appendChild(save);
    REASONS.forEach(function (r) {
      var b = U.btn(r[1], "mini-btn pg-sm-chip", function () {
        if (r[0] === "other") { noteRow.hidden = false; box.focus(); return; }
        U.send("matchReject", { asin: asin, url: c.url, reason: r[0], note: "" }, b).then(function (res) { U.say(res, said(res, "Rejected")); });
      });
      chips.appendChild(b);
    });
    row.appendChild(chips); row.appendChild(noteRow);
    return row;
  }
  function pickLine(asin, c) {
    var box = U.el("div", "pg-sm-pick");
    var head = U.el("div", "small");
    head.appendChild(U.el("b", "", (SHOP[c.retailer] || c.retailer || "Store") + " "));
    if (!c.notSource) head.appendChild(U.el("b", "pg-cp-kind pg-cp-kind-" + (c.matchKind === "upc" ? "upc" : "close"), c.matchKind === "upc" ? "UPC match" : "Close match")); // B-2221
    var a = U.el("a", "", c.title || "the listing"); a.href = c.url; a.target = "_blank"; a.rel = "noopener"; head.appendChild(a);
    box.appendChild(head);
    moneyLines(c).forEach(function (line) { box.appendChild(U.el("div", "muted small", line)); });
    if (c.reason) box.appendChild(U.el("div", "muted small", c.reason));
    var acts = U.el("div", "pg-row");
    var ok = U.btn("Confirm", "mini-btn", function () { U.send("matchConfirm", { asin: asin, url: c.url }, ok).then(function (res) { U.say(res, said(res, "Saved")); }); });
    var why = reasonRow(asin, c);
    var no = U.btn("Reject", "mini-btn", function () { why.hidden = !why.hidden; });
    if (!c.notSource) acts.appendChild(ok);
    acts.appendChild(no);
    box.appendChild(acts);
    box.appendChild(why);
    return box;
  }
  root.ShopperMatchBlock = { block: function (asin, m) {
    if (!m) return null;
    var w = U.el("div", "pg-sm-block");
    if (m.status === "confirmed") { w.appendChild(U.el("div", "muted small", "Source saved - Shopper asks once on the first buy")); return w; }
    if (m.status === "searching") { w.appendChild(U.el("div", "muted small", "Looking for a source...")); return w; }
    if (m.status === "capped") { w.appendChild(U.el("div", "muted small", "Auto-find is waiting for tomorrow (today's matches are used).")); return w; }
    if (m.status === "nokey") { w.appendChild(U.el("div", "muted small", "Auto-find needs the Anthropic key in the Settings tab.")); return w; }
    if (m.status === "none") {
      w.appendChild(U.el("div", "muted small", "No source yet" + (m.why ? " - " + m.why : "")));
      var fa = U.btn("Find again", "mini-btn", function () { U.send("matchFindAgain", { asin: asin }, fa).then(function (res) { U.say(res, said(res, "Done")); }); });
      w.appendChild(fa);
      return w;
    }
    if (m.status !== "found" || !m.best || !m.best.url) return null;
    w.appendChild(U.el("b", "small", "Source found"));
    w.appendChild(pickLine(asin, m.best));
    var others = (m.more || []).filter(function (c) { return c && c.url; }); // review: never draw an empty (thinned-away) pick
    if (others.length) {
      var more = U.el("div", "pg-sm-more"); more.hidden = true;
      others.forEach(function (c) { more.appendChild(pickLine(asin, c)); });
      var t = U.btn("See " + others.length + " more", "mini-btn", function () { more.hidden = !more.hidden; t.textContent = more.hidden ? "See " + others.length + " more" : "Hide"; });
      w.appendChild(t); w.appendChild(more);
    }
    return w;
  } };
})(self);
