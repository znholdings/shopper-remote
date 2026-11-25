// remote/margin-view.js - B-2397 (v2.0.210): the phone's "Margin" view inside the Cash tab.
// The laptop works everything out (lib/margin-model.js) and words the compact block (lib/margin-view.js buildMarginRemote);
// this file only lays it out: the three answer cards, the 30-day path chart and the last six months of buy choices,
// plus a Recompute button (the "marginRecompute" phone command - the laptop runs the job). Charts are drawn with the
// laptop's chart code (cashflow-lib.js). Owns no numbers and no rules.
(function () {
  "use strict";
  const C = self.ShopperChart;
  const $ = (id) => document.getElementById(id);
  const VIEW_KEY = "shopperMarginPhoneView";
  const view = { mode: "cash" };
  try { Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY) || "{}")); } catch (e) { /* defaults */ }
  let block = null;
  let drawn = "";
  const TONE = { good: "ai-banner-info", bad: "ai-banner-warn", info: "" };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const visible = () => { const p = $("cashFlowPane"); return !!(p && !p.hidden); };

  function applyMode() {
    const pane = $("cashFlowPane");
    if (pane) pane.dataset.cfmMode = view.mode;
    for (const b of document.querySelectorAll("#cfmMode button")) b.setAttribute("aria-pressed", String(b.dataset.mode === view.mode));
  }

  function chartCard(title) {
    const c = el("section", "cfm-card");
    c.append(el("h3", "cfm-h", title));
    return c;
  }

  function draw(force) {
    const host = $("cfmMarginHost");
    if (!host) return;
    const key = JSON.stringify([block ? block.builtAt : 0, view.mode, visible()]);
    if (!force && key === drawn) return;
    drawn = key;
    applyMode();
    host.textContent = "";
    const rc = el("button", "primary-btn", "Recompute");
    rc.type = "button";
    rc.id = "mgmRecompute";
    rc.addEventListener("click", () => { rc.disabled = true; rc.textContent = "Asking..."; self.ShopperRemote.sendCommand("marginRecompute", {}); });
    const head = el("div", "mgm-head");
    head.append(rc);
    host.append(head);
    if (!block) { host.append(el("p", "muted small", "The laptop has not worked out the margin yet - it does every night, or tap Recompute.")); return; }
    host.append(el("p", "muted small", block.line || ""));
    for (const c of block.cards || []) {
      const d = el("section", "cfm-card mgm-answer");
      d.dataset.card = c.id;
      const h = el("div", "cfm-card-head");
      h.append(el("h3", "cfm-h", c.title), el("span", "ai-banner " + (TONE[c.tone] || ""), c.verdict));
      d.append(h);
      if (c.ready && c.key) d.append(el("div", "cfm-stat-value", c.key), el("div", "cfm-stat-sub", c.keyLabel));
      d.append(el("p", c.ready ? "cfm-note cfm-keep" : "cfm-note", c.sentence));
      if (c.sub) d.append(el("p", "cfm-note", c.sub));
      host.append(d);
    }
    const draws = [];
    const pc = chartCard("Next 30 days");
    if (block.path && C) {
      const box = el("div", "cfm-chart"); box.id = "mgmPath";
      pc.append(box);
      const lows = block.path.lo.filter((v) => v != null).concat(block.path.trailing.filter((v) => v != null));
      const yMin = lows.length ? Math.max(0, Math.floor(Math.min.apply(null, lows) - 1)) : 0;
      draws.push(() => C.drawChart(box, { days: block.path.days, band: { low: block.path.lo, high: block.path.hi }, lines: [{ values: block.path.trailing, cls: "s-mark-1", label: "last 30 days", dash: true }, { values: block.path.marginPct, cls: "s-mark-2", label: "expected" }], yMin, yFormat: (v) => v.toFixed(0) + "%", height: 200, title: "30-day margin path" }));
    } else pc.append(el("p", "cfm-note", block.pathNote || ""));
    host.append(pc);
    const kc = chartCard("Profit per $100 bought, last 6 months");
    if (block.picking && C) {
      const box = el("div", "cfm-chart"); box.id = "mgmPicking";
      kc.append(box);
      const p = block.picking;
      draws.push(() => C.drawChart(box, { days: p.days, lines: [{ values: p.earned30, cls: "s-mark-1", label: "30 days" }, { values: p.earned60, cls: "s-mark-2", label: "60 days" }, { values: p.earned90, cls: "s-mark-3", label: "90 days" }, { values: p.comparable30, cls: "s-mark-4", label: "30 days, same mix", dash: true }], yFormat: (v) => "$" + Math.round(v), height: 200, title: "earned per $100 by month" }));
    } else kc.append(el("p", "cfm-note", block.pickingNote || ""));
    host.append(kc);
    if (visible() && view.mode === "margin") for (const f of draws) { try { f(); } catch (e) { /* one chart never breaks the view */ } }
  }

  function render(cashFlow) {
    block = cashFlow && typeof cashFlow === "object" && cashFlow.margin && typeof cashFlow.margin === "object" ? cashFlow.margin : null;
    draw(false);
  }
  function shown() { draw(true); }
  function wire() {
    for (const b of document.querySelectorAll("#cfmMode button")) b.addEventListener("click", () => {
      view.mode = b.dataset.mode === "margin" ? "margin" : "cash";
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* fine */ }
      draw(true);
    });
    applyMode();
    let t = null;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (visible() && view.mode === "margin") draw(true); }, 150); });
  }
  self.ShopperMarginView = { render, shown, wire };
})();
