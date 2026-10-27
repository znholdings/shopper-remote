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

  // The full-screen sheet (head + Close + Esc); returns the body to draw into.
  function openSheet(label) {
    if (cur) close();
    const overlay = el("div", "pk-overlay");
    const sheet = el("div", "pk-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", label);
    const head = el("div", "pk-sheet-head");
    const x = el("button", "pk-sheet-x", "Close");
    x.type = "button";
    x.addEventListener("click", close);
    // v2.0.113 (B-1553): the app menu stays reachable on every packing tab - this header never scrolls away; "Menu" closes the sheet and opens the sidebar.
    const menu = el("button", "pk-sheet-x pk-sheet-menu", "Menu");
    menu.type = "button";
    menu.setAttribute("aria-label", "Open the app menu");
    menu.addEventListener("click", () => {
      close();
      const burger = document.getElementById("navBtn");
      if (burger && typeof burger.click === "function") burger.click();
    });
    const btns = el("div", "pk-sheet-btns");
    btns.append(menu, x);
    head.append(el("div", "pk-sheet-title", label), btns);
    const host = el("div", "pk-sheet-body");
    sheet.append(head, host);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    document.body.classList.add("pk-open");
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    cur = { overlay, onKey };
    return host;
  }

  function open() {
    const P = root.ShopperPacking;
    if (!P || typeof P.mountPackingUi !== "function") return;
    const host = openSheet("Packing data");
    P.mountPackingUi(host, { api, surface: "phone", canSeed: true });
  }

  // B-1512 (v2.0.106): the Inventory row's "Packing" button - the one-product form (lib/packing-product-form.js) for that ASIN.
  // B-1515 (v2.0.107): p.onSaved() runs after a save closes the sheet (the Stock rows refresh their badges).
  // `apiFn` is injectable for a test; the default is the laptop command line above.
  function openProduct(p, apiFn) {
    const P = root.ShopperPacking;
    if (!P || typeof P.drawProductForm !== "function" || !p || !p.asin) return null;
    const call = apiFn || api;
    const sheet = openSheet("Packing data");
    const host = el("div", "pk-root pk-phone");
    sheet.appendChild(host);
    host.appendChild(el("div", "pk-note", "Asking the laptop..."));
    Promise.resolve().then(() => call("packingProduct", { asin: p.asin, msku: p.msku || "", title: p.title || "" })).then((r) => {
      if (!cur || !host.isConnected) return;
      host.textContent = "";
      if (!r || !r.ok || !r.row) { host.appendChild(el("div", "pk-msg pk-msg-bad", (r && r.error) || "Could not read this product's packing data.")); return; }
      P.drawProductForm(host, { api: call, surface: "phone", doc: document, row: r.row, onSaved: () => { close(); if (typeof p.onSaved === "function") { try { p.onSaved(); } catch (e) { /* the badge refresh must never break the sheet */ } } }, onCancel: close });
    }).catch((err) => {
      host.textContent = "";
      host.appendChild(el("div", "pk-msg pk-msg-bad", String((err && err.message) || err)));
    });
    return host;
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
  root.ShopperPackingView = Object.freeze({ open, openProduct, close, mount, api, _current: () => cur });
  if (typeof document !== "undefined" && document.getElementById) { mount(document.getElementById("packingHost")); wireMenu(); }
})(typeof self !== "undefined" ? self : globalThis);
