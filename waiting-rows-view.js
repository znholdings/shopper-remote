// remote/waiting-rows-view.js - B-1794 (v2.0.135): the two Replen Pulse / Sellerboard cards and client notes
// on the phone's Buy Queue: the RP/SB waiting list (alert days, remove a row, remove an ASIN), the
// "Ordered" check rows (write a total to RP and SB, after a confirm) and the pending client notes.
// Host: #waitingHost. Data: payload.pages.rpsbWaiting / rpsbCheckRows / clientNotes. Text nodes only.
(function () {
  "use strict";
  // ---- shared tiny kit (same text in every *-actions-view.js; see test v20135-phone-buy-actions) ----
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const say = (t, bad) => { try { if (typeof toast === "function") toast(t, !!bad); } catch (e) { /* no toast */ } };
  const pl = () => { try { return typeof lastPayload !== "undefined" ? lastPayload : null; } catch (e) { return null; } };
  const pg = () => { const p = pl(); return p && p.pages && typeof p.pages === "object" ? p.pages : {}; };
  const labels = (o) => { try { if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, o); } catch (e) { /* labels are cosmetic */ } };
  // One command; waits for the laptop's answer; a refusal or {ok:false} toasts its reason. -> { ok, result } | null
  async function act(name, body, o) {
    o = o || {};
    if (o.confirm && !window.confirm(o.confirm)) return null;
    const R = self.ShopperRemote;
    if (!R) { say("Not connected.", true); return null; }
    const btn = o.btn;
    const was = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); btn.textContent = "Working..."; }
    try {
      const id = await R.sendCommand(name, body || {});
      if (!id) return null;
      const status = await R.waitFor(id);
      let row = null;
      try { row = await R.commandRow(id); } catch (e) { row = null; }
      const res = row && row.result && typeof row.result === "object" ? row.result : null;
      if (status !== "done") { say(((row && row.reason) || "Not done (" + status + ").").slice(0, 200), true); return { ok: false, result: res }; }
      if (res && res.ok === false) { say(String(res.reason || res.error || "The computer refused.").slice(0, 200), true); return { ok: false, result: res }; }
      if (res && res.note === "no direct response") say("Started on the computer - watch the activity bar.");
      return { ok: true, result: res };
    } catch (e) {
      say("Not sent: " + ((e && e.message) || "no connection"), true);
      return null;
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); btn.textContent = was; }
    }
  }
  const btnOf = (text, cls, fn) => { const b = el("button", cls || "mini-btn", text); b.type = "button"; b.addEventListener("click", () => fn(b)); return b; };
  const typing = (host) => { const a = document.activeElement; return !!(a && host && host.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")); };
  labels({
    rpsbWaitingAlertSet: "Waiting alert days", rpsbWaitingRemove: "Remove a waiting row", rpsbWaitingRemoveAsin: "Remove a waiting ASIN",
    rpsbCheckRowSet: "Write the Ordered total to RP and SB", clientNoteResolve: "Save a client note",
  });
  let host = null, drawnKey = "";
  const list = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.rows) ? x.rows : []);

  function waitingCard(w) {
    const box = el("div", "section wax-box");
    const rows = list(w).slice(0, 40);
    box.appendChild(el("h3", "", "Waiting on RP / SB (" + rows.length + ")"));
    const days = el("div", "l-actions");
    const inp = el("input", "qty-input");
    inp.type = "number"; inp.min = "1"; inp.max = "60"; inp.value = String(w && w.alertDays != null ? w.alertDays : 7);
    inp.setAttribute("aria-label", "Alert after days");
    days.appendChild(el("span", "muted small", "Alert after (days) "));
    days.appendChild(inp);
    days.appendChild(btnOf("Set", "mini-btn", (b) => {
      const d = Math.round(Number(inp.value));
      if (!(d >= 1 && d <= 60)) { say("Days must be 1 to 60.", true); return; }
      act("rpsbWaitingAlertSet", { days: d }, { btn: b });
    }));
    box.appendChild(days);
    const confirms = (w && w.confirms) || {};
    rows.forEach((r) => {
      const row = el("div", "line wax-row");
      row.appendChild(el("div", "", (r.title || r.asin || "").toString().slice(0, 80)));
      row.appendChild(el("div", "muted small", [r.asin, r.retailer, r.orderNumber, r.qty != null ? "qty " + r.qty : "", r.ageDays != null ? r.ageDays + " d" : ""].filter(Boolean).join(" - ")));
      const a = el("div", "l-actions");
      a.appendChild(btnOf("Remove this row", "mini-btn danger-btn", (b) => act("rpsbWaitingRemove", { id: String(r.id) }, { btn: b, confirm: "Remove this waiting row (" + (r.orderNumber || r.asin) + ")?" })));
      a.appendChild(btnOf("Remove ASIN", "mini-btn danger-btn", (b) => act("rpsbWaitingRemoveAsin", { asin: String(r.asin) }, { btn: b, confirm: String(confirms[r.asin] || "Remove every waiting row for " + r.asin + "?").slice(0, 300) })));
      row.appendChild(a);
      box.appendChild(row);
    });
    if (!rows.length) box.appendChild(el("p", "muted small", "Nothing waiting."));
    return box;
  }
  function checkCard(rows) {
    const box = el("div", "section wax-box");
    box.appendChild(el("h3", "", "\"Ordered\" to check by hand (" + rows.length + ")"));
    rows.slice(0, 40).forEach((r) => {
      const row = el("div", "line wax-row");
      row.appendChild(el("div", "", (r.title || r.asin || "").toString().slice(0, 80)));
      row.appendChild(el("div", "muted small", [r.asin, r.orderNumber].filter(Boolean).join(" - ")));
      const a = el("div", "l-actions");
      const tot = el("input", "qty-input");
      tot.type = "number"; tot.min = "0"; tot.step = "0.01"; tot.inputMode = "decimal";
      tot.placeholder = "Total $";
      const pre = r.total != null ? r.total : r.ordered;
      if (pre != null && Number.isFinite(Number(pre))) tot.value = String(pre);
      a.appendChild(tot);
      a.appendChild(btnOf("Write to RP and SB", "mini-btn", (b) => {
        const t = Number(tot.value);
        if (!(tot.value !== "" && Number.isFinite(t) && t >= 0)) { say("Type the total first.", true); return; }
        act("rpsbCheckRowSet", { id: String(r.id), asin: String(r.asin), orderNumber: String(r.orderNumber || ""), total: t }, { btn: b, confirm: "Write $" + t.toFixed(2) + " to Replen Pulse and Sellerboard for order " + (r.orderNumber || r.asin) + "?" });
      }));
      row.appendChild(a);
      box.appendChild(row);
    });
    return box;
  }
  function notesCard(items) {
    const box = el("div", "section wax-box");
    box.appendChild(el("h3", "", "Client notes (" + items.length + ")"));
    items.slice(0, 30).forEach((n) => {
      const row = el("div", "line wax-row");
      row.appendChild(el("div", "", (n.title || n.asin || "").toString().slice(0, 80)));
      if (n.reason) row.appendChild(el("div", "muted small", String(n.reason).slice(0, 200)));
      const a = el("div", "l-actions");
      const note = el("input", "");
      note.type = "text"; note.maxLength = 500; note.placeholder = "Note";
      a.appendChild(note);
      a.appendChild(btnOf("Save note", "mini-btn", (b) => {
        const t = note.value.trim();
        if (!t) { say("Type the note first.", true); return; }
        act("clientNoteResolve", { id: String(n.id), note: t.slice(0, 500) }, { btn: b });
      }));
      row.appendChild(a);
      box.appendChild(row);
    });
    return box;
  }

  function draw() {
    host = host || document.getElementById("waitingHost");
    if (!host) return;
    const P = pg();
    const w = P.rpsbWaiting || null, checks = list(P.rpsbCheckRows), notes = list(P.clientNotes);
    const key = JSON.stringify([w, checks, notes]);
    if (key === drawnKey || typing(host)) return;
    drawnKey = key;
    host.textContent = "";
    if (w && (list(w).length || w.alertDays != null)) host.appendChild(waitingCard(w));
    if (checks.length) host.appendChild(checkCard(checks));
    if (notes.length) host.appendChild(notesCard(notes));
  }
  function start() { draw(); setInterval(draw, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperWaitingRows = Object.freeze({ draw });
})();
