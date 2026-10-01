// wizard-view.js - B-742 (v2.0.7): draws one Shipment Wizard screen.
//
// ONE renderer for the laptop page (wizard/wizard.html) and the phone's
// "Ship" tab (remote/index.html): both files are this same text (a test keeps
// them identical). It owns no rules - the screen model comes from
// lib/ship-wizard.js screenFor() on the laptop, and every tap goes back as
// (action, payload) through `send`. Built with textContent only.
(function () {
  "use strict";
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function inputFor(kind) {
    if (kind === "number") {
      var i = el("input", "wz-input");
      i.type = "number";
      i.min = "0";
      i.inputMode = "numeric";
      i.placeholder = "How many";
      return i;
    }
    if (kind === "date") {
      var d = el("input", "wz-input");
      d.type = "date";
      return d;
    }
    var t = el("input", "wz-input");
    t.type = "text";
    t.placeholder = "Type it here";
    return t;
  }

  function button(b, onPress, busy) {
    var cls = "wz-btn" + (b.style === "primary" ? " wz-btn-primary" : "") + (b.style === "small" ? " wz-btn-small" : "");
    var n = el("button", cls, b.label);
    n.type = "button";
    n.disabled = !!busy || b.style === "disabled";
    n.addEventListener("click", onPress);
    return n;
  }

  // host: element; screen: the model; opts: { send(action, payload) -> Promise, force }
  function render(host, screen, opts) {
    opts = opts || {};
    if (!host) return;
    var key = JSON.stringify(screen || null);
    if (!opts.force && host.__wzKey === key) return;
    // Never wipe what the helper is typing; the next update draws it.
    var a = document.activeElement;
    if (!opts.force && a && host.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.value) return;
    host.__wzKey = key;
    host.textContent = "";
    if (!screen) {
      host.append(el("p", "wz-muted", "Waiting for the laptop..."));
      return;
    }
    var send = typeof opts.send === "function" ? opts.send : function () { return Promise.resolve(); };
    var busy = !!screen.working;
    var wrap = el("div", "wz");
    if (screen.n) wrap.append(el("div", "wz-step", "Step " + screen.n + " of " + screen.of));
    wrap.append(el("h2", "wz-title", screen.title || ""));
    (screen.say || []).forEach(function (line) {
      if (line) wrap.append(el("p", "wz-say", line));
    });
    if (busy) wrap.append(el("div", "wz-working", screen.workingText || "Working..."));
    if (screen.error) wrap.append(el("div", "wz-error", screen.error));
    if (screen.note) wrap.append(el("div", "wz-note", screen.note));
    var hint = el("div", "wz-hint");
    hint.hidden = true;

    function press(b, input) {
      return function () {
        var payload = {};
        var k;
        for (k in b.payload || {}) payload[k] = b.payload[k];
        if (input) {
          var v = String(input.value || "").trim();
          if (b.action === "issue") {
            payload.qty = v || "1";
            payload.value = v;
          } else if (payload.ask) {
            if (!v) {
              hint.textContent = b.action === "date" ? "Type the date first, then tap the button again." : b.action === "bag" ? "Type the bag size first, then tap Other again." : "Type the number first, then tap No again.";
              hint.hidden = false;
              input.focus();
              return;
            }
            payload.value = v;
          }
        }
        hint.hidden = true;
        Array.prototype.forEach.call(host.querySelectorAll("button"), function (x) { x.disabled = true; });
        Promise.resolve(send(b.action, payload)).catch(function () {}).then(function () {
          Array.prototype.forEach.call(host.querySelectorAll("button"), function (x) { x.disabled = false; });
        });
      };
    }

    if ((screen.rows || []).length) {
      var list = el("div", "wz-rows");
      screen.rows.forEach(function (r) {
        var row = el("div", "wz-row" + (r.done ? " is-done" : ""));
        var head = el("div", "wz-row-head");
        head.append(el("div", "wz-row-title", r.title || ""));
        if (r.sub) head.append(el("div", "wz-row-sub", r.sub));
        row.append(head);
        if (r.text) row.append(el("div", "wz-row-text", r.text));
        if (r.question) row.append(el("div", "wz-row-q", r.question));
        var input = null;
        var acts = el("div", "wz-row-actions");
        if (r.ask && (r.actions || []).some(function (b) { return b.payload && (b.payload.ask || b.action === "issue"); })) {
          input = inputFor(r.ask);
          acts.append(input);
        }
        (r.actions || []).forEach(function (b) {
          acts.append(button(b, press(b, input), busy));
        });
        if (acts.childNodes.length) row.append(acts);
        list.append(row);
      });
      wrap.append(list);
    }

    if (screen.input && screen.input.kind === "text") {
      var box = el("div", "wz-dictate");
      var ta = el("textarea", "wz-textarea");
      ta.rows = 5;
      ta.placeholder = screen.input.placeholder || "";
      var read = button({ label: "Read", style: "primary" }, function () {
        var text = String(ta.value || "").trim();
        if (!text) {
          hint.textContent = "Say or type what is in the boxes first.";
          hint.hidden = false;
          ta.focus();
          return;
        }
        hint.hidden = true;
        read.disabled = true;
        Promise.resolve(send(screen.input.action, { text: text })).then(function (res) {
          read.disabled = false;
          if (!res || res.ok !== false) ta.value = "";
        });
      }, busy);
      box.append(ta, read);
      wrap.append(box);
    }

    wrap.append(hint);
    if ((screen.buttons || []).length) {
      var bar = el("div", "wz-buttons");
      screen.buttons.forEach(function (b) {
        bar.append(button(b, press(b, null), busy));
      });
      wrap.append(bar);
    }
    if (screen.moreBoxes) {
      var more = button({ label: "More boxes arrived" }, press({ action: "moreBoxes", payload: {} }, null), busy);
      more.className += " wz-more";
      wrap.append(more);
    }
    host.append(wrap);
  }

  var api = { render: render };
  if (typeof self !== "undefined") self.ShopperWizardView = api;
})();
