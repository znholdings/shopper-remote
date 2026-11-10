// remote/queue-actions-view.js - B-1794 (v2.0.135): the Buy Queue buttons the phone could not send:
// Clear a finished queue (own labelled button + confirm), the pre-run buy order (up / down / back to
// ranked - B-1927 moved those to queue-preview-view.js), the pack-rank check ("needs a rank" -> the editor) and Recovery "forget what it learned".
// Host: #queueActionsHost. Data: payload.run, payload.lines, payload.buylist.generatedAt. Text nodes only.
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
    queueClear: "Clear the finished queue", queueClearStale: "Clear a stale finished queue", queueSetOrder: "Set the buy order",
    queueResetOrder: "Back to the ranked order", packRankQuestion: "Pack rank question", packRankSave: "Save the pack rank",
    packRankStatus: "Pack rank check", recoveryClearLearned: "Forget what Recovery learned",
  });
  const FINISHED = new Set(["done", "aborted", "error"]);
  let host = null, drawnKey = "", staleSent = false, rankState = null, rankOpen = null;

  // B-1927 (v2.0.146): the idle payload has no lines (run: null); the approved lines are the ones Main answered to "Preview"
  // (remote/queue-preview-view.js), which also owns the up / down order buttons now.
  function previewLines(p) {
    const Q = self.ShopperQueuePreview;
    const lines = Q && typeof Q.buyLines === "function" ? Q.buyLines() : [];
    return lines.filter((l) => l && l.asin);
  }
  async function checkRanks(lines, b) {
    const M = self.ShopperManualPrint;
    if (!M || !M.runCommand) { say("Not connected.", true); return; }
    const asins = [...new Set(lines.map((l) => l.asin))].slice(0, 200);
    b.disabled = true;
    const was = b.textContent; b.textContent = "Checking...";
    const out = await M.runCommand("packRankStatus", { asins });
    b.disabled = false; b.textContent = was;
    const r = out && out.result;
    if (!out || out.status !== "done" || !r || r.ok === false) { say(((r && (r.reason || r.error)) || (out && out.reason) || "Could not check the pack rank.").toString().slice(0, 200), true); return; }
    const unranked = [].concat(r.unranked || r.needsRank || []).map((x) => (typeof x === "string" ? x : x && x.asin)).filter(Boolean);
    rankState = { unranked, ranked: [].concat(r.ranked || []).length, at: Date.now() };
    drawnKey = "";
    draw();
  }
  async function openRank(line, slot, b) {
    const M = self.ShopperManualPrint;
    const per = Number(line.itemsPerUnit) > 0 ? Number(line.itemsPerUnit) : 1;
    const unit = Number(line.expectedCost) > 0 && Number(line.qty) > 0 ? Number(line.expectedCost) / Number(line.qty) : 0;
    b.disabled = true;
    const out = await M.runCommand("packRankQuestion", { asin: line.asin, url: line.sourceUrl || "", title: String(line.title || "").slice(0, 200), itemsPerUnit: per, unitCost: unit });
    b.disabled = false;
    const q = out && out.result;
    if (!out || out.status !== "done" || !q || q.ok === false || !q.token) { say(((q && (q.reason || q.error)) || "No pack-rank question for that line.").toString().slice(0, 200), true); return; }
    rankOpen = line.asin;
    slot.textContent = "";
    if (!self.ShopperPackRankPhone) { say("The pack-rank editor is not loaded.", true); return; }
    self.ShopperPackRankPhone.render(slot, q, async (choice) => {
      const r = await act("packRankSave", { token: q.token, choice });
      if (r && r.ok) { say("Pack rank saved."); slot.textContent = ""; rankOpen = null; rankState = null; drawnKey = ""; draw(); }
    });
  }

  function draw() {
    host = host || document.getElementById("queueActionsHost");
    if (!host) return;
    const p = pl() || {};
    const run = p.run || null;
    const lines = previewLines(p);
    const key = JSON.stringify([run && [run.status, run.startedAt], lines.map((l) => l.asin), rankState]);
    if (key === drawnKey || typing(host) || rankOpen) return;
    drawnKey = key;
    host.textContent = "";
    const box = el("div", "section qax-box");
    const finished = !!(run && FINISHED.has(run.status));
    if (finished) {
      box.appendChild(btnOf("Clear finished queue", "secondary-btn danger-btn", (b) => act("queueClear", {}, { btn: b, confirm: "Clear the finished queue? The report stays in Last run." })));
      if (!staleSent) {
        const gen = p.buylist && p.buylist.generatedAt, started = run.startedAt;
        if (gen && started && new Date(gen).getTime() > new Date(started).getTime()) { staleSent = true; act("queueClearStale", {}); }
      }
    }
    if (!run && lines.length) {
      box.appendChild(btnOf("Check pack ranks", "secondary-btn", (b) => checkRanks(lines, b)));
    }
    if (rankState) {
      box.appendChild(el("p", "muted small", rankState.unranked.length ? rankState.unranked.length + " need a rank:" : "Every line has a pack rank."));
      rankState.unranked.forEach((asin) => {
        const line = lines.find((l) => l.asin === asin) || { asin };
        const r = el("div", "qax-rank");
        const head = el("div", "l-actions");
        head.appendChild(el("span", "qax-name", (line.title || asin).slice(0, 60)));
        const slot = el("div", "qax-rank-slot");
        head.appendChild(btnOf("Rank it", "mini-btn", (b) => openRank(line, slot, b)));
        r.appendChild(head); r.appendChild(slot);
        box.appendChild(r);
      });
    }
    box.appendChild(btnOf("Forget what Recovery learned", "secondary-btn danger-btn", (b) => act("recoveryClearLearned", {}, { btn: b, confirm: "Forget everything Recovery has learned? It will learn again from the next run." })));
    host.appendChild(box);
  }
  function start() { draw(); setInterval(draw, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperQueueActions = Object.freeze({ draw });
})();
