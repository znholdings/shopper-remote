// remote/target-plans-view.js - B-1103 (v2.0.57): the open Target plans on
// the phone's Buylist tab - product, done / wanted, today's part - and, for
// a plan whose product is on tonight's list, Zach's pick: "Roll into the
// plan" (preselected) or "Keep separate" (both bought). The laptop works it
// all out (lib/target-plan-list.js) and sends it on the buylist as
// `targetPlans`; a tap sends the targetPlanChoice command (the laptop
// Buylist panel's own SHOPPER_TARGET_PLAN_LIST_CHOICE).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let drawnKey = "";
  let data = null;
  let flash = "";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function send(p, choice, btns, out) {
    const R = self.ShopperRemote;
    if (!R) { out.textContent = "Not connected."; return; }
    btns.forEach(function (b) { b.disabled = true; });
    out.className = "tpv-result";
    out.textContent = "Sending to the laptop...";
    Promise.resolve(R.sendCommand("targetPlanChoice", { planId: p.planId, choice: choice }))
      .then(function (cmdId) {
        if (!cmdId) throw new Error("not sent");
        return R.waitFor(cmdId);
      })
      .then(function (status) {
        if (status === "done") {
          flash = p.asin + ": " + (choice === "separate" ? "kept separate - both are bought." : "rolls into its plan.");
          out.textContent = "Saved.";
        } else {
          btns.forEach(function (b) { b.disabled = false; });
          out.className = "tpv-result tpv-bad";
          out.textContent = "Not saved (" + status + ") - the laptop must be connected.";
        }
      })
      .catch(function (e) {
        btns.forEach(function (b) { b.disabled = false; });
        out.className = "tpv-result tpv-bad";
        out.textContent = "Not sent: " + ((e && e.message) || "no connection") + ".";
      });
  }

  // B-1794 (v2.0.135): Skip today / Don't skip / Cancel plan - the laptop card's own three buttons.
  // Cancel is its own labelled button behind a confirm (the desktop's wording, target-plans-card.js).
  function planCmd(name, p, btn, out, confirmText) {
    const R = self.ShopperRemote;
    if (!R) { out.textContent = "Not connected."; return; }
    if (confirmText && !window.confirm(confirmText)) return;
    btn.disabled = true;
    out.className = "tpv-result";
    out.textContent = "Sending to the laptop...";
    Promise.resolve(R.sendCommand(name, { planId: p.planId }))
      .then(function (id) { if (!id) throw new Error("not sent"); return R.waitFor(id).then(function (st) { return R.commandRow(id).then(function (row) { return [st, row]; }); }); })
      .then(function (a) {
        const row = a[1], res = row && row.result && typeof row.result === "object" ? row.result : null;
        btn.disabled = false;
        if (a[0] === "done" && !(res && res.ok === false)) { out.textContent = "Done."; return; }
        out.className = "tpv-result tpv-bad";
        out.textContent = String((res && (res.reason || res.error)) || (row && row.reason) || "Not done (" + a[0] + ").").slice(0, 160);
      })
      .catch(function (e) { btn.disabled = false; out.className = "tpv-result tpv-bad"; out.textContent = "Not sent: " + ((e && e.message) || "no connection") + "."; });
  }
  function planTools(p, row) {
    const t = el("div", "tpv-btns tpv-tools");
    const out = el("span", "tpv-result");
    const skip = el("button", "secondary-btn tpv-skip", p.skippedToday ? "Don't skip today" : "Skip today");
    skip.type = "button";
    skip.addEventListener("click", function () { planCmd(p.skippedToday ? "targetPlanUnskip" : "targetPlanSkipToday", p, skip, out); });
    const cancel = el("button", "secondary-btn danger-btn tpv-cancel", "Cancel plan");
    cancel.type = "button";
    cancel.addEventListener("click", function () { planCmd("targetPlanCancel", p, cancel, out, "Cancel this Target plan for " + (p.title || p.asin) + "? It will stop buying toward it."); });
    t.appendChild(skip);
    t.appendChild(cancel);
    t.appendChild(out);
    row.appendChild(t);
  }

  function planRow(p) {
    const row = el("div", "tpv-row" + (p.onList ? " tpv-on-list" : ""));
    row.appendChild(el("div", "tpv-title", (p.title || p.asin) + " (" + p.asin + ")"));
    row.appendChild(el("div", "tpv-facts", p.text || ""));
    if (p.listText) row.appendChild(el("div", "tpv-onlist", p.listText));
    if (p.skippedToday) row.appendChild(el("div", "tpv-onlist", "Skipped for today."));
    if (p.planId) planTools(p, row);
    if (!p.onList) return row;
    const btns = el("div", "tpv-btns");
    // s-tab: the shared segmented choice (retro fills the pressed one).
    const roll = el("button", "secondary-btn tpv-pick s-tab", "Roll into the plan");
    const sep = el("button", "secondary-btn tpv-pick s-tab", "Keep separate");
    roll.type = "button";
    sep.type = "button";
    roll.setAttribute("aria-pressed", String(p.choice !== "separate"));
    sep.setAttribute("aria-pressed", String(p.choice === "separate"));
    const out = el("span", "tpv-result");
    roll.addEventListener("click", function () { if (p.choice !== "roll") send(p, "roll", [roll, sep], out); });
    sep.addEventListener("click", function () { if (p.choice !== "separate") send(p, "separate", [roll, sep], out); });
    btns.appendChild(roll);
    btns.appendChild(sep);
    btns.appendChild(out);
    row.appendChild(btns);
    return row;
  }

  function render(bl) {
    const host = $("tpPlanHost");
    if (!host) return;
    data = bl && bl.targetPlans && Array.isArray(bl.targetPlans.plans) ? bl.targetPlans : null;
    const key = JSON.stringify(data) + "|" + flash;
    if (key === drawnKey) return;
    drawnKey = key;
    host.textContent = "";
    if (!data || !data.plans.length) { host.hidden = true; return; }
    host.hidden = false;
    const box = el("div", "section tpv-box");
    box.appendChild(el("h3", "tpv-head", "Target plans"));
    for (const p of data.plans) box.appendChild(planRow(p));
    if (data.todayDollars > 0) box.appendChild(el("p", "tpv-note", "Today's plan parts: $" + Number(data.todayDollars).toFixed(2) + " - counted in Approved."));
    if (flash) box.appendChild(el("p", "tpv-note", flash));
    host.appendChild(box);
  }

  try {
    if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { targetPlanCancel: "Cancel the Target plan", targetPlanSkipToday: "Skip the Target plan today", targetPlanUnskip: "Don't skip the Target plan today" });
  } catch (e) { /* labels are cosmetic */ }
  self.ShopperTargetPlansView = Object.freeze({ render: render });
})();
