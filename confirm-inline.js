// remote/confirm-inline.js - B-2180 (v2.0.175): the phone's ONE in-page confirm (the Close card's B-2175 idea, as a helper).
// inPageConfirm(anchorEl, text, { yes = "Yes", no = "Cancel" }) -> Promise<boolean>. A card is shown at the bottom of the screen
// (not inside the page, so a redraw of the page under it cannot drop it); Yes -> true, Cancel / Escape / a newer confirm -> false.
// The iOS PWA's window.confirm() is a blocking native sheet - nothing on the phone calls it any more. Text nodes only.
(function () {
  "use strict";
  let open = null; // { panel, finish } while a confirm is showing - one at a time
  function inPageConfirm(anchorEl, text, opts) {
    const o = opts || {};
    const yesText = o.yes || "Yes", noText = o.no || "Cancel";
    if (open) open.finish(false);
    return new Promise((resolve) => {
      const panel = document.createElement("div");
      panel.className = "ip-confirm";
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-live", "assertive");
      const msg = document.createElement("div");
      msg.className = "ip-confirm-text";
      msg.textContent = String(text == null ? "" : text);
      const row = document.createElement("div");
      row.className = "ip-confirm-row";
      const yes = document.createElement("button");
      yes.type = "button"; yes.className = "primary-btn mini-btn ip-confirm-yes"; yes.textContent = yesText;
      const no = document.createElement("button");
      no.type = "button"; no.className = "mini-btn ip-confirm-no"; no.textContent = noText;
      row.append(yes, no);
      panel.append(msg, row);
      let done = false;
      const onKey = (e) => { if (e && e.key === "Escape") finish(false); };
      function finish(v) {
        if (done) return;
        done = true;
        if (open && open.panel === panel) open = null;
        try { document.removeEventListener("keydown", onKey); } catch (e) { /* no listener */ }
        try { panel.remove(); } catch (e) { /* already gone */ }
        try { if (anchorEl && anchorEl.isConnected && typeof anchorEl.focus === "function") anchorEl.focus(); } catch (e) { /* focus is a courtesy */ }
        resolve(v === true);
      }
      yes.addEventListener("click", () => finish(true));
      no.addEventListener("click", () => finish(false));
      document.addEventListener("keydown", onKey);
      open = { panel, finish };
      (document.body || document.documentElement).appendChild(panel);
      try { no.focus(); } catch (e) { /* focus is a courtesy */ }
    });
  }
  // B-2203 (v2.0.176): a redraw under an open card must not let Yes act on the values the card was drawn from. readNow() -> any JSON-able
  // signature of the value the answer acts on; it is read when the card opens and again after Yes. Moved -> false, onMoved() says so, nothing is sent.
  function inPageConfirmStill(anchorEl, text, readNow, opts, onMoved) {
    const sig = () => { try { return JSON.stringify(readNow()); } catch (e) { return "?"; } };
    // opts.drawn = the signature of the value the card's button was DRAWN from (a redraw may have been skipped, so "current when it opens" can already be newer).
    const before = opts && Object.prototype.hasOwnProperty.call(opts, "drawn") ? JSON.stringify(opts.drawn) : sig();
    return inPageConfirm(anchorEl, text, opts).then((yes) => {
      if (!yes) return false;
      if (sig() !== before) { try { if (typeof onMoved === "function") onMoved(); } catch (e) { /* the refusal stands */ } return false; }
      return true;
    });
  }
  self.inPageConfirm = inPageConfirm;
  self.inPageConfirmStill = inPageConfirmStill;
})();
