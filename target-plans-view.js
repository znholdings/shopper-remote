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

  function planRow(p) {
    const row = el("div", "tpv-row" + (p.onList ? " tpv-on-list" : ""));
    row.appendChild(el("div", "tpv-title", (p.title || p.asin) + " (" + p.asin + ")"));
    row.appendChild(el("div", "tpv-facts", p.text || ""));
    if (p.listText) row.appendChild(el("div", "tpv-onlist", p.listText));
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

  self.ShopperTargetPlansView = Object.freeze({ render: render });
})();
