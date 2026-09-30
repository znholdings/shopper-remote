// remote/belowmin-view.js - B-741 (v2.01): the phone's "Min" tab.
//
// The laptop's Below Min list (lib/below-min.js projectBelowMinForRemote),
// with the same three choices per listing and one Send. Owns no rules: the
// profit / ROI / margin at a typed price comes from belowmin-lib.js, which is
// lib/sellersnap-price.js wrapped unchanged (test/_belowmin-bundle.mjs). The
// laptop does the send and the read-back (SHOPPER_BELOWMIN_SEND); the phone
// shows the result on the next publish.
(function () {
  "use strict";
  const P = self.ShopperPrice;
  const $ = (id) => document.getElementById(id);
  let data = null;
  let lastKey = "";
  const choices = {}; // sku -> { action, price }

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
  const atLine = (at) => (at ? `profit ${money(at.profit)} · ROI ${pct(at.roi)} · margin ${pct(at.margin)}` : "no cost in Seller Snap");
  const rowFor = (r) => ({ cost: r.calc && r.calc.cost, additionalCost: r.calc && r.calc.additionalCost, fees: (r.calc && r.calc.fees) || {} });

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

  function card(r) {
    const c = el("div", "bmm-card");
    const a = el("a", "bmm-title", r.title || r.asin);
    a.href = r.amazonUrl;
    a.target = "_blank";
    a.rel = "noopener";
    c.append(a, el("div", "muted small", `${r.asin} · ${r.qty == null ? "?" : r.qty} in stock${r.bbStatus ? " · Buy Box " + r.bbStatus : ""}`));
    const t = r.trend || {};
    const grid = el("div", "bmm-nums");
    const cell = (label, value, sub, cls) => {
      const d = el("div", "bmm-num");
      d.append(el("div", "t-label", label), el("div", "t-value" + (cls ? " " + cls : ""), value));
      if (sub) d.append(el("div", "muted small", sub));
      return d;
    };
    grid.append(
      cell("Buy Box", money(r.bb)),
      cell("Your min", money(r.min), `max ${money(r.max)}`),
      cell("SS ROI 7d", pct(r.ssRoi), `margin ${pct(r.ssMargin)}`),
      cell("Sold 7d", r.units7 == null ? "-" : String(r.units7), `before: ${r.unitsPrev7 == null ? "-" : r.unitsPrev7}`),
      cell("Velocity", r.v7 == null ? "-" : `${Number(r.v7).toFixed(2)}/day`, t.label || "", t.dir === "down" ? "warn-text" : ""),
      cell("At Buy Box", r.atBb ? money(r.atBb.profit) : "-", r.atBb ? `ROI ${pct(r.atBb.roi)} · margin ${pct(r.atBb.margin)}` : ""),
    );
    c.append(grid);
    c.append(choice(r, "keep", el("span", null, "Don't change")));
    // Custom, with the laptop's own math live.
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
      live.textContent = `At ${money(p)}: ${atLine(at)}${r.max != null && p > r.max ? " · above your max" : ""}${at && at.profit < 0 ? " · a LOSS" : ""}`;
    };
    inp.addEventListener("input", () => {
      choices[r.sku] = { action: "custom", price: inp.value };
      const radio = c.querySelector(`input[type=radio][name="bmm-${CSS.escape(r.sku)}"][data-a="custom"]`);
      if (radio) radio.checked = true;
      upd();
      renderSend();
    });
    upd();
    wrap.append(el("span", null, "Custom min $ "), inp);
    const customLab = choice(r, "custom", wrap, live);
    customLab.querySelector("input[type=radio]").dataset.a = "custom";
    c.append(customLab);
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
    if (d && d.lastSend) msgs.push(`Last send: ${d.lastSend.confirmed} confirmed${d.lastSend.failed ? `, ${d.lastSend.failed} NOT confirmed` : ""}.`);
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
    const key = JSON.stringify(data && [data.readAt, data.count, data.error, data.lastSend, (data.rows || []).map((r) => [r.sku, r.bb, r.min])]);
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
