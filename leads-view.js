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
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { leadsAdd: "Tracked Leads: add", leadsSetCost: "Tracked Leads: cost", leadsSetSalePrice: "Tracked Leads: sale price", leadsUntrack: "Tracked Leads: untrack", leadsSendToBuylist: "Tracked Leads: send to Buylist", leadsRefreshNow: "Tracked Leads: refresh now" });

  var data = null;
  var sig = "";
  var sort = "score";
  var flt = { minRoi: null, offers: "", hideGated: false, hideAmazon: false };
  var f = {};
  var SB = root.ShopperSourcingSearch; // B-2288
  var sbar = SB ? SB.bar(pane, { units: "#leadsPane .pg-ld-row", placeholder: "ASIN, brand, product, store", cut: function () { return !!(data && data.total > (data.rows || []).length); } }) : null;

  var SHOPNAME = { walmart: "Walmart", samsclub: "Sam's Club", target: "Target", homedepot: "Home Depot" };
  // B-2290: the words of lib/lead-blank-words.js - a pinned copy (the phone cannot import a module); test/v20196-b2290-*.test.mjs keeps the two equal
  var W = {
    NOT_READ: "not read yet", NO_COST: "cost not read yet", NO_FEES: "Amazon fees not read yet", NO_PRICE: "no price to work from - add a Desired sale price",
    bbNote: function (r) { return r.offersAt ? "no Buy Box right now" : "not read yet"; },
    fbaNote: function (r) { return r.offersAt && r.fbaCount === 0 ? "no FBA seller" : r.offersAt ? "no FBA price" : "not read yet"; },
    noPrice: function (r) { var avgOk = !(r.alt && r.alt.avg && r.alt.avg.stale); return [r.bb, r.lowFba, r.lowNew, avgOk ? r.bbAvg90 : null, avgOk ? r.bbAvg30 : null, r.salePrice].every(function (v) { return v == null; }); }, // B-2292 (a) / B-2296: a stale average is not a price // B-2292 (a)
    feesNote: function (r) { return r.cost == null ? (r.packNeeded === true && r.amzPack && r.costState !== "ask" && r.costState !== "reading" ? "type the store pack on the desktop to see the cost" : "cost not read yet") : r.feesMissing ? (r.feesErr === "403" ? "Amazon refused the fee read" : r.feesErr ? "Amazon gave no fee estimate (" + r.feesErr + ")" : W.noPrice(r) ? W.NO_PRICE : "Amazon fees not read yet") : null; }, // B-2307
    scenario: { low: "at lowest offer", avg90: "at 90-day average", avg30: "at 30-day average", sp: "at your price" },
    ageWords: function (h) { return h && (h.scenario === "avg90" || h.scenario === "avg30") && Number(h.ageDays) >= 2 ? ", " + Math.floor(Number(h.ageDays)) + " days old" : ""; } // B-2296: a Buy Box average 2+ days old says so
  };
  function soldText(r) { return r.sold == null ? "-" : r.soldEst ? "~" + r.sold : String(r.sold); } // B-2290: "~N" = estimated from rank drops
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

  // B-2245: the meta line (same bits as the desktop table: ASIN, rank, offers, FBA/FBM, Amazon, gated, tags, Blacklist, catalog, On buylist)
  function metaBits(r) {
    var t = function (x) { return x ? x.text : "-"; };
    var bits = [r.asin];
    if (r.bsr != null) bits.push("rank " + r.bsr + (r.bsrChange30 == null ? "" : r.bsrChange30 > 0 ? " (30 days: " + r.bsrChange30 + "% worse)" : r.bsrChange30 < 0 ? " (30 days: " + (-r.bsrChange30) + "% better)" : " (30 days: same)"));
    if (r.offers != null) bits.push("offers " + r.offers + " (15 days " + t(r.offersTrend15) + " · 30 days " + t(r.offersTrend30) + ")");
    if (r.fbaCount != null || r.fbmCount != null) bits.push("FBA " + nz(r.fbaCount) + " / FBM " + nz(r.fbmCount));
    if (r.amazon) bits.push("Amazon on listing" + (r.amazonShare != null ? " (wins " + r.amazonShare + "% of the Buy Box)" : ""));
    bits.push(r.gated === true ? "gated" : r.gated === false ? "ungated" : "gating unknown");
    (r.tags || []).forEach(function (x) { bits.push(x); });
    if (r.scoreNote) bits.push(r.scoreNote); // B-2290
    if (r.blocked) bits.push("on your Blacklist");
    if (r.inCatalog) bits.push("now in your catalog");
    if (r.sentAt) bits.push("On buylist ×" + (r.sentQty || "?"));
    return bits;
  }
  function factsLine(r) {
    var out = [];
    if (r.costTyped || r.packNote || r.packNeeded || r.amzPack) out.push("cost " + (r.costTyped ? "typed by you" : [r.packNeeded ? "store pack not read (type it on the desktop)" : r.packNote, r.amzPack ? "\u00d7" + r.amzPack.n + ": Amazon " + r.amzPack.n + "-pk" : ""].filter(Boolean).join(" \u00b7 ")));
    if (r.srcChange) out.push("source price since tracked " + (r.srcChange.delta === 0 ? "same" : (r.srcChange.delta > 0 ? "▲ " : "▼ ") + money(Math.abs(r.srcChange.delta)) + " (" + r.srcChange.pct + "%)") + ", was " + money(r.srcChange.was));
    if (r.bbAvg90 != null || r.bbAvg30 != null) out.push("Buy Box 90-day average " + money(r.bbAvg90) + (r.bbAvg30 != null ? " · 30-day " + money(r.bbAvg30) : ""));
    return out.join(" · ");
  }
  function scenRows(r) {
    var alt = { low: (r.alt && r.alt.low) || {}, avg: (r.alt && r.alt.avg) || {} };
    var noCost = W.feesNote(r); // B-2290: "cost not read yet" or "Amazon fees not read yet"
    var rows = [{ name: "Buy Box", price: r.bb, profit: r.profitBB, roi: r.roiBB, margin: r.marginBB, note: W.bbNote(r), feesNote: noCost }, { name: "Lowest FBA", price: r.lowFba, profit: r.profitFBA, roi: r.roiFBA, margin: r.marginFBA, note: W.fbaNote(r), feesNote: noCost }];
    if (r.lowNew != null && r.lowNew !== r.bb && r.lowNew !== r.lowFba) rows.push({ name: "Lowest offer", price: r.lowNew, profit: alt.low.profit, roi: alt.low.roi, margin: alt.low.margin, feesNote: noCost }); // B-2290
    if (alt.avg.price != null) rows.push({ name: (alt.avg.days === 30 ? "30-day avg" : "90-day avg") + (alt.avg.ageDays >= 2 ? " (" + Math.floor(alt.avg.ageDays) + "\u00a0d\u00a0old)" : ""), price: alt.avg.price, profit: alt.avg.profit, roi: alt.avg.roi, margin: alt.avg.margin, feesNote: noCost }); // B-2290
    if (r.salePrice != null) rows.push({ name: "At your price", price: r.salePrice, profit: r.profitSP, roi: r.roiSP, margin: r.marginSP, feesNote: noCost });
    return rows;
  }

  // B-2289: "Suggested 12 · 21-day test" with the Why lines under a tap; no suggestion -> the one reason line
  function suggestLine(c, r) {
    var s = r.suggest;
    if (!s) return;
    if (!s.qty) { var nd = U.el("div", "muted small pg-ld-sug", "No suggestion: " + ((s.why && s.why[0]) || "not enough data")); nd.setAttribute("data-nosearch", "1"); c.appendChild(nd); return; } // B-2296: boilerplate is not a search word
    var d = U.el("details", "pg-ld-sug");
    d.setAttribute("data-nosearch", "1");
    d.appendChild(U.el("summary", "muted small", "Suggested " + s.qty + " \u00b7 " + s.days + "-day test - why?"));
    var ul = U.el("ul", "muted small pg-ld-sug-why");
    (s.why || []).forEach(function (w) { ul.appendChild(U.el("li", "", w)); });
    d.appendChild(ul);
    c.appendChild(d);
  }
  // B-2308: the answer next to the Save button (the toast is easy to miss); kept 4 s through a redraw
  var sendingNow = {}; // B-2327: ASINs whose Send to Buylist is running (a redraw keeps their button off)
  var savedMap = {};
  function savedSpan(asin, kind) {
    var k = asin + "|" + kind, v = savedMap[k], sp = U.el("span", "small pg-ld-saved" + (v && v.warn ? " pg-ld-saved-warn" : ""), v && v.until > Date.now() ? v.text : "");
    sp.setAttribute("aria-live", "polite"); sp.setAttribute("data-kind", kind); sp.setAttribute("data-nosearch", "1");
    sp.style.display = "inline-block"; sp.style.minWidth = "5rem";
    return sp;
  }
  function flash(sp, asin, kind, res, cleared) {
    var bad = !res || res.ok === false, text = bad ? String((res && (res.reason || res.error)) || "That did not work.").slice(0, 120) : cleared ? "Cleared \u2713" : "Saved \u2713";
    var k = asin + "|" + kind; savedMap[k] = { text: text, warn: bad, until: Date.now() + 4000 };
    sp.textContent = text; sp.className = "small pg-ld-saved" + (bad ? " pg-ld-saved-warn" : "");
    if (typeof setTimeout === "function") setTimeout(function () { if (savedMap[k] && savedMap[k].until <= Date.now()) { delete savedMap[k]; } sp.textContent = ""; }, 4050);
  }
  function card(r) {
    var c = U.el("div", "line pg-card pg-ld-row" + (r.blocked ? " pg-ld-off" : ""));
    c.setAttribute("data-search", [r.brand, r.url, r.retailer, SHOPNAME[r.retailer]].filter(Boolean).join(" ")); // B-2288: hidden search words
    var t = U.el("div", "");
    if (r.score != null) t.appendChild(U.el("b", "pg-cp-score", r.score + " "));
    t.appendChild(doc.createTextNode(String(r.title || r.asin)));
    c.appendChild(t);
    c.appendChild(U.el("div", "muted small pg-ld-meta", metaBits(r).join(" · ")));
    if (r.offer && r.offer.sku) c.appendChild(U.el("div", (r.offer.warn ? "warn-text" : "muted") + " small pg-ld-offer", r.offer.warn ? "⚠ Existing SKU " + r.offer.sku + " reused" : "Offer " + r.offer.sku + " created")); // B-2327: the last Send to Buylist's Amazon offer
    var h = r.headline || null, LB = root.ShopperLeadBand;
    if (LB) c.appendChild(LB.band({ retailer: r.url ? (r.retailer || "Store") : "No source yet", cost: r.cost, profit: h ? h.profit : null, margin: h ? h.margin : null, roi: h ? h.roi : null }, soldText(r))); // B-2245: the B-2242 band from the headline (lower-profit scenario)
    { var sw = h && W.scenario[h.scenario] ? W.scenario[h.scenario] + W.ageWords(h) : ""; if (sw) c.appendChild(U.el("div", "muted small pg-ld-scen", "Profit " + sw)); else if (!h && r.feesMissing && W.noPrice(r)) c.appendChild(U.el("div", "muted small pg-ld-scen", W.NO_PRICE)); } // B-2292 (a) // B-2290: says which price the headline used
    if (r.soldEst) c.appendChild(U.el("div", "muted small pg-ld-scen", "Sold/mo est. from rank drops (30 days)")); // B-2290: parity with the desktop sold cell
    suggestLine(c, r); // B-2289
    { var mb = (!r.url || r.plan) && root.ShopperMatchBlock ? root.ShopperMatchBlock.block(r.asin, r.match) : null; if (mb) c.appendChild(mb); } // B-2108: no link yet -> what Auto-find sources found
    if (LB) c.appendChild(LB.rowsTable(scenRows(r)));
    var fl = factsLine(r); if (fl) c.appendChild(U.el("div", "muted small pg-ld-facts", fl));
    var links = U.el("div", "pg-cp-links small");
    links.appendChild(link("A", "https://www.amazon.com/dp/" + r.asin));
    links.appendChild(link("K", "https://keepa.com/#!product/1-" + r.asin));
    links.appendChild(link("G", "https://www.google.com/search?q=" + encodeURIComponent(String(r.title || r.asin).slice(0, 120))));
    if (r.url) links.appendChild(link("Source", r.url));
    c.appendChild(links);
    var acts = U.el("div", "pg-row");
    if (r.costState === "ask" || r.costState === "reading") c.appendChild(U.el("div", "small pg-cp-why", r.costState === "reading" ? "Reading the store page..." : "Cost not read - enter it."));
    { // B-2313: the cost box is always there; blank + Save clears the typed cost
      var cost = U.input("text", { placeholder: r.costTyped ? "Cost per item" : r.cost != null ? "Cost (read $" + Number(r.cost).toFixed(2) + ")" : "Enter cost", inputmode: "decimal" });
      if (r.costTyped && r.cost != null) cost.value = String(r.cost);
      var csv = savedSpan(r.asin, "cost");
      var sc = U.btn("Save cost", "mini-btn", function () { var v = cost.value.trim(); U.send("leadsSetCost", { asin: r.asin, cost: v || null }, sc).then(function (res) { flash(csv, r.asin, "cost", res, !v); U.say(res, v ? "Cost saved" : "Cost cleared"); }); });
      acts.appendChild(cost); acts.appendChild(sc); acts.appendChild(csv);
    }
    var sale = U.input("text", { placeholder: "Desired sale price", inputmode: "decimal" }); // B-2135: empty + Save clears it
    if (r.salePrice != null) sale.value = String(r.salePrice);
    var psv = savedSpan(r.asin, "price");
    var sp = U.btn("Save price", "mini-btn", function () { var v = sale.value.trim(); U.send("leadsSetSalePrice", { asin: r.asin, salePrice: v || null }, sp).then(function (res) { flash(psv, r.asin, "price", res, /^[\s$,]*$/.test(v)); U.say(res, /^[\s$,]*$/.test(v) ? "Price cleared" : "Price saved"); }); });
    acts.appendChild(sale); acts.appendChild(sp); acts.appendChild(psv);
    var sb = U.btn("Send to Buylist", "mini-btn", function () {
      if (sendingNow[r.asin]) return; // B-2327: never two at once - it makes an Amazon offer
      var q = root.prompt ? root.prompt("How many of " + r.asin + " for the Buylist? (1 to 9999)", String(r.suggest && r.suggest.qty ? r.suggest.qty : 1)) : null;
      if (q == null) return;
      var n = Math.round(Number(q));
      if (!(n >= 1 && n <= 9999)) { U.toast("Type a number from 1 to 9999.", true); return; }
      if (sendingNow[r.asin]) return;
      sendingNow[r.asin] = true;
      U.send("leadsSendToBuylist", { asin: r.asin, qty: n }, sb).then(function (res) {
        delete sendingNow[r.asin];
        var ans = res && res.result && typeof res.result === "object" ? res.result : null;
        if (res && res.ok && ans && ans.offerWarn) U.toast(String(ans.offerWarn) + " Sent to the Buylist.", true); // B-2327: the warning leads the text, in the warning style
        else U.say(res, ans && ans.offerSku && ans.offerMade ? "Sent to the Buylist - offer " + ans.offerSku + " created" : "Sent to the Buylist");
      });
    });
    sb.disabled = !!r.blocked || !!sendingNow[r.asin];
    if (sendingNow[r.asin]) sb.textContent = "Working...";
    acts.appendChild(sb);
    var ut = U.btn("Untrack", "danger-btn", function () { U.confirmSend("Stop tracking " + r.asin + "?", "leadsUntrack", { asin: r.asin }, ut, "Untracked"); });
    acts.appendChild(ut);
    c.appendChild(acts);
    return c;
  }

  function addBox() {
    var s = U.section("Add a lead");
    f.asin = U.input("text", { placeholder: "ASIN (B0...)", autocapitalize: "characters", maxlength: "10" });
    f.url = U.input("url", { placeholder: "Source URL (or leave empty - Shopper looks in the morning)" });
    f.cost = U.input("text", { placeholder: "Cost per item (optional)", inputmode: "decimal" });
    f.sale = U.input("text", { placeholder: "Desired Sale Price (optional)", inputmode: "decimal" }); // B-2135
    s.appendChild(U.field("ASIN", f.asin)); s.appendChild(U.field("Source URL", f.url)); s.appendChild(U.field("Cost (only if the page can't be read)", f.cost)); s.appendChild(U.field("Desired Sale Price (optional)", f.sale));
    var b = U.btn("+ Add lead", "primary-btn", function () {
      var a = f.asin.value.trim(), u = f.url.value.trim();
      if (!a) { U.toast("Type the ASIN.", true); return; }
      U.send("leadsAdd", { asin: a, url: u, cost: f.cost.value.trim() || null, salePrice: f.sale.value.trim() || null, origin: "hand" }, b).then(function (res) { U.say(res, "Tracked"); if (res.ok) { f.asin.value = ""; f.url.value = ""; f.cost.value = ""; f.sale.value = ""; } });
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
    if (sbar) sbar.remember(); // B-2288: the search box keeps its focus across the wipe
    pane.textContent = "";
    if (!data) { pane.appendChild(U.el("p", "muted small pg-sec", "Tracked Leads load from the computer...")); return; }
    var st = data.status || {};
    var head = U.section("");
    head.appendChild(U.el("p", "muted small", (data.total || 0) + " leads · last read " + (st.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : "never") + " · next " + (st.nextSlot || "-") + " Central · " + (st.tokensToday || 0) + " of " + (st.cap || 0) + " Keepa tokens used today"));
    if (st.noCredentials) head.appendChild(U.el("p", "small pg-cp-why", "Amazon is not connected on the main computer - the live Buy Box and offers are not being read."));
    if (st.keepaUsedUp) head.appendChild(U.el("p", "small pg-cp-why", "Keepa numbers are from " + (st.keepaAt ? new Date(st.keepaAt).toLocaleString() : "an earlier read") + " - today's lead tokens are used."));
    var rb = U.btn("Read leads now", "mini-btn", function () { U.send("leadsRefreshNow", {}, rb).then(function (res) { U.say(res, "Started"); }); });
    head.appendChild(rb);
    pane.appendChild(head);
    pane.appendChild(addBox());
    var chipsNode = chips();
    pane.appendChild(chipsNode);
    if (sbar) sbar.reattach(chipsNode); // B-2288
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
