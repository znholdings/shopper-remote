// remote/margin-view.js - B-2397 (v2.0.210): the phone's "Margin" view inside the Cash tab.
// The laptop works everything out (lib/margin-model.js) and words the compact block (lib/margin-view.js buildMarginRemote);
// this file only lays it out: the three answer cards, the trend strip, the history + forecast chart and the buy-month bars,
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
  const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
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
      if (c.ready && c.key) d.append(el("div", "cfm-stat-value mgm-key", c.key), el("div", "cfm-stat-sub", c.keyLabel));
      d.append(el("p", c.ready ? "cfm-note cfm-keep mgm-sentence" : "cfm-note mgm-sentence", c.sentence));
      const extra = [];
      if (c.sentence && c.sentence.length > 130) extra.push(el("p", "cfm-note cfm-keep", c.sentence));
      for (const t of c.more || (c.sub ? [c.sub] : [])) extra.push(el("p", "cfm-note cfm-keep", t));
      if (extra.length) {
        const wrap = el("div", "mgm-why-body");
        wrap.append.apply(wrap, extra);
        d.append(wrap);
        if (self.ShopperWhy) self.ShopperWhy.wrap([wrap], { id: "mgm-why-" + c.id });
      }
      host.append(d);
    }
    if (block.trends && block.trends.length) {
      const tc = chartCard("Trends: last 30 days vs the 30 before");
      tc.id = "mgmTrends";
      const t = el("table", "mgm-trends");
      const hr = t.createTHead().insertRow();
      ["", "Last 30", "Change", "12 weeks"].forEach((x, i) => hr.append(el("th", i === 1 || i === 2 ? "num" : "", x)));
      const tb = t.createTBody();
      for (const r of block.trends) {
        const tr = tb.insertRow();
        tr.dataset.row = r.id;
        tr.insertCell().textContent = r.label;
        const v = (x) => (x == null ? "-" : r.unit === "$" ? "$" + Math.round(x) : Number(x).toFixed(1) + "%");
        const c1 = tr.insertCell(); c1.className = "num"; c1.textContent = v(r.last30);
        const c2 = tr.insertCell(); c2.className = "num " + (r.change > 0 ? "mgm-up" : r.change < 0 ? "mgm-down" : ""); c2.textContent = r.change == null ? "-" : (r.change > 0 ? "+" : r.change < 0 ? "-" : "") + (r.unit === "$" ? "$" + Math.abs(Math.round(r.change)) : Math.abs(r.change).toFixed(1) + " pts");
        const c3 = tr.insertCell(); c3.className = r.trend === "rising" ? "mgm-up" : r.trend === "falling" ? "mgm-down" : ""; c3.textContent = r.word || "";
      }
      tc.append(t);
      host.append(tc);
    }
    const draws = [];
    const pc = chartCard("Last 90 days and the next 30");
    if (block.chart && C && C.drawTrendChart) {
      const ch = block.chart;
      const box = el("div", "cfm-chart"); box.id = "mgmPath";
      const nH = ch.hist.length, nF = ch.f.length;
      const days = [];
      for (let i = 0; i < nH; i++) days.push(addDays(ch.start, i));
      for (let i = 0; i < nF; i++) days.push(addDays(ch.fStart, i));
      const pad = (a) => new Array(nH).fill(null).concat(a);
      const lines = [];
      if (ch.committed) lines.push({ values: pad(ch.committed), cls: "s-mark-3", label: "committed buys only", thin: true });
      lines.push({ values: ch.hist.concat(new Array(nF).fill(null)), cls: "s-mark-2", label: "7-day realized" }, { values: pad(ch.f), cls: "s-mark-1", label: "expected" });
      const ax = ch.axis || { min: 0, max: 25, ticks: [0, 5, 10, 15, 20, 25] };
      pc.append(box);
      const lg = el("div", "s-legend");
      [["k2", "7-day realized"], ["k1", "expected"], ["kband", "80% range"]].forEach((k) => { const sp = el("span"); sp.append(el("i", k[0]), document.createTextNode(k[1])); lg.append(sp); });
      pc.append(lg);
      if (ch.caption) pc.append(el("p", "cfm-note cfm-keep", ch.caption));
      draws.push(() => C.drawTrendChart(box, { days, split: nH, band: { low: pad(ch.lo), high: pad(ch.hi) }, lines, ref: ch.ref != null ? { value: ch.ref } : null, yMin: ax.min, yMax: ax.max, ticks: ax.ticks, yFormat: (v) => v + "%", height: 210, title: "margin, last 90 days and next 30" }));
    } else pc.append(el("p", "cfm-note", block.pathNote || ""));
    host.append(pc);
    const kc = chartCard("Profit per $100 bought, by buy month");
    if (block.picking && block.picking.groups && C && C.drawGroupedBars) {
      const box = el("div", "cfm-chart"); box.id = "mgmPicking";
      kc.append(box);
      const lg = el("div", "s-legend");
      [["k1", "30 days"], ["k2", "60 days"], ["k3", "90 days"], ["kdot", "same mix"]].forEach((k) => { const sp = el("span"); sp.append(el("i", k[0]), document.createTextNode(k[1])); lg.append(sp); });
      kc.append(lg);
      const groups = block.picking.groups;
      draws.push(() => C.drawGroupedBars(box, { groups, yFormat: (v) => "$" + Math.round(v), height: 210, title: "earned per $100 by buy month" }));
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
