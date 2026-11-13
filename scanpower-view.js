// remote/scanpower-view.js - B-1804 (v2.0.137): ScanPower batch writes on the phone (Pipeline page, #scanpowerHost).
// Reads: scanpowerPhoneRead {what: "plan" | "open" | "preview"} - Main runs the laptop's own Build plan / open batches / Update
// preview and stores them thinned (payload.pages.scanpowerPhone). Writes (each with a confirm): Create a new batch
// (scanpowerBuildSubmit), Add to an open batch (scanpowerAddToBatch), Update the batch with the deliveries shown
// (scanpowerBatchUpdateApply {batchId, signature, exclude, expect} - refused on the computer if anything changed since the preview).
// Text nodes only.
(function () {
  "use strict";
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const say = (t, bad) => { try { if (typeof toast === "function") toast(t, !!bad); } catch (e) { /* no toast */ } };
  const pl = () => { try { return typeof lastPayload !== "undefined" ? lastPayload : null; } catch (e) { return null; } };
  const pg = () => { const p = pl(); return p && p.pages && typeof p.pages === "object" ? p.pages : {}; };
  try { if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { scanpowerPhoneRead: "ScanPower: read", scanpowerBuildSubmit: "ScanPower: create batch", scanpowerAddToBatch: "ScanPower: add to batch", scanpowerBatchUpdateApply: "ScanPower: update batch" }); } catch (e) { /* cosmetic */ }

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
      if (res && res.ok === false) { say(String(res.error || res.reason || "The computer refused.").slice(0, 240), true); return { ok: false, result: res }; }
      if (res && res.note === "no direct response") say("Working on the computer - this page fills in when it is done.");
      return { ok: true, result: res };
    } catch (e) {
      say("Not sent: " + ((e && e.message) || "no connection"), true);
      return null;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = was; }
    }
  }
  const btnOf = (text, cls, fn) => { const b = el("button", cls || "mini-btn", text); b.type = "button"; b.addEventListener("click", () => fn(b)); return b; };
  const ago = (at) => { const m = Math.round((Date.now() - Number(at || 0)) / 60000); return !at ? "" : m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };

  // what Zach changed on screen, kept across redraws (by ASIN)
  const edit = { include: {}, qty: {}, expires: {}, msku: {}, exclude: {}, batchName: "", targetBatch: "" };

  function planSection(plan, open) {
    const sec = el("div", "sp-part");
    sec.appendChild(el("div", "small", "Build plan " + ago(plan.at) + (plan.more ? " (first 60 shown)" : "")));
    if (!plan.ok) { sec.appendChild(el("p", "muted small", plan.error || "No plan.")); return sec; }
    if (!plan.lines || !plan.lines.length) { sec.appendChild(el("p", "muted small", "Nothing at the house to send.")); return sec; }
    for (const l of plan.lines) {
      const row = el("div", "line sp-line");
      const inc = el("input"); inc.type = "checkbox"; inc.checked = edit.include[l.asin] !== false; inc.addEventListener("change", () => { edit.include[l.asin] = inc.checked; });
      row.appendChild(inc);
      const main = el("div", "sp-main");
      main.appendChild(el("b", "", l.title || l.asin));
      main.appendChild(el("div", "muted small", l.asin + " · at the house " + (l.onHand == null ? "?" : l.onHand) + (l.resolved ? "" : " · NOT a ScanPower listing")));
      const q = el("input", "sp-qty"); q.type = "number"; q.min = "0"; q.inputMode = "numeric"; q.value = String(edit.qty[l.asin] != null ? edit.qty[l.asin] : l.quantity || 0);
      q.addEventListener("input", () => { edit.qty[l.asin] = q.value; });
      main.appendChild(q);
      if (l.expirationRequired) {
        const d = el("input", "sp-exp"); d.type = "date"; d.value = edit.expires[l.asin] || l.expires || "";
        d.addEventListener("input", () => { edit.expires[l.asin] = d.value; });
        main.appendChild(el("span", "small", " expires "));
        main.appendChild(d);
      }
      if (l.mskuOptions && l.mskuOptions.length > 1) {
        const s = el("select", "sp-msku");
        for (const m of l.mskuOptions) { const o = el("option", "", m.msku + (m.condition ? " · " + m.condition : "")); o.value = m.msku; s.appendChild(o); }
        if (edit.msku[l.asin]) s.value = edit.msku[l.asin];
        s.addEventListener("change", () => { edit.msku[l.asin] = s.value; });
        main.appendChild(s);
      }
      row.appendChild(main);
      sec.appendChild(row);
    }
    const linesNow = () => plan.lines.filter((l) => edit.include[l.asin] !== false).map((l) => ({ asin: l.asin, quantity: Math.max(0, Math.floor(Number(edit.qty[l.asin] != null ? edit.qty[l.asin] : l.quantity) || 0)), cost: l.cost, source: l.source, expires: edit.expires[l.asin] || l.expires || "" })).filter((l) => l.quantity > 0);
    const mskus = () => { const o = {}; for (const l of plan.lines) if (edit.msku[l.asin]) o[l.asin] = edit.msku[l.asin]; else if (l.mskuOptions && l.mskuOptions.length > 1) o[l.asin] = l.mskuOptions[0].msku; return o; };
    const units = (ls) => ls.reduce((t, l) => t + l.quantity, 0);
    const name = el("input", "sp-name"); name.placeholder = "Batch name (optional)"; name.value = edit.batchName; name.addEventListener("input", () => { edit.batchName = name.value; });
    sec.appendChild(name);
    sec.appendChild(btnOf("Create new batch", "mini-btn primary-btn", (b) => {
      const ls = linesNow();
      if (!ls.length) { say("Nothing ticked.", true); return; }
      act("scanpowerBuildSubmit", { lines: ls, chosenMskuByAsin: mskus(), batchName: edit.batchName.trim().slice(0, 80) || null }, { btn: b, confirm: "Create a NEW ScanPower batch with " + ls.length + " product(s), " + units(ls) + " unit(s)? The computer re-checks every listing first." }).then((r) => { if (r && r.ok) say("Batch created" + (r.result && (r.result.batchName || r.result.batchId) ? ": " + (r.result.batchName || r.result.batchId) : "") + "."); });
    }));
    const batches = open && open.ok && Array.isArray(open.batches) ? open.batches : [];
    if (batches.length) {
      const s = el("select", "sp-target");
      for (const bt of batches) { const o = el("option", "", (bt.name || bt.batchId) + (bt.units != null ? " · " + bt.units + " units" : "")); o.value = bt.batchId; s.appendChild(o); }
      if (edit.targetBatch) s.value = edit.targetBatch;
      s.addEventListener("change", () => { edit.targetBatch = s.value; });
      sec.appendChild(s);
      sec.appendChild(btnOf("Add to this batch", "mini-btn", (b) => {
        const ls = linesNow();
        const id = s.value;
        if (!ls.length) { say("Nothing ticked.", true); return; }
        const bt = batches.find((x) => x.batchId === id) || {};
        act("scanpowerAddToBatch", { batchId: id, lines: ls, chosenMskuByAsin: mskus() }, { btn: b, confirm: "Add " + ls.length + " product(s), " + units(ls) + " unit(s) to ScanPower batch " + (bt.name || id) + "? The computer re-checks the batch is still open first." }).then((r) => { if (r && r.ok) say("Added to " + (bt.name || id) + "."); });
      }));
    }
    return sec;
  }

  function previewSection(pv) {
    const sec = el("div", "sp-part");
    sec.appendChild(el("div", "small", "Update preview " + ago(pv.at)));
    if (!pv.ok) { sec.appendChild(el("p", "muted small", pv.error || "No preview.")); return sec; }
    sec.appendChild(el("div", "", "Batch " + pv.batchName + (pv.since ? " · deliveries since " + String(pv.since).slice(0, 16).replace("T", " ") : "")));
    const lines = Array.isArray(pv.lines) ? pv.lines : [];
    if (!lines.length) { sec.appendChild(el("p", "muted small", "Nothing new to add.")); return sec; }
    const qtyOf = {};
    for (const l of lines) qtyOf[l.asin] = l.quantity;
    for (const r of pv.rows || []) {
      if (!(r.asin in qtyOf)) { if (r.why) sec.appendChild(el("div", "muted small", r.asin + ": " + r.why)); continue; }
      const row = el("div", "line sp-line");
      const inc = el("input"); inc.type = "checkbox"; inc.checked = !edit.exclude[r.asin]; inc.addEventListener("change", () => { edit.exclude[r.asin] = !inc.checked; });
      row.appendChild(inc);
      const main = el("div", "sp-main");
      main.appendChild(el("b", "", r.title || r.asin));
      main.appendChild(el("div", "muted small", r.asin + " · add " + qtyOf[r.asin] + (r.inBatch != null ? " · in batch now " + r.inBatch : "") + (r.why ? " · " + r.why : "")));
      row.appendChild(main);
      sec.appendChild(row);
    }
    sec.appendChild(btnOf("Update the batch", "mini-btn primary-btn", (b) => {
      const exclude = Object.keys(edit.exclude).filter((a) => edit.exclude[a] && a in qtyOf);
      const expect = {};
      for (const l of lines) if (!exclude.includes(l.asin)) expect[l.asin] = l.quantity;
      const n = Object.keys(expect).length;
      if (!n) { say("Nothing ticked.", true); return; }
      act("scanpowerBatchUpdateApply", { batchId: pv.batchId, signature: pv.signature, exclude, expect }, { btn: b, confirm: "Add these " + n + " product(s) to ScanPower batch " + pv.batchName + "? If anything changed since the preview, the computer writes nothing." }).then((r) => { if (r && r.ok) say("Batch " + pv.batchName + " updated."); });
    }));
    return sec;
  }

  let drawn = "";
  function draw() {
    const host = document.getElementById("scanpowerHost");
    if (!host) return;
    const a = document.activeElement;
    if (a && host.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT")) return;
    const d = pg().scanpowerPhone || {};
    const key = JSON.stringify(d);
    if (key === drawn && host.firstChild) return;
    drawn = key;
    host.textContent = "";
    const sec = el("section", "section sp-card");
    sec.appendChild(el("h3", "", "ScanPower batch"));
    const bar = el("div", "co-actions");
    bar.appendChild(btnOf("Build plan", "mini-btn", (b) => act("scanpowerPhoneRead", { what: "plan" }, { btn: b }).then(() => act("scanpowerPhoneRead", { what: "open" }))));
    bar.appendChild(btnOf("Update preview", "mini-btn", (b) => act("scanpowerPhoneRead", { what: "preview" }, { btn: b })));
    sec.appendChild(bar);
    if (d.plan) sec.appendChild(planSection(d.plan, d.open));
    if (d.preview) sec.appendChild(previewSection(d.preview));
    // B-2069 (v2.0.158): the two-line explainer sits behind an ⓘ by the heading, always.
    if (self.ShopperInfoTip) self.ShopperInfoTip.add(sec.querySelector("h3"), "Build plan: what is at the house, ready for a new or open batch. Update preview: the deliveries since the open batch was last updated.", { id: "sp-batch" });
    host.appendChild(sec);
  }
  function start() { draw(); setInterval(draw, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperScanpowerPhone = Object.freeze({ draw });
})();
