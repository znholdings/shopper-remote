// remote/manual-buy-view.js - B-1792 / B-1795 (v2.0.135): Manual Buy on the phone (the laptop's buyqueue/manual-buy.html).
// Look up an ASIN -> fill the same 10 fields -> "Work it out" (the laptop's plan, read-only) -> Save (two-step: the plan shown rides
// along as `shown`; the laptop plans again and refuses if a number moved). The phone works nothing out itself.
// Commands: manualBuyLookup, manualBuyPlan (read-only), manualBuySave (confirm; writes All Orders + Ledger + RP + SB).
// Data: payload.pages.manualBuy.stores (retailer names). DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("manualBuyPane");
  if (!P || !pane) return;
  var U = P.ui;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { manualBuyLookup: "Manual Buy: look up", manualBuyPlan: "Manual Buy: work it out", manualBuySave: "Manual Buy: save" });

  var f = {};
  var shown = null;
  var storesSig = "";
  var built = false;
  var extra = []; // B-1879 (v2.0.143): more products on the same order (up to 4)

  function today() {
    try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function form() {
    var q = f.quantity.value === "" ? "" : Number(f.quantity.value);
    var o = {
      asin: f.asin.value.trim().toUpperCase().slice(0, 10),
      retailer: f.retailer.value, orderNumber: f.orderNumber.value, quantity: q, quantityKind: f.quantityKind.value,
      total: f.total.value, orderDate: f.orderDate.value, shipTo: f.shipTo.value, tracking: f.tracking.value, notes: f.notes.value
    };
    Object.keys(o).forEach(function (k) { if (typeof o[k] === "string") o[k] = o[k].slice(0, 200); });
    var more = [];
    extra.forEach(function (x) {
      var a = x.asin.value.trim().toUpperCase().slice(0, 10), qv = x.qty.value, t = x.total.value.trim().slice(0, 20);
      if (!a && qv === "" && !t) return;
      more.push({ asin: a, quantity: qv === "" ? 0 : Number(qv), quantityKind: x.kind.value, total: t });
    });
    o.more = more;
    return o;
  }
  function addExtraRow() {
    if (extra.length >= 4) { U.toast("One order carries at most 5 products.", true); return; }
    var x = {};
    x.asin = U.input("text", { placeholder: "Another product's ASIN", autocapitalize: "characters", maxlength: "10" });
    x.qty = U.input("number", { min: "1", step: "1", inputmode: "numeric", placeholder: "How many" });
    x.kind = U.select([["packs", "Packs (the store's own count)"], ["pieces", "Pieces"], ["units", "Amazon units (sellable)"]]);
    x.total = U.input("text", { inputmode: "decimal", placeholder: "This product's total ($)" });
    x.row = U.el("div", "pg-note");
    x.remove = U.btn("Remove", "secondary-btn", function () {
      var i = extra.indexOf(x);
      if (i >= 0) extra.splice(i, 1);
      if (x.row.parentNode) x.row.parentNode.removeChild(x.row);
      clearPlan();
    });
    [x.asin, x.qty, x.kind, x.total].forEach(function (e) { e.addEventListener("input", clearPlan); e.addEventListener("change", clearPlan); });
    x.row.appendChild(U.field("Product ASIN", x.asin));
    x.row.appendChild(U.field("Quantity", x.qty));
    x.row.appendChild(U.field("Counted as", x.kind));
    x.row.appendChild(U.field("This product's total", x.total));
    x.row.appendChild(x.remove);
    f.moreBox.appendChild(x.row);
    extra.push(x);
    clearPlan();
  }
  function clearExtra() {
    extra.forEach(function (x) { if (x.row.parentNode) x.row.parentNode.removeChild(x.row); });
    extra = [];
  }
  function clearPlan() {
    shown = null;
    f.save.disabled = true;
    f.planBox.textContent = "";
  }
  function listLines(box, lines) {
    box.textContent = "";
    (lines || []).slice(0, 40).forEach(function (l) { box.appendChild(U.el("div", "pg-line small", String(l).slice(0, 300))); });
  }

  function build() {
    built = true;
    pane.textContent = "";
    var sec = U.section("Manual Buy");
    sec.appendChild(U.el("p", "muted small", "Record a buy made by hand. The computer works the numbers out and saves it; this page only sends what you type."));
    f.asin = U.input("text", { placeholder: "ASIN", autocapitalize: "characters", maxlength: "10" });
    f.lookup = U.btn("Look up", "secondary-btn", doLookup);
    var row = U.el("div", "pg-row");
    row.appendChild(f.asin);
    row.appendChild(f.lookup);
    sec.appendChild(row);
    f.lookupBox = U.el("div", "pg-note small");
    sec.appendChild(f.lookupBox);
    f.retailer = U.select([["", "Pick the store"]]);
    f.orderNumber = U.input("text", { placeholder: "Order number" });
    f.quantity = U.input("number", { min: "1", step: "1", inputmode: "numeric", placeholder: "How many" });
    f.quantityKind = U.select([["packs", "Packs (the store's own count)"], ["pieces", "Pieces"], ["units", "Amazon units (sellable)"]]);
    f.total = U.input("text", { inputmode: "decimal", placeholder: "Order total ($)" });
    f.orderDate = U.input("date", {});
    f.orderDate.value = today();
    f.shipTo = U.select([["house", "House"], ["prep", "Prep center"]]);
    f.tracking = U.input("text", { placeholder: "Tracking (optional)" });
    f.notes = U.input("text", { placeholder: "Notes (optional)" });
    sec.appendChild(U.field("Store", f.retailer));
    sec.appendChild(U.field("Order number", f.orderNumber));
    sec.appendChild(U.field("Quantity", f.quantity));
    sec.appendChild(U.field("Counted as", f.quantityKind));
    sec.appendChild(U.field("Total", f.total));
    sec.appendChild(U.field("Order date", f.orderDate));
    sec.appendChild(U.field("Ships to", f.shipTo));
    sec.appendChild(U.field("Tracking", f.tracking));
    sec.appendChild(U.field("Notes", f.notes));
    ["asin", "retailer", "orderNumber", "quantity", "quantityKind", "total", "orderDate", "shipTo", "tracking", "notes"].forEach(function (k) {
      f[k].addEventListener("input", clearPlan);
      f[k].addEventListener("change", clearPlan);
    });
    f.moreBox = U.el("div", "");
    sec.appendChild(f.moreBox);
    f.addLine = U.btn("Add another product on this order", "secondary-btn", addExtraRow);
    sec.appendChild(f.addLine);
    f.plan = U.btn("Work it out", "primary-btn", doPlan);
    f.save = U.btn("Save this buy", "primary-btn", doSave);
    f.save.disabled = true;
    var acts = U.el("div", "pg-row");
    acts.appendChild(f.plan);
    acts.appendChild(f.save);
    sec.appendChild(acts);
    f.planBox = U.el("div", "pg-plan");
    sec.appendChild(f.planBox);
    pane.appendChild(sec);
  }

  async function doLookup() {
    var asin = f.asin.value.trim().toUpperCase();
    if (asin.length !== 10) { U.toast("Type the 10-character ASIN first.", true); return; }
    var r = await U.send("manualBuyLookup", { asin: asin }, f.lookup);
    f.lookupBox.textContent = "";
    if (!r.ok) { U.say(r); return; }
    var res = r.result || {};
    var prod = res.product && typeof res.product === "object" ? res.product : null;
    var st = res.stock && typeof res.stock === "object" ? res.stock : null;
    f.lookupBox.textContent = (prod ? String(prod.title || prod.name || asin).slice(0, 200) : asin) +
      (st ? " - House " + (st.house == null ? "-" : st.house) + ", Prep " + (st.prep == null ? "-" : st.prep) + ", In transit " + (st.inTransit == null ? "-" : st.inTransit) : "");
  }
  async function doPlan() {
    clearPlan();
    var r = await U.send("manualBuyPlan", { form: form() }, f.plan);
    if (!r.ok) { U.say(r); return; }
    var res = r.result || {};
    if (!res.plan) { U.toast("The computer sent no plan.", true); return; }
    shown = res.plan;
    listLines(f.planBox, res.lines);
    f.save.disabled = false;
  }
  async function doSave() {
    if (!shown) return;
    await U.confirmSend("Save this buy to All Orders, the Ledger, Replen Pulse and Sellerboard?", "manualBuySave", { form: form(), shown: shown }, f.save, "Saved", function (r) {
      if (r && r.ok) { f.planBox.textContent = r.started ? "Saving on the computer - watch the activity bar." : "Saved."; clearExtra(); shown = null; f.save.disabled = true; }
    });
  }

  function render(p) {
    if (!built) build();
    var d = U.pageData(p, "manualBuy");
    var stores = d && Array.isArray(d.stores) ? d.stores : d && Array.isArray(d.retailers) ? d.retailers : [];
    var names = stores.slice(0, 30).map(function (s) { return String(s && s.name != null ? s.name : s).slice(0, 80); }).filter(Boolean);
    var sig = names.join("|");
    if (sig === storesSig) return;
    storesSig = sig;
    var keep = f.retailer.value;
    f.retailer.textContent = "";
    [["", names.length ? "Pick the store" : "Stores load from the computer..."]].concat(names.map(function (n) { return [n, n]; })).forEach(function (o) {
      var op = doc.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      f.retailer.appendChild(op);
    });
    if (keep && names.indexOf(keep) >= 0) f.retailer.value = keep;
  }

  build();
  P.register("manualbuy", { pane: pane, render: render });
})(self);
