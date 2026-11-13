// remote/run-reviews-view.js - B-1792 (v2.0.135): Run reviews on the phone (the laptop's runreviews/runreviews.html, read-only).
// payload.pages.runReviews = { at, reviews:[{reviewedAt, runId, trigger, severity, what, why, fix, status}] } (last 15).
// DOM API, textContent only. No buttons.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("runReviewsPane");
  if (!P || !pane) return;
  var U = P.ui;
  var sig = "\u0000";
  // B-2073 (v2.0.158): copies of lib/run-reviews-drawer.js SOURCE_LABEL (a test keeps them equal).
  var SEV = { severe: "Severe", high: "High", medium: "Medium", low: "Low", none: "No anomalies" };
  var TRIG = { buyQueue: "Buy Queue run", manualPipelineRefresh: "Pipeline refresh", makeChanges: "Make changes", hourly: "Hourly refresh" };
  var PL = { when: function (v) { return root.ShopperPlain ? root.ShopperPlain.when(v) : String(v || ""); }, note: function (v) { return root.ShopperPlain ? root.ShopperPlain.note(v) : String(v == null ? "" : v); } };

  function render(p) {
    var d = U.pageData(p, "runReviews");
    var s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    pane.textContent = "";
    var sec = U.section("Run reviews");
    pane.appendChild(sec);
    if (!d) { sec.appendChild(U.el("p", "muted", "Run reviews load from the computer...")); return; }
    // B-2073 (v2.0.158): newest first (the feed is oldest first), Central time, plain words, Fix shown.
    var list = Array.isArray(d.reviews) ? d.reviews.slice() : [];
    var ts = function (r) { var t = Date.parse(r && r.reviewedAt); return Number.isFinite(t) ? t : -Infinity; };
    list.sort(function (x, y) { return ts(y) - ts(x); });
    list = list.slice(0, 15);
    if (!list.length) { sec.appendChild(U.el("p", "muted", "No run reviews yet.")); return; }
    var newest = ts(list[0]);
    if (Number.isFinite(newest) && Date.now() - newest > 14 * 86400000) {
      sec.appendChild(U.el("p", "muted small", "No new reviews since " + PL.when(list[0].reviewedAt) + " - Shopper no longer writes run reviews; each run is summarized on the Run Summaries tab."));
    }
    list.forEach(function (r, i) {
      var sevKey = String(r.severity || "").toLowerCase().replace(/[^a-z]/g, "");
      var card = U.el("div", "pg-card pg-sev-" + sevKey);
      var head = U.el("div", "pg-head small");
      head.appendChild(U.el("b", "", SEV[sevKey] || String(r.severity || "Note").slice(0, 20)));
      var bits = [PL.when(r.reviewedAt), TRIG[r.trigger] || r.trigger].filter(Boolean).map(function (x) { return String(x).slice(0, 60); });
      head.appendChild(U.el("span", "muted", " " + bits.join(" - ")));
      card.appendChild(head);
      if (r.what) {
        var line = U.el("div", "pg-kv small");
        line.appendChild(U.el("span", "muted", "What: "));
        line.appendChild(U.el("span", "", PL.note(String(r.what).slice(0, 300))));
        card.appendChild(line);
      }
      var more = [r.why ? "Why: " + PL.note(String(r.why).slice(0, 300)) : "", r.fix ? "Fix: " + PL.note(String(r.fix).slice(0, 300)) : ""].filter(Boolean).join("  ");
      if (more && root.ShopperInfoTip) root.ShopperInfoTip.add(head, more, { id: "rr:" + (r.runId || "") + ":" + i, label: "Why and fix", after: head.lastElementChild });
      else if (more) card.appendChild(U.el("div", "pg-kv small", more));
      sec.appendChild(card);
    });
  }

  P.register("runreviews", { pane: pane, render: render });
  render(null);
})(self);
