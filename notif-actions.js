// remote/notif-actions.js - B-1287 (v2.0.75): Mark done / Dismiss / Undo on a
// notification in the Home tab's Do next list (outside The Daily).
//
// The SAME command The Daily's notification card sends (B-1272,
// remote/daily-view.js): ONE remote command `dashNotifAction` {id, status} ->
// the laptop Dashboard's own SHOPPER_DASHBOARD_NOTIFICATION_ACTION
// (whitelisted + checked in lib/remote-protocol.js). `id` is the id of the
// FULL notification key (lib/remote-dashboard.js shapeNotification - the key
// itself may be cut); the laptop finds the notification again or refuses.
// The card shows the tap at once; a refusal (app.js's command-outcome toast
// says why) puts it back as it was. The laptop's next payload drops a cleared
// notification from Do next. Dismiss is undone by Undo (no confirmation - as
// in The Daily; nothing is deleted).
(function () {
  "use strict";
  const taps = new Map(); // notification id -> "done" | "dismissed" | "open" (this page load)

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function button(label, cls, fn) {
    const b = node("button", cls, label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation(); // the card under it is a button too
      fn();
    });
    return b;
  }

  // B-1359 (v2.0.82): "Marked done" / "Dismissed" / Undo show ONLY after the laptop says done.
  // Press -> the button says "Saving..." (and is off) until the laptop answers; a refusal, a
  // timeout or a phone that could not send puts the button back with a plain sentence beside it
  // (remote/press-feedback.js, the same helper every other phone button uses).
  function answerFor(id, status) {
    return async function () {
      const R = self.ShopperRemote;
      const P = self.ShopperPress;
      if (!R || !R.sendCommand) return { ok: false, error: "not sent - the phone is not connected" };
      const cmdId = await R.sendCommand("dashNotifAction", { id: id, status: status });
      const st = cmdId ? (R.waitFor ? await R.waitFor(cmdId) : "unknown") : "not sent";
      let reason = "";
      let result = null;
      if (st !== "done" && cmdId && typeof R.readCommand === "function") {
        try { const row = await R.readCommand(cmdId); reason = (row && row.reason) || ""; result = (row && row.result) || null; } catch (e) { /* the status says enough */ }
      }
      if (P && P.phoneAnswer) return P.phoneAnswer(st, reason, result);
      return st === "done" ? { ok: true } : { ok: false, error: "the laptop said: " + st };
    };
  }
  function send(id, status, redraw, btn) {
    const P = self.ShopperPress;
    const run = answerFor(id, status);
    if (P && P.press && btn) {
      return P.press(btn, {
        sending: "Saving\u2026",
        run: run,
        onDone: function () { taps.set(id, status); },
      }).then(function (res) { if (res && res.ok) redraw(); return res; });
    }
    // no press helper (an old page): still nothing is shown as done before the laptop says so
    if (btn) { btn.disabled = true; btn.textContent = "Saving\u2026"; }
    return run().then(function (res) {
      if (res && res.ok) { taps.set(id, status); redraw(); return res; }
      if (btn) { btn.disabled = false; btn.textContent = status === "done" ? "Mark done" : status === "open" ? "Undo" : "Dismiss"; }
      return res;
    });
  }

  // n = a shaped notification ({ id, ... }); redraw() re-fills the card body.
  function build(n, redraw) {
    const box = node("div", "gl-notif-actions");
    const id = n && n.id ? String(n.id) : "";
    if (!id) {
      box.appendChild(node("span", "muted small", "Mark done / Dismiss for this one are on the laptop."));
      return box;
    }
    const tap = taps.get(id);
    if (tap === "done" || tap === "dismissed") {
      box.appendChild(node("span", "muted small gl-notif-state", tap === "done" ? "Marked done" : "Dismissed"));
      const undo = button("Undo", "linkish gl-notif-undo", () => send(id, "open", redraw, undo));
      box.appendChild(undo);
      return box;
    }
    const done = button("Mark done", "secondary-btn gl-notif-done", () => send(id, "done", redraw, done));
    const dis = button("Dismiss", "linkish gl-notif-dismiss", () => send(id, "dismissed", redraw, dis));
    box.appendChild(done);
    box.appendChild(dis);
    return box;
  }

  // B-1347 (v2.0.82): "check by hand" items closed (Mark done / Dismiss) in the last 7 days, with
  // Undo - the laptop Dashboard's "Show resolved" list, on the phone. The laptop sends them as
  // `resolvedHand` [{ id, title, status }]; Undo is the existing dashNotifAction {id, status:"open"}
  // (whitelisted in lib/remote-protocol.js, handled by SHOPPER_DASHBOARD_NOTIFICATION_ACTION).
  // redraw() redraws the Home tab. -> a block, or null when there is nothing to undo.
  function buildResolved(list, redraw) {
    const items = (Array.isArray(list) ? list : []).filter((x) => x && x.id && taps.get(String(x.id)) !== "open");
    if (!items.length) return null;
    const box = node("div", "gl-hand-resolved muted small");
    box.appendChild(node("div", "gl-hand-resolved-h", "Closed \"Ordered\" checks - Undo to open one again:"));
    for (const it of items.slice(0, 5)) {
      const line = node("div", "gl-hand-resolved-row");
      line.appendChild(node("span", "gl-hand-resolved-t", (it.status === "dismissed" ? "Dismissed: " : "Done: ") + String(it.title || "").slice(0, 120)));
      const id = String(it.id);
      const undo = button("Undo", "linkish gl-notif-undo", () => send(id, "open", redraw, undo));
      line.appendChild(undo);
      box.appendChild(line);
    }
    return box;
  }

  self.ShopperNotifActions = Object.freeze({ build: build, buildResolved: buildResolved, tapOf: (id) => taps.get(String(id)) });
})();
