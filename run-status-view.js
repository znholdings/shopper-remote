// remote/run-status-view.js - B-1792 / B-1795 (v2.0.135): Run status on the phone (the laptop's status/status.html).
// The engine's single-product run record, thinned by the computer: payload.pages.run =
//   { runId, status, mode, asin, title, currentStep, targetQty, targetDollar, progress, startedAt, finishedAt, pendingApproval, result, log }.
// Buttons: runPause / runResume / runAbort (Abort has its own red button + confirm). They act on the Main computer's run only.
// DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("runStatusPane");
  if (!P || !pane) return;
  var U = P.ui;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { runPause: "Run: pause", runResume: "Run: resume", runAbort: "Run: abort" });
  var sig = "\u0000";
  var OTHER = "That run is on the other computer - use the Buy Queue tab's controls.";

  function when(ms) {
    var n = Number(ms);
    if (!(n > 0)) return "";
    try { return new Date(n).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT"; } catch (e) { return ""; }
  }
  function kv(box, k, v) {
    if (v == null || v === "") return;
    var r = U.el("div", "pg-kv small");
    r.appendChild(U.el("span", "muted", k + ": "));
    r.appendChild(U.el("span", "", String(v).slice(0, 300)));
    box.appendChild(r);
  }
  async function control(name, b) {
    var r = await U.send(name, {}, b);
    if (!r.ok && r.result && /no running run|no run/i.test(String(r.result.reason || r.result.error || ""))) { U.toast(OTHER, true); return; }
    if (!r.ok && /no running run/i.test(r.reason || "")) { U.toast(OTHER, true); return; }
    U.say(r, "Sent");
  }

  function render(p) {
    var run = U.pageData(p, "run");
    var s = JSON.stringify(run);
    if (s === sig) return;
    sig = s;
    pane.textContent = "";
    var sec = U.section("Run status");
    pane.appendChild(sec);
    if (!run) {
      sec.appendChild(U.el("p", "muted", "No single-product run on the computer right now; the Buy Queue tab shows the queue."));
      return;
    }
    var status = String(run.status || "");
    var finished = !!(run.finishedAt || run.result);
    var card = U.el("div", "pg-card");
    kv(card, "Status", status);
    kv(card, "Mode", run.mode);
    kv(card, "Product", [run.asin, run.title].filter(Boolean).join(" - "));
    kv(card, "Step", run.currentStep);
    kv(card, "Target", [run.targetQty ? run.targetQty + " units" : "", run.targetDollar ? "$" + run.targetDollar : ""].filter(Boolean).join(", "));
    kv(card, "Started", when(run.startedAt));
    kv(card, "Finished", when(run.finishedAt));
    var prog = run.progress && typeof run.progress === "object" ? run.progress : null;
    if (prog) Object.keys(prog).slice(0, 8).forEach(function (k) { if (typeof prog[k] !== "object") kv(card, k, prog[k]); });
    if (run.pendingApproval) kv(card, "Waiting", "for an approval - answer it on the Buy Queue tab or the computer");
    var res = run.result && typeof run.result === "object" ? run.result : null;
    if (res) kv(card, "Result", (res.ok ? "done" : "stopped") + (res.reason ? " - " + res.reason : "") + (res.boughtQty != null ? "; bought " + res.boughtQty : "") + (res.spentDollars != null ? "; spent $" + res.spentDollars : ""));
    sec.appendChild(card);
    if (!finished) {
      var acts = U.el("div", "pg-row");
      var paused = /paus/i.test(status);
      if (paused) { var rs = U.btn("Resume", "secondary-btn", function () { control("runResume", rs); }); acts.appendChild(rs); }
      else { var pa = U.btn("Pause", "secondary-btn", function () { control("runPause", pa); }); acts.appendChild(pa); }
      var ab = U.btn("Abort run", "danger-btn", function () {
        if (typeof root.confirm === "function" && !root.confirm("Abort this run? The product on the screen stops now.")) return;
        control("runAbort", ab);
      });
      acts.appendChild(ab);
      sec.appendChild(acts);
    }
    var log = Array.isArray(run.log) ? run.log.slice(-30) : [];
    if (log.length) {
      var lg = U.section("Log");
      var pre = U.el("pre", "pg-log small");
      pre.textContent = log.map(function (l) { return typeof l === "string" ? l : (l && l.text) || ""; }).join("\n").slice(0, 6000);
      lg.appendChild(pre);
      pane.appendChild(lg);
    }
  }

  P.register("runstatus", { pane: pane, render: render });
  render(null);
})(self);
