// remote/topbar-view.js - B-874 (v2.0.24): the phone's top bar, the same bar
// as the laptop's (lib/topbar.js + lib/topbar.css), scaled down.
//
// The wording comes from remote/activity-view.js (generated from
// lib/activity-view.js - one wording on both). The value is payload.activity,
// the same shape as the laptop's shopperActivity. app.js calls update() when
// a payload lands and tab() when the tab changes; a 1 s timer runs ONLY
// while a job is running (for "no new step for ..."), none when idle.
(function (root) {
  "use strict";
  var TAB_NAMES = { dashboard: "Dashboard", bank: "Virtual Bank", run: "Buy Queue", buylist: "Buylist", inventory: "Pipeline",
    fba: "FBA", wizard: "Ship to Amazon", belowmin: "Pricing", cashflow: "Cash", catalog: "Catalog", books: "Books", settings: "Settings",
    // B-1792 (v2.0.135): the pages the phone gained.
    daily: "The Daily", manualbuy: "Manual Buy", blacklist: "Blacklist", booksrules: "Books rules", runstatus: "Run status", runreviews: "Old run reviews", competitors: "Competitor ASINs", leads: "Tracked Leads" };
  var state = null;
  var timer = 0;

  function bar() { return document.getElementById("topBar"); }

  function draw() {
    var b = bar();
    var V = root.ShopperActivityView;
    if (!b || !V) return;
    var d = V.activityDisplay(state, Date.now());
    var w = V.activityLine(d);
    var running = d.mode === "run";
    b.setAttribute("data-state", running ? (d.stalledSec ? "stalled" : "run") : "idle");
    b.setAttribute("data-indeterminate", running && d.pct === null ? "1" : "0");
    b.style.setProperty("--s-tb-p", running && d.pct !== null ? String(d.pct / 100) : "0");
    var q = function (s) { return b.querySelector(s); };
    q(".s-tb-state").textContent = w.head;
    q(".s-tb-text").textContent = w.rest ? " · " + w.rest : "";
    q(".s-tb-warn").textContent = w.warn ? " · " + w.warn : "";
    if (running && !timer) timer = setInterval(draw, 1000);
    if (!running && timer) { clearInterval(timer); timer = 0; }
  }

  function update(activity) {
    var next = activity && typeof activity === "object" ? activity : null;
    var key = JSON.stringify(next);
    if (key === update.lastKey && (timer || !next)) return;
    update.lastKey = key;
    state = next;
    draw();
  }

  function tab(which) {
    var n = document.getElementById("tbPage");
    if (n) n.textContent = TAB_NAMES[which] || "Remote";
    if (root.ShopperShoppyView) root.ShopperShoppyView.tab(which); // B-2361 (v2.0.205): the queue Shoppy shows on the Buylist and Buy Queue tabs only
  }

  root.ShopperTopbar = Object.freeze({ update: update, tab: tab, draw: draw, TAB_NAMES: TAB_NAMES });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw);
  else draw();
})(self);
