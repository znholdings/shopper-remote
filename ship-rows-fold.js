// B-2072 (v2.0.158): Ship step 1 - Damaged / Wrong item sit behind a ⋯ on each product row. wizard-view.js is shared with the
// laptop, so it is not edited; this watches #wizardHost and folds the issue buttons after each draw (same idea as wizard/wizard-desk.js).
// Open rows are remembered in memory by the row's ASIN line. textContent only.
(function () {
  "use strict";
  var host = document.getElementById("wizardHost");
  if (!host || !self.MutationObserver) return;
  var ISSUE = ["Damaged", "Wrong item"];
  var OPEN = new Set();
  var busy = false;
  function labels(acts) {
    var out = [];
    for (var i = 0; i < acts.children.length; i++) if (acts.children[i].tagName === "BUTTON") out.push(acts.children[i].textContent.trim());
    return out;
  }
  function keyOf(row) { var s = row.querySelector(".wz-row-sub"); return s ? s.textContent.trim() : ""; }
  function apply() {
    if (busy) return;
    busy = true;
    try {
      var rows = host.querySelectorAll(".wz-row");
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.dataset.srf === "1") continue;
        var acts = row.querySelector(":scope > .wz-row-actions");
        var head = row.querySelector(":scope > .wz-row-head");
        if (!acts || !head) continue;
        var l = labels(acts);
        if (l.length !== ISSUE.length || l[0] !== ISSUE[0] || l[1] !== ISSUE[1]) continue;
        row.dataset.srf = "1";
        acts.classList.add("srf-folded");
        var key = keyOf(row);
        var on = key && OPEN.has(key);
        row.classList.toggle("srf-open", !!on);
        var b = document.createElement("button");
        b.type = "button"; b.className = "wz-btn wz-btn-small srf-more"; b.textContent = "⋯";
        b.setAttribute("aria-label", "Damaged or wrong item"); b.setAttribute("aria-expanded", on ? "true" : "false");
        b.addEventListener("click", function (row, key, b) {
          return function () {
            var open = row.classList.toggle("srf-open");
            b.setAttribute("aria-expanded", open ? "true" : "false");
            if (key) { if (open) OPEN.add(key); else OPEN.delete(key); }
          };
        }(row, key, b));
        head.appendChild(b);
      }
    } finally { busy = false; }
  }
  new MutationObserver(function () { if (!busy) apply(); }).observe(host, { childList: true, subtree: true });
  apply();
})();
