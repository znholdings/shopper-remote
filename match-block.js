// remote/match-block.js - B-2108 (v2.0.163): the "Source found" block on the phone (a Competitor ASINs row, a Tracked Leads card with no link).
// ShopperMatchBlock.block(asin, m) -> a node or null. m = lib/source-match-view.js matchView() (thinned). Writes: matchConfirm / matchReject {asin, url}, matchFindAgain {asin}
// (each one laptop handler). DOM API, textContent only. The same words as sourcing/source-match-block.js.
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
  function pickLine(asin, c) {
    var box = U.el("div", "pg-sm-pick");
    var head = U.el("div", "small");
    head.appendChild(U.el("b", "", (SHOP[c.retailer] || c.retailer || "Store") + " "));
    var a = U.el("a", "", c.title || "the listing"); a.href = c.url; a.target = "_blank"; a.rel = "noopener"; head.appendChild(a);
    box.appendChild(head);
    var facts = ["cost per item you sell " + money(c.cost), "ROI " + (c.roi == null ? "-" : c.roi + "%")];
    var pk = packWords(c); if (pk) facts.push(pk);
    box.appendChild(U.el("div", "muted small", facts.join(" · ")));
    if (c.reason) box.appendChild(U.el("div", "muted small", c.reason));
    var acts = U.el("div", "pg-row");
    var ok = U.btn("Confirm", "mini-btn", function () { U.send("matchConfirm", { asin: asin, url: c.url }, ok).then(function (res) { U.say(res, (res && res.text) || "Saved"); }); });
    var no = U.btn("Reject", "mini-btn", function () { U.send("matchReject", { asin: asin, url: c.url }, no).then(function (res) { U.say(res, "Rejected"); }); });
    acts.appendChild(ok); acts.appendChild(no);
    box.appendChild(acts);
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
      var fa = U.btn("Find again", "mini-btn", function () { U.send("matchFindAgain", { asin: asin }, fa).then(function (res) { U.say(res, (res && res.text) || "Done"); }); });
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
