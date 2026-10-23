// remote/packing-view.js - B-1426 / B-1429 (v2.0.92). Packing data on the
// phone's Ship tab: a "Packing data" button opens a full-screen sheet with the
// SAME form the laptop page has (remote/packing-lib.js is the generated copy
// of lib/packing-form.js + lib/packing-form-view.js). ⚠ Owns no rules: every
// tap is a whitelisted command (lib/remote-protocol.js packing*) the laptop
// answers and checks; nothing here reaches ScanPower, a listing or a run.
//
// The laptop must be there - the same rule as Manual Print: a command the
// laptop did not pick up within 50 s is refused (never run late) and the
// phone takes it back at 60 s (remote/manual-print-view.js runCommand).
// Classic script: sets self.ShopperPackingView, draws its button into
// #packingHost (index.html, the Ship tab). Built with textContent only.
(function (root) {
  "use strict";
  const OFFLINE = "The laptop isn't connected - try again when it is.";
  let cur = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const mp = () => root.ShopperManualPrint || null;

  // name, payload -> the laptop's answer object; throws Error(plain words) when there is none.
  async function api(name, payload) {
    const M = mp();
    if (!M || typeof M.runCommand !== "function") throw new Error(OFFLINE);
    const out = await M.runCommand(name, payload || {});
    if (out.status === "done" && out.result && typeof out.result === "object") return out.result;
    if (out.status === "offline" || (out.status === "rejected" && /was not connected/.test(String(out.reason || "")))) throw new Error(OFFLINE);
    if (out.status === "not sent") throw new Error("That did not reach the laptop.");
    if (out.status === "timeout") throw new Error("The laptop did not answer in 3 minutes.");
    if (out.status === "rejected") throw new Error("The laptop refused it" + (out.reason ? " - " + out.reason : "") + ".");
    throw new Error(out.reason || "The laptop gave no answer.");
  }

  function close() {
    if (!cur) return;
    cur.overlay.remove();
    document.removeEventListener("keydown", cur.onKey);
    document.body.classList.remove("pk-open");
    cur = null;
  }

  function open() {
    if (cur) close();
    const P = root.ShopperPacking;
    if (!P || typeof P.mountPackingUi !== "function") return;
    const overlay = el("div", "pk-overlay");
    const sheet = el("div", "pk-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Packing data");
    const head = el("div", "pk-sheet-head");
    const x = el("button", "pk-sheet-x", "Close");
    x.type = "button";
    x.addEventListener("click", close);
    head.append(el("div", "pk-sheet-title", "Packing data"), x);
    const host = el("div", "pk-sheet-body");
    sheet.append(head, host);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    document.body.classList.add("pk-open");
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    cur = { overlay, onKey };
    P.mountPackingUi(host, { api, surface: "phone", canSeed: true });
  }

  function mount(host) {
    if (!host || host.__pk) return;
    host.__pk = true;
    const wrap = el("div", "pk-entry");
    const b = el("button", "rc-btn pk-entry-btn", "Packing data");
    b.type = "button";
    b.addEventListener("click", open);
    wrap.append(b, el("div", "pk-entry-note", "Size, weight and prep for the products in a shipment."));
    host.appendChild(wrap);
  }

  // B-1451: the phone menu's "Packing planner" button (#tabPacking, remote/index.html) opens the sheet straight away.
  function wireMenu() {
    const t = typeof document !== "undefined" && document.getElementById ? document.getElementById("tabPacking") : null;
    if (t && !t.__pk) { t.__pk = true; t.addEventListener("click", open); }
  }
  root.ShopperPackingView = Object.freeze({ open, close, mount, api, _current: () => cur });
  if (typeof document !== "undefined" && document.getElementById) { mount(document.getElementById("packingHost")); wireMenu(); }
})(typeof self !== "undefined" ? self : globalThis);
