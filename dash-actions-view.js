// remote/dash-actions-view.js - B-1798 (v2.0.135): the Dashboard's own buttons on the phone's Home:
// Refresh dashboard, "Not now" on the ScanPower batch offer, a link to the RP/SB check rows (Buy Queue
// tab) and Ask Shopper (ask / confirm / cancel; the computer keeps the last reply, read from
// payload.pages.ask). The host is made here, at the top of #dashboardPane. Text nodes only.
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
    dashboardRefresh: "Refresh the Dashboard", batchOfferDismiss: "Not now (batch offer)",
    askShopper: "Ask Shopper", askConfirm: "Ask Shopper: do it", askCancel: "Ask Shopper: cancel",
    askCapApprove: "Ask Shopper: approve", askCapSkip: "Ask Shopper: skip",
  });
  let host = null, drawnKey = "", asking = false;

  // The stored last reply, tolerant of two shapes: { reply, plans, choices, last } or { reply: {reply, plans} }.
  function askView(a) {
    if (!a || typeof a !== "object") return null;
    const inner = a.reply && typeof a.reply === "object" ? a.reply : a;
    return {
      request: String(a.request || "").slice(0, 200),
      error: a.ok === false ? String(a.error || a.reason || "Ask Shopper failed.").slice(0, 300) : "",
      reply: String(typeof inner.reply === "string" ? inner.reply : typeof a.reply === "string" ? a.reply : "").slice(0, 1500),
      plans: (Array.isArray(inner.plans) ? inner.plans : []).slice(0, 6).filter((p) => p && p.token).map((p) => ({ token: String(p.token), summary: String(p.summary || "A plan").slice(0, 300) })),
      choices: inner.choices && Array.isArray(inner.choices.options) ? inner.choices.options.slice(0, 8).map((o) => String((o && (o.title || o.asin)) || "").slice(0, 100)).filter(Boolean) : [],
      last: a.last && typeof a.last === "object" ? { status: String(a.last.status || ""), message: String(a.last.message || "").slice(0, 300), question: a.last.question && typeof a.last.question === "object" ? { title: String(a.last.question.title || "").slice(0, 120), note: String(a.last.question.note || "").slice(0, 400), checkoutTotal: String(a.last.question.checkoutTotal || "").slice(0, 20), capText: String(a.last.question.capText || "").slice(0, 20), asin: String(a.last.question.asin || "").slice(0, 12), askedAt: Number(a.last.question.askedAt) || 0 } : null } : null,
    };
  }
  function askCard(P) {
    const box = el("div", "section dax-ask");
    box.appendChild(el("h3", "", "Ask Shopper"));
    const row = el("div", "l-actions");
    const q = el("input", "");
    q.type = "text"; q.maxLength = 500; q.placeholder = "Ask or tell Shopper to buy"; q.setAttribute("aria-label", "Ask Shopper");
    row.appendChild(q);
    row.appendChild(btnOf("Ask", "secondary-btn", async (b) => {
      const t = q.value.trim();
      if (!t) { say("Type a question first.", true); return; }
      asking = true;
      const r = await act("askShopper", { text: t.slice(0, 500) }, { btn: b });
      asking = false;
      if (r && r.ok) { q.value = ""; say("Asked. The answer shows here when the computer has it."); drawnKey = ""; }
    }));
    box.appendChild(row);
    const v = askView(P.ask || P.askLast);
    if (v) {
      if (v.request) box.appendChild(el("p", "muted small", "You asked: " + v.request));
      if (v.error) box.appendChild(el("p", "dax-bad", v.error));
      if (v.reply) box.appendChild(el("p", "", v.reply));
      v.choices.forEach((c) => box.appendChild(el("div", "muted small", "Option: " + c)));
      v.plans.forEach((pl2) => {
        const pr = el("div", "line dax-plan");
        pr.appendChild(el("div", "", pl2.summary));
        const a = el("div", "l-actions");
        a.appendChild(btnOf("Do it", "primary-btn", (b) => act("askConfirm", { token: pl2.token }, { btn: b, confirm: "Do this now? " + pl2.summary })));
        a.appendChild(btnOf("Cancel", "secondary-btn", (b) => act("askCancel", { token: pl2.token }, { btn: b })));
        pr.appendChild(a);
        box.appendChild(pr);
      });
      if (v.last && v.last.question) {
        const aq = v.last.question;
        const qb = el("div", "line dax-plan");
        qb.appendChild(el("div", "", aq.note || aq.title || "The checkout is over the safety cap."));
        qb.appendChild(el("div", "", "Order " + aq.checkoutTotal + " - cap " + aq.capText));
        const qa = el("div", "l-actions");
        qa.appendChild(btnOf("Approve this order", "primary-btn", (b) => act("askCapApprove", { askedAt: aq.askedAt }, { btn: b, confirm: "Approve this " + aq.checkoutTotal + " order?" })));
        qa.appendChild(btnOf("Skip - buy nothing", "secondary-btn", (b) => act("askCapSkip", { askedAt: aq.askedAt }, { btn: b })));
        qb.appendChild(qa);
        box.appendChild(qb);
      }
      if (v.last && v.last.message) box.appendChild(el("p", "muted small", "Last buy: " + (v.last.status ? v.last.status + " - " : "") + v.last.message));
    }
    return box;
  }
  function goBuy() { try { if (typeof switchTab === "function") switchTab("run"); } catch (e) { /* tab missing */ } }

  function draw() {
    const pane = document.getElementById("dashboardPane");
    if (!pane) return;
    if (!host) {
      host = el("div", "dax-host");
      host.id = "dashActionsHost";
      pane.insertBefore(host, pane.firstChild);
    }
    const p = pl() || {};
    const P = pg();
    const offer = p.dashboard && p.dashboard.extra && p.dashboard.extra.batchOffer;
    const checks = Array.isArray(P.rpsbCheckRows) ? P.rpsbCheckRows.length : 0;
    const key = JSON.stringify([offer && offer.sig, checks, P.ask, P.askLast]);
    if (key === drawnKey || typing(host) || asking) return;
    drawnKey = key;
    host.textContent = "";
    const top = el("div", "l-actions");
    top.appendChild(btnOf("Refresh dashboard", "secondary-btn", (b) => act("dashboardRefresh", {}, { btn: b })));
    if (checks) top.appendChild(btnOf("RP/SB to check by hand (" + checks + ")", "secondary-btn", goBuy));
    host.appendChild(top);
    if (offer && offer.sig) {
      const o = el("div", "section dax-offer");
      o.appendChild(el("p", "", "Arrivals for the ScanPower batch" + (offer.batchName ? ": " + String(offer.batchName).slice(0, 80) : "")));
      o.appendChild(btnOf("Not now", "mini-btn", (b) => act("batchOfferDismiss", { sig: String(offer.sig).slice(0, 40) }, { btn: b })));
      host.appendChild(o);
    }
    host.appendChild(askCard(P));
  }
  function start() { draw(); setInterval(draw, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperDashActions = Object.freeze({ askView, draw });
})();
