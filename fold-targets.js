// remote/fold-targets.js - B-2057 / B-2070 (v2.0.158): the registry of the phone's folds. Each target finds a section / block a view draws and hands
// it to ShopperFold (remote/fold-shared.js). One MutationObserver on <body>, coalesced to one microtask, re-runs every target (each is idempotent), so a
// view's redraw is folded again before the next paint. Everything starts CLOSED. The views themselves are not edited.
(function (root) {
  "use strict";

  const F = root.ShopperFold;
  if (!F) return;

  const $ = (sel, from) => (from || document).querySelector(sel);
  const $$ = (sel, from) => Array.prototype.slice.call((from || document).querySelectorAll(sel));
  const count = (host, sel) => { const n = host ? host.querySelectorAll(sel).length : 0; return n ? n : null; };
  // the child of hostSel matching childSel whose first heading's text matches re
  function byHead(hostSel, childSel, re) {
    const host = $(hostSel);
    if (!host) return null;
    return $$(childSel, host).find((c) => {
      if (c.parentNode !== host) return false;
      const h = Array.prototype.find.call(c.children, (x) => x.tagName === "H3");
      return !!h && re.test(String(h.textContent || "").trim());
    }) || null;
  }
  const sec = (el, key, cnt) => { if (el) F.section(el, { key, count: cnt == null ? null : cnt }); };

  // Every key a fold uses on the phone (the tests read this list).
  const SECTION_KEYS = ["arrivals:shipments", "arrivals:unmatched", "arrivals:edits", "arrivals:removals", "buylist:carryover", "run:clientNotes", "run:waiting", "blacklist:add", "books:forClaude"];
  const GROUP_KEYS = ["run:reportDetail", "dashboard:checks", "dashboard:sustainWhy", "cash:claudeMore", "fba:claudeMore", "cash:claudeAnswers", "fba:claudeAnswers"];

  function decorateAll() {
    let el;
    el = $("#shipmentsHost > section.ops-card"); sec(el, "arrivals:shipments", count(el, ".ops-ship-row"));
    sec($("#unmatchedHost > section.ops-card"), "arrivals:unmatched", null);
    el = $("#editsHost > section.ops-card"); sec(el, "arrivals:edits", count(el, ".ops-edit-row"));
    el = $("#fbaStockHost > section.fs-card"); sec(el, "arrivals:removals", count(el, ".fs-line"));
    sec($("#carryOverHost > section.co-card"), "buylist:carryover", null);
    sec(byHead("#waitingHost", ".wax-box", /^Client notes/), "run:clientNotes", null);
    sec(byHead("#waitingHost", ".wax-box", /^Waiting on RP/), "run:waiting", null);
    sec(byHead("#blacklistPane", ".pg-sec", /Add to the Blacklist/), "blacklist:add", null);
    sec($("#bkmForClaudeCard"), "books:forClaude", null);

    // Groups: a button + the elements hidden while closed (urgent + summary of the report stay visible).
    el = $("#reportBuckets");
    if (el && el.children.length) F.group("run:reportDetail", "Details", [el]);
    el = $("#dashChecks");
    if (el && el.children.length) {
      const warn = $$(".warn-text", el).length;
      F.group("dashboard:checks", "Checks" + (warn ? " · " + warn + " need a look" : ""), [el]);
    }
    const why = $$('[data-tile="sustain"] .gl-line2');
    if (why.length) F.group("dashboard:sustainWhy", "Why", why);
    [["cash", "#cfmClaude"], ["fba", "#fbaClaude"]].forEach((p) => {
      const more = $(p[1] + " .csx-bullets");
      if (more) F.group(p[0] + ":claudeMore", "Read more", [more]);
      const ans = $(p[1] + " .csx-answers");
      if (ans && ans.children.length) F.group(p[0] + ":claudeAnswers", "Last answer", [ans]);
    });
  }

  let queued = false;
  function again() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; try { decorateAll(); } catch (e) { /* a view that is not there yet */ } });
  }
  function start() {
    if (typeof MutationObserver === "function" && document.body) new MutationObserver(again).observe(document.body, { childList: true, subtree: true });
    decorateAll();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  root.ShopperFoldTargets = Object.freeze({ SECTION_KEYS, GROUP_KEYS, decorateAll });
})(typeof self !== "undefined" ? self : globalThis);
