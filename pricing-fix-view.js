// remote/pricing-fix-view.js - B-1599 (v2.0.116): "Fix this one" on the phone, for a pricing-error row in Do next.
// Two taps, never one: "Fix this one" only ASKS for the plan (the laptop reads Seller Snap and Amazon, nothing is changed),
// then "Approve and start" sends the plan that was shown (+ the Delete box) and the laptop re-checks it before it starts.
// Commands: pricingFixPlan / pricingFixApply (lib/remote-protocol.js) -> the laptop's SHOPPER_PRICING_FIX_START. Stop / Restore stay on the laptop.
// Sets self.ShopperPhoneFix = { build(sku) } -> a node. DOM by createElement / textContent only.
(function (root) {
  "use strict";
  const states = new Map(); // sku -> { phase: "reading"|"plan"|"starting"|"started"|"failed", plan, words, note, text, del }
  const boxes = new Map(); // sku -> the newest node for that SKU (the list is redrawn by the page; the state survives)

  function mk(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const busy = () => [...states.values()].some((s) => s.phase === "reading" || s.phase === "starting");

  async function ask(name, payload) {
    const R = root.ShopperRemote;
    if (!R || !R.sendCommand) return { ok: false, text: "The phone is not connected to the laptop." };
    let id = null;
    try { id = await R.sendCommand(name, payload); } catch (e) { id = null; }
    if (!id) return { ok: false, text: "Not sent - the phone could not reach the laptop's relay. Try again." };
    let status = "done";
    try { if (R.waitFor) status = await R.waitFor(id); } catch (e) { status = "done"; }
    let row = null;
    try { if (R.readCommand) row = await R.readCommand(id); } catch (e) { row = null; }
    const res = row && row.result && typeof row.result === "object" ? row.result : null;
    if (status === "timeout") return { ok: false, text: "No answer from the laptop in 5 minutes - check its Pricing page before trying again." };
    if (status !== "done") return { ok: false, res, text: String((row && row.reason) || (res && (res.reason || res.error)) || `not done (${status})`) };
    return { ok: true, res };
  }

  function draw(sku) {
    const box = boxes.get(sku);
    if (!box) return;
    const st = states.get(sku) || null;
    box.textContent = "";
    const off = busy();
    if (!st || st.phase === "failed" || st.phase === "started") {
      if (st && st.text) box.append(mk("div", "dnr-fix-note" + (st.phase === "failed" ? " dnr-fix-bad" : ""), st.text));
      if (st && st.phase === "started") return;
      const b = mk("button", "mini-btn dnr-fix-btn", "Fix this one");
      b.type = "button";
      b.disabled = off;
      b.addEventListener("click", () => plan(sku));
      box.append(b);
      return;
    }
    if (st.phase === "reading") { box.append(mk("div", "dnr-fix-note", "Asking the laptop to read Seller Snap and Amazon (nothing is changed yet)...")); return; }
    if (st.phase === "starting") { box.append(mk("div", "dnr-fix-note", "Approved - the laptop is starting the fix (up to a minute)...")); return; }
    // phase "plan": the plan, the Delete box, Approve / Cancel
    box.append(mk("div", "dnr-fix-head", "Fix this one - the plan"));
    if (st.note) box.append(mk("div", "dnr-fix-note dnr-fix-bad", st.note));
    box.append(mk("div", "dnr-fix-plan", st.words || "The laptop sent no words for this plan."));
    const noStock = Number(st.plan.stock) === 0;
    const lab = mk("label", "dnr-fix-del");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!st.del && noStock;
    cb.disabled = !noStock;
    cb.addEventListener("change", () => { st.del = cb.checked; });
    lab.append(cb, mk("span", null, noStock
      ? " Delete this listing once the error is resolved (Amazon's stock, orders and stranded list are checked again first)"
      : " Delete this listing once the error is resolved - not offered: this SKU has stock at Amazon"));
    box.append(lab);
    const bar = mk("div", "dnr-fix-bar");
    const go = mk("button", "mini-btn dnr-fix-go", "Approve and start");
    go.type = "button";
    const no = mk("button", "mini-btn", "Cancel");
    no.type = "button";
    go.addEventListener("click", () => approve(sku, cb.checked && noStock));
    no.addEventListener("click", () => { states.delete(sku); draw(sku); });
    bar.append(go, no);
    box.append(bar);
  }

  async function plan(sku) {
    if (busy()) return;
    states.set(sku, { phase: "reading" });
    for (const k of boxes.keys()) draw(k);
    const r = await ask("pricingFixPlan", { sku });
    const res = r.res || {};
    if (r.ok && res.plan && typeof res.plan === "object") states.set(sku, { phase: "plan", plan: res.plan, words: String(res.words || "") });
    else states.set(sku, { phase: "failed", text: `Not started: ${r.ok ? res.reason || "the laptop gave no plan" : r.text}` });
    for (const k of boxes.keys()) draw(k);
  }

  async function approve(sku, del) {
    const cur = states.get(sku);
    if (!cur || cur.phase !== "plan" || busy()) return;
    const p = cur.plan;
    states.set(sku, { ...cur, phase: "starting" });
    for (const k of boxes.keys()) draw(k);
    // Only the figures the laptop compares after it plans again.
    const confirm = { mode: p.mode, start: p.start, target: p.target, floor: p.floor, stepCents: p.stepCents };
    const r = await ask("pricingFixApply", { sku, confirm, deleteWhenActive: del === true });
    const res = r.res || {};
    if (r.ok && res.ok !== false) states.set(sku, { phase: "started", text: `Started${del ? " (the listing is deleted once the error is resolved)" : ""} - the laptop is changing the price now. Watch it on the laptop's Pricing page.` });
    else if (res.changed && res.plan) states.set(sku, { phase: "plan", plan: res.plan, words: String(res.words || ""), del, note: res.reason || "The figures changed since you looked - check the new plan." });
    else states.set(sku, { phase: "failed", text: `Not started: ${r.ok ? res.reason || "no answer" : r.text}` });
    for (const k of boxes.keys()) draw(k);
  }

  function build(sku) {
    const box = mk("div", "dnr-fix");
    boxes.set(sku, box);
    draw(sku);
    return box;
  }

  root.ShopperPhoneFix = Object.freeze({ build });
})(self);
