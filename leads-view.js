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
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { leadsAdd: "Tracked Leads: add", leadsSetCost: "Tracked Leads: cost", leadsSetSalePrice: "Tracked Leads: sale price", leadsUntrack: "Tracked Leads: untrack", leadsSendToBuylist: "Tracked Leads: send to Buylist", leadsUnarchive: "Tracked Leads: unarchive", leadsRefreshNow: "Tracked Leads: refresh now" });

  var data = null;
  var sig = "";
  var sort = "score";
  var flt = { minRoi: null, offers: "", hideGated: false, hideAmazon: false };
  var f = {};
  var tab = "active"; function split() { return !!(data && data.counts && Array.isArray(data.archived)); } function arch() { return split() && tab === "archived"; } // B-2411: Active / Archived tabs
  var SB = root.ShopperSourcingSearch; // B-2288
  var sbar = SB ? SB.bar(pane, { units: "#leadsPane .pg-ld-row", placeholder: "ASIN, brand, product, store", cut: function () { return !!(data && (split() ? (arch() ? data.counts.archived > (data.archived || []).length : data.counts.active > (data.rows || []).length) : data.total > (data.rows || []).length)); } }) : null;

  var SHOPNAME = { walmart: "Walmart", samsclub: "Sam's Club", target: "Target", homedepot: "Home Depot" };
  // B-2290: the words of lib/lead-blank-words.js - a pinned copy (the phone cannot import a module); test/v20196-b2290-*.test.mjs keeps the two equal
  var W = {
    NOT_READ: "not read yet", NO_COST: "cost not read yet", NO_FEES: "Amazon fees not read yet", NO_PRICE: "no price to work from - add a Desired sale price",
    bbNote: function (r) { return r.offersAt ? "no Buy Box right now" : "not read yet"; },
    fbaNote: function (r) { return r.offersAt && r.fbaCount === 0 ? "no FBA seller" : r.offersAt ? "no FBA price" : "not read yet"; },
    noPrice: function (r) { var avgOk = !(r.alt && r.alt.avg && r.alt.avg.stale); return [r.bb, r.lowFba, r.lowNew, avgOk ? r.bbAvg90 : null, avgOk ? r.bbAvg30 : null, r.salePrice].every(function (v) { return v == null; }); }, // B-2292 (a) / B-2296: a stale average is not a price // B-2292 (a)
    feesNote: function (r) { return r.cost == null ? (r.packNeeded === true && r.amzPack && r.costState !== "ask" && r.costState !== "reading" ? "type the store pack on the desktop to see the cost" : "cost not read yet") : r.feesMissing ? (r.feesErr === "403" ? "Amazon refused the fee read" : r.feesErr ? "Amazon gave no fee estimate (" + r.feesErr + ")" : W.noPrice(r) ? W.NO_PRICE : "Amazon fees not read yet") : null; }, // B-2307
    scenario: { low: "at lowest offer", avg90: "at 90-day average", avg30: "at 30-day average", sp: "at your price", ssp: "at suggested price" },
    ageWords: function (h) { return h && (h.scenario === "avg90" || h.scenario === "avg30") && Number(h.ageDays) >= 2 ? ", " + Math.floor(Number(h.ageDays)) + " days old" : ""; } // B-2296: a Buy Box average 2+ days old says so
  };
  // B-2412: the words of lib/lead-handover.js leadRunWords - a pinned copy (the phone cannot import a module); test/v20214-b2412-read-now.test.mjs keeps the two equal
  function runWords(r) {
    if (!r || !Number(r.at) || Date.now() - Number(r.at) > 65 * 60000) return "";
    var hm; try { hm = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: false }).format(new Date(Number(r.at))); } catch (e) { hm = ""; }
    var step = String(r.step || "offers");
    return "Reading now on " + (r.by || "the Main computer") + " (started " + hm + ") - " + step + (step === "store pages" ? " " + (Number(r.done) || 0) + " of " + (Number(r.of) || 0) : "");
  }
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
    return ((arch() ? data.archived : data.rows) || []).filter(function (r) {
      if (flt.minRoi != null && !(r.roiBB != null && r.roiBB >= flt.minRoi)) return false;
      if (flt.offers === "falling" && !(r.offersTrend30 && r.offersTrend30.dir === "down")) return false;
      if (flt.offers === "rising" && !(r.offersTrend30 && r.offersTrend30.dir === "up")) return false;
      if (flt.hideGated && r.gated === true) return false;
      if (flt.hideAmazon && r.amazon === true) return false;
      return true;
    }).sort(CMP[sort] || CMP.score);
  }

  // B-2424: the rows of the card's Amazon Listing list - a pinned copy of sourcing/tracked-table.js listingRows (test/v20214-b2424-lead-cards.test.mjs keeps the two equal)
  function bsrWords(r) { return String(r.bsr) + (r.bsrChange30 == null ? "" : r.bsrChange30 > 0 ? " (30 days: " + r.bsrChange30 + "% worse)" : r.bsrChange30 < 0 ? " (30 days: " + (-r.bsrChange30) + "% better)" : " (30 days: same)"); }
  function sentDay(ms) { return new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }); } // B-2411
  function listingRows(r) {
    var t = function (x) { return x ? x.text : "-"; };
    var rows = [{ k: "ASIN", parts: [{ t: r.asin }] }];
    if (r.bsr != null) rows.push({ k: "Rank", parts: [{ t: bsrWords(r) }] });
    if (r.offers != null) rows.push({ k: "Offers", parts: [{ t: r.offers + " (15 days " + t(r.offersTrend15) + " · 30 days " + t(r.offersTrend30) + ")" }] });
    if (r.fbaCount != null || r.fbmCount != null) rows.push({ k: "FBA / FBM", parts: [{ t: nz(r.fbaCount) + " / " + nz(r.fbmCount) }] });
    rows.push({ k: "Access", parts: [{ t: r.gated === true ? "gated" : r.gated === false ? "ungated" : "gating unknown", warn: r.gated === true }] });
    var flags = [];
    if (r.amazon) flags.push({ t: "Amazon on listing" + (r.amazonShare != null ? " (wins " + r.amazonShare + "% of the Buy Box)" : ""), warn: true });
    (r.tags || []).forEach(function (x) { if (x !== "Generic brand") flags.push({ t: x, warn: true }); }); // B-2410: it is the red pill at the top of the card
    if (r.scoreNote) flags.push({ t: r.scoreNote, warn: true }); // B-2290
    if (r.blocked) flags.push({ t: "on your Blacklist", warn: true });
    if (r.inCatalog) flags.push({ t: "now in your catalog" });
    if (r.sentAt) flags.push({ t: "On buylist ×" + (r.sentQty || "?") + ", sent " + sentDay(r.sentAt) }); // B-2411
    if (r.offer && r.offer.sku) flags.push(r.offer.warn ? { t: "⚠ Existing SKU " + r.offer.sku + " reused", warn: true, cls: "pg-ld-offer" } : { t: "Offer " + r.offer.sku + " created", cls: "pg-ld-offer" }); // B-2327: the last Send to Buylist's Amazon offer
    if (flags.length) rows.push({ k: "Flags", parts: flags });
    var sold = [{ t: soldText(r), cls: "pg-ld-val" }];
    if (r.soldEst) sold.push({ t: "est. from rank drops (30 days)", cls: "muted small" }); // B-2290
    if (r.share != null) sold.push({ t: "about " + r.share + " to you", cls: "muted small" });
    rows.push({ k: "Sold/mo", parts: sold, cls: "pg-ld-sold" });
    return rows;
  }
  function listingDl(r) {
    var dl = U.el("dl", "pg-ld-dl pg-ld-meta");
    listingRows(r).forEach(function (row) {
      var dt = U.el("dt", "", row.k); dt.setAttribute("data-nosearch", "1");
      var dd = U.el("dd", row.cls || "");
      row.parts.forEach(function (b, i) { if (i && !row.cls) dd.appendChild(doc.createTextNode(" · ")); dd.appendChild(U.el("span", ((b.warn ? "pg-ld-warn " : "") + (b.cls || "")).trim(), b.t)); });
      dl.appendChild(dt); dl.appendChild(dd);
    });
    return dl;
  }
  // the cost note under Cost/unit, the price-change line under the retailer, the Buy Box average under the table (the three lines the old facts line held)
  function costNote(r) {
    if (!(r.costTyped || r.packNote || r.packNeeded || r.amzPack)) return "";
    return r.costTyped ? "typed by you" : [r.packNeeded ? "store pack not read (type it on the desktop)" : r.packNote, r.amzPack ? "×" + r.amzPack.n + ": Amazon " + r.amzPack.n + "-pk" : ""].filter(Boolean).join(" · ");
  }
  function srcChangeLine(r) { return r.srcChange ? "Source price since tracked: " + (r.srcChange.delta === 0 ? "same" : (r.srcChange.delta > 0 ? "▲ " : "▼ ") + money(Math.abs(r.srcChange.delta)) + " (" + r.srcChange.pct + "%)") + " · was " + money(r.srcChange.was) : ""; }
  function bbAvgLine(r) { return r.bbAvg90 != null || r.bbAvg30 != null ? "Buy Box 90-day average " + money(r.bbAvg90) + (r.bbAvg30 != null ? " · 30-day " + money(r.bbAvg30) : "") : ""; }
  function scenRows(r) {
    var alt = { low: (r.alt && r.alt.low) || {}, avg: (r.alt && r.alt.avg) || {} };
    var noCost = W.feesNote(r); // B-2290: "cost not read yet" or "Amazon fees not read yet"
    var rows = [{ name: "Buy Box", price: r.bb, profit: r.profitBB, roi: r.roiBB, margin: r.marginBB, note: W.bbNote(r), feesNote: noCost }, { name: "Lowest FBA", price: r.lowFba, profit: r.profitFBA, roi: r.roiFBA, margin: r.marginFBA, note: W.fbaNote(r), feesNote: noCost }];
    if (r.lowNew != null && r.lowNew !== r.bb && r.lowNew !== r.lowFba) rows.push({ name: "Lowest offer", price: r.lowNew, profit: alt.low.profit, roi: alt.low.roi, margin: alt.low.margin, feesNote: noCost }); // B-2290
    if (alt.avg.price != null) rows.push({ name: (alt.avg.days === 30 ? "30-day avg" : "90-day avg") + (alt.avg.ageDays >= 2 ? " (" + Math.floor(alt.avg.ageDays) + "\u00a0d\u00a0old)" : ""), price: alt.avg.price, profit: alt.avg.profit, roi: alt.avg.roi, margin: alt.avg.margin, feesNote: noCost }); // B-2290
    if (r.salePrice != null) rows.push({ name: "At your price", price: r.salePrice, profit: r.profitSP, roi: r.roiSP, margin: r.marginSP, feesNote: noCost });
    else if (r.suggestedSalePrice && r.suggestedSalePrice.price != null) rows.push({ name: "At suggested price", price: r.suggestedSalePrice.price, profit: r.suggestedSalePrice.profit, roi: r.suggestedSalePrice.roi, margin: r.suggestedSalePrice.margin, feesNote: noCost }); // B-2413
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
  // B-2413: "Suggested $23.87 - why?" with the why lines under a tap; no price -> the one reason line
  function dspLine(c, r) {
    var s = r.suggestedSalePrice;
    if (!s) return;
    if (s.price == null) { var nd = U.el("div", "muted small pg-ld-dsp", "No suggested price: " + ((s.why && s.why[0]) || "not enough data")); nd.setAttribute("data-nosearch", "1"); c.appendChild(nd); return; }
    var d = U.el("details", "pg-ld-dsp");
    d.setAttribute("data-nosearch", "1");
    d.appendChild(U.el("summary", "muted small", "Suggested $" + Number(s.price).toFixed(2) + " - why?"));
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
  function sec(title) { var s = U.el("section", "pg-ld-sec"); var h = U.el("h3", "pg-ld-h", title); h.setAttribute("data-nosearch", "1"); s.appendChild(h); return s; }
  function metricCell(label, node) { var m = U.el("div", "pg-ld-m"); var k = U.el("span", "pg-ld-k", label); k.setAttribute("data-nosearch", "1"); m.appendChild(k); m.appendChild(node); return m; }
  function card(r) {
    var c = U.el("div", "line pg-card pg-ld-row" + (r.blocked ? " pg-ld-off" : ""));
    c.setAttribute("data-asin", r.asin);
    c.setAttribute("data-search", [r.brand, r.url, r.retailer, SHOPNAME[r.retailer]].filter(Boolean).join(" ")); // B-2288: hidden search words
    var h = r.headline || null, LB = root.ShopperLeadBand;
    // the band: pill first, score + title, A / K / G, Untrack
    var band = U.el("div", "pg-ld-band");
    if ((r.tags || []).indexOf("Generic brand") >= 0) band.appendChild(U.el("div", "pg-brandwarn", "⚠ Generic brand on Amazon")); // B-2410: loud, first on the card
    var t = U.el("div", "pg-ld-title");
    if (r.score != null) t.appendChild(U.el("b", "pg-cp-score", r.score + " "));
    t.appendChild(doc.createTextNode(String(r.title || r.asin)));
    band.appendChild(t);
    var links = U.el("div", "pg-cp-links small");
    links.appendChild(link("A", "https://www.amazon.com/dp/" + r.asin));
    links.appendChild(link("K", "https://keepa.com/#!product/1-" + r.asin));
    links.appendChild(link("G", "https://www.google.com/search?q=" + encodeURIComponent(String(r.title || r.asin).slice(0, 120))));
    band.appendChild(links);
    var ut = U.btn("Untrack", "danger-btn", function () { U.confirmSend("Stop tracking " + r.asin + "?", "leadsUntrack", { asin: r.asin }, ut, "Untracked"); });
    band.appendChild(ut);
    c.appendChild(band);
    // Amazon Listing
    var s1 = sec("Amazon Listing"); s1.appendChild(listingDl(r)); c.appendChild(s1);
    // Retailer Source: the retailer + its Source link first, the price-change line, then what Auto-find found when there is no link / a plan
    var s2 = sec("Retailer Source");
    var line = U.el("div", "pg-ld-source");
    if (r.url) { line.appendChild(U.el("b", "", r.retailer ? (SHOPNAME[r.retailer] || r.retailer) : "Store")); line.appendChild(link("Source", r.url)); } else line.appendChild(U.el("b", "muted", "No source yet"));
    s2.appendChild(line);
    var sc = srcChangeLine(r); if (sc) s2.appendChild(U.el("div", "muted small pg-ld-help", sc));
    { var mb = (!r.url || r.plan) && root.ShopperMatchBlock ? root.ShopperMatchBlock.block(r.asin, r.match) : null; if (mb) s2.appendChild(mb); } // B-2108: no link yet -> what Auto-find sources found
    c.appendChild(s2);
    // Pricing: Cost/unit, Profit/unit (+ which price), Margin, ROI, the table, the Buy Box average
    var s3 = sec("Pricing"), ms = U.el("div", "pg-ld-metrics");
    var cn = U.el("div", "pg-ld-cost"); cn.appendChild(U.el("span", "pg-ld-val", money(r.cost)));
    var cnote = costNote(r); if (cnote) cn.appendChild(U.el("span", "muted small pg-ld-help pg-ld-facts", cnote));
    ms.appendChild(metricCell("Cost/unit", cn));
    var pn = U.el("div", "pg-ld-profit"); pn.appendChild(U.el("span", "pg-ld-val", money(h ? h.profit : null)));
    { var sw = h && W.scenario[h.scenario] ? W.scenario[h.scenario] + W.ageWords(h) : ""; if (sw) pn.appendChild(U.el("span", "muted small pg-ld-scen", sw)); else if (!h && r.feesMissing && W.noPrice(r)) pn.appendChild(U.el("span", "muted small pg-ld-scen", W.NO_PRICE)); } // B-2292 (a) // B-2290: says which price the headline used
    ms.appendChild(metricCell("Profit/unit", pn));
    if (LB) { ms.appendChild(metricCell("Margin", LB.metric("Margin", h ? h.margin : null, LB.MARGIN_SCALE))); ms.appendChild(metricCell("ROI", LB.metric("ROI", h ? h.roi : null, LB.ROI_SCALE))); }
    s3.appendChild(ms);
    if (LB) s3.appendChild(LB.rowsTable(scenRows(r)));
    var bbl = bbAvgLine(r); if (bbl) s3.appendChild(U.el("div", "muted small pg-ld-help", bbl));
    c.appendChild(s3);
    // the footer: cost + Save cost, sale price + Save price, Send (or Unarchive), the suggested first buy
    var foot = U.el("div", "pg-ld-foot");
    var acts = U.el("div", "pg-ld-pair");
    if (r.costState === "ask" || r.costState === "reading") acts.appendChild(U.el("div", "small pg-cp-why", r.costState === "reading" ? "Reading the store page..." : "Cost not read - enter it."));
    { // B-2313: the cost box is always there; blank + Save clears the typed cost
      var cost = U.input("text", { placeholder: r.costTyped ? "Cost per item" : r.cost != null ? "Cost (read $" + Number(r.cost).toFixed(2) + ")" : "Enter cost", inputmode: "decimal" });
      if (r.costTyped && r.cost != null) cost.value = String(r.cost);
      var csv = savedSpan(r.asin, "cost");
      var sc2 = U.btn("Save cost", "mini-btn", function () { var v = cost.value.trim(); U.send("leadsSetCost", { asin: r.asin, cost: v || null }, sc2).then(function (res) { flash(csv, r.asin, "cost", res, !v); U.say(res, v ? "Cost saved" : "Cost cleared"); }); });
      acts.appendChild(cost); acts.appendChild(sc2); acts.appendChild(csv);
    }
    foot.appendChild(acts);
    acts = U.el("div", "pg-ld-pair");
    var dspS = r.suggestedSalePrice, hasSug = r.salePrice == null && !!dspS && dspS.price != null; // B-2413: an empty box + Save keeps the suggestion as his own price
    var sale = U.input("text", { placeholder: hasSug ? "Suggested $" + Number(dspS.price).toFixed(2) : "Desired sale price", inputmode: "decimal" }); // B-2135: empty + Save clears it
    if (r.salePrice != null) sale.value = String(r.salePrice);
    var psv = savedSpan(r.asin, "price");
    var sp = U.btn("Save price", "mini-btn", function () { var v = sale.value.trim() || (hasSug ? String(dspS.price) : ""); U.send("leadsSetSalePrice", { asin: r.asin, salePrice: v || null }, sp).then(function (res) { flash(psv, r.asin, "price", res, /^[\s$,]*$/.test(v)); U.say(res, /^[\s$,]*$/.test(v) ? "Price cleared" : "Price saved"); }); });
    acts.appendChild(sale); acts.appendChild(sp); acts.appendChild(psv);
    foot.appendChild(acts);
    dspLine(foot, r); // B-2413
    acts = U.el("div", "pg-ld-pair");
    if (arch()) { var ua = U.btn("Unarchive", "mini-btn", function () { U.send("leadsUnarchive", { asin: r.asin }, ua).then(function (res) { U.say(res, "Unarchived - back on Active"); }); }); acts.appendChild(ua); } else { // B-2411: an archived card offers Unarchive instead of Send
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
    }
    foot.appendChild(acts);
    suggestLine(foot, r); // B-2289
    c.appendChild(foot);
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
    head.appendChild(U.el("p", "muted small", (split() ? data.counts.active + " active · " + data.counts.archived + " archived" : (data.total || 0) + " leads") + " · last read " + (st.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : "never") + " · next " + (st.nextSlot || "-") + " Central · " + (st.tokensToday || 0) + " of " + (st.cap || 0) + " Keepa tokens used today"));
    { var rw = st.running ? runWords(st.running) : ""; if (rw) head.appendChild(U.el("p", "small pg-ld-run", rw)); } // B-2412
    if (st.searchNote) head.appendChild(U.el("p", "muted small", st.searchNote)); // B-2412
    if (st.noCredentials) head.appendChild(U.el("p", "small pg-cp-why", "Amazon is not connected on the main computer - the live Buy Box and offers are not being read."));
    if (st.keepaUsedUp) head.appendChild(U.el("p", "small pg-cp-why", "Keepa numbers are from " + (st.keepaAt ? new Date(st.keepaAt).toLocaleString() : "an earlier read") + " - today's lead tokens are used."));
    var rb = U.btn("Read leads now", "mini-btn", function () { U.send("leadsRefreshNow", {}, rb).then(function (res) { U.say(res, (res && res.result && res.result.text) || "Started"); }); });
    head.appendChild(rb);
    pane.appendChild(head);
    pane.appendChild(addBox());
    var chipsNode = chips();
    pane.appendChild(chipsNode);
    if (sbar) sbar.reattach(chipsNode); // B-2288
    if (split()) { // B-2411: Active / Archived
      var trow = U.el("div", "pg-row");
      [["active", "Active (" + data.counts.active + ")"], ["archived", "Archived (" + data.counts.archived + ")"]].forEach(function (t) { trow.appendChild(U.btn(t[1], tab === t[0] ? "primary-btn" : "mini-btn", function () { tab = t[0]; draw(); })); });
      pane.appendChild(trow);
    }
    var rows = visible();
    var of = split() ? (arch() ? data.counts.archived : data.counts.active) : (data.total || 0);
    var s = U.section((arch() ? "Archived" : "Leads") + " (" + rows.length + (rows.length !== of ? " of " + of : "") + ")");
    if (!rows.length) s.appendChild(U.el("p", "muted small", arch() ? (data.counts.archived ? "No archived lead matches these filters." : "Nothing archived yet - leads you send to the Buylist land here.") : (of ? "No lead matches these filters." : split() && data.counts.archived ? "No active leads - every lead has been sent to the Buylist (see Archived)." : "No leads yet. Add one above, or press + on a Competitor ASINs row.")));
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
