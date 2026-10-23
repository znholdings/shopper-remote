// remote/listing-health-view.js - B-1125 (v2.0.58): the phone Pricing tab's
// "Aged inventory" and "No sales" sections, compact.
//
// Data: p.belowMin.listingHealth from the laptop (lib/listing-health-store.js
// projectListingHealthForRemote - the 7-day candidates, stalest first, capped
// at 40; the totals per window from the laptop's full list; the aged rows
// capped at 40). The window filter and the words are lib/listing-health.js,
// the laptop page's own code (remote/belowmin-lib.js wraps it unchanged).
// The 7 / 14 / 30 choice is remembered on this phone (localStorage, same key
// name as the laptop's).
//
// B-1198 (v2.0.68): each row's Seller Snap block, like the laptop row
// (belowmin/pricing-row-view.js): min · max · listed · Buy Box · strategy,
// then Min / Max / strategy (+ "None (AI Default)", B-1200) and Send. Send =
// the remote command pricingRowSend -> the laptop's own
// SHOPPER_PRICING_ROW_SEND (lib/remote-protocol.js whitelist). The phone
// checks the typed values with the laptop's rule first (P.prValidate =
// lib/pricing-rows.js); the laptop checks again on a fresh Seller Snap read,
// with the below-cost floor (B-1202 - the row then offers "Send below cost"),
// and reads Seller Snap back. The answer: the command's reply, else (a reply
// past the laptop's 30 s) the laptop's recent sends by SKU, else the row's
// figures marked "sent" on the next payload. Typed values are kept per SKU
// and the list is never redrawn while a box has the focus.
(function () {
  "use strict";
  const P = self.ShopperPrice;
  const $ = (id) => document.getElementById(id);
  const SHOW_FIRST = 5;
  const KEY = (P && P.NO_SALES_WINDOW_KEY) || "shopperPricingNoSalesWindow";
  let data = null;
  let lastKey = "";
  let win = 30;
  try { win = P && P.lhNormalizeWindow ? P.lhNormalizeWindow(localStorage.getItem(KEY)) : 30; } catch (e) { /* default */ }
  let nsAll = false;
  let agedAll = false;
  // B-1198: the laptop's recent sends (p.recent), typed values and each row's send, by SKU.
  let recent = null;
  const drafts = {};
  const sends = {};
  let sendingSku = null;
  const CLOCK_SLACK_MS = 2 * 60000; // phone vs laptop clocks, when matching a recent send to this tap
  const LOSS_WORDS = (P && P.LOSS_REFUSAL_WORDS) || "under cost";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const plural = (n, one) => `${n} ${n === 1 ? one : one + "s"}`;
  function ago(ms) {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }
  function nameLine(r) {
    const d = el("div", "lhm-name");
    const a = el("a", "lhm-title", r.title || r.asin);
    a.href = `https://www.amazon.com/dp/${encodeURIComponent(r.asin || "")}`;
    a.target = "_blank";
    a.rel = "noopener";
    d.append(a);
    const ids = el("div", "muted small lhm-ids");
    ids.append(el("span", null, r.asin || ""));
    if (r.asin && P && P.makeCopyButton) ids.append(P.makeCopyButton(document, { value: r.asin, what: "ASIN", className: "s-plain-btn" }));
    d.append(ids);
    return d;
  }
  function more(all, n, toggle) {
    const b = el("button", "mini-btn lhm-more", all ? "Show fewer" : `Show all ${n}`);
    b.type = "button";
    b.addEventListener("click", toggle);
    return b;
  }

  // ---- B-1198 (v2.0.68): one row -> Seller Snap --------------------------
  const m2 = (v) => (v == null || !Number.isFinite(Number(v)) ? "-" : `$${Number(v).toFixed(2)}`);
  const label = (p) => (P && P.prPresetLabel ? P.prPresetLabel(p) : String(p));
  function ssNowText(sp) {
    const bits = [`min ${m2(sp.min)}`, `max ${m2(sp.max)}`, `listed ${m2(sp.listed)}`, sp.bb == null ? "BB none" : `BB ${m2(sp.bb)}`];
    if (sp.preset) bits.push(label(sp.preset));
    if (sp.fromOverlay) bits.push(`sent ${ago(sp.at)}`);
    return bits.join(" · ");
  }
  function changeText(c) {
    if (!c) return "";
    return [c.newMin != null ? `min ${m2(c.newMin)}` : "", c.newMax != null ? `max ${m2(c.newMax)}` : "", c.preset ? `strategy ${label(c.preset)}` : ""].filter(Boolean).join(" ");
  }
  // The laptop's newest recent send for this SKU (since the tap, give or take the clocks).
  function recentFor(sku, sinceMs) {
    for (const h of Array.isArray(recent) ? recent : []) {
      if (h && h.sku === sku && (!sinceMs || Number(h.at) >= sinceMs - CLOCK_SLACK_MS)) return h;
    }
    return null;
  }
  // The row's line 3: { cls, text } or null.
  function statusFor(sp) {
    const s = sends[sp.sku];
    if (s) {
      if (s.phase === "invalid" || s.phase === "failed") return { cls: "warn-text", text: s.text };
      if (s.phase === "sending") return { cls: "muted", text: "Sent - the laptop is checking Seller Snap (up to a minute)" };
      const r = s.res || null;
      if (r && r.confirmed) return { cls: "is-good", text: `confirmed · ${changeText(r.change)}` };
      if (r && r.pending) return { cls: "muted", text: `sent - Seller Snap took it, not showing yet (${changeText(r.change)}) - checked again on the next read` };
      const h = recentFor(sp.sku, s.at);
      if (h) {
        const good = /^confirmed/.test(String(h.result || ""));
        const taken = /^sent - Seller Snap took it/.test(String(h.result || ""));
        return { cls: good ? "is-good" : taken ? "muted" : "warn-text", text: `${h.words || `min -> ${m2(h.newMin)}`}: ${h.result}` };
      }
      return { cls: "muted", text: "Sent - the laptop is still checking Seller Snap; its answer shows here when it is done" };
    }
    if (sp.fromOverlay) return { cls: sp.result === "confirmed" ? "is-good" : "muted", text: `sent ${ago(sp.at)}: ${sp.result === "confirmed" ? "confirmed" : "Seller Snap took it, not showing yet - checked again on the next read"}` };
    return null;
  }
  // fromTap: right after a Send tap the keyboard goes (iOS keeps the focus in
  // the box when a button is tapped) and the row's new state is drawn. Later
  // (the laptop's answer) a box with the focus is left alone - the next
  // payload draws it.
  const repaintHooks = []; // B-1410: other phone views that draw a row's Seller Snap block (the Min cards)
  function redraw(fromTap) {
    for (const f of repaintHooks) { try { f(); } catch (e) { /* fine */ } }
    const box = $("lhmBox");
    const a = document.activeElement;
    if (fromTap && box && a && box.contains(a) && typeof a.blur === "function") a.blur();
    lastKey = "";
    render(data);
  }
  function priceBox(cls, what, current, draft, disabled) {
    const i = el("input", `qty-input ${cls}`);
    i.type = "text";
    i.inputMode = "decimal";
    i.autocomplete = "off";
    i.placeholder = current == null ? what : Number(current).toFixed(2);
    i.setAttribute("aria-label", `${what} - blank keeps ${current == null ? "it" : m2(current)}`);
    if (draft != null) i.value = draft;
    i.disabled = disabled;
    return i;
  }
  async function sendRow(req) {
    const R = self.ShopperRemote;
    if (!R || !R.sendCommand || sendingSku) return;
    const at = Date.now();
    sendingSku = req.sku;
    sends[req.sku] = { phase: "sending", at };
    redraw(true);
    let id = null;
    // iOS: this runs straight from the tap (the relay POST is the first await).
    try { id = await R.sendCommand("pricingRowSend", req); } catch (e) { id = null; }
    if (!id) {
      sendingSku = null;
      sends[req.sku] = { phase: "failed", at, text: "Not sent - the phone could not reach the laptop's relay. Try again." };
      redraw(true);
      return;
    }
    let status = "done";
    try { if (R.waitFor) status = await R.waitFor(id); } catch (e) { status = "done"; }
    let row = null;
    try { if (R.readCommand) row = await R.readCommand(id); } catch (e) { row = null; }
    sendingSku = null;
    const res = row && row.result && typeof row.result === "object" ? row.result : null;
    if (status === "done") {
      sends[req.sku] = { phase: "answered", at, res };
      delete drafts[req.sku];
    } else if (status === "timeout") {
      sends[req.sku] = { phase: "failed", at, text: "No answer from the laptop in 5 minutes - check its Pricing page before sending again." };
    } else {
      const why = String((row && row.reason) || (res && res.error) || `not sent (${status})`);
      sends[req.sku] = { phase: "failed", at, text: why, lossAsk: why.includes(LOSS_WORDS) };
    }
    redraw();
  }
  function ssBlock(r, presetsIn) {
    const box = el("div", "lhm-ss");
    const sp = r && r.sp;
    if (!sp || !sp.sku) {
      box.append(el("div", "muted small lhm-ss-now", "not in Seller Snap"));
      return box;
    }
    box.append(el("div", "muted small lhm-ss-now", ssNowText(sp)));
    if (!P || !P.prValidate) return box;
    const d = drafts[sp.sku] || {};
    const busy = !!sendingSku;
    const keep = (patch) => { drafts[sp.sku] = { ...(drafts[sp.sku] || {}), ...patch }; };
    const edit = el("div", "lhm-ss-edit");
    const minI = priceBox("lhm-ss-min", "Min", sp.min, d.min, busy);
    const maxI = priceBox("lhm-ss-max", "Max", sp.max, d.max, busy);
    edit.append(minI, maxI);
    let sel = null;
    const presets = Array.isArray(presetsIn) ? presetsIn : data && Array.isArray(data.presets) ? data.presets : [];
    if (presets.length && P.prPickerChoices) {
      sel = el("select", "lhm-ss-preset");
      sel.setAttribute("aria-label", "Seller Snap strategy");
      const k = el("option", null, `keep ${sp.preset == null ? "current" : label(sp.preset)}`);
      k.value = "";
      sel.append(k);
      const choices = P.prPickerChoices(presets);
      for (const c of choices) {
        const o = el("option", null, c.label);
        o.value = c.value;
        sel.append(o);
      }
      sel.value = d.preset && choices.some((c) => c.value === d.preset) ? d.preset : "";
      sel.disabled = busy;
      edit.append(sel);
    }
    const btn = el("button", "mini-btn lhm-ss-send", sendingSku === sp.sku ? "Sending..." : "Send");
    btn.type = "button";
    btn.disabled = busy;
    edit.append(btn);
    box.append(edit);
    const s = sends[sp.sku];
    let lossBox = null;
    if (d.allowLoss === true || (s && s.lossAsk)) {
      const lab = el("label", "radio-label lhm-ss-loss");
      lossBox = el("input", "lhm-ss-loss-box");
      lossBox.type = "checkbox";
      lossBox.checked = d.allowLoss === true;
      lossBox.disabled = busy;
      lab.append(lossBox, el("span", null, (P && P.LOSS_TICK_LABEL) || "Send below cost (I typed this on purpose)"));
      box.append(lab);
      lossBox.addEventListener("change", () => keep({ allowLoss: lossBox.checked }));
    }
    const st = statusFor(sp);
    const out = el("div", "small lhm-ss-result" + (st ? ` ${st.cls}` : ""), st ? st.text : "");
    out.hidden = !st;
    box.append(out);
    minI.addEventListener("input", () => keep({ min: minI.value }));
    maxI.addEventListener("input", () => keep({ max: maxI.value }));
    if (sel) sel.addEventListener("change", () => keep({ preset: sel.value }));
    btn.addEventListener("click", () => {
      if (sendingSku) return;
      const req = { sku: sp.sku, asin: String(r.asin || ""), min: minI.value.trim(), max: maxI.value.trim(), preset: sel ? sel.value : "", allowLoss: !!(lossBox && lossBox.checked) };
      keep({ min: req.min, max: req.max, preset: req.preset });
      // The laptop's own rule, before anything leaves the phone.
      const v = P.prValidate({ min: req.min, max: req.max, preset: req.preset, cur: sp });
      if (!v.ok) {
        sends[sp.sku] = { phase: "invalid", at: Date.now(), text: v.errors.join(" ") };
        redraw(true);
        return;
      }
      sendRow(req);
    });
    return box;
  }

  function drawAged(box, a) {
    box.append(el("h3", "ai-h2", "Aged inventory"));
    const st = P.lhAgedStatus(a, Date.now());
    box.append(el("p", "muted small" + (st.bad ? " warn-text" : ""), st.text));
    if (!st.known || !a || !a.summary) return;
    const tiles = el("div", "lhm-levels");
    for (const lv of P.AGED_LEVELS) {
      const s = a.summary[lv] || { skus: 0, units: 0, fee: null };
      const t = el("div", "lhm-level lhm-" + lv);
      t.append(el("div", "t-label", P.AGED_LEVEL_LABEL[lv]), el("div", "t-value", String(s.units)),
        el("div", "muted small", `units · ${plural(s.skus, "SKU")}${lv !== "old" && s.fee != null ? ` · ${P.lhMoney(s.fee)}` : ""}`));
      tiles.append(t);
    }
    box.append(tiles);
    const rows = a.rows || [];
    if (!rows.length) { box.append(el("p", "muted small", "Amazon's report shows no unit over 90 days old.")); return; }
    const list = el("div", "lhm-list");
    for (const r of agedAll ? rows : rows.slice(0, SHOW_FIRST)) {
      const row = el("div", "lhm-row");
      row.append(nameLine(r));
      const line = el("div", "lhm-line");
      line.append(el("span", "s-pill lhm-pill-" + r.level, P.AGED_LEVEL_LABEL[r.level] || r.level), el("span", "muted small", " " + P.lhAgedLine(r)));
      row.append(line);
      if ("sp" in r) row.append(ssBlock(r)); // B-1198 (v2.0.68); an older laptop sends no sp
      list.append(row);
    }
    box.append(list);
    const total = Math.max(rows.length, a.total || 0);
    if (rows.length > SHOW_FIRST) box.append(more(agedAll, rows.length, () => { agedAll = !agedAll; lastKey = ""; render(data); }));
    if (total > rows.length) box.append(el("p", "muted small", `${total - rows.length} more on the laptop's Pricing page.`));
  }

  function drawNoSales(box, lh) {
    const head = el("div", "lhm-head");
    head.append(el("h3", "ai-h2", "No sales"));
    const chips = el("div", "ctm-chipset lhm-win");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "No sales in the last");
    for (const w of P.NO_SALES_WINDOWS) {
      const b = el("button", "ctm-seg s-plain-btn", `${w} days`);
      b.type = "button";
      b.dataset.window = String(w);
      b.setAttribute("aria-pressed", String(w === win));
      b.addEventListener("click", () => {
        win = P.lhNormalizeWindow(w);
        nsAll = false;
        try { localStorage.setItem(KEY, String(win)); } catch (e) { /* fine */ }
        lastKey = "";
        render(data);
      });
      chips.append(b);
    }
    head.append(chips);
    box.append(head);
    const base = lh.base;
    const ns = P.noSalesFor(base, win);
    const tot = (lh.totals && lh.totals[win]) || null;
    const total = tot && tot.known ? Math.max(tot.total, ns.total) : ns.total;
    if (!base.stock || !base.stock.source) { box.append(el("p", "muted small", "No stock figures on file yet.")); return; }
    if (!ns.known) { box.append(el("p", "muted small warn-text", ns.reason)); return; }
    box.append(el("p", "muted small", `${plural(total, "listing")} with stock, no sale in ${win} days${ns.through ? ` through ${ns.through}` : ""} · ${tot ? `${tot.units} units · ${P.lhMoney(tot.value)} at cost` : ""}${ns.warn ? " · " + ns.warn : ""}`));
    box.append(el("p", "muted small lhm-src", `Stock ${ago(base.stock.at)} (${base.stock.source === "amazon" ? "Amazon" : "Replen Pulse"}) · sales: ${ns.sourceText}`));
    if (!ns.rows.length) { box.append(el("p", "muted small", `Every listing with stock sold at least once in the last ${win} days${ns.through ? ` (through ${ns.through})` : ""}.`)); return; }
    const list = el("div", "lhm-list");
    for (const r of nsAll ? ns.rows : ns.rows.slice(0, SHOW_FIRST)) {
      const row = el("div", "lhm-row");
      row.append(nameLine(r));
      const nums = el("div", "lhm-nums");
      const cell = (label, value) => { const c = el("div", "lhm-num"); c.append(el("div", "t-label", label), el("div", "lhm-v", value)); return c; };
      nums.append(cell("Stock", String(r.avail)), cell("At cost", r.value == null ? "-" : P.lhMoney(r.value)), cell("Last sale", r.sinceText), cell("Price", P.lhPriceVsBb(r.my, r.bb)));
      row.append(nums);
      if (r.restock) row.append(el("div", "muted small", `Last restock ${P.lhShortDay(r.restock)}`));
      if ("sp" in r) row.append(ssBlock(r)); // B-1198 (v2.0.68); an older laptop sends no sp
      list.append(row);
    }
    box.append(list);
    if (ns.rows.length > SHOW_FIRST) box.append(more(nsAll, ns.rows.length, () => { nsAll = !nsAll; lastKey = ""; render(data); }));
    if (total > ns.rows.length) box.append(el("p", "muted small", `${total - ns.rows.length} more on the laptop's Pricing page.`));
  }

  // rec (B-1198): the laptop's recent sends; undefined = keep the last ones.
  function render(lh, rec) {
    data = lh || null;
    if (rec !== undefined) recent = Array.isArray(rec) ? rec : null;
    const box = $("lhmBox");
    if (!box || !P || !P.noSalesFor) return;
    // B-1198 (v2.0.68): never redraw under his thumb - while a box has the
    // focus the new payload waits for the next one (not on blur: a redraw
    // between the blur and the click would swallow the Send tap).
    const a = document.activeElement;
    if (a && box.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    const key = JSON.stringify([data && data.at, win, nsAll, agedAll, recent && recent[0] ? recent[0].at : 0]);
    if (key === lastKey) return;
    lastKey = key;
    box.textContent = "";
    box.hidden = !data;
    if (!data) return;
    const aged = el("section", "lhm-card");
    drawAged(aged, data.aged);
    const ns = el("section", "lhm-card");
    if (data.base) drawNoSales(ns, data);
    box.append(aged, ns);
  }

  // B-1410 (v2.0.88): the Min cards draw the same Seller Snap block (ssBlock) and get redrawn after its sends.
  self.ShopperListingHealthView = { render, ssBlock: (r, presets) => ssBlock(r, presets), onRepaint: (f) => repaintHooks.push(f) };
})();
