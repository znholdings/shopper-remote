// remote/carryover-view.js - B-1803 (v2.0.137): the Buylist's carry-over panel ("Not fully bought - last 3 days") on the phone.
// Host: #carryOverHost (remote/index.html, under the Buylist actions). Data: payload.pages.carryOver (lib/remote-pages.js part
// `carryOver`, the same buildCarryOver the laptop panel uses). Buttons: Ignore / Undo ignore (carryOverDecide), Remaining N /
// Today's N / Custom (carryOverApply - the laptop's own two paths), Check stock (carryOverStockCheck - opens the retailer pages on the
// computer, read-only; refused while the Buy Queue runs). Text nodes only.
(function () {
  "use strict";
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const say = (t, bad) => { try { if (typeof toast === "function") toast(t, !!bad); } catch (e) { /* no toast */ } };
  const pl = () => { try { return typeof lastPayload !== "undefined" ? lastPayload : null; } catch (e) { return null; } };
  const pg = () => { const p = pl(); return p && p.pages && typeof p.pages === "object" ? p.pages : {}; };
  try { if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { carryOverDecide: "Carry-over: ignore / undo", carryOverApply: "Carry-over: add to today's list", carryOverStockCheck: "Carry-over: check stock" }); } catch (e) { /* cosmetic */ }

  async function act(name, body, o) {
    o = o || {};
    if (o.confirm && !window.confirm(o.confirm)) return null;
    const R = self.ShopperRemote;
    if (!R) { say("Not connected.", true); return null; }
    const btn = o.btn;
    const was = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Working..."; }
    try {
      const id = await R.sendCommand(name, body || {});
      if (!id) return null;
      const status = await R.waitFor(id);
      let row = null;
      try { row = await R.commandRow(id); } catch (e) { row = null; }
      const res = row && row.result && typeof row.result === "object" ? row.result : null;
      if (status !== "done") { say(((row && row.reason) || "Not done (" + status + ").").slice(0, 200), true); return { ok: false, result: res }; }
      if (res && res.ok === false) { say(String(res.reason || "The computer refused.").slice(0, 200), true); return { ok: false, result: res }; }
      return { ok: true, result: res };
    } catch (e) {
      say("Not sent: " + ((e && e.message) || "no connection"), true);
      return null;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = was; }
    }
  }
  const btnOf = (text, cls, fn) => { const b = el("button", cls || "mini-btn", text); b.type = "button"; b.addEventListener("click", () => fn(b)); return b; };
  function stockWords(s) {
    if (!s) return "";
    if (s.state === "in") return "In stock" + (s.maxQty ? " · max " + s.maxQty : "") + (s.onlyLeft ? " · only " + s.onlyLeft + " left" : "");
    if (s.state === "out") return "Out of stock (" + s.reason + ")";
    if (s.state === "skipped") return "Not checked: " + s.reason;
    return "Unknown: " + (s.reason || "no answer");
  }
  async function apply(line, choice, qty, btn) {
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n < 1) { say("Enter a quantity of 1 or more.", true); return; }
    const body = { key: line.key, asin: line.asin, fromDay: line.day, choice, qty: n };
    let r = await act("carryOverApply", body, { btn });
    if (r && !r.ok && r.result && r.result.needsOverride && window.confirm("That is above the normal guard rail. Add " + n + " anyway?")) r = await act("carryOverApply", { ...body, override: true }, { btn });
    if (r && r.ok) say("Sent " + n + " of " + line.asin + " to today's list.");
  }
  const noteOpen = new Set(), moreOpen = new Set(); // B-2072 (v2.0.158): which notes / "more choices" are open (this phone, in memory)
  function lineCard(line, day) {
    line = { ...line, day: day.day };
    const d = line.decision;
    const card = el("div", "line co-line" + (d && d.choice === "ignore" ? " co-ignored" : d ? " co-applied" : ""));
    card.appendChild(el("b", "", line.title || line.asin));
    const facts = [line.asin, line.bought + "/" + line.target + " bought", "short " + line.shortfall];
    if (line.remaining !== line.shortfall) facts.push(line.remaining + " still needed");
    card.appendChild(el("div", "small", facts.join(" · ")));
    const flags = [];
    if (line.stockFlag) flags.push(line.stockFlag === "limitReached" ? "Limit reached" : "Out of stock");
    if (line.repeatDays >= 2) flags.push("Missed " + line.repeatDays + " days running");
    flags.push(line.onToday ? "Today's list: " + (line.todayQty == null ? "?" : line.todayQty) : "Not on today's list");
    const sw = stockWords(line.stock);
    if (sw) flags.push(sw);
    if (d && d.choice !== "ignore") flags.push("Sent " + d.qty + " to today's list");
    card.appendChild(el("div", "muted small", flags.join(" · ")));
    if (line.note) {
      // B-2072 (v2.0.158): the reason is one line; a tap opens the whole text. B-2073: no backlog codes.
      const nt = el("div", "muted small co-note" + (noteOpen.has(line.key) ? " co-note-open" : ""), self.ShopperPlain ? self.ShopperPlain.note(line.note) : line.note);
      nt.setAttribute("role", "button"); nt.tabIndex = 0; nt.setAttribute("aria-expanded", String(noteOpen.has(line.key)));
      const flip = () => { const on = nt.classList.toggle("co-note-open"); if (on) noteOpen.add(line.key); else noteOpen.delete(line.key); nt.setAttribute("aria-expanded", String(on)); };
      nt.addEventListener("click", flip);
      nt.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
      card.appendChild(nt);
    }
    const acts = el("div", "co-actions");
    if (d && d.choice === "ignore") {
      acts.appendChild(btnOf("Undo ignore", "mini-btn", (b) => act("carryOverDecide", { key: line.key, asin: line.asin, fromDay: day.day, choice: "undo" }, { btn: b })));
    } else {
      acts.appendChild(btnOf("Ignore", "mini-btn", (b) => act("carryOverDecide", { key: line.key, asin: line.asin, fromDay: day.day, choice: "ignore" }, { btn: b })));
      acts.appendChild(btnOf(line.stockCap && line.remainingPick < line.remaining ? "Remaining " + line.remainingPick + " (stock cap)" : "Remaining " + line.remainingPick, "mini-btn primary-btn", (b) => apply(line, "remaining", line.remainingPick, b)));
      // B-2072 (v2.0.158): Today's / Qty / Custom sit behind a ⋯ (payloads unchanged).
      const more = btnOf("⋯", "mini-btn co-more", () => {
        const on = extra.hidden; extra.hidden = !on;
        if (on) moreOpen.add(line.key); else moreOpen.delete(line.key);
        more.setAttribute("aria-expanded", String(on));
      });
      more.setAttribute("aria-label", "More choices");
      more.setAttribute("aria-expanded", String(moreOpen.has(line.key)));
      acts.appendChild(more);
      const extra = el("div", "co-extra");
      extra.hidden = !moreOpen.has(line.key);
      if (line.onToday && line.todayQty > 0) extra.appendChild(btnOf("Today's " + line.todayQty, "mini-btn", (b) => apply(line, "today", line.todayQty, b)));
      const custom = el("input", "co-custom");
      custom.type = "number"; custom.min = "1"; custom.placeholder = "Qty"; custom.inputMode = "numeric";
      extra.appendChild(custom);
      extra.appendChild(btnOf("Custom", "mini-btn", (b) => apply(line, "custom", custom.value, b)));
      acts.appendChild(extra);
    }
    card.appendChild(acts);
    return card;
  }
  let drawn = "";
  function draw() {
    const host = document.getElementById("carryOverHost");
    if (!host) return;
    const a = document.activeElement;
    if (a && host.contains(a) && a.tagName === "INPUT") return; // never redraw under a typed quantity
    const data = pg().carryOver || null;
    const key = JSON.stringify(data);
    if (key === drawn) return;
    drawn = key;
    host.textContent = "";
    const days = data && Array.isArray(data.days) ? data.days : [];
    const count = days.reduce((t, d) => t + (d.lines || []).length, 0);
    host.hidden = count === 0;
    if (!count) return;
    const sec = el("section", "card co-card");
    const head = el("h3", "", "Not fully bought - last 3 days");
    head.appendChild(el("span", "count", " " + count));
    sec.appendChild(head);
    if (!data.hasList) sec.appendChild(el("p", "muted small", "Generate or restore today's buylist first - the buttons add to it."));
    sec.appendChild(btnOf("Check stock", "mini-btn", async (b) => {
      const items = [];
      for (const d of days) for (const l of d.lines || []) if (l.sourceUrl && !(l.decision && l.decision.choice === "ignore")) items.push({ asin: l.asin, sourceUrl: l.sourceUrl });
      if (!items.length) { say("No line has a store link to check.", true); return; }
      const r = await act("carryOverStockCheck", { items: items.slice(0, 40) }, { btn: b, confirm: "Check stock for " + Math.min(items.length, 40) + " product(s)? The computer opens each store page (read only)." });
      if (r && r.ok) say("Stock checked" + (r.result && r.result.checked != null ? ": " + r.result.checked + " product(s)" : "") + ".");
    }));
    for (const d of days) {
      sec.appendChild(el("div", "co-day-head small", d.label + " · " + d.lines.length + " line(s)"));
      for (const l of d.lines) sec.appendChild(lineCard(l, d));
    }
    host.appendChild(sec);
  }
  function start() { draw(); setInterval(draw, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperCarryOver = Object.freeze({ draw });
})();
