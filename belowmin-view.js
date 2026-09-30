// remote/belowmin-view.js - B-741 (v2.01), B-745/746/747 (v2.0.2): the
// phone's "Min" tab.
//
// The laptop's Below Min list (lib/below-min.js projectBelowMinForRemote),
// laid out like the laptop card: big stock, prices (incl. lowest FBA / FBM),
// Seller Snap 7-day ROI + margin (same size), ROI + margin at the Buy Box and
// listed prices, the three Keepa panels, the offers (Prime only / All), and
// the same three choices with one Send. Owns no rules: the math and the
// charts are belowmin-lib.js (lib/sellersnap-price.js + lib/keepa-chart-svg.js,
// wrapped unchanged). The laptop does the send and the read-back.
(function () {
  "use strict";
  const P = self.ShopperPrice;
  const $ = (id) => document.getElementById(id);
  let data = null;
  let lastKey = "";
  const choices = {}; // sku -> { action, price }
  let offerView = "all";
  try { offerView = localStorage.getItem("shopperBelowMinOfferView") === "prime" ? "prime" : "all"; } catch (e) { /* default */ }
  const openOffers = new Set();

  const money = (v) => (v == null || !Number.isFinite(Number(v)) ? "-" : (Number(v) < 0 ? "-$" : "$") + Math.abs(Number(v)).toFixed(2));
  const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? "-" : Number(v).toFixed(1) + "%");
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function ago(ms) {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }
  const atLine = (at) => (at ? `ROI ${pct(at.roi)} · margin ${pct(at.margin)}${at.profit < 0 ? " · a LOSS" : ""}` : "no cost in Seller Snap");
  const rowFor = (r) => ({ cost: r.calc && r.calc.cost, additionalCost: r.calc && r.calc.additionalCost, fees: (r.calc && r.calc.fees) || {} });
  const bad = (v) => v != null && Number(v) < 0;

  function pickedCount() {
    return Object.values(choices).filter((c) => c && c.action).length;
  }
  function renderSend() {
    const n = pickedCount();
    const btn = $("bmmSend");
    if (!btn) return;
    btn.disabled = !n;
    btn.textContent = n ? `Send ${n} to Seller Snap` : "Send to Seller Snap";
  }

  function choice(r, action, label, sub, disabled) {
    const lab = el("label", "bmm-choice" + (disabled ? " bmm-off" : ""));
    const i = document.createElement("input");
    i.type = "radio";
    i.name = "bmm-" + r.sku;
    i.disabled = !!disabled;
    i.dataset.a = action;
    i.checked = !!(choices[r.sku] && choices[r.sku].action === action);
    i.addEventListener("change", () => {
      const prev = choices[r.sku] || {};
      choices[r.sku] = { action, price: action === "custom" ? prev.price || "" : undefined };
      renderSend();
    });
    lab.append(i, label);
    if (sub) lab.append(sub);
    return lab;
  }
  function cell(label, value, sub, cls) {
    const d = el("div", "bmm-num");
    d.append(el("div", "t-label", label), el("div", "t-value" + (cls ? " " + cls : ""), value));
    if (sub) d.append(el("div", "muted small", sub));
    return d;
  }
  function pair(label, at) {
    const d = el("div", "bmm-num");
    d.append(el("div", "t-label", label));
    const g = el("div", "bmm-pair");
    for (const [n, v] of [["ROI", at && at.roi], ["Margin", at && at.margin]]) {
      const x = el("div");
      x.append(el("div", "t-value" + (bad(v) ? " warn-text" : ""), pct(v)), el("div", "muted small", n));
      g.append(x);
    }
    d.append(g);
    return d;
  }

  function offers(r) {
    const box = el("div", "bmm-offers");
    const all = Array.isArray(r.offers) ? r.offers : null;
    const head = el("div", "bmm-offers-head");
    head.append(el("h4", "ai-h2", all ? `Offers (${all.length})` : "Offers"));
    const tabs = el("div", "bmm-seg");
    for (const [k, label] of [["prime", "Prime only"], ["all", "All"]]) {
      const b = el("button", "mini-btn" + (offerView === k ? " bmm-seg-on" : ""), label);
      b.type = "button";
      b.addEventListener("click", () => { offerView = k; try { localStorage.setItem("shopperBelowMinOfferView", k); } catch (e) { /* fine */ } draw(); });
      tabs.append(b);
    }
    head.append(tabs);
    box.append(head);
    if (!all) { box.append(el("p", "muted small", "Offer list not read yet.")); return box; }
    const list = offerView === "prime" ? all.filter((o) => o.channel === "FBA") : all;
    if (!list.length) { box.append(el("p", "muted small", "No Prime (FBA) offers.")); return box; }
    const show = openOffers.has(r.sku) ? list : list.slice(0, 6);
    const t = el("table", "bmm-offer-table");
    const hr = el("tr");
    for (const h of ["Seller", "", "Price", "ROI", "Margin"]) hr.append(el("th", null, h));
    t.append(hr);
    for (const o of show) {
      const at = P ? P.profitAt(o.price, rowFor(r)) : null;
      const tr = el("tr", o.you ? "bmm-you" : "");
      tr.append(el("td", "bmm-seller", o.you ? "You" : o.seller), el("td", null, o.channel), el("td", null, money(o.price)),
        el("td", bad(at && at.roi) ? "warn-text" : "", pct(at && at.roi)), el("td", bad(at && at.margin) ? "warn-text" : "", pct(at && at.margin)));
      t.append(tr);
    }
    box.append(t);
    if (list.length > 6) {
      const more = el("button", "mini-btn", openOffers.has(r.sku) ? "Show fewer" : `Show all ${list.length}`);
      more.type = "button";
      more.addEventListener("click", () => { openOffers.has(r.sku) ? openOffers.delete(r.sku) : openOffers.add(r.sku); draw(); });
      box.append(more);
    }
    return box;
  }

  function card(r) {
    const c = el("div", "bmm-card");
    const top = el("div", "bmm-top");
    const nameBox = el("div", "bmm-name");
    const a = el("a", "bmm-title", r.title || r.asin);
    a.href = r.amazonUrl;
    a.target = "_blank";
    a.rel = "noopener";
    nameBox.append(a, el("div", "muted small", `${r.asin}${r.bbStatus ? " · Buy Box " + r.bbStatus : ""}`));
    const stock = el("div", "bmm-stock");
    stock.append(el("div", "bmm-stock-n", r.qty == null ? "?" : String(r.qty)), el("div", "bmm-stock-l", "in stock"));
    top.append(nameBox, stock);
    c.append(top);
    const t = r.trend || {};
    const prices = el("div", "bmm-nums bmm-nums3");
    prices.append(cell("Buy Box", money(r.bb)), cell("Your min", money(r.min), `max ${money(r.max)}`), cell("Listed", money(r.listed)),
      cell("Lowest FBA", money(r.lowestFba)), cell("Lowest FBM", money(r.lowestFbm)));
    c.append(prices);
    const grid = el("div", "bmm-nums");
    grid.append(
      pair("Seller Snap 7 days", { roi: r.ssRoi, margin: r.ssMargin }),
      cell("Sold 7 days", r.units7 == null ? "-" : String(r.units7), `week before ${r.unitsPrev7 == null ? "-" : r.unitsPrev7} · ${r.v7 == null ? "-" : Number(r.v7).toFixed(2) + "/day"} · ${t.label || ""}`, t.dir === "down" ? "warn-text" : ""),
      pair(`At Buy Box ${money(r.bb)}`, r.atBb),
      pair(`At listed ${money(r.listed)}`, r.atListed),
    );
    c.append(grid);
    if (P && P.drawKeepaCharts) c.append(P.drawKeepaCharts(document, r.chart || null, { asOf: r.chartAt || null }));
    c.append(offers(r));
    c.append(choice(r, "keep", el("span", null, "Don't change")));
    const cur = choices[r.sku] && choices[r.sku].action === "custom" ? choices[r.sku] : null;
    const wrap = el("span");
    const inp = document.createElement("input");
    inp.className = "qty-input bmm-price";
    inp.inputMode = "decimal";
    inp.placeholder = "0.00";
    inp.value = cur ? cur.price || "" : "";
    const live = el("div", "muted small bmm-sub");
    const upd = () => {
      if (!inp.value) { live.textContent = "Type a price."; return; }
      const p = P ? P.parsePrice(inp.value) : null;
      if (p == null) { live.textContent = "Type a price like 12.97."; return; }
      const at = P ? P.profitAt(p, rowFor(r)) : null;
      live.textContent = `At ${money(p)}: ${atLine(at)}${r.max != null && p > r.max ? " · above your max" : ""}`;
    };
    inp.addEventListener("input", () => {
      choices[r.sku] = { action: "custom", price: inp.value };
      const radio = c.querySelector('input[type=radio][data-a="custom"]');
      if (radio) radio.checked = true;
      upd();
      renderSend();
    });
    upd();
    wrap.append(el("span", null, "Custom min $ "), inp);
    c.append(choice(r, "custom", wrap, live));
    const sg = r.suggestion || {};
    if (sg.price != null) c.append(choice(r, "suggested", el("span", null, `Suggested min ${money(sg.price)}`), el("div", "muted small bmm-sub", `At ${money(sg.price)}: ${atLine(sg)}`)));
    else c.append(choice(r, "suggested", el("span", null, "No suggestion"), el("div", "muted small bmm-sub", sg.reason || ""), true));
    return c;
  }

  function draw() {
    const box = $("bmmBody");
    if (!box) return;
    box.textContent = "";
    const d = data;
    $("bmmAsOf").textContent = d && d.readAt ? `${d.count} listing(s) · read ${ago(d.readAt)}${d.via ? " from " + d.via : ""}${d.hidden ? ` · ${d.hidden} hidden (Don't change)` : ""}` : "Not read yet - tap Check now.";
    const ban = $("bmmBanner");
    const msgs = [];
    if (d && d.error) msgs.push(`Last check failed: ${d.error}`);
    if (d && d.lastSend) msgs.push(`Last send: ${d.lastSend.confirmed} confirmed${d.lastSend.pending ? `, ${d.lastSend.pending} taken but not showing yet` : ""}${d.lastSend.failed ? `, ${d.lastSend.failed} NOT confirmed` : ""}.`);
    ban.hidden = !msgs.length;
    ban.textContent = msgs.join(" ");
    if (!d || !d.rows || !d.rows.length) {
      box.append(el("p", "muted", d && d.readAt ? "Nothing below min right now." : ""));
    } else {
      for (const r of d.rows) box.append(card(r));
    }
    if (d && d.recent && d.recent.length) {
      const ul = el("ul", "muted small bmm-recent");
      for (const h of d.recent) ul.append(el("li", null, `${h.asin} min -> ${money(h.newMin)}: ${h.result}`));
      box.append(el("h3", "ai-h2", "Recent changes"), ul);
    }
    renderSend();
  }

  function render(p) {
    data = p || null;
    for (const sku of Object.keys(choices)) if (!(data && (data.rows || []).some((r) => r.sku === sku))) delete choices[sku];
    // Don't redraw under his thumb while he is choosing - only when the list changed.
    const key = JSON.stringify(data && [data.readAt, data.count, data.error, data.lastSend, (data.rows || []).map((r) => [r.sku, r.bb, r.min, r.chartAt, r.offers ? r.offers.length : -1])]);
    if (key === lastKey) return;
    lastKey = key;
    draw();
  }

  function wire() {
    const check = $("bmmCheck");
    const sendBtn = $("bmmSend");
    if (!check || !sendBtn || !self.ShopperRemote) return;
    check.addEventListener("click", () => self.ShopperRemote.sendCommand("belowMinCheck", {}));
    sendBtn.addEventListener("click", () => {
      const picked = Object.fromEntries(Object.entries(choices).filter(([, c]) => c && c.action));
      if (!Object.keys(picked).length) return;
      self.ShopperRemote.sendCommand("belowMinSend", { choices: picked });
      for (const k of Object.keys(choices)) delete choices[k];
      lastKey = "";
      renderSend();
    });
  }

  self.ShopperBelowMinView = { render, wire, count: () => (data ? data.count || 0 : 0) };
})();
