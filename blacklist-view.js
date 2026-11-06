// remote/blacklist-view.js - B-1792 / B-1795 (v2.0.135): the Blacklist on the phone (the laptop's blacklist/blacklist.html).
// Rows come from payload.pages.blacklist = { at, entries:[{asin,title,reason,blockedOn}], total, pending:[{asin,title,reason}] }.
// Add -> blacklistAdd {asin,title,reason}; each row's own Remove button (confirm) -> blacklistRemove {asin}. Search filters locally.
// DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("blacklistPane");
  if (!P || !pane) return;
  var U = P.ui;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { blacklistAdd: "Blacklist: add", blacklistRemove: "Blacklist: remove" });

  var data = null;
  var f = {};
  var sig = "";

  function build() {
    pane.textContent = "";
    var add = U.section("Add to the Blacklist");
    f.asin = U.input("text", { placeholder: "ASIN", autocapitalize: "characters", maxlength: "10" });
    f.title = U.input("text", { placeholder: "Title (optional)", maxlength: "200" });
    f.reason = U.input("text", { placeholder: "Why (optional)", maxlength: "200" });
    add.appendChild(U.field("ASIN", f.asin));
    add.appendChild(U.field("Title", f.title));
    add.appendChild(U.field("Reason", f.reason));
    f.addBtn = U.btn("Add to Blacklist", "primary-btn", doAdd);
    add.appendChild(f.addBtn);
    pane.appendChild(add);
    var list = U.section("Blocked");
    f.count = U.el("span", "count");
    list.firstChild.appendChild(doc.createTextNode(" "));
    list.firstChild.appendChild(f.count);
    f.search = U.input("search", { placeholder: "Search ASIN, title, reason" });
    f.search.addEventListener("input", drawRows);
    list.appendChild(f.search);
    f.pending = U.el("div", "pg-note small");
    f.pending.hidden = true;
    list.appendChild(f.pending);
    f.rows = U.el("div", "lines pg-rows");
    list.appendChild(f.rows);
    pane.appendChild(list);
  }

  async function doAdd() {
    var asin = f.asin.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) { U.toast("Type the 10-character ASIN.", true); return; }
    var r = await U.send("blacklistAdd", { asin: asin, title: f.title.value.trim().slice(0, 200), reason: f.reason.value.trim().slice(0, 200) }, f.addBtn);
    U.say(r, "Added to the Blacklist");
    if (r.ok) { f.asin.value = ""; f.title.value = ""; f.reason.value = ""; }
  }

  function drawRows() {
    var entries = data && Array.isArray(data.entries) ? data.entries : [];
    var q = f.search.value.trim().toLowerCase();
    var shownRows = q ? entries.filter(function (e) { return (String(e.asin) + " " + String(e.title) + " " + String(e.reason)).toLowerCase().indexOf(q) >= 0; }) : entries;
    f.count.textContent = data ? (shownRows.length === entries.length ? String(data.total != null ? data.total : entries.length) : shownRows.length + " of " + entries.length) : "";
    f.rows.textContent = "";
    if (!data) { f.rows.appendChild(U.el("p", "muted small", "The Blacklist loads from the computer...")); return; }
    if (!shownRows.length) { f.rows.appendChild(U.el("p", "muted small", q ? "Nothing matches." : "The Blacklist is empty.")); return; }
    shownRows.forEach(function (e) {
      var row = U.el("div", "line pg-bl-row");
      var main = U.el("div", "pg-bl-main");
      main.appendChild(U.el("b", "", e.asin));
      if (e.title) main.appendChild(U.el("div", "small", String(e.title).slice(0, 200)));
      var meta = [e.reason, e.blockedOn].filter(Boolean).map(function (x) { return String(x).slice(0, 200); }).join(" - ");
      if (meta) main.appendChild(U.el("div", "muted small", meta));
      row.appendChild(main);
      var rm = U.btn("Remove", "danger-btn", function () {
        U.confirmSend("Remove " + e.asin + " from the Blacklist? It can be bought again.", "blacklistRemove", { asin: String(e.asin) }, rm, "Removed");
      });
      row.appendChild(rm);
      f.rows.appendChild(row);
    });
  }

  function render(p) {
    var d = U.pageData(p, "blacklist");
    var s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    data = d;
    var pend = d && Array.isArray(d.pending) ? d.pending : [];
    f.pending.hidden = !pend.length;
    f.pending.textContent = pend.length ? "Waiting to be blocked: " + pend.slice(0, 20).map(function (x) { return x.asin; }).join(", ") : "";
    drawRows();
  }

  build();
  drawRows();
  P.register("blacklist", { pane: pane, render: render });
})(self);
