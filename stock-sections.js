// remote/stock-sections.js - v2.0.55 builder A. The phone's Stock tab, tidied.
//
// B-1073: every Stock section (Box contents, Needs you, Latest arrivals,
//   Arrivals, Products) folds under its own heading - the heading row keeps
//   the title and the count, a tap opens / closes it, and which ones are open
//   is remembered on this phone (localStorage, try/catch: storage off = the
//   defaults). Defaults: Needs you + Arrivals open, the rest closed. A small
//   sticky jump row (chips with the counts) goes to a section and opens it.
//   The Ship tab's wizard screen folds the same way (remembered, default open).
//   Box contents keeps its own renderer (remote/boxes.js, Builder D): only its
//   container folds - closing hides, never clears, and the heading carries
//   #boxesHeaderBadge's "Unsent on this phone: N".
// B-1076: the Products list is one line per product (title · House / Prep /
//   In transit). A tap opens that product's controls inline - ✎ Count and the
//   expiry date (remote/parity.js decorateProduct, unchanged), Receive and
//   Manual Print (app.js / manual-print-view.js, the same buttons the House
//   list has). Built only when opened; which products are open survives the
//   3-second redraw.
//
// Owns no rules and sends nothing itself - every control it shows is the
// existing one, sending the existing command. The sections' own renderers
// (parity.js, boxes.js, app.js) are untouched: the fold works on the host
// element (a class) and the heading the renderer draws, re-applied whenever a
// renderer redraws (MutationObserver). Built with textContent only.
(function (root) {
  "use strict";

  const KEY = "shopperStockSections";
  // Page order (index.html). open = the default before Zach picks.
  const SECTIONS = [
    { key: "boxes", id: "boxesSection", chip: "Boxes", open: false },
    { key: "needs", id: "needsSection", chip: "Needs", open: true },
    { key: "latest", id: "latestSection", chip: "Latest", open: false },
    { key: "arrivals", id: "invArrivalsSection", chip: "Arrivals", open: true },
    { key: "products", id: "invProductsSection", chip: "Products", open: false },
    // The Ship tab: the wizard's screen folds under "Ship to Amazon · Step N of M"
    // (no jump row - Process returns above it is already one line). The wrapper
    // is built here around #wizardHost; wizard-view.js still draws into #wizardHost.
    { key: "ship", id: "shipWizardSection", chip: "Ship", open: true, tab: "ship" },
  ];
  const STOCK = SECTIONS.filter((s) => s.tab !== "ship");

  const $ = (id) => document.getElementById(id);
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  function isOpen(s) { return Object.prototype.hasOwnProperty.call(saved, s.key) ? !!saved[s.key] : s.open; }
  function remember(s, open) {
    saved[s.key] = !!open;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* per-phone nicety */ }
  }

  let boxesInfo = "";
  let shipInfo = "";
  let shipTitle = "";

  // Box contents' own "Unsent on this phone: N" (remote/boxes.js, B-1089) - whatever
  // text it puts in #boxesHeaderBadge (or its data-badge) shows in the folded
  // heading, so a closed section never hides words still waiting on this phone.
  // Read only; without the badge element, typed words in the box say so instead.
  function ownBadge() {
    const b = $("boxesHeaderBadge");
    return b ? String((b.dataset && b.dataset.badge) || b.textContent || "").trim() : "";
  }
  function typedBadge() {
    const ta = $("boxesText");
    return ta && String(ta.value || "").trim() ? "Typed, not read yet" : "";
  }
  // Merge fix (v2.0.55): boxes.js always has a badge; when it is empty, words typed
  // but not read yet still show, so a folded section never hides them.
  function boxesBadge() { return ownBadge() || typedBadge(); }
  // v2.0.55 review (B-1089): the Ship tab's box words the same way - its words
  // still on this phone (remote/box-outbox.js, read only) or typed in its text
  // box and not read yet - so folding "Ship to Amazon" never hides them.
  function shipBadge() {
    const ob = root.ShopperBoxOutbox;
    const n = ob && typeof ob.unsent === "function" ? ob.unsent("phone-ship").length : 0;
    if (n) return n + " unsent";
    const host = $("wizardHost");
    const ta = host && host.querySelector(".wz-textarea");
    return ta && String(ta.value || "").trim() ? "Typed, not read yet" : "";
  }

  // The heading a section's renderer draws (its first h3), or null before it drew one.
  function headOf(host) {
    for (const c of host.children) if (c.tagName === "H3") return c;
    return null;
  }

  // The count shown in the heading and on the chip.
  function countOf(s, host, head) {
    if (s.key === "latest") return String(host.querySelectorAll(".inv-arrival").length);
    if (s.key === "boxes") return boxesInfo;
    // Open, the wizard shows its own "Step N of M"; folded, the heading names the step and its title.
    if (s.key === "ship") return isOpen(s) ? "" : shipInfo + (shipTitle ? (shipInfo ? " · " : "") + shipTitle : "");
    const c = head && head.querySelector(".count:not(.s55-count)");
    return c ? c.textContent.replace(/[()]/g, "").trim() : "";
  }

  function decorate(s) {
    const host = $(s.id);
    if (!host) return;
    const open = isOpen(s);
    host.classList.add("s55-sec");
    host.dataset.s55 = s.key;
    host.classList.toggle("s55-closed", !open);
    const head = headOf(host);
    if (!head) return;
    head.classList.add("s55-head");
    // Latest arrivals, Box contents and Ship have no count of their own in the heading.
    if (s.key === "latest" || s.key === "boxes" || s.key === "ship") {
      let c = head.querySelector(".s55-count");
      if (!c) { c = node("span", "count s55-count"); head.insertBefore(c, head.querySelector("select")); }
      const t = countOf(s, host, head);
      if (c.textContent !== t) c.textContent = t;
    }
    if (s.key === "boxes") {
      const own = $("boxesHeaderBadge");
      const t = own && head.contains(own) && ownBadge() ? "" : boxesBadge();
      let m = head.querySelector(".s55-badge");
      if (!m) { m = node("span", "s55-badge"); m.setAttribute("role", "status"); head.insertBefore(m, head.querySelector(".s55-toggle")); }
      if (m.textContent !== t) m.textContent = t;
      host.classList.toggle("s55-unsent", !!t);
    }
    if (s.key === "ship") {
      const t = shipBadge();
      let m = head.querySelector(".s55-badge");
      if (!m) { m = node("span", "s55-badge"); m.setAttribute("role", "status"); head.insertBefore(m, head.querySelector(".s55-toggle")); }
      if (m.textContent !== t) m.textContent = t;
      host.classList.toggle("s55-unsent", !!t);
    }
    let tog = head.querySelector(".s55-toggle");
    if (!tog) {
      tog = node("button", "s55-toggle");
      tog.type = "button";
      tog.dataset.s55 = s.key;
      tog.append(node("span", "s55-chev", "▾"));
      head.append(tog);
    }
    const label = (open ? "Close " : "Open ") + s.chip;
    if (tog.getAttribute("aria-expanded") !== String(open)) tog.setAttribute("aria-expanded", String(open));
    if (tog.getAttribute("aria-label") !== label) tog.setAttribute("aria-label", label);
  }

  // ---- the jump row ------------------------------------------------------------
  let jump = null;
  function buildJump(pane) {
    jump = node("nav", "s55-jump");
    jump.setAttribute("aria-label", "Go to a Stock section");
    const top = node("button", "s55-chip", "Top");
    top.type = "button";
    top.dataset.s55 = "top";
    top.setAttribute("aria-label", "Go to the House / Prep / In transit totals");
    jump.append(top);
    for (const s of STOCK) {
      const b = node("button", "s55-chip");
      b.type = "button";
      b.dataset.s55 = s.key;
      b.append(node("span", "s55-chip-t", s.chip), node("span", "s55-chip-n", ""));
      jump.append(b);
    }
    pane.insertBefore(jump, pane.firstChild);
  }
  function paintJump() {
    if (!jump) return;
    for (const s of STOCK) {
      const b = jump.querySelector('[data-s55="' + s.key + '"]');
      const host = $(s.id);
      if (!b || !host) continue;
      const n = countOf(s, host, headOf(host));
      const el = b.querySelector(".s55-chip-n");
      if (el.textContent !== n) el.textContent = n;
      b.classList.toggle("s55-chip-closed", !isOpen(s));
      if (s.key === "boxes") b.classList.toggle("s55-chip-warn", !!boxesBadge());
    }
  }

  function setOpen(s, open) {
    remember(s, open);
    decorate(s);
    paintJump();
  }

  function go(key) {
    // Top = the top of the tab (refresh, the House / Prep / In transit tiles).
    if (key === "top") { if (root.scrollTo) root.scrollTo(0, 0); return; }
    const s = SECTIONS.find((x) => x.key === key);
    const host = s && $(s.id);
    if (!host) return;
    if (!isOpen(s)) setOpen(s, true);
    if (host.scrollIntoView) host.scrollIntoView({ block: "start" });
  }

  // ---- Products: one line each (B-1076) ------------------------------------------
  const openProducts = new Set();
  // app.js renderInventory calls this per product. h = { units, receiveButton }.
  function productRow(r, h) {
    const units = (h && h.units) || ((v) => String(v));
    const row = node("div", "line inv-product s55-prod");
    row.dataset.asin = r.asin;
    const top = node("div", "inv-row-top s55-prod-top");
    top.setAttribute("role", "button");
    top.tabIndex = 0;
    top.append(node("span", "inv-title", r.title || r.asin));
    const nums = node("span", "s55-nums");
    nums.append(
      node("span", "inv-n inv-house" + (r.house < 0 ? " inv-neg" : ""), "H " + units(r.house)),
      node("span", "inv-n inv-prep" + (r.prep < 0 ? " inv-neg" : ""), "P " + units(r.prep)),
      node("span", "inv-n inv-transit", "T " + units(r.inTransit))
    );
    top.append(nums, node("span", "s55-chev", "▾"));
    row.append(top);
    const body = node("div", "s55-prod-body");
    row.append(body);
    function paint(open) {
      row.classList.toggle("s55-open", open);
      top.setAttribute("aria-expanded", String(open));
      top.setAttribute("aria-label", (open ? "Close " : "Open ") + (r.title || r.asin) + " - count, receive, expiry, print");
      body.hidden = !open;
      if (open && !body.firstChild) fill(body, r, h, units);
    }
    function toggle() {
      const open = !openProducts.has(r.asin);
      if (open) openProducts.add(r.asin); else openProducts.delete(r.asin);
      paint(open);
    }
    top.addEventListener("click", toggle);
    top.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    paint(openProducts.has(r.asin));
    return row;
  }

  // The controls the old two-to-four-line row always showed, plus the House
  // list's Receive and Manual Print - the same buttons, built the same way.
  function fill(body, r, h, units) {
    body.append(node("div", "l-meta", [r.asin, "House " + units(r.house), "Prep " + units(r.prep), "Transit " + units(r.inTransit)].join(" · ")));
    const tools = node("div", "controls need-actions s55-prod-tools");
    if (h && typeof h.receiveButton === "function" && root.ShopperReceive) tools.append(h.receiveButton(r));
    if (root.ShopperManualPrint) {
      const mp = root.ShopperManualPrint.button(r);
      mp.append(node("span", "s55-mp-t", "Print"));
      tools.append(mp);
    }
    if (tools.firstChild) body.append(tools);
    // v4.74 (B-570/B-571): ✎ Count + the house expiry date (parity.js, unchanged).
    if (root.ShopperParity) root.ShopperParity.decorateProduct(body, r);
  }

  // ---- wiring ---------------------------------------------------------------------
  // The Ship tab's fold: a wrapper + heading around #wizardHost (moved, never redrawn here).
  function buildShip() {
    const host = $("wizardHost");
    if (!host || $("shipWizardSection")) return;
    const sec = node("div", "s55-ship");
    sec.id = "shipWizardSection";
    sec.append(node("h3", null, "Ship to Amazon "));
    host.parentNode.insertBefore(sec, host);
    sec.append(host);
  }

  let started = false;
  function start() {
    if (started) return;
    const pane = $("inventoryPane");
    if (!pane) return;
    started = true;
    buildJump(pane);
    buildShip();
    const ship = $("wizardPane");
    if (ship) ship.addEventListener("click", onHeadTap);
    pane.addEventListener("click", (e) => {
      const chip = e.target.closest && e.target.closest(".s55-chip");
      if (chip && jump && jump.contains(chip)) { go(chip.dataset.s55); return; }
      onHeadTap(e);
    });
    let queued = false;
    const again = () => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; refresh(); });
    };
    if (typeof MutationObserver === "function") {
      for (const s of SECTIONS) {
        const host = $(s.id);
        if (host) new MutationObserver(again).observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-badge"] });
      }
    }
    // Typed-but-unread words (shown whenever boxes.js's own badge is empty).
    document.addEventListener("input", (e) => { if (e.target && (e.target.id === "boxesText" || (e.target.classList && e.target.classList.contains("wz-textarea")))) again(); });
    refresh();
  }
  // A tap on a section heading (not on its own controls) opens / closes it.
  function onHeadTap(e) {
    const head = e.target.closest && e.target.closest(".s55-head");
    if (!head) return;
    // The heading's own controls (Latest arrivals' hours) keep their tap.
    if (e.target.closest("select, input, textarea, a") || (e.target.closest("button") && !e.target.closest(".s55-toggle"))) return;
    const host = head.parentElement;
    const s = host && SECTIONS.find((x) => x.key === host.dataset.s55);
    if (s) setOpen(s, !isOpen(s));
  }
  function refresh() {
    for (const s of SECTIONS) decorate(s);
    paintJump();
  }

  // app.js renderPayload calls this after the Stock renderers.
  function render(p) {
    start();
    const b = p && p.boxes;
    const d = b && b.draft;
    boxesInfo = b && b.phase && b.phase !== "idle" ? String(b.phase) : d && d.boxes && d.boxes.length ? d.boxes.length + " box" + (d.boxes.length === 1 ? "" : "es") : "";
    const sc = p && p.wizard && p.wizard.screen;
    shipInfo = sc && sc.n ? "Step " + sc.n + (sc.of ? " of " + sc.of : "") : "";
    shipTitle = sc && sc.title ? String(sc.title) : "";
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // open(key): open a section without scrolling (app.js openInventoryView - Home's Products tile).
  function open(key) { const s = SECTIONS.find((x) => x.key === key); if (s && !isOpen(s)) setOpen(s, true); }

  root.ShopperStockSections = Object.freeze({ render, productRow, go, open, isOpen: (key) => { const s = SECTIONS.find((x) => x.key === key); return !!s && isOpen(s); }, SECTIONS, KEY });
})(typeof self !== "undefined" ? self : globalThis);
