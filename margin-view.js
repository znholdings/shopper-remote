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

  function chartCard(title, takeaway) {
    const c = el("section", "cfm-card");
    c.append(el("h3", "cfm-h", title));
    if (takeaway) c.append(el("p", "mgm-takeaway cfm-keep", takeaway));
    return c;
  }
  // B-2402 / B-2404 / B-2405 (v2.0.212): a small plain table (head + rows of strings), first column left, the rest right-aligned.
  function miniTable(head, rows, cls) {
    const t = el("table", "mgm-mini " + (cls || ""));
    const hr = t.createTHead().insertRow();
    head.forEach((h, i) => hr.append(el("th", i ? "num" : "", h)));
    const tb = t.createTBody();
    rows.forEach((r) => { const tr = tb.insertRow(); r.forEach((v, i) => { const td = tr.insertCell(); if (i) td.className = "num"; td.textContent = v; }); });
    return t;
  }
  const fp = (v) => (v == null ? "-" : Number(v).toFixed(1) + "%");
  const fmoney = (v) => (v == null ? "-" : (v < 0 ? "-" : "") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US"));
  function legendOf(items) {
    const lg = el("div", "s-legend");
    items.forEach((k) => { const sp = el("span"); sp.append(el("i", k[0]), document.createTextNode(k[1])); lg.append(sp); });
    return lg;
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
      if (c.table) { const tw = el("div", "mgm-table-wrap cfm-keep"); tw.append(miniTable(c.table.head, c.table.rows, "mgm-needed-table")); extra.push(tw); }
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
    const tk = block.takeaways || {};
    // 1. Margin by when it sells (B-2404) + the vintage table
    if (block.lift !== undefined) {
      const lc = chartCard("Margin by when it sells", tk.lift);
      lc.id = "mgmLiftCard";
      if (block.lift && C && C.drawPipelineBars) {
        const box = el("div", "cfm-chart"); box.id = "mgmLift";
        lc.append(box, legendOf([...(block.lift.vintages || []).map((v) => ["k-v" + v.k + " bar", v.label]), ["k2", "actual margin"], ["k1 dash", "expected margin"]]));
        const L = block.lift;
        draws.push(() => C.drawPipelineBars(box, { actual: L.actual, weeks: L.weeks, moneyAxis: L.moneyAxis, pctAxis: L.pctAxis, height: 230, title: "expected sales by week and buy vintage, with margin" }));
        if (block.vintages && block.vintages.length) {
          const tw = el("div", "mgm-table-wrap cfm-keep");
          const t = miniTable(["Bought", "Cost", "Sold", "After shortfall", "Selling"], block.vintages.map((v) => [v.label, fmoney(v.cost), v.soldPct == null ? "-" : Math.round(v.soldPct) + "%", fp(v.expAfterPct), v.selling || "-"]), "mgm-vintages");
          t.id = "mgmVintages";
          tw.append(t);
          lc.append(tw);
        }
      } else lc.append(el("p", "cfm-note", block.liftNote || ""));
      host.append(lc);
    }
    // 2. Margin trend (28-day, expected after the usual shortfall, needed for everything) + the reconcile lines
    if (block.trend && C && C.drawTrendChart) {
      const T = block.trend;
      const tc = chartCard("Margin trend, last 90 days", tk.trend);
      tc.id = "mgmTrendCard";
      const box = el("div", "cfm-chart"); box.id = "mgmTrend";
      const days = []; for (let i = 0; i < T.days; i++) days.push(addDays(T.start, i));
      const lines = [];
      if (T.needed != null) lines.push({ values: days.map(() => T.needed), cls: "s-mark-5", label: "needed for everything", dash: true });
      lines.push({ values: T.exp, cls: "s-mark-4", label: T.adjusted ? "expected (after shortfall)" : "expected", dash: true }, { values: T.r28, cls: "s-mark-1", label: "28-day" });
      tc.append(box, legendOf([["k1", "28-day"], ["k4 dash", T.adjusted ? "expected, after shortfall" : "expected at buy"], ...(T.needed != null ? [["k5 dash", "needed for everything"]] : [])]));
      if (T.caption) tc.append(el("p", "cfm-note cfm-keep mgm-haircut", T.caption));
      if (block.reconcile && block.reconcile.length) { const tw = el("div", "mgm-table-wrap cfm-keep"); tw.id = "mgmReconcile"; tw.append(miniTable(["Contribution to Sellerboard net profit", "Amount"], block.reconcile.map((r) => [r.label, fmoney(r.amount)]), "mgm-reconcile")); tc.append(tw); }
      draws.push(() => C.drawTrendChart(box, { days, lines, yMin: T.axis.min, yMax: T.axis.max, ticks: T.axis.ticks, yFormat: (v) => v + "%", height: 210, title: "margin, 28-day, last 90 days" }));
      host.append(tc);
    }
    // 3. History + forecast (demoted)
    const pc = chartCard("Last 90 days and the next 30", tk.history);
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
      pc.append(box, legendOf([["k2", "7-day realized"], ["k1", "expected"], ["kband", "80% range"]]));
      if (ch.caption) pc.append(el("p", "cfm-note cfm-keep", ch.caption));
      draws.push(() => C.drawTrendChart(box, { days, split: nH, band: { low: pad(ch.lo), high: pad(ch.hi) }, lines, ref: ch.ref != null ? { value: ch.ref } : null, yMin: ax.min, yMax: ax.max, ticks: ax.ticks, yFormat: (v) => v + "%", height: 210, title: "margin, last 90 days and next 30" }));
    } else pc.append(el("p", "cfm-note", block.pathNote || ""));
    host.append(pc);
    // 4. Picking bars (every month >= 50% scored; the sellable-age bar when the model has it)
    const kc = chartCard("Profit per $100 bought, by buy month", tk.picking);
    if (block.picking && block.picking.groups && C && C.drawGroupedBars) {
      const box = el("div", "cfm-chart"); box.id = "mgmPicking";
      const groups = block.picking.groups;
      const sell = groups.some((g) => g.bars.some((b) => b.kind === "sellable"));
      kc.append(box, legendOf([...(sell ? [["k4 bar", "30 days after sellable"]] : []), ["k1", sell ? "30 days after the buy" : "30 days"], ["k2", "60 days"], ["k3", "90 days"], ["kdot", "same mix"]]));
      draws.push(() => C.drawGroupedBars(box, { groups, yFormat: (v) => "$" + Math.round(v), height: 210, title: "earned per $100 by buy month" }));
    } else kc.append(el("p", "cfm-note", block.pickingNote || ""));
    host.append(kc);
    // 5. Share of spend
    if (block.share && C && C.drawStackedBars) {
      const sc = chartCard("What we are buying: new vs returning", tk.share);
      sc.id = "mgmShareCard";
      const box = el("div", "cfm-chart"); box.id = "mgmShare";
      const S = block.share;
      sc.append(box, legendOf([["k4 bar", "first-ever"], ["k3 bar", "back after 90+ days"], ["k1 bar", "restocks"]]));
      draws.push(() => C.drawStackedBars(box, { labels: S.labels, series: [{ values: S.first, label: "first-ever buys" }, { values: S.reactivated, label: "back after 90+ days" }, { values: S.restock, label: "restocks" }], height: 190, title: "share of spend by month" }));
      host.append(sc);
    }
    // 6. How the model is learning
    if (block.learning && block.learning.length) {
      const d = el("details", "cfm-card mgm-fold"); d.id = "mgmLearning";
      d.append(el("summary", "cfm-h", "How the model is learning"));
      const ul = el("ul", "cfm-note cfm-keep mgm-list");
      block.learning.forEach((t) => ul.append(el("li", null, t)));
      d.append(ul);
      host.append(d);
    }
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
