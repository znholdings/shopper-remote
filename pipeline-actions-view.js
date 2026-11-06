// remote/pipeline-actions-view.js - v2.0.135 (B-1795/B-1796, chunk P3): the Pipeline buttons the phone could not send.
//   Shipments card (schedule / ignore / check now / run due), unmatched emails (dismiss, rescan, order-email links),
//   manual edits (undo). NO Reconcile and NO ScanPower batch writes (Zach's answers Q5 / Q6).
// Hosts (index.html, builder C): #shipmentsHost, #unmatchedHost, #editsHost. app.js calls ShopperPipelineActions.render(payload)
// with the whole projection; this file reads payload.needs.shipments and payload.pages.{unmatched,edits}.
// Every write has its own labelled button + window.confirm where scoped; no innerHTML; no file inputs; no keys.
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
    editUndo: "Undo edit", orderEmails: "Find order emails", rescanEmail: "Rescan email", unmatchedDismiss: "Dismiss email",
    shipmentCheckNow: "Check shipments now", shipmentSchedule: "Schedule shipment update", shipmentIgnore: "Ignore shipments", shipmentRunDue: "Run scheduled updates",
  });

  const $ = (id) => document.getElementById(id);
  const sigs = {};
  function paint(id, sig, build) {
    const host = $(id);
    if (!host) return;
    if (sigs[id] === sig && host.childNodes.length) return;
    if (editing(host)) return;
    sigs[id] = sig;
    host.textContent = "";
    const card = build();
    if (card) host.appendChild(card);
  }

  // ---- shipments ----
  function shipmentsCard(needs) {
    const list = arr(obj(needs).shipments);
    const card = el("section", "ops-card ops-shipments");
    card.appendChild(el("h3", "", "Shipments"));
    const top = el("div", "ops-row");
    const check = btn("Check ScanPower now", "ops-ship-check");
    check.addEventListener("click", () => run({ name: "shipmentCheckNow", payload: {}, btn: check, ok: "Checking shipments on the computer" }));
    const due = btn("Run scheduled updates now", "ops-ship-due");
    due.addEventListener("click", () => run({ name: "shipmentRunDue", payload: {}, btn: due, ok: "Running the scheduled updates" }));
    top.append(check, due);
    card.appendChild(top);
    if (!list.length) { card.appendChild(el("p", "muted small", "No shipments waiting.")); return card; }
    const picked = new Set();
    const rows = [];
    for (const s of list.slice(0, 25)) {
      const row = el("label", "ops-line ops-ship-row");
      const cb = el("input");
      cb.type = "checkbox";
      cb.dataset.key = String(s.key || "");
      cb.setAttribute("aria-label", "Completed: " + clip(s.batchName || s.batchId, 80));
      cb.addEventListener("change", () => { if (cb.checked) picked.add(cb.dataset.key); else picked.delete(cb.dataset.key); });
      row.append(cb, el("strong", "", " " + clip(s.batchName || s.batchId || "Batch", 80)), el("span", "muted small", " " + clip(s.when, 40)));
      const lines = arr(s.lines).slice(0, 12).map((l) => clip(l.units, 6) + " x " + clip(l.title || l.asin, 50));
      if (lines.length) row.appendChild(el("div", "muted small", lines.join(" · ")));
      rows.push(row);
      card.appendChild(row);
    }
    if (needs.shipmentsOverflow) card.appendChild(el("p", "muted small", "+" + Number(needs.shipmentsOverflow) + " more on the computer."));
    const when = el("div", "ops-row");
    const date = el("input", "ops-in ops-ship-date");
    if (self.ShopperDateInput && self.ShopperDateInput.attach) self.ShopperDateInput.attach(date);
    else { date.type = "text"; date.placeholder = "MM/DD/YYYY"; }
    date.setAttribute("aria-label", "Update date");
    const time = el("input", "ops-in ops-ship-time");
    time.type = "time";
    time.value = "09:00";
    time.setAttribute("aria-label", "Update time");
    const sched = btn("Schedule selected", "ops-ship-schedule");
    sched.addEventListener("click", () => {
      const keys = [...picked];
      if (!keys.length) { toast("Tick the shipments first.", true); return; }
      const D = self.ShopperDateInput;
      const iso = D && D.readValue ? D.readValue(date.value) : /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : "";
      if (!iso) { toast("Type the date as MM/DD/YYYY.", true); return; }
      if (!/^\d{2}:\d{2}$/.test(time.value)) { toast("Pick a time.", true); return; }
      run({ name: "shipmentSchedule", payload: { at: { date: iso, time: time.value }, keys }, btn: sched, ok: "Update scheduled", fail: "Not scheduled" });
    });
    when.append(date, time, sched);
    const ign = btn("Ignore selected", "ops-ship-ignore");
    ign.addEventListener("click", () => {
      const keys = [...picked];
      if (!keys.length) { toast("Tick the shipments first.", true); return; }
      run({ name: "shipmentIgnore", payload: { keys }, confirm: "Ignore these shipments? Their units stay where they are.", btn: ign, ok: "Shipments ignored" });
    });
    when.appendChild(ign);
    card.appendChild(when);
    return card;
  }

  // ---- unmatched emails ----
  function searchLinks(box, res) {
    box.textContent = "";
    const list = arr(obj(res).searches);
    if (!list.length) { box.appendChild(el("span", "muted small", "No searches came back.")); return; }
    for (const s of list.slice(0, 6)) {
      const url = typeof s === "string" ? s : s && s.url;
      if (!/^https:\/\/mail\.google\.com\//.test(String(url || ""))) continue;
      const a = el("a", "ops-link", clip((s && s.label) || "Open in Gmail", 60));
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      box.appendChild(a);
      box.appendChild(document.createTextNode(" "));
    }
  }
  function unmatchedCard(un) {
    const rows = arr(obj(un).rows);
    const card = el("section", "ops-card ops-unmatched");
    card.appendChild(el("h3", "", "Emails not matched" + (rows.length ? " (" + rows.length + ")" : "")));
    const re = el("div", "ops-row");
    const days = el("input", "ops-in ops-rescan-days");
    days.type = "number"; days.min = "1"; days.max = "30"; days.value = "3";
    days.setAttribute("inputmode", "numeric");
    days.setAttribute("aria-label", "Days of email to rescan");
    const rescan = btn("Rescan email", "ops-rescan");
    rescan.addEventListener("click", () => {
      const d = Math.floor(Number(days.value));
      if (!(d >= 1 && d <= 30)) { toast("Days: 1 to 30.", true); return; }
      run({ name: "rescanEmail", payload: { days: d }, btn: rescan, ok: "Rescanning email on the computer" });
    });
    re.append(days, el("span", "muted small", "days"), rescan);
    card.appendChild(re);
    if (!rows.length) { card.appendChild(el("p", "muted small", "Nothing unmatched.")); return card; }
    for (const r of rows.slice(0, 20)) {
      const line = el("div", "ops-line ops-un-row");
      line.dataset.key = String(r.key || "");
      line.appendChild(el("div", "", clip(r.retailer, 40) + " - " + clip(r.subject, 120)));
      line.appendChild(el("div", "muted small", [clip(r.date, 20), r.orderNumber ? "#" + clip(r.orderNumber, 40) : "", clip(r.hint, 80)].filter(Boolean).join(" · ")));
      const b = el("div", "ops-row");
      const links = el("span", "ops-links");
      if (r.orderNumber) {
        const find = btn("Find order emails", "ops-find");
        find.addEventListener("click", () => run({ name: "orderEmails", payload: { orderNumber: String(r.orderNumber), retailer: String(r.retailer || "") }, btn: find, ok: "Found", done: (res) => searchLinks(links, res) }));
        b.appendChild(find);
      }
      const dis = btn("Dismiss", "ops-dismiss");
      dis.addEventListener("click", () => run({ name: "unmatchedDismiss", payload: { keys: [String(r.key)] }, btn: dis, ok: "Dismissed", done: () => line.remove() }));
      b.append(dis, links);
      line.appendChild(b);
      card.appendChild(line);
    }
    return card;
  }

  // ---- manual edits ----
  function editsCard(edits) {
    const rows = arr(Array.isArray(edits) ? edits : obj(edits).rows);
    if (!rows.length) return null;
    const card = el("section", "ops-card ops-edits");
    card.appendChild(el("h3", "", "Recent manual edits"));
    for (const e of rows.slice(0, 10)) {
      const line = el("div", "ops-line ops-edit-row");
      line.appendChild(el("div", "", clip(e.title || e.asin, 80) + " - " + clip(e.units, 8) + " to " + clip(e.destination, 30)));
      line.appendChild(el("div", "muted small", [clip(e.at, 30), clip(e.note, 80)].filter(Boolean).join(" · ")));
      const undo = btn("Undo", "ops-undo");
      undo.addEventListener("click", () => run({ name: "editUndo", payload: { keys: arr(e.keys).slice(0, 50).map((k) => clip(k, 120)) }, confirm: "Undo this edit? Its row(s) are deleted from the ledger.", btn: undo, ok: "Edit undone", done: () => line.remove() }));
      line.appendChild(undo);
      card.appendChild(line);
    }
    return card;
  }

  function render(p) {
    const payload = obj(p), pages = obj(payload.pages), needs = obj(payload.needs);
    // The printed ledger the Manual Print sheet reads (labelsMarkPrinted needs the batch id).
    if (self.ShopperManualPrint && self.ShopperManualPrint.setLabels) self.ShopperManualPrint.setLabels(pages.labels || null);
    paint("shipmentsHost", JSON.stringify(needs.shipments || null) + needs.shipmentsOverflow, () => shipmentsCard(needs));
    paint("unmatchedHost", JSON.stringify(pages.unmatched || null), () => unmatchedCard(pages.unmatched));
    paint("editsHost", JSON.stringify(pages.edits || null), () => editsCard(pages.edits));
  }

  self.ShopperPipelineActions = Object.freeze({ render, shipmentsCard, unmatchedCard, editsCard });
})();
