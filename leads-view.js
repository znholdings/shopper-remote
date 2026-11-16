// remote/leads-view.js - B-2103 (v2.0.162): Tracked Leads (Sourcing) on the phone. Cards come from payload.pages.leads (the laptop page's own SHOPPER_LEADS_GET,
// thinned: 100 cards). Sorting and the filter chips are done here. Writes (each one laptop handler): leadsAdd {asin,url,cost?,origin}, leadsSetCost {asin,cost},
// leadsUntrack {asin}, leadsSendToBuylist {asin,qty}, leadsRefreshNow. DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("leadsPane");
  if (!P || !pane) return;
  var U = P.ui;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { leadsAdd: "Tracked Leads: add", leadsSetCost: "Tracked Leads: cost", leadsUntrack: "Tracked Leads: untrack", leadsSendToBuylist: "Tracked Leads: send to Buylist", leadsRefreshNow: "Tracked Leads: refresh now" });

  var data = null;
  var sig = "";
  var sort = "score";
  var flt = { minRoi: null, offers: "", hideGated: false, hideAmazon: false };
  var f = {};

  function money(v) { return v == null ? "-" : "$" + Number(v).toFixed(2); }
  function pct(v) { return v == null ? "-" : v + "%"; }
  function nz(v) { return v == null ? "-" : String(v); }
  function link(text, href) { var a = U.el("a", "", text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }

  var SORTS = [["score", "Best first (score)"], ["roiBB", "ROI at Buy Box"], ["roiFBA", "ROI at lowest FBA"], ["net", "Profit per item"], ["sold", "Sales a month"], ["offers", "Fewest offers"], ["newest", "Newest added"]];
  var CMP = {
    score: function (a, b) { return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score); },
    roiBB: function (a, b) { return (b.roiBB == null ? -1e9 : b.roiBB) - (a.roiBB == null ? -1e9 : a.roiBB); },
    roiFBA: function (a, b) { return (b.roiFBA == null ? -1e9 : b.roiFBA) - (a.roiFBA == null ? -1e9 : a.roiFBA); },
    net: function (a, b) { return (b.netProfit == null ? -1e9 : b.netProfit) - (a.netProfit == null ? -1e9 : a.netProfit); },
    sold: function (a, b) { return (b.sold == null ? -1 : b.sold) - (a.sold == null ? -1 : a.sold); },
    offers: function (a, b) { return (a.offers == null ? 1e9 : a.offers) - (b.offers == null ? 1e9 : b.offers); },
    newest: function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); }
  };
  function visible() {
    return (data.rows || []).filter(function (r) {
      if (flt.minRoi != null && !(r.roiBB != null && r.roiBB >= flt.minRoi)) return false;
      if (flt.offers === "falling" && !(r.offersTrend30 && r.offersTrend30.dir === "down")) return false;
      if (flt.offers === "rising" && !(r.offersTrend30 && r.offersTrend30.dir === "up")) return false;
      if (flt.hideGated && r.gated === true) return false;
      if (flt.hideAmazon && r.amazon === true) return false;
      return true;
    }).sort(CMP[sort] || CMP.score);
  }

  function cells(r) {
    var t = function (x) { return x ? x.text : "-"; };
    var src = r.srcChange ? (r.srcChange.delta === 0 ? "same" : (r.srcChange.delta > 0 ? "▲ " : "▼ ") + money(Math.abs(r.srcChange.delta)) + " (" + r.srcChange.pct + "%)") : "-";
    return [
      "Cost " + money(r.cost) + (r.costTyped ? " (typed)" : r.packNote ? " (" + r.packNote + ")" : ""),
      "Buy Box " + money(r.bb) + " · lowest FBA " + money(r.lowFba),
      "At Buy Box: ROI " + pct(r.roiBB) + " · margin " + pct(r.marginBB),
      "At lowest FBA: ROI " + pct(r.roiFBA) + " · margin " + pct(r.marginFBA),
      "Profit per item " + money(r.netProfit) + " · sales/mo " + nz(r.sold) + (r.share != null ? " (about " + r.share + " to you, rough)" : ""),
      "Offers " + nz(r.offers) + " · 15 days " + t(r.offersTrend15) + " · 30 days " + t(r.offersTrend30) + " · FBA " + nz(r.fbaCount) + " / FBM " + nz(r.fbmCount),
      "Amazon on listing: " + (r.amazon == null ? "-" : r.amazon ? "yes" : "no") + " · gated: " + (r.gated == null ? "-" : r.gated ? "yes" : "no"),
      "Rank " + nz(r.bsr) + (r.bsrChange30 == null ? "" : r.bsrChange30 > 0 ? " (30 days: " + r.bsrChange30 + "% worse)" : r.bsrChange30 < 0 ? " (30 days: " + (-r.bsrChange30) + "% better)" : " (30 days: same)"),
      "Buy Box 90-day average " + money(r.bbAvg90) + " · source price since tracked " + src
    ];
  }

  function card(r) {
    var c = U.el("div", "line pg-card pg-ld-row" + (r.blocked ? " pg-ld-off" : ""));
    var t = U.el("div", "");
    if (r.score != null) t.appendChild(U.el("b", "pg-cp-score", r.score + " "));
    t.appendChild(doc.createTextNode(String(r.title || r.asin)));
    c.appendChild(t);
    var tags = [r.asin].concat(r.tags || []);
    if (r.blocked) tags.push("on your Blacklist");
    if (r.inCatalog) tags.push("now in your catalog");
    if (r.sentAt) tags.push("On buylist ×" + (r.sentQty || "?"));
    c.appendChild(U.el("div", "muted small", tags.join(" · ")));
    { var mb = !r.url && root.ShopperMatchBlock ? root.ShopperMatchBlock.block(r.asin, r.match) : null; if (mb) c.appendChild(mb); } // B-2108: no link yet -> what Auto-find sources found
    cells(r).forEach(function (line) { c.appendChild(U.el("div", "small", line)); });
    var links = U.el("div", "pg-cp-links small");
    links.appendChild(link("A", "https://www.amazon.com/dp/" + r.asin));
    links.appendChild(link("K", "https://keepa.com/#!product/1-" + r.asin));
    links.appendChild(link("G", "https://www.google.com/search?q=" + encodeURIComponent(String(r.title || r.asin).slice(0, 120))));
    if (r.url) links.appendChild(link("Source", r.url));
    c.appendChild(links);
    var acts = U.el("div", "pg-row");
    if (r.costState === "ask" || r.costState === "reading") {
      c.appendChild(U.el("div", "small pg-cp-why", r.costState === "reading" ? "Reading the store page..." : "Cost not read - enter it."));
      var cost = U.input("text", { placeholder: "Enter cost", inputmode: "decimal" });
      var sc = U.btn("Save cost", "mini-btn", function () { var v = cost.value.trim(); if (!v) { U.toast("Type the cost first.", true); return; } U.send("leadsSetCost", { asin: r.asin, cost: v }, sc).then(function (res) { U.say(res, "Cost saved"); }); });
      acts.appendChild(cost); acts.appendChild(sc);
    }
    var sb = U.btn("Send to Buylist", "mini-btn", function () {
      var q = root.prompt ? root.prompt("How many of " + r.asin + " for the Buylist? (1 to 9999)", "1") : null;
      if (q == null) return;
      var n = Math.round(Number(q));
      if (!(n >= 1 && n <= 9999)) { U.toast("Type a number from 1 to 9999.", true); return; }
      U.send("leadsSendToBuylist", { asin: r.asin, qty: n }, sb).then(function (res) { U.say(res, "Sent to the Buylist"); });
    });
    sb.disabled = !!r.blocked;
    acts.appendChild(sb);
    var ut = U.btn("Untrack", "danger-btn", function () { U.confirmSend("Stop tracking " + r.asin + "?", "leadsUntrack", { asin: r.asin }, ut, "Untracked"); });
    acts.appendChild(ut);
    c.appendChild(acts);
    return c;
  }

  function addBox() {
    var s = U.section("Add a lead");
    f.asin = U.input("text", { placeholder: "ASIN (B0...)", autocapitalize: "characters", maxlength: "10" });
    f.url = U.input("url", { placeholder: "Source URL (or leave empty - Shopper looks overnight)" });
    f.cost = U.input("text", { placeholder: "Cost per item (optional)", inputmode: "decimal" });
    s.appendChild(U.field("ASIN", f.asin)); s.appendChild(U.field("Source URL", f.url)); s.appendChild(U.field("Cost (only if the page can't be read)", f.cost));
    var b = U.btn("+ Add lead", "primary-btn", function () {
      var a = f.asin.value.trim(), u = f.url.value.trim();
      if (!a) { U.toast("Type the ASIN.", true); return; }
      U.send("leadsAdd", { asin: a, url: u, cost: f.cost.value.trim() || null, origin: "hand" }, b).then(function (res) { U.say(res, "Tracked"); if (res.ok) { f.asin.value = ""; f.url.value = ""; f.cost.value = ""; } });
    });
    s.appendChild(b);
    return s;
  }

  function chips() {
    var s = U.section("Sort and filter");
    var so = U.select(SORTS); so.value = sort; so.addEventListener("change", function () { sort = so.value; draw(); });
    s.appendChild(U.field("Sort by", so));
    var row = U.el("div", "pg-row");
    function chip(label, on, fn) { var b = U.btn(label, on ? "primary-btn" : "mini-btn", function () { fn(); draw(); }); row.appendChild(b); }
    chip("ROI 30%+", flt.minRoi === 30, function () { flt.minRoi = flt.minRoi === 30 ? null : 30; });
    chip("Offers falling", flt.offers === "falling", function () { flt.offers = flt.offers === "falling" ? "" : "falling"; });
    chip("Offers rising", flt.offers === "rising", function () { flt.offers = flt.offers === "rising" ? "" : "rising"; });
    chip("Hide gated", flt.hideGated, function () { flt.hideGated = !flt.hideGated; });
    chip("Hide Amazon", flt.hideAmazon, function () { flt.hideAmazon = !flt.hideAmazon; });
    s.appendChild(row);
    return s;
  }

  function draw() {
    pane.textContent = "";
    if (!data) { pane.appendChild(U.el("p", "muted small pg-sec", "Tracked Leads load from the computer...")); return; }
    var st = data.status || {};
    var head = U.section("");
    head.appendChild(U.el("p", "muted small", (data.total || 0) + " leads · last read " + (st.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : "never") + " · next " + (st.nextSlot || "-") + " Central · " + (st.tokensToday || 0) + " of " + (st.cap || 0) + " Keepa tokens used today"));
    if (st.noCredentials) head.appendChild(U.el("p", "small pg-cp-why", "Amazon is not connected on the main computer - the live Buy Box and offers are not being read."));
    if (st.keepaUsedUp) head.appendChild(U.el("p", "small pg-cp-why", "Keepa numbers are from " + (st.keepaAt ? new Date(st.keepaAt).toLocaleString() : "an earlier read") + " - today's lead tokens are used."));
    var rb = U.btn("Refresh now", "mini-btn", function () { U.send("leadsRefreshNow", {}, rb).then(function (res) { U.say(res, "Started"); }); });
    head.appendChild(rb);
    pane.appendChild(head);
    pane.appendChild(addBox());
    pane.appendChild(chips());
    var rows = visible();
    var s = U.section("Leads (" + rows.length + (rows.length !== (data.total || 0) ? " of " + data.total : "") + ")");
    if (!rows.length) s.appendChild(U.el("p", "muted small", (data.total ? "No lead matches these filters." : "No leads yet. Add one above, or press + on a Competitor ASINs row.")));
    rows.forEach(function (r) { s.appendChild(card(r)); });
    pane.appendChild(s);
  }

  function render(p) {
    var d = U.pageData(p, "leads");
    var s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    data = d;
    draw();
  }

  draw();
  P.register("leads", { pane: pane, render: render });
})(self);
