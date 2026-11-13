// remote/pricing-actions-view.js - v2.0.135 (B-1797, chunk P3): the Pricing buttons the phone could not send.
//   Check aged inventory, Check pricing errors (scan then check), COGS check run + per-row pick + Apply (confirm),
//   dismiss a pricing error, Stop a running price fix (confirm). Settings-set / tick-now stay off the phone.
// Host (index.html, builder C): #bmmActionsHost. app.js calls ShopperPricingActions.render(payload) with the whole
// projection; this reads payload.pages.{cogs,pricingErrors,pricingFixes}.
(function () {
  "use strict";
  // ---- shared by the four *-actions-view.js files (identical copy; the first one loaded wins) ----
  function makeAct() {
    const WAIT_MS = 3 * 60 * 1000;
    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = String(text);
      return n;
    }
    function toast(text, isError) {
      const t = document.getElementById("toast");
      if (!t) return;
      t.textContent = text;
      t.hidden = false;
      t.classList.toggle("error", !!isError);
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { t.hidden = true; }, 3500);
    }
    function btn(text, cls, onClick) {
      const b = el("button", "secondary-btn ops-btn" + (cls ? " " + cls : ""), text);
      b.type = "button";
      if (onClick) b.addEventListener("click", onClick);
      return b;
    }
    // The reason a finished command row failed, or "" when it worked.
    function failure(status, row) {
      const res = row && row.result && typeof row.result === "object" ? row.result : null;
      if (status !== "done") return (row && row.reason) || ("the computer said " + status);
      if (res && res.ok === false) return res.error || res.reason || res.message || "the computer said no";
      return "";
    }
    // One labelled button -> optional window.confirm -> one command -> toast. Never two sends for one tap.
    async function run(o) {
      if (o.btn && (o.btn.disabled || o.btn.dataset.busy)) return { ok: false, busy: true };
      if (o.confirm && !window.confirm(o.confirm)) return { ok: false, cancelled: true };
      const R = self.ShopperRemote;
      if (!R) { toast("Not connected.", true); return { ok: false }; }
      let pill = null;
      if (o.btn) {
        o.btn.disabled = true;
        o.btn.dataset.busy = "1";
        pill = el("span", "ops-pill", "Working...");
        pill.setAttribute("role", "status");
        if (o.btn.parentNode) o.btn.parentNode.insertBefore(pill, o.btn.nextSibling);
      }
      let out = { ok: false };
      try {
        const id = await R.sendCommand(o.name, o.payload || {});
        if (!id) { toast("Not sent - check the connection.", true); return out; }
        const status = await Promise.race([R.waitFor(id), new Promise((r) => setTimeout(() => r("timeout"), WAIT_MS))]);
        const row = await R.readCommand(id).catch(() => null);
        const why = failure(status, row);
        const res = row && row.result && typeof row.result === "object" ? row.result : null;
        if (why) toast((o.fail || "Not done") + ": " + String(why).slice(0, 160), true);
        else if (res && res.note === "no direct response") toast("Started on the computer - watch the activity bar.");
        else toast(o.ok || "Done");
        out = { ok: !why, row, result: res, status };
        if (!why && typeof o.done === "function") o.done(res, row);
      } catch (e) {
        toast("Not sent: " + ((e && e.message) || "no connection"), true);
      } finally {
        if (pill) pill.remove();
        if (o.btn) { o.btn.disabled = false; delete o.btn.dataset.busy; }
      }
      return out;
    }
    const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
    const arr = (v) => (Array.isArray(v) ? v : []);
    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    // Don't redraw under a finger: a focused field or a running button holds the redraw.
    const editing = (host) => !!(host && (host.querySelector("[data-busy]") || (host.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))));
    return { el, toast, btn, run, failure, clip, arr, obj, editing };
  }
  if (!document.getElementById("ops-act-css")) {
    const st = document.createElement("style");
    st.id = "ops-act-css";
    st.textContent = ".ops-card{margin:10px 0;padding:8px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px}.ops-card h3{margin:0 0 6px;font-size:15px}.ops-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.ops-line{padding:6px 0;border-top:1px solid color-mix(in srgb,currentColor 15%,transparent);overflow-wrap:anywhere}.ops-pill{font-size:12px;opacity:.8}.ops-btn{min-height:40px}.ops-in{min-height:36px;max-width:100%;box-sizing:border-box}";
    document.head.appendChild(st);
  }
  const A = self.ShopperOpsAct || (self.ShopperOpsAct = makeAct());
  const { el, toast, btn, run, clip, arr, obj, editing } = A;

  Object.assign(typeof REMOTE_LABELS !== "undefined" ? REMOTE_LABELS : {}, {
    agedCheck: "Check aged inventory", cogsCheckRun: "Run COGS check", cogsCheckApply: "Apply COGS picks",
    pricingErrorsCheck: "Check pricing errors", pricingIssuesScan: "Scan pricing issues", pricingErrorsDismiss: "Dismiss pricing error", pricingFixStop: "Stop price fix",
  });

  const $ = (id) => document.getElementById(id);
  let sig = "";
  const money = (v) => (Number.isFinite(Number(v)) && v !== "" && v != null ? "$" + Number(v).toFixed(2) : "-");

  let menuOpen = false; // B-2071 (v2.0.158): the Checks menu's open state (this phone, in memory)
  const when = (v) => (self.ShopperPlain ? self.ShopperPlain.when(v) : clip(v, 30)); // B-2073

  function checksRow() {
    const row = el("div", "ops-row");
    const aged = btn("Check aged inventory", "ops-aged");
    aged.addEventListener("click", () => run({ name: "agedCheck", payload: {}, btn: aged, ok: "Checking aged inventory on the computer" }));
    const errs = btn("Check pricing errors now", "ops-errs");
    // The desktop presses Scan, THEN Check (belowmin.js): one phone button sends both, in order.
    errs.addEventListener("click", async () => {
      const a = await run({ name: "pricingIssuesScan", payload: {}, btn: errs, ok: "Scanned" });
      if (a.ok) await run({ name: "pricingErrorsCheck", payload: {}, btn: errs, ok: "Checking pricing errors on the computer" });
    });
    row.append(aged, errs);
    return row;
  }
  function checks() {
    const card = el("section", "ops-card ops-pricing-checks");
    card.appendChild(el("h3", "", "Checks"));
    card.appendChild(checksRow());
    return card;
  }
  // B-2071 (v2.0.158): Check aged / Check pricing errors / Run COGS check and their last-run lines in ONE closed menu.
  function checksMenu(cogs) {
    const c = obj(cogs), check = obj(c.check);
    const n = arr(check.rows).length;
    const d = el("details", "ops-card ops-checks-menu");
    d.open = menuOpen;
    const sum = el("summary", "ops-menu-sum", "⋯ Checks");
    if (n) sum.appendChild(el("span", "count", " · COGS: " + n + " to fix"));
    d.appendChild(sum);
    d.addEventListener("toggle", () => { menuOpen = d.open; });
    d.appendChild(checksRow());
    const top = el("div", "ops-row");
    const go = btn("Run COGS check", "ops-cogs-run");
    go.addEventListener("click", () => run({ name: "cogsCheckRun", payload: {}, btn: go, ok: "Checking COGS on the computer" }));
    top.appendChild(go);
    d.appendChild(top);
    if (check.at) d.appendChild(el("p", "muted small", "Last check " + when(check.at) + (c.tolerance != null ? " · tolerance " + money(c.tolerance) : "")));
    if (c.lastApply) d.appendChild(el("p", "muted small", "Last apply: " + when(typeof c.lastApply === "string" ? c.lastApply : c.lastApply.at || "")));
    return d;
  }

  function errorsCard(pe) {
    const rows = arr(Array.isArray(pe) ? pe : obj(pe).rows);
    if (!rows.length) return null;
    const card = el("section", "ops-card ops-pricing-errors");
    card.appendChild(el("h3", "", "Pricing errors (" + rows.length + ")"));
    for (const r of rows.slice(0, 30)) {
      const line = el("div", "ops-line ops-err-row");
      line.appendChild(el("div", "", clip(r.title || r.asin || r.sku, 80)));
      line.appendChild(el("div", "muted small", [clip(r.kind, 40), clip(r.sku, 40), clip(r.since, 30)].filter(Boolean).join(" · ")));
      const d = btn("Dismiss", "ops-err-dismiss");
      d.addEventListener("click", () => run({ name: "pricingErrorsDismiss", payload: { sku: clip(r.sku, 60) }, btn: d, ok: "Dismissed", done: () => line.remove() }));
      line.appendChild(d);
      card.appendChild(line);
    }
    return card;
  }

  function fixesCard(fx) {
    const rows = arr(Array.isArray(fx) ? fx : obj(fx).rows);
    if (!rows.length) return null;
    const card = el("section", "ops-card ops-pricing-fixes");
    card.appendChild(el("h3", "", "Running price fixes (" + rows.length + ")"));
    for (const r of rows.slice(0, 20)) {
      const line = el("div", "ops-line ops-fix-row");
      line.appendChild(el("div", "", clip(r.title || r.asin || r.sku, 80)));
      line.appendChild(el("div", "muted small", [clip(r.mode, 20), "start " + money(r.start), "target " + money(r.target), "floor " + money(r.floor), clip(r.state, 30)].join(" · ")));
      const s = btn("Stop this fix", "ops-fix-stop");
      s.addEventListener("click", () => run({ name: "pricingFixStop", payload: { sku: clip(r.sku, 60) }, confirm: "Stop this fix? Min/max go back to what they were.", btn: s, ok: "Fix stopped" }));
      line.appendChild(s);
      card.appendChild(line);
    }
    return card;
  }

  function cogsCard(cogs) {
    const c = obj(cogs), check = obj(c.check);
    const rows = arr(check.rows);
    if (!rows.length) return null; // B-2071 (v2.0.158): no differences - Run COGS check and the last-check line live in the Checks menu
    const card = el("section", "ops-card ops-cogs");
    card.appendChild(el("h3", "", "COGS check"));
    const picks = {};
    for (const r of rows.slice(0, 40)) {
      const asin = clip(r.asin, 10);
      picks[asin] = r.pick === "sb" ? "sb" : "sheet";
      const line = el("div", "ops-line ops-cogs-row");
      line.dataset.asin = asin;
      line.appendChild(el("div", "", clip(r.title || asin, 80) + " (" + asin + ")"));
      line.appendChild(el("div", "muted small", "Sheet " + money(r.sheetCost) + " · Sellerboard " + money(r.sbCost) + " · diff " + money(r.diff)));
      const sel = el("select", "ops-in ops-cogs-pick");
      sel.setAttribute("aria-label", "Cost to keep for " + asin);
      for (const [v, t] of [["sheet", "Keep the sheet cost"], ["sb", "Keep Sellerboard's cost"]]) {
        const o = el("option", "", t); o.value = v; sel.appendChild(o);
      }
      sel.value = picks[asin];
      sel.addEventListener("change", () => { picks[asin] = sel.value; });
      line.appendChild(sel);
      card.appendChild(line);
    }
    const apply = btn("Apply picks", "ops-cogs-apply");
    apply.addEventListener("click", () => run({
      name: "cogsCheckApply", payload: { sig: clip(check.sig, 120), confirmed: true, picks: Object.assign({}, picks), custom: {} },
      confirm: "Write these " + Object.keys(picks).length + " cost pick(s) to Sellerboard?", btn: apply, ok: "COGS applied",
    }));
    card.appendChild(apply);
    return card;
  }

  function render(p) {
    const host = $("bmmActionsHost");
    if (!host) return;
    const pages = obj(obj(p).pages);
    const s = JSON.stringify([pages.cogs || null, pages.pricingErrors || null, pages.pricingFixes || null]);
    if (s === sig && host.childNodes.length) return;
    if (editing(host)) return;
    sig = s;
    host.textContent = "";
    for (const c of [checksMenu(pages.cogs), errorsCard(pages.pricingErrors), fixesCard(pages.pricingFixes), cogsCard(pages.cogs)]) if (c) host.appendChild(c);
  }

  self.ShopperPricingActions = Object.freeze({ render, checks, errorsCard, fixesCard, cogsCard });
})();
