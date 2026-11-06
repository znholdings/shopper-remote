// remote/settings-actions-view.js - v2.0.135 (B-1798, chunk P3): the "Actions" card at the bottom of the phone's Settings.
//   Build tonight's buy list now (confirm), Test retailer / Test Amazon buy mode (start behind a confirm, Cancel while running),
//   Pull Amazon (SP-API), Refresh Plaid, Pull Gusto. Never a password, key or connect flow (desktop only).
// card(payload) returns the node (the Settings screen appends it before its "Passwords and API keys..." line);
// render(payload) mounts it into #stgActionsHost when that host exists. Reads payload.pages.{tests,spapi,gusto}.
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
    nightlyRunNow: "Build tonight's list now", retailerTestStart: "Test a retailer", retailerTestCancel: "Cancel retailer test",
    amazonAssistTestStart: "Test Amazon buy mode", amazonAssistTestCancel: "Cancel Amazon test",
    spapiPull: "Pull Amazon data", plaidRefresh: "Refresh bank feed", gustoPullNow: "Pull Gusto", leadTimeRefresh: "Refresh lead time",
  });

  const $ = (id) => document.getElementById(id);
  const RETAILERS = [["target", "Target"], ["homedepot", "Home Depot"]];
  const MODES = [["link", "Link only"], ["button", "Button on the page"], ["auto_tab", "Auto in my tab"], ["full", "Full auto (old)"]];
  let sig = "";

  function sub(title) { const h = el("h4", "", title); return h; }
  function steps(running) {
    const box = el("div", "ops-steps muted small");
    box.setAttribute("role", "status");
    for (const s of arr(obj(running).steps).slice(-8)) box.appendChild(el("div", "", clip(typeof s === "string" ? s : s && (s.text || s.line), 160)));
    return box;
  }
  function results(list) {
    const box = el("div", "ops-results muted small");
    for (const r of arr(list).slice(0, 3)) box.appendChild(el("div", "", clip(r.verdict || r.summary || r.text || r.retailer, 200) + (r.at ? " · " + clip(r.at, 30) : "")));
    return box;
  }
  function select(opts, label) {
    const s = el("select", "ops-in");
    s.setAttribute("aria-label", label);
    for (const [v, t] of opts) { const o = el("option", "", t); o.value = v; s.appendChild(o); }
    return s;
  }

  function card(p) {
    const pages = obj(obj(p).pages), tests = obj(pages.tests), rt = obj(tests.retailer), asst = obj(tests.assist);
    const c = el("section", "ops-card ops-settings-actions");
    c.appendChild(el("h3", "", "Actions"));

    const night = btn("Build tonight's list now", "ops-nightly");
    night.addEventListener("click", () => run({ name: "nightlyRunNow", payload: {}, confirm: "Build tonight's buy list now?", btn: night, ok: "Building the buy list on the computer" }));
    c.appendChild(night);

    c.appendChild(sub("Test a retailer"));
    if (rt.running) {
      c.appendChild(el("div", "small", "Running at " + clip(obj(rt.running).retailer, 30) + "..."));
      c.appendChild(steps(rt.running));
      const x = btn("Cancel the test", "ops-rt-cancel");
      x.addEventListener("click", () => run({ name: "retailerTestCancel", payload: {}, btn: x, ok: "Cancelled" }));
      c.appendChild(x);
    } else {
      const row = el("div", "ops-row");
      const sel = select(RETAILERS, "Retailer");
      const prod = el("input", "ops-in ops-rt-product");
      prod.type = "text"; prod.maxLength = 300; prod.placeholder = "Test product ASIN or link";
      prod.setAttribute("aria-label", "Test product");
      const saved = obj(rt.products);
      sel.addEventListener("change", () => { if (!prod.value && saved[sel.value]) prod.value = clip(saved[sel.value], 300); });
      if (saved[sel.value]) prod.value = clip(saved[sel.value], 300);
      const go = btn("Start test", "ops-rt-start");
      go.addEventListener("click", () => {
        if (!prod.value.trim()) { toast("Type the test product first.", true); return; }
        const name = (RETAILERS.find((r) => r[0] === sel.value) || [])[1] || sel.value;
        run({ name: "retailerTestStart", payload: { retailer: sel.value, product: prod.value.trim().slice(0, 300) }, confirm: "Run a real test buy at " + name + "? It can place an order.", btn: go, ok: "Test started on the computer" });
      });
      row.append(sel, prod, go);
      c.appendChild(row);
    }
    if (arr(rt.results).length) c.appendChild(results(rt.results));

    c.appendChild(sub("Test Amazon buy mode"));
    if (asst.running) {
      c.appendChild(el("div", "small", "Amazon test running..."));
      c.appendChild(steps(asst.running));
      const x = btn("Cancel the test", "ops-aa-cancel");
      x.addEventListener("click", () => run({ name: "amazonAssistTestCancel", payload: {}, btn: x, ok: "Cancelled" }));
      c.appendChild(x);
    } else {
      const row = el("div", "ops-row");
      const mode = select(MODES, "Mode");
      const asin = el("input", "ops-in ops-aa-asin");
      asin.type = "text"; asin.maxLength = 10; asin.placeholder = "ASIN";
      asin.setAttribute("aria-label", "Test ASIN");
      const go = btn("Start test", "ops-aa-start");
      go.addEventListener("click", () => {
        const a = asin.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(a)) { toast("Type the 10-character ASIN.", true); return; }
        run({ name: "amazonAssistTestStart", payload: { mode: mode.value, asin: a }, confirm: "Run the Amazon buy test (" + mode.value + ") on " + a + "? It can add to a cart.", btn: go, ok: "Test started on the computer" });
      });
      row.append(mode, asin, go);
      c.appendChild(row);
    }
    if (arr(asst.results).length) c.appendChild(results(asst.results));

    c.appendChild(sub("Pulls"));
    const sp = obj(pages.spapi), gu = obj(pages.gusto);
    const pulls = el("div", "ops-row");
    const b1 = btn("Pull Amazon data", "ops-spapi");
    b1.addEventListener("click", () => run({ name: "spapiPull", payload: {}, btn: b1, ok: "Pulling Amazon data on the computer" }));
    const b2 = btn("Refresh bank feed", "ops-plaid");
    b2.addEventListener("click", () => run({ name: "plaidRefresh", payload: {}, btn: b2, ok: "Refreshing the bank feed" }));
    const b3 = btn("Pull Gusto", "ops-gusto");
    b3.addEventListener("click", () => run({ name: "gustoPullNow", payload: {}, btn: b3, ok: "Pulling Gusto on the computer" }));
    pulls.append(b1, b2, b3);
    c.appendChild(pulls);
    const lines = [];
    if (sp.lastPullAt) lines.push("Amazon: last pull " + clip(sp.lastPullAt, 30) + (sp.lastOk === false ? " (failed)" : ""));
    if (gu.lastPullAt || gu.lastAt) lines.push("Gusto: " + clip(gu.lastPullAt || gu.lastAt, 30));
    if (lines.length) c.appendChild(el("p", "muted small", lines.join(" · ")));
    c.appendChild(el("p", "muted small", "Connecting accounts, keys and passwords are on the computer."));
    return c;
  }

  function render(p) {
    const host = $("stgActionsHost");
    if (!host) return;
    const pages = obj(obj(p).pages);
    const s = JSON.stringify([pages.tests || null, pages.spapi || null, pages.gusto || null]);
    if (s === sig && host.childNodes.length) return;
    if (editing(host)) return;
    sig = s;
    host.textContent = "";
    host.appendChild(card(p));
  }

  // The FBA tab's lead-time button (fba-view.js calls this; no projection change for v1).
  function leadTimeButton() {
    const b = btn("Refresh lead time", "ops-leadtime");
    b.addEventListener("click", () => run({ name: "leadTimeRefresh", payload: {}, btn: b, ok: "Lead time refreshed" }));
    return b;
  }

  self.ShopperSettingsActions = Object.freeze({ render, card, leadTimeButton });
})();
