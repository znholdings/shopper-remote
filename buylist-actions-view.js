// remote/buylist-actions-view.js - B-1793 (v2.0.135): the Buylist actions the phone could not send:
// Save / Restore the list, flag / ignore a row, the Quantity v3 override, the pending-alert card,
// and the Buylist History row after Approve / Conditional / Push (recordDecision).
// Host: #blActionsHost (remote/index.html). Row tools are added to each card of #buylistItems.
// Data: payload.pages.buylistMarks / qtyV3 / buylistAlert (lib/remote-pages.js). Text nodes only.
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
    buylistSave: "Save the buylist", buylistRestore: "Restore the saved buylist", buylistRowMark: "Flag / ignore a row",
    qtyV3Override: "Quantity v3 override", recordDecision: "Write to Buylist History", buylistClearPendingAlert: "Clear the buylist alert",
    buylistSaveInfo: "Saved buylist info",
  });
  const FIELDS = [["leadDays", "Lead days"], ["targetDays", "Target days"], ["minOrder", "Min order"], ["roundMultiple", "Round to"]];
  const DECISION = { approve: "approve", conditional: "conditional", push: "pushed" };
  let host = null, drawnKey = "", saveInfo = null, infoAt = 0;

  // Buylist History: SHOPPER_BUYLIST_ACTION does not write the row (only the laptop page did), so after an
  // approve / conditional / push the phone sends recordDecision, same fields as buylist/buylist.js 2562.
  function historyPayload(asin, action, extra) {
    const p = pl();
    const items = p && p.buylist && Array.isArray(p.buylist.items) ? p.buylist.items : [];
    const i = items.find((x) => x.asin === asin);
    if (!i) return null;
    const qty = extra && typeof extra.qty === "number" ? extra.qty : null;
    const out = {
      asin: i.asin,
      title: String(i.title || "").slice(0, 200),
      sources: String(i.qtySources && i.qtySources.length ? [].concat(i.qtySources).join("+") : i.supplierNames || "").slice(0, 200),
      recommendedQty: i.recommendedQty != null ? i.recommendedQty : i.v3Qty != null ? i.v3Qty : i.sbQty != null ? i.sbQty : i.rpQtyRaw != null ? i.rpQtyRaw : null,
      decision: DECISION[action],
      adjustedQty: action === "conditional" ? qty : null,
      rpMarginPct: i.rpMarginPct != null ? i.rpMarginPct : null,
      sbMarginPct: i.sbMarginPct != null ? i.sbMarginPct : null,
      roiPct: i.sbRoiPct != null ? i.sbRoiPct : i.rpRoiPct != null ? i.rpRoiPct : null,
      rationale: String(i.rationale || i.why || "").slice(0, 300),
    };
    for (const k of Object.keys(out)) if (out[k] == null) delete out[k]; // numbers the item lacks are left out, not sent as null
    return out;
  }
  function wrapSend() {
    if (typeof window.sendCommand !== "function" || window.sendCommand.__bax) return;
    const orig = window.sendCommand;
    const wrapped = function (name, payload, opts) {
      const out = orig.apply(this, arguments);
      if (name === "buylistAction" && payload && DECISION[payload.action]) {
        const body = historyPayload(payload.asin, payload.action, payload);
        if (body) {
          Promise.resolve(out).then((id) => (id ? self.ShopperRemote.waitFor(id) : null)).then((status) => {
            if (status === "done") return orig("recordDecision", body, { quiet: true });
            return null;
          }).catch(() => {});
        }
      }
      return out;
    };
    wrapped.__bax = true;
    window.sendCommand = wrapped;
  }

  async function refreshInfo() {
    infoAt = Date.now();
    const M = self.ShopperManualPrint;
    if (!M || !M.runCommand) return;
    const out = await M.runCommand("buylistSaveInfo", {});
    const r = out && out.result;
    saveInfo = out && out.status === "done" && r && r.ok !== false ? r : null;
    drawnKey = "";
    draw();
  }
  function infoText() {
    if (!saveInfo) return "";
    const n = saveInfo.itemCount != null ? saveInfo.itemCount : saveInfo.count;
    const t = saveInfo.savedAt ? new Date(saveInfo.savedAt).toLocaleString() : "";
    return t ? "Restore from " + t + (n != null ? " (" + n + ")" : "") : "";
  }

  function draw() {
    host = host || document.getElementById("blActionsHost");
    if (!host) return;
    const a = pg().buylistAlert;
    const key = JSON.stringify([a, saveInfo]);
    if (key === drawnKey || typing(host)) return;
    drawnKey = key;
    host.textContent = "";
    const box = el("div", "section bax-box");
    const row = el("div", "l-actions");
    row.appendChild(btnOf("Save list", "secondary-btn", async (b) => {
      const r = await act("buylistSave", {}, { btn: b });
      if (r && r.ok) { const x = r.result || {}; say("Saved" + (x.itemCount != null ? " (" + x.itemCount + " items)" : "") + "."); refreshInfo(); }
    }));
    const rt = infoText();
    const restore = btnOf(rt || "Restore saved list", "secondary-btn", async (b) => {
      const r = await act("buylistRestore", {}, { btn: b, confirm: "Replace the list on screen with the saved copy?" });
      if (r && r.ok) say("Saved copy restored.");
    });
    if (!rt) restore.disabled = true;
    row.appendChild(restore);
    box.appendChild(row);
    if (a && a.id && a.message) {
      const al = el("div", "bax-alert");
      al.appendChild(el("p", "", String(a.message).slice(0, 400)));
      al.appendChild(btnOf("OK", "primary-btn", async (b) => { await act("buylistClearPendingAlert", { id: String(a.id).slice(0, 80) }, { btn: b }); }));
      box.appendChild(al);
    }
    host.appendChild(box);
  }

  // ---- per-row tools --------------------------------------------------------
  function untilText(ms) {
    const t = Number(ms);
    return t > 0 ? new Date(t).toLocaleDateString() : "";
  }
  function rowTools(card) {
    const asin = card.dataset.asin;
    const bar = el("div", "l-actions bax-tools");
    bar.dataset.baxAsin = asin;
    const m = (pg().buylistMarks || {})[asin] || {};
    const ov = ((pg().qtyV3 || {}).overrides || {})[asin] || null;
    if (m.flagged) bar.appendChild(el("span", "bax-chip", "Flagged"));
    if (m.ignoredUntil) bar.appendChild(el("span", "bax-chip", "Ignored until " + untilText(m.ignoredUntil)));
    const mark = (label, which, on) => btnOf(label, "mini-btn", async (b) => {
      const r = await act("buylistRowMark", { asin, mark: which, on }, { btn: b });
      if (r && r.ok) { say(label + ": done."); drawnKey = ""; }
    });
    bar.appendChild(mark(m.flagged ? "Unflag" : "Flag", "flag", !m.flagged));
    bar.appendChild(mark(m.ignoredUntil ? "Stop ignoring" : "Ignore 7 days", "ignore", !m.ignoredUntil));
    const fold = el("div", "bax-fold");
    fold.hidden = true;
    const inputs = {};
    for (const [k, label] of FIELDS) {
      const lab = el("label", "", label + " ");
      const inp = el("input", "qty-input");
      inp.type = "number"; inp.min = "0"; inp.placeholder = "global";
      inp.value = ov && ov[k] != null ? String(ov[k]) : "";
      lab.appendChild(inp);
      inputs[k] = inp;
      fold.appendChild(lab);
    }
    const send = (fields, b) => act("qtyV3Override", { asin, fields }, { btn: b }).then((r) => { if (r && r.ok) { say("Quantity override saved."); fold.hidden = true; } });
    fold.appendChild(btnOf("Save override", "mini-btn", (b) => {
      const f = {};
      for (const [k] of FIELDS) { const raw = inputs[k].value.trim(); if (raw !== "" && Number.isFinite(Number(raw))) f[k] = Number(raw); }
      send(Object.keys(f).length ? f : null, b);
    }));
    fold.appendChild(btnOf("Clear override", "mini-btn", (b) => send(null, b)));
    bar.appendChild(btnOf(ov ? "Qty override (on)" : "Qty override", "mini-btn", () => { fold.hidden = !fold.hidden; }));
    bar.appendChild(fold);
    return bar;
  }
  let busy = false;
  function decorate() {
    if (busy) return;
    const list = document.getElementById("buylistItems");
    if (!list) return;
    busy = true;
    try {
      list.querySelectorAll(".line[data-asin]").forEach((card) => {
        // B-1080 tidy rule: the card itself stays Approve / qty / Set / More -
        // the row tools live inside that line's "More" sheet (one tap away).
        if (!card.dataset.asin) return;
        const target = card.querySelector(".bl-sheet-box") || card;
        if (target.querySelector(":scope > .bax-tools")) return;
        target.appendChild(rowTools(card));
      });
    } finally { busy = false; }
  }
  function redecorate() {
    const list = document.getElementById("buylistItems");
    if (list) list.querySelectorAll(".bax-tools").forEach((n) => n.remove());
    decorate();
  }

  function start() {
    wrapSend();
    draw();
    refreshInfo();
    const list = document.getElementById("buylistItems");
    if (list && typeof MutationObserver === "function") new MutationObserver(decorate).observe(list, { childList: true, subtree: true });
    let marksKey = "";
    setInterval(() => {
      draw();
      decorate();
      const k = JSON.stringify([pg().buylistMarks, (pg().qtyV3 || {}).overrides]);
      if (k !== marksKey && !typing(document.getElementById("buylistItems"))) { marksKey = k; redecorate(); }
      if (Date.now() - infoAt > 5 * 60 * 1000) refreshInfo();
    }, 2000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperBuylistActions = Object.freeze({ historyPayload, draw });
})();
