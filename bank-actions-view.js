// remote/bank-actions-view.js - B-1795 (v2.0.135): Virtual Bank "Manual entry" on the phone
// (bankAddManualEntry: a note and an amount, plus or minus, after a confirm). The host is made here,
// right under #bankRows. "Update (CSV)" is a file upload and stays on the computer. Text nodes only.
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
  labels({ bankAddManualEntry: "Add a Bank entry" });
  function build() {
    const rows = document.getElementById("bankRows");
    if (!rows || document.getElementById("bankActionsHost")) return;
    const host = el("div", "section bnx-box");
    host.id = "bankActionsHost";
    host.appendChild(el("h3", "", "Manual entry"));
    const note = el("input", "");
    note.type = "text"; note.maxLength = 200; note.placeholder = "Note"; note.setAttribute("aria-label", "Note");
    const amt = el("input", "qty-input");
    amt.type = "number"; amt.step = "0.01"; amt.inputMode = "decimal"; amt.placeholder = "Amount (- for money out)"; amt.setAttribute("aria-label", "Amount");
    const row = el("div", "l-actions");
    row.appendChild(note); row.appendChild(amt);
    row.appendChild(btnOf("Add entry", "secondary-btn", async (b) => {
      const n = note.value.trim(), a = Number(amt.value);
      if (!n) { say("Type a note first.", true); return; }
      if (!(amt.value !== "" && Number.isFinite(a) && a !== 0 && Math.abs(a) <= 50000)) { say("Amount must be a number, not 0, up to 50,000.", true); return; }
      const r = await act("bankAddManualEntry", { note: n.slice(0, 200), amount: a }, { btn: b, confirm: "Add " + (a < 0 ? "-" : "") + "$" + Math.abs(a).toFixed(2) + " (" + n + ") to the Bank tab?" });
      if (r && r.ok) {
        const x = r.result || {};
        say("Bank entry added" + (x.balance != null && Number.isFinite(Number(x.balance)) ? ". Balance $" + Number(x.balance).toFixed(2) : ".") + " The tile can lag up to a minute.");
        note.value = ""; amt.value = "";
      }
    }));
    host.appendChild(row);
    host.appendChild(el("p", "muted small", "Update (CSV) is a file upload - do that on the computer."));
    rows.parentNode.insertBefore(host, rows.nextSibling);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  self.ShopperBankActions = Object.freeze({ build });
})();
