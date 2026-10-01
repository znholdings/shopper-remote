// remote/cashflow-view.js - B-765 (v2.0.8): the phone's "Cash" tab.
//
// The laptop's Cash Flow page on the phone: the four 30-day tiles, day by
// day, the projection, stock at Amazon, payouts 7/14/30, buying vs payouts
// and the 13-week trends. Owns no rules: the laptop works everything out
// with the page's own analysis (lib/cash-flow-remote.js) after each
// Sellerboard read, and the charts are drawn by the laptop's chart code
// (cashflow-lib.js = lib/s-chart.js, wrapped unchanged). This file only
// slices to the range picked and lays it out. "Read Sellerboard now" and
// "Reload" are commands the laptop runs.
(function () {
  "use strict";
  const C = self.ShopperChart;
  const $ = (id) => document.getElementById(id);
  const VIEW_KEY = "shopperCashFlowPhoneView";
  const view = { days: 90, series: "sales", proj: "sales" };
  try { Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY) || "{}")); } catch (e) { /* defaults */ }
  let data = null; // { model, pull }
  let drawnKey = "";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function ago(ms) {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* fine */ } }
  const tail = (a) => (Array.isArray(a) ? a.slice(-view.days) : []);
  const visible = () => { const p = $("cashFlowPane"); return !!(p && !p.hidden); };

  function tabs(id, items, current, onPick) {
    const box = el("div", "cfm-tabs");
    box.id = id;
    box.setAttribute("role", "group");
    for (const [value, label] of items) {
      const b = el("button", "cfm-tab", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(String(value) === String(current)));
      b.addEventListener("click", () => onPick(value));
      box.append(b);
    }
    return box;
  }
  function legend(items) {
    const box = el("div", "s-legend");
    for (const [k, text] of items) {
      const s = el("span");
      s.append(el("i", k), document.createTextNode(text));
      box.append(s);
    }
    return box;
  }
  function card(title, head) {
    const c = el("section", "cfm-card");
    const h = el("div", "cfm-card-head");
    h.append(el("h3", "cfm-h", title));
    if (head) h.append(head);
    c.append(h);
    return c;
  }
  function chartBox(id) {
    const d = el("div", "cfm-chart");
    d.id = id;
    return d;
  }
  function empty(text) { return el("div", "cfm-empty", text); }

  function renderStatus(m, pull) {
    const bits = [];
    if (m && m.hasSb) bits.push(`Sellerboard days ${m.start} to ${m.end}`);
    bits.push(`read ${ago(m && m.sbReadAt)}`);
    if (m && m.spendAt) bits.push(`All Orders spend read ${ago(m.spendAt)}`);
    if (pull && pull.running) bits.push(`reading now: ${pull.step || "..."}`);
    if (m && m.builtAt) bits.push(`worked out ${ago(m.builtAt)}`);
    $("cfmStatus").textContent = bits.join(" · ");
    const problems = [...((m && m.problems) || [])];
    if (!m) problems.unshift("The laptop has not worked out the cash flow for the phone yet - it does after its next Sellerboard read (every 6 hours), or tap Reload.");
    if (pull && pull.ok === false && pull.error) problems.push(`Last Sellerboard read failed: ${pull.error}`);
    const b = $("cfmBanner");
    b.hidden = !problems.length;
    b.textContent = problems.join(" ");
    b.className = "ai-banner " + (pull && pull.ok === false ? "ai-banner-warn" : "ai-banner-info");
    const btn = $("cfmPull");
    btn.disabled = !!(pull && pull.running);
    btn.textContent = pull && pull.running ? "Reading Sellerboard..." : "Read Sellerboard now";
  }

  function tilesEl(m) {
    const box = el("div", "cfm-tiles");
    for (const t of m.tiles || []) {
      const d = el("div", "cfm-stat");
      d.append(el("div", "cfm-stat-label", t.label), el("div", "cfm-stat-value", t.value));
      const sub = el("div", "cfm-stat-sub");
      if (t.change) {
        sub.append(el("b", t.change.cls, t.change.pct), document.createTextNode(t.change.rest));
      } else sub.textContent = t.empty || "";
      d.append(sub);
      if (t.verdict) d.append(el("div", "cfm-stat-sub cf-verdict", t.verdict));
      box.append(d);
    }
    return box;
  }

  function dailyCard(m) {
    const c = card("Day by day", tabs("cfmSeries", [["sales", "Sales"], ["payout", "Est. payout"], ["spend", "Spend"], ["netProfit", "Net profit"]], view.series, (v) => { view.series = v; saveView(); draw(true); }));
    const s = m.daily && m.daily[view.series];
    if (!s) { c.append(empty(view.series === "spend" ? "All Orders spend could not be read." : "No Sellerboard days yet.")); return { c }; }
    const box = chartBox("cfmDaily");
    c.append(box, legend([["kbar", "each day"], ["k1", "7-day average"], ["k2", "28-day average"]]), el("p", "cfm-note", s.trend));
    return { c, draw: () => C.drawChart(box, { days: tail(m.days), bars: tail(s.bars), barLabel: "Day", lines: [{ values: tail(s.roll7), cls: "s-mark-1", label: "7-day avg" }, { values: tail(s.roll28), cls: "s-mark-2", label: "28-day avg" }], title: view.series }) };
  }

  function projCard(m) {
    const c = card("Projection", tabs("cfmProjSeries", [["sales", "Sales"], ["payout", "Est. payout"]], view.proj, (v) => { view.proj = v; saveView(); draw(true); }));
    const p = m.proj && m.proj[view.proj];
    if (!p || !p.ok) { c.append(empty((p && p.text) || "No Sellerboard days yet.")); return { c }; }
    const box = chartBox("cfmProj");
    c.append(box, legend([["k1", "7-day average (actual)"], ["k2", "forecast (trend + weekly rhythm)"], ["kband", "80% range"], ["k4", "from stock already at Amazon"]]));
    const grid = el("div", "cfm-proj-grid");
    for (const k of p.cards || []) {
      const d = el("div", "cfm-stat");
      d.append(el("div", "cfm-stat-label", k.label), el("div", "cfm-stat-value", k.value), el("div", "cfm-stat-sub", k.sub));
      grid.append(d);
    }
    c.append(grid);
    const nullsH = p.histDays.map(() => null);
    return {
      c,
      draw: () => C.drawChart(box, {
        days: [...p.histDays, ...p.futDays],
        split: p.histDays.length,
        band: { low: [...nullsH, ...p.low], high: [...nullsH, ...p.high] },
        lines: [
          { values: [...p.roll7, ...p.futDays.map(() => null)], cls: "s-mark-1", label: "7-day avg" },
          { values: [...nullsH, ...p.point], cls: "s-mark-2", label: "forecast" },
          ...(p.stock ? [{ values: [...nullsH, ...p.stock], cls: "s-mark-4", label: "from stock", dash: true }] : []),
        ],
        title: "projection",
      }),
    };
  }

  function stockCard(m) {
    const c = card("Stock at Amazon (at cost)");
    const st = m.stock || {};
    const out = { c };
    if (!st.days || !st.days.length) c.append(empty("No Amazon stock history yet (the hourly SP-API pull writes it)."));
    else {
      const box = chartBox("cfmStock");
      c.append(box, legend([["k4", "Available"], ["k3", "Inbound"], ["k1", "FC transfer / processing"]]));
      out.draw = () => C.drawStacked(box, { days: st.days, series: [{ values: st.available, cls: "a-available" }, { values: st.inbound, cls: "a-inbound" }, { values: st.transfer, cls: "a-transfer" }] });
    }
    c.append(el("p", "cfm-sentence", st.sentence || ""), el("p", "cfm-note", st.note || ""));
    return out;
  }

  function payoutsCard(m) {
    const c = card("Payouts: 7 / 14 / 30 days");
    if (!m.payouts) { c.append(empty("No Sellerboard days yet.")); return { c }; }
    const box = chartBox("cfmPayouts");
    c.append(box, legend([["k3", "7 days"], ["k1", "14 days"], ["k2", "30 days"]]));
    return { c, draw: () => C.drawChart(box, { days: tail(m.days), height: 220, lines: [{ values: tail(m.payouts.p7), cls: "s-mark-3", label: "7 days" }, { values: tail(m.payouts.p14), cls: "s-mark-1", label: "14 days" }, { values: tail(m.payouts.p30), cls: "s-mark-2", label: "30 days" }] }) };
  }

  function buyCard(m) {
    const c = card("Buying vs payouts");
    if (!m.hasSb) return { c: null };
    if (!m.buyVsPay) { c.append(empty("All Orders spend could not be read.")); return { c }; }
    const box = chartBox("cfmBuyVsPay");
    c.append(box, el("p", "cfm-note", m.buyVsPayNote || ""));
    return { c, draw: () => C.drawChart(box, { days: tail(m.days), height: 220, ref: 1, yFormat: (v) => v.toFixed(2) + "x", lines: [{ values: tail(m.buyVsPay), cls: "s-mark-5", label: "spend ÷ payout (30 days)" }] }) };
  }

  function trendsCard(m) {
    const c = card("Trends");
    c.append(el("p", "cfm-note", "Last 13 whole weeks, weekly totals (the weekday rhythm is gone), robust slope (Theil-Sen). A trend is only called rising or falling when its 90% range does not include \"flat\"."));
    const wrap = el("div", "cfm-table-wrap");
    const t = el("table", "cfm-table");
    const head = t.createTHead().insertRow();
    ["", "Trend", "Per week", "90% range", "% a week", "Weekly average"].forEach((h, i) => { const th = el("th", i >= 2 ? "num" : "", h); head.append(th); });
    const body = t.createTBody();
    for (const r of m.trends || []) {
      const row = body.insertRow();
      [r.label, r.verdict, r.perWeek, r.range, r.pctWeek, r.avg].forEach((v, i) => {
        const td = row.insertCell();
        td.textContent = v;
        if (i >= 2) td.className = "num";
        if (i === 1) td.className = r.cls + (r.cls !== "cf-flat" ? " cf-verdict" : "");
      });
    }
    wrap.append(t);
    c.append(wrap);
    return { c };
  }

  // Lays the tab out; charts need the pane's real width, so they are drawn
  // only while it shows (and again when it is opened - shown()).
  function draw(force) {
    const m = data && data.model;
    const pull = data && data.pull;
    renderStatus(m, pull);
    const key = JSON.stringify([m ? m.builtAt : 0, view, visible()]);
    if (!force && key === drawnKey) return;
    drawnKey = key;
    const body = $("cfmBody");
    body.textContent = "";
    for (const b of $("cfmRange").querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.days) === view.days));
    if (!m) return;
    body.append(tilesEl(m));
    const parts = [dailyCard(m), projCard(m), stockCard(m), payoutsCard(m), buyCard(m), trendsCard(m)];
    for (const p of parts) if (p.c) body.append(p.c);
    if (visible()) for (const p of parts) if (p.draw) p.draw();
  }

  function render(cashFlow) {
    data = cashFlow && typeof cashFlow === "object" ? cashFlow : null;
    draw(false);
  }
  function shown() { draw(true); }

  function wire() {
    const range = $("cfmRange");
    if (range) range.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-days]");
      if (!b) return;
      view.days = Number(b.dataset.days);
      saveView();
      draw(true);
    });
    const pull = $("cfmPull");
    if (pull) pull.addEventListener("click", () => {
      pull.disabled = true;
      pull.textContent = "Asking the laptop...";
      self.ShopperRemote.sendCommand("cashFlowPull", {});
    });
    const reload = $("cfmReload");
    if (reload) reload.addEventListener("click", () => self.ShopperRemote.sendCommand("cashFlowRefresh", {}));
    let t = null;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (visible()) draw(true); }, 150); });
  }

  if (!C) {
    self.ShopperCashFlowView = { render() {}, shown() {}, wire() {}, missing: true };
    return;
  }
  self.ShopperCashFlowView = { render, shown, wire };
})();
