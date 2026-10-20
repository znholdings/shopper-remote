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

  // host: element; screen: the model; opts: { send(action, payload) -> Promise, force, dictate }
  // B-1089 (v2.0.55): opts.dictate = where the box words go (the phone's
  // outbox, remote/box-outbox.js; the laptop page's own draft, wizard.js):
  //   load() / save(text)  the text box survives every re-draw and reload
  //   submit(text, input)  -> {ok:true, stored|queued} once the words are SAFE
  //   pending()            words not on the laptop yet ("Unsent on this phone")
  //   stamp()              redraw when those change
  function render(host, screen, opts) {
    opts = opts || {};
    if (!host) return;
    var dict = opts.dictate || null;
    var key = JSON.stringify(screen || null) + (dict && dict.stamp ? dict.stamp() : "");
    if (!opts.force && host.__wzKey === key) return;
    // Never wipe what the helper is typing; the next update draws it.
    // B-1089: never re-draw under a finger in the box-words text box, even empty.
    var a = document.activeElement;
    if (!opts.force && a && host.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a.value || a.className === "wz-textarea")) return;
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
        if (b.confirm && typeof confirm === "function" && !confirm(b.confirm)) return; // B-1326 (v2.0.79 laptops): Upload anyway asks first
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
      // B-1089 (v2.0.55): the words are never dropped. The text box keeps
      // them across re-draws (dict.save on every keystroke) and is emptied
      // only when submit says they are safe; Read is never locked while the
      // laptop works - the words queue.
      var box = el("div", "wz-dictate");
      var ta = el("textarea", "wz-textarea");
      ta.rows = 5;
      ta.placeholder = screen.input.placeholder || "";
      if (dict && dict.load) ta.value = dict.load() || "";
      ta.addEventListener("input", function () {
        if (dict && dict.save) dict.save(ta.value);
      });
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
        var go = dict && dict.submit ? dict.submit(text, screen.input) : send(screen.input.action, { text: text });
        Promise.resolve(go).then(function (res) {
          read.disabled = false;
          if (res && res.ok === true && (res.stored || res.queued)) {
            ta.value = "";
            if (dict && dict.save) dict.save("");
            // A re-draw while the words were being saved drew them into a new
            // text box - empty that one too (only if it holds just these words).
            var live = host.querySelector ? host.querySelector(".wz-textarea") : null;
            if (live && live !== ta && String(live.value || "").trim() === text) live.value = "";
          } else if (res && res.error) {
            hint.textContent = res.error;
            hint.hidden = false;
          }
        }, function () {
          read.disabled = false;
        });
      }, false);
      box.append(ta, read);
      var unsent = dict && dict.pending ? dict.pending() : [];
      if (unsent.length) {
        var ub = el("div", "wz-unsent");
        var online = !(dict.laptopOnline && !dict.laptopOnline());
        ub.append(el("p", "wz-unsent-head", "Unsent on this phone: " + unsent.length + (online ? " (sending…)" : " (the laptop isn't connected - they go as soon as it is)")));
        unsent.forEach(function (u) {
          ub.append(el("div", "wz-unsent-msg", u.words.length > 300 ? u.words.slice(0, 300) + "…" : u.words));
        });
        box.append(ub);
      }
      wrap.append(box);
    }

    wrap.append(hint);
    // v2.0.55 review (B-1089): box words still on this phone go before the
    // upload - the upload button waits for them and says why.
    var waiting = dict && dict.pendingAny ? dict.pendingAny().length : dict && dict.pending ? dict.pending().length : 0;
    var buttons = (screen.buttons || []).filter(function (b) { return !(waiting && b.action === "boxesUpload"); });
    if (waiting && buttons.length !== (screen.buttons || []).length) {
      wrap.append(el("div", "wz-note wz-upload-wait", waiting + " message" + (waiting === 1 ? " is" : "s are") + " still on this phone, not on the laptop yet - " + (waiting === 1 ? "it goes" : "they go") + " first, then you can put the boxes in ScanPower."));
    }
    if (buttons.length) {
      var bar = el("div", "wz-buttons");
      buttons.forEach(function (b) {
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
