// remote/books-rules-view.js - B-1792 / B-1797 (v2.0.135): Books rules on the phone (the laptop's books/rules.html, Settings > Books).
// payload.pages.booksRules = { at, rules:[{key, account, count, note}], loans:[{id, name, account}], accounts:[[code, name]] }.
// What the phone can do: ADD a rule (booksRulesAdd, confirm - it appends to the Rules tab) and REMOVE a loan (booksLoanRemove, confirm).
// Changing the whole rule list (booksRulesSet), editing a loan (booksLoanSet), Learn from bench / Fill bench / Shadow import (files) stay on
// the computer: the phone's rule rows do not carry every column Set needs, and a Set from them could switch rules off.
// DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("booksRulesPane");
  if (!P || !pane) return;
  var U = P.ui;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { booksRulesAdd: "Books rules: add", booksRulesSet: "Books rules: save", booksLoanSet: "Books loan: save", booksLoanRemove: "Books loan: remove" });
  var sig = "\u0000";
  var f = {};

  function accName(a) { return Array.isArray(a) ? String(a[1] || "") : String((a && a.name) || ""); }
  function accCode(a) { return Array.isArray(a) ? String(a[0]) : String((a && a.code) || ""); }

  async function doAdd() {
    var key = f.key.value.trim().slice(0, 120);
    var account = f.account.value;
    if (!key || !account) { U.toast("Type the merchant and pick the account.", true); return; }
    if (typeof root.confirm === "function" && !root.confirm("Add a rule: always book \"" + key + "\" to account " + account + "? It is written to the Rules tab.")) return;
    var r = await U.send("booksRulesAdd", { rules: [{ key: key, account: account, count: 1 }] }, f.addBtn);
    U.say(r, "Rule added");
    if (r.ok) f.key.value = "";
  }

  var lastP = null;
  function render(p) {
    lastP = p;
    var d = U.pageData(p, "booksRules");
    var s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    // Never redraw under a finger.
    var ae = doc.activeElement;
    if (ae && pane.contains(ae) && /^(INPUT|SELECT)$/.test(ae.tagName)) { sig = "\u0000"; return; }
    pane.textContent = "";
    if (!d) {
      var w = U.section("Books rules");
      w.appendChild(U.el("p", "muted", "The rules load from the computer..."));
      pane.appendChild(w);
      return;
    }
    var rules = Array.isArray(d.rules) ? d.rules.slice(0, 200) : [];
    var rs = U.section("Rules");
    rs.firstChild.appendChild(doc.createTextNode(" "));
    rs.firstChild.appendChild(U.el("span", "count", rules.length));
    if (!rules.length) rs.appendChild(U.el("p", "muted small", "No rules yet."));
    rules.forEach(function (r) {
      var row = U.el("div", "line pg-rule");
      row.appendChild(U.el("b", "", String(r.key).slice(0, 120)));
      row.appendChild(U.el("span", "muted small", " -> " + String(r.account).slice(0, 120) + (r.count ? " (" + r.count + ")" : "")));
      if (r.note) row.appendChild(U.el("div", "muted small", String(r.note).slice(0, 200)));
      rs.appendChild(row);
    });
    pane.appendChild(rs);

    var loans = Array.isArray(d.loans) ? d.loans.slice(0, 20) : [];
    var ls = U.section("Loans");
    if (!loans.length) ls.appendChild(U.el("p", "muted small", "No loans."));
    loans.forEach(function (l) {
      var row = U.el("div", "line pg-loan");
      var main = U.el("div", "pg-bl-main");
      main.appendChild(U.el("b", "", String(l.name || l.id).slice(0, 120)));
      if (l.account) main.appendChild(U.el("div", "muted small", String(l.account).slice(0, 120)));
      row.appendChild(main);
      ls.appendChild(row);
    });
    pane.appendChild(ls);
    // Add / change rules and loans: remote/books-actions-view.js (ShopperBooksActions.renderRules) draws into this host.
    var host = doc.createElement("div");
    host.id = "booksRulesActionsHost";
    pane.appendChild(host);
    if (root.ShopperBooksActions && root.ShopperBooksActions.renderRules && lastP) root.ShopperBooksActions.renderRules(host, lastP);
  }

  P.register("booksrules", { pane: pane, render: render });
  render(null);
})(self);
