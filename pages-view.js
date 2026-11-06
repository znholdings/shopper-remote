// remote/pages-view.js - B-1792 (v2.0.135): the registry the phone's new pages hang on, so app.js needs only two hook lines.
//
//   ShopperPhonePages.register(tab, { pane, render(p), shown(), left() })
//   switched(which)  - app.js switchTab() calls it: every registered pane is hidden unless it is the tab shown; shown() runs on the one shown.
//   render(p)        - app.js renderPayload() calls it: the payload goes to every registered page's render (each page reads p.pages.<part>).
//   ui               - the small DOM helpers + the one "send a command and wait for its answer" every new page uses.
//
// Also registers the two tabs that live inside existing panes: "daily" (The Daily is drawn inside #dashboardPane by daily-view.js)
// and "bank" (#bankPane; app.js still shows it through its own lines).
// Loaded right after app.js. Classic script, DOM API only (textContent for every payload string).
(function (root) {
  "use strict";
  var doc = root.document;
  var pages = [];
  var current = "";

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function btn(label, cls, onClick) {
    var b = el("button", cls || "secondary-btn", label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function toast(text, bad) {
    var R = root.ShopperRemote;
    if (R && R.toast) R.toast(text, !!bad);
  }
  function section(title) {
    var s = el("div", "section pg-sec");
    if (title) s.appendChild(el("h3", "", title));
    return s;
  }
  function field(label, input) {
    var l = el("label", "pg-field");
    l.appendChild(el("span", "pg-label", label));
    l.appendChild(input);
    return l;
  }
  function input(type, attrs) {
    var i = doc.createElement("input");
    i.type = type || "text";
    i.className = "pg-input";
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function select(options) {
    var s = el("select", "pg-input");
    (options || []).forEach(function (o) {
      var op = doc.createElement("option");
      op.value = o[0];
      op.textContent = o[1];
      s.appendChild(op);
    });
    return s;
  }
  function pageData(p, part) {
    var pg = p && p.pages && typeof p.pages === "object" ? p.pages : null;
    return pg && pg[part] && typeof pg[part] === "object" ? pg[part] : null;
  }
  function mp() { return root.ShopperManualPrint || null; }

  // One command, then its answer. -> { ok, started, reason, result, status }
  // ok = the computer did it; started = a long job that answers "no direct response" (the outcome arrives through the projection).
  async function send(name, payload, button) {
    var M = mp();
    if (!M || !M.runCommand) return { ok: false, reason: "The phone is not ready yet.", status: "not sent" };
    var oldText = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "Working..."; }
    var out;
    try { out = await M.runCommand(name, payload || {}); } catch (e) { out = { status: "not sent" }; }
    if (button) { button.disabled = false; button.textContent = oldText; }
    var res = out && out.result && typeof out.result === "object" ? out.result : null;
    var r = { ok: false, started: false, reason: "", result: res, status: out && out.status };
    if (out.status === "offline") r.reason = M.OFFLINE_TEXT || "The computer is not answering.";
    else if (out.status === "not sent") r.reason = "It did not reach the computer, so nothing happened.";
    else if (out.status === "timeout") r.reason = "The computer did not answer in 3 minutes - check it before pressing again.";
    else if (out.status === "rejected") r.reason = "The computer refused it" + (out.reason ? " - " + out.reason : "") + ".";
    else if (out.status === "failed") r.reason = out.reason || "It failed on the computer.";
    else if (res && res.truncated) { r.ok = true; r.started = true; }
    else if (res && res.note === "no direct response") { r.ok = true; r.started = true; }
    else if (res && res.ok === false) r.reason = String(res.reason || res.error || "The computer said no.").slice(0, 300);
    else if (out.status === "done") r.ok = true;
    else r.reason = "No answer.";
    return r;
  }
  function say(r, doneText) {
    if (r.ok) toast(r.started ? "Started on the computer - watch the activity bar" : (doneText || "Done"), false);
    else toast(r.reason || "Did not work", true);
  }
  // A destructive button: its own labelled button, a confirm, then exactly one command.
  function confirmSend(message, name, payload, button, doneText, after) {
    if (typeof root.confirm === "function" && !root.confirm(message)) return Promise.resolve(null);
    return send(name, payload, button).then(function (r) { say(r, doneText); if (after) after(r); return r; });
  }

  function register(tab, def) { pages.push({ tab: tab, pane: def.pane || null, render: def.render, shown: def.shown, left: def.left }); }

  function switched(which) {
    var prev = current;
    current = which;
    pages.forEach(function (pg) {
      if (pg.pane) pg.pane.hidden = pg.tab !== which;
      if (pg.tab === prev && prev !== which && pg.left) { try { pg.left(); } catch (e) { /* a page must not break the tab switch */ } }
    });
    pages.forEach(function (pg) { if (pg.tab === which && pg.shown) { try { pg.shown(); } catch (e) { /* ignore */ } } });
  }
  function render(p) {
    pages.forEach(function (pg) { if (pg.render) { try { pg.render(p); } catch (e) { /* one page's bug must not blank the others */ } } });
  }

  var dailyPending = false;
  // The Daily is drawn inside #dashboardPane; the tab only makes that pane the one on screen and opens the review.
  register("daily", {
    shown: function () {
      var pane = doc.getElementById("dashboardPane");
      if (pane) pane.hidden = false;
      var D = root.ShopperDailyView;
      if (D && D.show && !D.isOpen()) D.show();
      dailyPending = !(D && D.isOpen && D.isOpen());
    },
    left: function () {
      var D = root.ShopperDailyView;
      if (D && D.close && D.isOpen()) D.close();
    },
    render: function () {
      // Reopened on The Daily before the first payload landed: open it once the data is here.
      var D = root.ShopperDailyView;
      if (dailyPending && current === "daily" && D && D.show && !D.isOpen()) { D.show(); dailyPending = !D.isOpen(); }
    }
  });
  register("bank", { pane: doc.getElementById("bankPane") });

  root.ShopperPhonePages = Object.freeze({
    register: register, switched: switched, render: render,
    ui: Object.freeze({ el: el, btn: btn, toast: toast, section: section, field: field, input: input, select: select, pageData: pageData, send: send, say: say, confirmSend: confirmSend }),
    _current: function () { return current; }
  });
})(self);
