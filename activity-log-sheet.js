// remote/activity-log-sheet.js - B-2061 (v2.0.158). The phone's Activity log: an "Activity log" row in the drawer (just above .pn-foot)
// and a full-height sheet with the MAIN computer's log (payload pages.activityLog.lines, newest last). textContent only. Classic script.
(function (root) {
  "use strict";
  var doc = root.document;
  if (!doc) return;
  var LOG_PATH = '<path d="M4 6h9M4 12h16M4 18h12"/><circle cx="18" cy="6" r="2"/>';
  var last = null; // the latest pages.activityLog part (null = none yet)
  var sheet = null;
  var pinned = true;
  var drawnKey = "";
  var keyFn = null;

  function clock(at) {
    var n = typeof at === "number" ? at : Date.parse(at);
    if (!isFinite(n)) return "--:--:--";
    try { return new Date(n).toLocaleTimeString("en-US", { timeZone: "America/Chicago" }); } catch (e) { return "--:--:--"; }
  }
  function nearBottom(el) { return el.scrollHeight - (el.scrollTop + el.clientHeight) <= 24; }
  function mk(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ensureCss() {
    if (doc.querySelector("link[data-als-css]")) return;
    var l = doc.createElement("link");
    l.rel = "stylesheet";
    l.href = "activity-log-sheet.css";
    l.setAttribute("data-als-css", "1");
    doc.head.appendChild(l);
  }

  function draw() {
    if (!sheet) return;
    var list = sheet.querySelector(".als-list");
    var nb = sheet.querySelector(".als-new");
    var top = list.scrollTop;
    var had = drawnKey;
    list.textContent = "";
    var lines = last && Array.isArray(last.lines) ? last.lines : null;
    if (!lines) {
      list.appendChild(mk("div", "als-empty", "No log from the main computer yet (it needs Shopper v2.0.158)."));
      drawnKey = "";
    } else if (!lines.length) {
      list.appendChild(mk("div", "als-empty", "Nothing in the log yet."));
      drawnKey = "";
    } else {
      lines.forEach(function (l) {
        var row = mk("div", "als-line");
        row.appendChild(mk("span", "als-time", clock(l && l.at)));
        row.appendChild(mk("span", "als-text", String((l && l.text) || "")));
        list.appendChild(row);
      });
      var lastLine = lines[lines.length - 1] || {};
      drawnKey = String(lastLine.at) + "|" + String(lastLine.text);
    }
    if (pinned) { list.scrollTop = list.scrollHeight; nb.hidden = true; }
    else { list.scrollTop = top; if (drawnKey && had && drawnKey !== had) nb.hidden = false; }
  }

  function close() {
    if (!sheet) return;
    doc.removeEventListener("keydown", keyFn, true);
    sheet.remove();
    sheet = null;
    keyFn = null;
  }
  function open() {
    if (sheet) return;
    ensureCss();
    pinned = true;
    drawnKey = "";
    sheet = mk("div", "als-root");
    var scrim = mk("div", "als-scrim");
    scrim.addEventListener("click", close);
    var card = mk("div", "als-sheet");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Activity log");
    var head = mk("div", "als-head");
    var ttl = mk("div", "als-title");
    ttl.appendChild(mk("div", "als-h", "Activity log"));
    ttl.appendChild(mk("div", "als-sub", "From the main computer"));
    var x = mk("button", "als-x", "\u2715");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    head.appendChild(ttl);
    head.appendChild(x);
    var list = mk("div", "als-list");
    var nb = mk("button", "als-new", "New lines \u2193");
    nb.type = "button";
    nb.hidden = true;
    nb.addEventListener("click", function () { pinned = true; nb.hidden = true; list.scrollTop = list.scrollHeight; });
    list.addEventListener("scroll", function () { pinned = nearBottom(list); if (pinned) nb.hidden = true; });
    card.appendChild(head);
    card.appendChild(list);
    card.appendChild(nb);
    sheet.appendChild(scrim);
    sheet.appendChild(card);
    doc.body.appendChild(sheet);
    keyFn = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    doc.addEventListener("keydown", keyFn, true);
    draw();
    try { x.focus(); } catch (e) { /* optional */ }
  }

  function addButton() {
    var nav = doc.getElementById("phoneNav");
    if (!nav || nav.querySelector(".pn-actlog")) return;
    ensureCss();
    var row = mk("div", "pn-actlog");
    var b = mk("button", "pn-actlog-btn");
    b.type = "button";
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + LOG_PATH + "</svg>";
    b.appendChild(mk("span", "pn-actlog-label", "Activity log"));
    b.addEventListener("click", function () {
      if (root.ShopperPhoneNav && typeof root.ShopperPhoneNav.close === "function") root.ShopperPhoneNav.close();
      open();
    });
    row.appendChild(b);
    var foot = nav.querySelector(".pn-foot");
    if (foot) nav.insertBefore(row, foot); else nav.appendChild(row);
  }

  addButton();
  if (root.ShopperPhonePages && typeof root.ShopperPhonePages.register === "function") {
    root.ShopperPhonePages.register("activitylog", {
      render: function (p) {
        var pg = p && p.pages && typeof p.pages === "object" ? p.pages : null;
        last = pg && pg.activityLog && typeof pg.activityLog === "object" ? pg.activityLog : null;
        if (sheet) draw();
      }
    });
  }
  root.ShopperActivityLogSheet = Object.freeze({ open: open, close: close, isOpen: function () { return !!sheet; } });
})(typeof self !== "undefined" ? self : this);
