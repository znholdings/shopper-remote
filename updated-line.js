// remote/updated-line.js - B-1088 (v2.0.55): one "Updated N min ago" line per tab.
//
// Zach: the Stock / FBA / Home tabs opened with two or three timestamp and
// explainer lines each. Now each tab says one thing - "Updated 25 min ago" -
// with an ⓘ that opens the old wording (the full time, where the figures come
// from). The ⓘ opens every `.upd-more` line in that tab (the refresh bar's
// "Full refresh finished ..." line too - remote/parity.js), and is remembered
// per tab on this phone. A running refresh and any problem stay in sight.
// textContent only. The "N min ago" ticks over once a minute.
(function () {
  "use strict";
  const KEY = "shopperUpdInfoOpen";
  let open = {};
  try { open = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { open = {}; }

  function ago(ms) {
    if (!ms) return "never";
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    return h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
  }
  const toMs = (v) => (typeof v === "number" ? v : Date.parse(v || "")) || 0;
  const paneOf = (host) => (host && host.closest ? host.closest('[id$="Pane"]') : null);
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function applyPane(pane) {
    if (!pane) return;
    const on = !!open[pane.id];
    pane.classList.toggle("upd-open", on);
    for (const b of pane.querySelectorAll(".upd-info")) b.setAttribute("aria-expanded", on ? "true" : "false");
  }
  function toggle(pane) {
    if (!pane) return;
    open[pane.id] = !open[pane.id];
    try { localStorage.setItem(KEY, JSON.stringify(open)); } catch (e) { /* this phone only */ }
    applyPane(pane);
  }

  // host: the tab's as-of <p>. at: ms or ISO. detail: the old wording (behind ⓘ).
  // warn: a short visible warning after the time (e.g. stale figures).
  function set(host, { at, detail, warn } = {}) {
    if (!host) return;
    host.textContent = "";
    host.classList.add("upd-line");
    const ms = toMs(at);
    const main = el("span", "upd-main", ms ? "Updated " + ago(ms) : "Not updated yet");
    if (ms) main.dataset.at = String(ms);
    host.append(main);
    if (warn) host.append(el("span", "upd-warn warn-text", " · " + warn));
    if (detail) {
      const b = el("button", "upd-info c55-info", "ⓘ");
      b.type = "button";
      b.title = "Details";
      b.setAttribute("aria-label", "Details");
      b.addEventListener("click", () => toggle(paneOf(host)));
      host.append(b, el("span", "upd-more upd-detail", detail));
    }
    applyPane(paneOf(host));
  }
  // The refresh bar (parity.js) re-applies the tab's open state after it redraws.
  function sync(host) { applyPane(paneOf(host)); }

  setInterval(() => {
    for (const s of document.querySelectorAll(".upd-main[data-at]")) s.textContent = "Updated " + ago(Number(s.dataset.at));
  }, 60000);

  self.ShopperUpdated = Object.freeze({ set, sync, ago });
})();
