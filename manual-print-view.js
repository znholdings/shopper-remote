// remote/manual-print-view.js - B-1057 (v2.0.53). Manual Print on the phone.
//
// The laptop's Pipeline rows have a small printer (pipeline/pipeline.js
// addManualPrintButton -> pipeline/labels-popup.js manualPrint, B-938). The
// phone's Stock tab rows (House, Prep, In transit - the same Pipeline
// products) get the same printer, under the units, and the same form:
//   - "How many labels" - always asked, filled with the row's House units;
//   - "Best by" - only when ScanPower's listing needs one, the last date
//     printed for the ASIN filled in (typed MM/DD/YYYY, read with the
//     laptop's own normalizeExpiry - a half or passed date is never sent);
//   - which listing, when ScanPower has several;
//   - Print -> the laptop prints through the SAME SHOPPER_LABELS_PRINT the
//     laptop pop-up sends (manualPrint command, background/label-remote-
//     handlers.js) - the B-937 cap ask comes back here as Yes / Skip.
//   - the result line under the form ("Printed N label(s) for ... on ...").
//
// The laptop must be there. When it has gone quiet (no update for 3 min, the
// same rule as the "Laptop not heard from" banner) the form says "The laptop
// isn't connected - the print can't run now" and sends NOTHING. The laptop
// refuses a print older than 50 s (lib/remote-protocol.js maxAgeMs) and the
// phone takes back one still not picked up at 60 s (cancelled while still
// pending) - both say the same words. The laptop's limit is the shorter one, so
// a print the phone has called "not run" can never run after all. Nothing
// waits in the relay to print later.
//
// Classic script: sets self.ShopperManualPrint. Uses self.ShopperRemote
// (app.js), self.ShopperDateInput (date-input.js) and self.ShopperExpiry
// (expiry-lib.js) at call time. The pop-up reuses the Receive pop-up's
// rc-overlay / rc-card look (receive-count.css).
(function (root) {
  "use strict";

  const OFFLINE_TEXT = "The laptop isn't connected - the print can't run now.";
  const PICKUP_MS = 60 * 1000; // over the protocol's 50 s maxAgeMs (see the top)
  const ANSWER_MS = 3 * 60 * 1000;
  const POLL_EVERY_MS = 1500;
  const MAX_QTY = 999;
  const PRINTER_SVG = '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>';

  // Tests swap the clock and the wait.
  const timing = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

  let cur = null; // the open form

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const remote = () => root.ShopperRemote || null;
  // The laptop refused it as too old (lib/remote-protocol.js validateCommand):
  // it was not connected when the phone sent it.
  const tooLate = (o) => o.status === "rejected" && /was not connected/.test(String(o.reason || ""));
  function online() {
    const R = remote();
    return !!(R && typeof R.laptopOnline === "function" && R.laptopOnline());
  }
  function todayIso() {
    return new Date(timing.now()).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  }
  function isoToUs(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? m[2] + "/" + m[3] + "/" + m[1] : "";
  }

  // The quantity box: the row's House units (whole, 1..999), else 1 - the laptop's rule.
  function defaultQty(house) {
    const n = Math.floor(Number(house));
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_QTY) : 1;
  }

  // The Best-by box -> { iso, error }.
  function readDate(text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return { iso: "", error: "This product needs a Best-by date on its label - type the date." };
    const E = root.ShopperExpiry;
    if (E && E.normalizeExpiry) {
      const r = E.normalizeExpiry(t, { todayIso: todayIso() });
      return r.error ? { iso: "", error: r.error } : { iso: r.iso, error: "" };
    }
    const D = root.ShopperDateInput;
    const iso = D && D.readValue ? D.readValue(t) : "";
    return iso ? { iso, error: "" } : { iso: "", error: "Type the date as MM/DD/YYYY." };
  }

  // One command, then its answer from the command row.
  // -> { status: "done" | "failed" | "rejected" | "offline" | "not sent" | "timeout", reason, result }
  // The ONE offline gate: a laptop that has gone quiet gets nothing sent.
  async function runCommand(name, payload) {
    const R = remote();
    if (!R || !R.sendQuiet || !R.readCommand || !online()) return { status: "offline" };
    let id = null;
    try { id = await R.sendQuiet(name, payload); } catch (err) { id = null; }
    if (!id) return { status: "not sent" };
    const start = timing.now();
    for (;;) {
      await timing.sleep(POLL_EVERY_MS);
      let row = null;
      try { row = await R.readCommand(id); } catch (err) { row = null; }
      const st = row && row.status;
      if (st === "done" || st === "failed" || st === "rejected") return { status: st, reason: row.reason || "", result: row.result || null };
      if (st === "cancelled") return { status: "offline" };
      const age = timing.now() - start;
      if ((!st || st === "pending") && age >= PICKUP_MS) {
        let took = false;
        try { took = await R.cancelPending(id, "the laptop did not pick it up within 60 s - not run"); } catch (err) { took = false; }
        if (took) return { status: "offline" };
      }
      if (age >= ANSWER_MS) return { status: "timeout" };
    }
  }

  // A print's outcome -> { text, tone: "ok" | "bad" | "" }.
  function printOutcome(out) {
    const o = out || {};
    const res = o.result && typeof o.result === "object" ? o.result : null;
    if (o.status === "offline" || tooLate(o)) return { text: OFFLINE_TEXT, tone: "bad" };
    if (o.status === "not sent") return { text: "The print did not reach the laptop, so nothing printed.", tone: "bad" };
    if (o.status === "timeout") return { text: "The laptop did not answer in 3 minutes - check its Last prints before printing again.", tone: "bad" };
    if (res && res.truncated) return { text: "The laptop answered, but its answer was too long to show - check the laptop's Last prints.", tone: "" };
    if (res && res.note === "no direct response") return { text: "The laptop has not finished after 30 s (QZ Tray may be waiting for its Allow dialog) - check the laptop's Last prints before printing again.", tone: "" };
    // Over the cap: the Yes / Skip box under it says it all (the laptop pop-up shows only the box).
    if (res && res.askPrompt && Array.isArray(res.askPrompt.items) && res.askPrompt.items.length) return { text: "", tone: "" };
    if (res && typeof res.line === "string" && res.line) {
      return { text: res.line, tone: Number(res.printedLabels) > 0 ? "ok" : res.askPrompt ? "" : "bad" };
    }
    if (o.status === "rejected") return { text: "Not printed: the laptop refused it" + (o.reason ? " - " + o.reason : "") + ".", tone: "bad" };
    if (o.status === "done") return { text: "Sent to the laptop's printer.", tone: "ok" };
    return { text: "Not printed: " + (o.reason || "the laptop said no") + ".", tone: "bad" };
  }

  // The listing read's outcome -> { facts } | { text } (why the form cannot print).
  function lookupOutcome(out) {
    const o = out || {};
    const res = o.result && typeof o.result === "object" ? o.result : null;
    if (o.status === "offline" || tooLate(o)) return { text: OFFLINE_TEXT };
    if (o.status === "not sent") return { text: "The request did not reach the laptop." };
    if (o.status === "timeout") return { text: "The laptop did not answer in 3 minutes." };
    if (o.status === "done" && res && res.ok) return { facts: res };
    if (res && res.error) return { text: "Could not read ScanPower: " + res.error + (res.loginRequired ? " - sign in at unity.scanpower.com on the laptop and try again." : "") };
    return { text: "Could not read ScanPower: " + (o.reason || "no answer") + "." };
  }

  function close() {
    const m = cur;
    if (!m || m.busy) return;
    m.overlay.remove();
    document.removeEventListener("keydown", m.onKey);
    cur = null;
  }

  // row = { asin, title, house }
  function open(row) {
    if (!row || !row.asin) return null;
    if (cur) { cur.busy = false; close(); }
    const overlay = el("div", "rc-overlay mp-overlay");
    const card = el("div", "rc-card mp-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Manual Print");
    card.tabIndex = -1;
    const head = el("div", "rc-head");
    const heads = el("div", "rc-heads");
    const kicker = el("div", "mp-kicker", "Manual Print");
    const title = el("div", "rc-title mp-title", row.title || row.asin);
    const ids = el("div", "rc-asin mp-ids", row.asin);
    heads.append(kicker, title, ids);
    const x = el("button", "rc-x mp-x", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    head.append(heads, x);
    // B-1093 (v2.0.56): the labels that print count as printed in the open ScanPower batch (the laptop adds them).
    const note = el("div", "mp-note", "Prints this product's FNSKU labels on the laptop's label printer now. Nothing is added to any batch; when the product is in the open ScanPower batch, these labels count as printed there.");
    const status = el("div", "rc-msg mp-status");
    const retry = el("button", "rc-btn mp-retry", "Try again");
    retry.type = "button";
    retry.hidden = true;
    const form = el("div", "mp-form");
    const qtyWrap = el("label", "mp-field");
    const qty = el("input", "rc-input mp-qty");
    qty.type = "number"; qty.min = "1"; qty.max = String(MAX_QTY); qty.step = "1";
    qty.setAttribute("inputmode", "numeric");
    qty.value = String(defaultQty(row.house));
    qtyWrap.append(el("span", "mp-lab", "How many labels"), qty);
    const dateWrap = el("label", "mp-field mp-datewrap");
    const date = el("input", "rc-input mp-date");
    if (root.ShopperDateInput && root.ShopperDateInput.attach) root.ShopperDateInput.attach(date);
    else { date.type = "text"; date.setAttribute("inputmode", "numeric"); date.placeholder = "MM/DD/YYYY"; }
    dateWrap.append(el("span", "mp-lab", "Best by"), date);
    dateWrap.hidden = true;
    form.append(qtyWrap, dateWrap);
    const foot = el("div", "rc-foot mp-foot");
    const go = el("button", "rc-btn rc-primary mp-go", "Print");
    go.type = "button";
    go.disabled = true;
    const cancel = el("button", "rc-btn rc-quiet mp-close", "Close");
    cancel.type = "button";
    foot.append(go, cancel);
    const result = el("div", "rc-msg mp-result");
    card.append(head, note, status, retry, form, foot, result);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const m = { overlay, card, row, facts: null, busy: false, pick: null, onKey: null, looked: null };
    cur = m;
    const listing = () => {
      const ls = (m.facts && m.facts.listings) || [];
      return (m.pick && ls.find((l) => l.msku === m.pick.value)) || ls[0] || null;
    };
    const needsDate = () => { const l = listing(); return !!(l && l.expirationRequired); };
    const say = (box, text, tone) => { box.textContent = text || ""; box.className = box.className.replace(/\s*rc-msg-(ok|bad)/g, "") + (tone ? " rc-msg-" + tone : ""); };
    const paintGo = () => {
      const q = Math.floor(Number(qty.value));
      const good = Number.isFinite(q) && q > 0 && q <= MAX_QTY;
      go.textContent = m.busy ? "Printing…" : good ? "Print " + q + " label(s)" : "Print";
      go.disabled = m.busy || !listing() || !good || (needsDate() && !date.value.trim());
      dateWrap.hidden = !needsDate();
      cancel.disabled = m.busy;
      x.disabled = m.busy;
    };

    const showFacts = (facts) => {
      m.facts = facts;
      if (facts.title) title.textContent = facts.title;
      const ls = facts.listings || [];
      if (!ls.length) {
        say(status, facts.noListing ? "ScanPower has no listing for this ASIN - nothing to print." : "ScanPower's listing has no FNSKU - nothing to print.", "bad");
        paintGo();
        return;
      }
      if (ls.length > 1) {
        const pick = el("select", "mp-pick");
        pick.setAttribute("aria-label", "Which listing");
        for (const l of ls) {
          const o = el("option", "", l.fnsku + " · " + l.msku + (l.condition && l.condition !== "New" ? " · " + l.condition : ""));
          o.value = l.msku;
          pick.appendChild(o);
        }
        pick.addEventListener("change", paintGo);
        m.pick = pick;
        ids.textContent = (facts.asin || row.asin) + " · ";
        ids.appendChild(pick);
      } else {
        ids.textContent = (facts.asin || row.asin) + " · " + ls[0].fnsku + " · " + ls[0].msku;
      }
      if (facts.lastExpires && !date.value) date.value = isoToUs(facts.lastExpires);
      say(status, facts.expirationRequired ? "This product needs a Best-by date on its label" + (facts.lastExpires ? " (the last one printed is filled in)." : ".") : "", "");
      paintGo();
    };

    const lookup = async () => {
      retry.hidden = true;
      if (!online()) { say(status, OFFLINE_TEXT, "bad"); retry.hidden = false; paintGo(); return; }
      say(status, "Asking the laptop for ScanPower's listing…", "");
      const out = await runCommand("manualPrintLookup", { asin: row.asin, title: row.title || "" });
      if (cur !== m) return;
      const got = lookupOutcome(out);
      if (got.facts) { showFacts(got.facts); return; }
      say(status, got.text, "bad");
      retry.hidden = false;
      paintGo();
    };

    const showAsk = (prompt, answer) => {
      const picks = {};
      const box = el("div", "rc-ask mp-ask");
      box.appendChild(el("div", "rc-ask-text", (prompt.title || "Over the label cap") + " - " + (prompt.detail || "nothing has printed yet.")));
      for (const it of prompt.items || []) {
        box.appendChild(el("div", "rc-ask-text mp-ask-q", it.question || "Print " + it.total + " labels?"));
        const btns = el("div", "rc-ask-btns");
        for (const v of ["yes", "skip"]) {
          const b = el("button", "rc-btn" + (v === "yes" ? " rc-primary" : ""), (prompt.labels && prompt.labels[v]) || (v === "yes" ? "Yes" : "Skip"));
          b.type = "button";
          b.dataset.answer = v;
          b.dataset.fnsku = it.fnsku;
          b.addEventListener("click", () => {
            picks[it.fnsku] = v;
            for (const y of btns.querySelectorAll("button")) y.disabled = true;
            btns.appendChild(el("span", "mp-picked", v === "yes" ? "Will print." : "Skipped."));
            if ((prompt.items || []).every((z) => picks[z.fnsku])) {
              answer({
                approved: prompt.items.filter((z) => picks[z.fnsku] === "yes").map((z) => z.fnsku),
                declined: prompt.items.filter((z) => picks[z.fnsku] === "skip").map((z) => z.fnsku),
              });
            }
          });
          btns.appendChild(b);
        }
        box.appendChild(btns);
      }
      result.appendChild(box);
    };

    const doPrint = async (answers) => {
      if (m.busy) return;
      if (!answers && go.disabled) return;
      const l = listing();
      if (!l) return;
      const q = Math.floor(Number(qty.value));
      if (!(Number.isFinite(q) && q > 0 && q <= MAX_QTY)) { say(result, "Type how many labels to print (1 to " + MAX_QTY + ").", "bad"); return; }
      let iso = "";
      if (needsDate()) {
        const d = readDate(date.value);
        if (d.error) { say(result, d.error, "bad"); return; }
        iso = d.iso;
      }
      m.busy = true;
      paintGo();
      say(result, "Asking the laptop to print…", "");
      const payload = { asin: row.asin, title: (m.facts && m.facts.title) || row.title || "", msku: l.msku, qty: q, expires: iso };
      if (answers) { payload.approved = answers.approved || []; payload.declined = answers.declined || []; }
      const out = await runCommand("manualPrint", payload);
      m.busy = false;
      if (cur !== m) return;
      paintGo();
      const shown = printOutcome(out);
      say(result, shown.text, shown.tone);
      const res = out && out.result;
      if (res && res.askPrompt && Array.isArray(res.askPrompt.items) && res.askPrompt.items.length) {
        showAsk(res.askPrompt, (a) => doPrint(a));
      }
    };

    m.onKey = (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "Enter" && (e.target === qty || e.target === date)) { e.preventDefault(); doPrint(); }
    };
    document.addEventListener("keydown", m.onKey);
    qty.addEventListener("input", paintGo);
    date.addEventListener("input", paintGo);
    go.addEventListener("click", () => doPrint());
    cancel.addEventListener("click", close);
    x.addEventListener("click", close);
    retry.addEventListener("click", () => { m.looked = lookup(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    paintGo();
    m.looked = lookup();
    return m;
  }

  // The small printer under a row's units.
  function button(r) {
    const b = el("button", "mp-row-btn");
    b.type = "button";
    b.dataset.asin = r.asin;
    b.title = "Manual Print";
    b.setAttribute("aria-label", "Manual Print - " + (r.title || r.asin));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = PRINTER_SVG;
    b.appendChild(svg);
    b.addEventListener("click", () => open({ asin: r.asin, title: r.title || "", house: r.house }));
    return b;
  }

  root.ShopperManualPrint = Object.freeze({
    button, open, close, defaultQty, readDate, runCommand, printOutcome, lookupOutcome,
    OFFLINE_TEXT, PICKUP_MS, ANSWER_MS, _timing: timing, _current: () => cur,
  });
})(typeof self !== "undefined" ? self : globalThis);
