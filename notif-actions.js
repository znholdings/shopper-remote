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

  function send(id, status, redraw) {
    const before = taps.get(id);
    taps.set(id, status);
    const R = self.ShopperRemote;
    if (R && R.sendCommand) {
      Promise.resolve(R.sendCommand("dashNotifAction", { id: id, status: status })).then((cmdId) => {
        if (!cmdId) return "not sent";
        return R.waitFor ? R.waitFor(cmdId) : null;
      }).then((outcome) => {
        if (outcome == null || outcome === "done" || taps.get(id) !== status) return;
        if (before === undefined) taps.delete(id); else taps.set(id, before);
        redraw();
      }).catch(() => {});
    }
    redraw();
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
      box.appendChild(button("Undo", "linkish gl-notif-undo", () => send(id, "open", redraw)));
      return box;
    }
    box.appendChild(button("Mark done", "secondary-btn gl-notif-done", () => send(id, "done", redraw)));
    box.appendChild(button("Dismiss", "linkish gl-notif-dismiss", () => send(id, "dismissed", redraw)));
    return box;
  }

  self.ShopperNotifActions = Object.freeze({ build: build, tapOf: (id) => taps.get(String(id)) });
})();
