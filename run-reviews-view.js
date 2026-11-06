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

  function render(p) {
    var d = U.pageData(p, "runReviews");
    var s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    pane.textContent = "";
    var sec = U.section("Run reviews");
    pane.appendChild(sec);
    var list = d && Array.isArray(d.reviews) ? d.reviews.slice(0, 15) : [];
    if (!d) { sec.appendChild(U.el("p", "muted", "Run reviews load from the computer...")); return; }
    if (!list.length) { sec.appendChild(U.el("p", "muted", "No run reviews yet.")); return; }
    list.forEach(function (r) {
      var card = U.el("div", "pg-card pg-sev-" + String(r.severity || "").toLowerCase().replace(/[^a-z]/g, ""));
      var head = U.el("div", "pg-head small");
      head.appendChild(U.el("b", "", String(r.severity || "note").slice(0, 20)));
      head.appendChild(U.el("span", "muted", " " + [r.reviewedAt, r.trigger, r.status].filter(Boolean).map(function (x) { return String(x).slice(0, 60); }).join(" - ")));
      card.appendChild(head);
      [["What", r.what], ["Why", r.why], ["Fix", r.fix]].forEach(function (kv) {
        if (!kv[1]) return;
        var line = U.el("div", "pg-kv small");
        line.appendChild(U.el("span", "muted", kv[0] + ": "));
        line.appendChild(U.el("span", "", String(kv[1]).slice(0, 300)));
        card.appendChild(line);
      });
      sec.appendChild(card);
    });
  }

  P.register("runreviews", { pane: pane, render: render });
  render(null);
})(self);
