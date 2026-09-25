// remote/fba-view.js - B-510/B-511 (v4.61): the phone's FBA tab and its
// Dashboard card.
//
// ⚠ Owns no rules. Every calculation and every mark is the laptop's own
// lib/amzinv*.js / lib/fba-card.js code, bundled into fba-lib.js
// (self.ShopperFBA). This file wires the controls and draws - the same job
// amazon/inventory.js and dashboard/fba-card.js do on the laptop.
//
// Read-only: no command, no write, no Amazon pull. The range / $-Units /
// style / series controls start on the laptop's Chart settings and are then
// remembered on THIS phone only (localStorage) - a tap here never changes
// what the laptop shows.
(function () {
  "use strict";
  const F = self.ShopperFBA;
  const $ = (id) => document.getElementById(id);
  // B-605 / B-607 (v4.78): a new key, so every phone starts once on the new
  // defaults (30d, non-overlapping series) instead of an older saved pick.
  const VIEW_KEY = "shopperFbaPhoneView2";
  const SPARK_W = 300, SPARK_H = 56;
  const NS = "http://www.w3.org/2000/svg";

  let data = null;          // the projection (payload.fba)
  let points = [];          // decoded + merged
  let lastKey = "";         // fingerprint of the projection last drawn
  // B-515 (v4.63): `trendlines` null = follow the laptop's setting.
  const view = { days: null, custom: null, customOpen: false, measure: null, style: null, table: false, moreChips: false, trendSeries: null, trendlines: null, notes: false };

  function loadView() {
    try {
      const raw = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
      if (raw && typeof raw === "object") {
        for (const k of ["days", "measure", "style", "trendSeries"]) if (raw[k] != null) view[k] = raw[k];
        view.table = !!raw.table;
        view.notes = !!raw.notes;
        if (typeof raw.trendlines === "boolean") view.trendlines = raw.trendlines;
      }
    } catch (_e) { /* private mode: the laptop's settings are used */ }
  }
  function saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ days: view.days, measure: view.measure, style: view.style, trendSeries: view.trendSeries, table: view.table, trendlines: view.trendlines, notes: view.notes }));
    } catch (_e) { /* the page still draws */ }
  }
  loadView();

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function agoText(ms) {
    if (!ms) return "never";
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    return h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
  }

  // The laptop's Chart settings, with this phone's own choices on top.
  function settings() {
    const s = (data && data.settings) || F.normalizeSettings(null);
    return F.normalizeSettings(Object.assign({}, s, view.trendSeries ? { trendSeries: view.trendSeries } : {}));
  }
  function measure() { return view.measure === "units" || view.measure === "value" ? view.measure : settings().measure; }
  function style() { return ["columns", "lines", "area"].includes(view.style) ? view.style : settings().style; }
  function trendlines() { return typeof view.trendlines === "boolean" ? view.trendlines : settings().showTrendlines !== false; }
  function days() {
    const s = settings();
    return s.presets.includes(view.days) ? view.days : s.defaultRange;
  }

  function setData(fba) {
    data = fba || null;
    points = data && data.available
      ? F.mergeFbaPoints(F.decodeFbaPoints(data.daily, data.keys), F.decodeFbaPoints(data.hourly, data.keys))
      : [];
  }

  // ------------------------------------------------------------ FBA tab
  function banner(host, text, kind) {
    const d = node("div", "ai-banner ai-banner-" + (kind || "info"));
    d.append(node("span", "ai-banner-icon", kind === "warn" ? "⚠" : kind === "error" ? "✖" : "ℹ"), node("span", null, text));
    host.append(d);
  }

  function renderBanners() {
    const host = $("fbaBanners");
    host.textContent = "";
    if (!data) return;
    if (!data.available) { banner(host, "Could not read the FBA history on the laptop: " + (data.loadError || "unknown error"), "error"); return; }
    if (data.connected === false) banner(host, "Amazon is not connected - paste the SP-API keys on the laptop's Setup page.", "warn");
    if (data.error) banner(host, "Last Amazon pull failed: " + data.error + " The figures below are from the last good pull.", "error");
    if (data.historyError) banner(host, "The last history row was NOT saved: " + data.historyError, "error");
    const s = settings();
    const dip = F.dipSignal(points, s.dip);
    if (dip.state === "warming") banner(host, "Supply-squeeze warning starts once " + dip.need + " days of history exist (" + dip.have + " so far).", "info");
    for (const a of F.fbaAlerts(points, s)) banner(host, a.text, "warn");
  }

  function renderNow() {
    const bars = $("fbaBars");
    bars.textContent = "";
    // B-566 (v4.74): one full stack (same lib code as the laptop page).
    const p = F.withLiveParts(points.length ? points[points.length - 1] : null, data.ordered);
    if (!p) { $("fbaNowNote").textContent = "No history rows yet - the first one is written by the laptop's next Amazon pull."; return; }
    const s = settings();
    const u = F.barSegments(p, "units", s.splitInboundInBars);
    const v = F.barSegments(p, "value", s.splitInboundInBars);
    bars.append(
      F.drawStackedBar(document, { title: "Units", segments: u.segments, total: u.total, measure: "units", amazonTotal: u.allInventory ? u.amazonTotal : null }),
      F.drawStackedBar(document, { title: "$ at cost", segments: v.segments, total: v.total, measure: "value", amazonTotal: v.allInventory ? v.amazonTotal : null }),
      nowTable(u, v)
    );
    const ord = F.orderedNote(data.ordered);
    $("fbaNowNote").textContent = "Amazon's own count at " + F.fmtCT(p.t) + ", valued at the cost in effect then." +
      (p.unpricedUnits ? " " + p.unpricedUnits + " unit(s) have no cost on file and are in Units but not in $." : "") +
      (ord ? " " + ord : "");
  }

  // B-603 (v4.78): one small table (status · units · $ · share) in place of
  // the two wrapped legends under the bars (hidden on the phone by CSS).
  function nowTable(u, v) {
    const t = node("table", "fba-now-table");
    const hr = node("tr");
    for (const h of ["", "Units", "$", "%"]) hr.append(node("th", h ? "ai-num" : null, h));
    const thead = node("thead"); thead.append(hr);
    const tbody = node("tbody");
    for (const s of u.segments) {
      const sv = v.segments.find((x) => x.key === s.key) || { v: 0, pct: 0 };
      if (!(s.v > 0) && !(sv.v > 0)) continue;
      const tr = node("tr");
      const lab = node("td", "fba-now-label");
      const sw = node("span", "ai-swatch" + (s.dash ? " ai-swatch-sub" : ""));
      sw.style.background = s.color;
      lab.append(sw, document.createTextNode(s.label));
      tr.append(lab, node("td", "ai-num", F.fmt(s.v, "units")), node("td", "ai-num", F.fmt(sv.v, "value")), node("td", "ai-num", Math.round(sv.pct || 0) + "%"));
      tbody.append(tr);
    }
    const tot = node("tr", "fba-now-total");
    tot.append(node("td", null, u.allInventory ? "All inventory" : "Amazon Total"), node("td", "ai-num", F.fmt(u.total, "units")), node("td", "ai-num", F.fmt(v.total, "value")), node("td", "ai-num", ""));
    tbody.append(tot);
    t.append(thead, tbody);
    return t;
  }

  function segBtn(label, on, onClick) {
    const b = node("button", "ai-seg-btn" + (on ? " is-on" : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function renderControls() {
    const s = settings();
    const ranges = $("fbaRanges");
    ranges.textContent = "";
    for (const d of s.presets) {
      ranges.append(segBtn(F.rangeLabel(d), !view.custom && days() === d, () => { view.days = d; view.custom = null; view.customOpen = false; saveView(); draw(); }));
    }
    const m = measure(), st = style();
    const mm = $("fbaMeasure"); mm.textContent = "";
    mm.append(
      segBtn("$", m === "value", () => { view.measure = "value"; saveView(); draw(); }),
      segBtn("Units", m === "units", () => { view.measure = "units"; saveView(); draw(); })
    );
    const ss = $("fbaStyle"); ss.textContent = "";
    ss.append(
      segBtn("Columns", st === "columns", () => { view.style = "columns"; saveView(); draw(); }),
      segBtn("Lines", st === "lines", () => { view.style = "lines"; saveView(); draw(); }),
      segBtn("Area", st === "area", () => { view.style = "area"; saveView(); draw(); })
    );
    $("fbaCustomToggle").classList.toggle("is-on", !!view.custom || view.customOpen);
    $("fbaCustomToggle").setAttribute("aria-expanded", view.customOpen ? "true" : "false");
    $("fbaCustom").hidden = !view.customOpen;
    $("fbaTableToggle").classList.toggle("is-on", view.table);
    // B-603 (v4.78): the explanatory text sits behind "Details".
    $("fbaPane").classList.toggle("fba-notes-on", view.notes);
    const nt = $("fbaNotesToggle");
    if (nt) { nt.classList.toggle("is-on", view.notes); nt.setAttribute("aria-expanded", view.notes ? "true" : "false"); }
    const tl = $("fbaTrendlinesToggle");
    if (tl) {
      tl.hidden = st === "lines";
      tl.classList.toggle("is-on", trendlines());
      tl.setAttribute("aria-pressed", trendlines() ? "true" : "false");
    }
  }

  function renderChips() {
    const host = $("fbaChips");
    host.textContent = "";
    const s = settings();
    const on = new Set(s.trendSeries);
    const g = F.chipGroups(F.SERIES.map(([k]) => F.SERIES_BY_KEY[k]), on, view.moreChips);
    for (const key of g.shown) {
      const ser = F.SERIES_BY_KEY[key];
      const b = node("button", "ai-chip");
      b.type = "button";
      b.setAttribute("aria-pressed", on.has(key) ? "true" : "false");
      const sw = node("span", "ai-swatch" + (ser.dash ? " ai-swatch-sub" : ""));
      sw.style.background = ser.color;
      b.append(sw, document.createTextNode(ser.label));
      b.addEventListener("click", () => {
        view.trendSeries = on.has(key) ? s.trendSeries.filter((k) => k !== key) : s.trendSeries.concat([key]);
        saveView();
        draw();
      });
      host.append(b);
    }
    if (g.hiddenCount || view.moreChips) {
      const more = node("button", "ai-chip ai-chip-more", view.moreChips ? "Fewer" : "More… (" + g.hiddenCount + ")");
      more.type = "button";
      more.setAttribute("aria-expanded", view.moreChips ? "true" : "false");
      more.addEventListener("click", () => { view.moreChips = !view.moreChips; renderChips(); });
      host.append(more);
    }
  }

  function currentSlice() {
    const now = Date.now();
    if (view.custom) return F.sliceRange(points, { now, from: view.custom.from, to: view.custom.to });
    return F.sliceRange(points, { days: days(), now });
  }

  function renderTrend() {
    const trend = $("fbaTrend"), table = $("fbaTable");
    trend.textContent = "";
    table.textContent = "";
    const sl = currentSlice();
    const s = settings();
    const m = measure(), st = style();
    const compare = s.showCompare ? F.previousPeriod(points, sl) : null;
    const markers = s.showMarkers
      ? F.shipmentMarkers((data && data.batches) || [], { lo: Number.isFinite(sl.lo) ? sl.lo : -Infinity, hi: Number.isFinite(sl.hi) ? sl.hi : Infinity })
      : [];
    const dip = F.dipSignal(points, s.dip);
    const bands = dip.bands && !sl.hourly ? dip.bands.filter((t) => (!Number.isFinite(sl.lo) || t >= sl.lo) && (!Number.isFinite(sl.hi) || t <= sl.hi)) : [];
    // Drawn at the box's real width (a phone is ~350px) and a shorter height.
    const width = Math.max(320, Math.min(1000, trend.clientWidth || 360));
    const height = 240;
    const hi = Number.isFinite(sl.hi) ? sl.hi : Date.now();
    if (st === "columns") {
      trend.append(F.drawColumnsTrend(document, {
        points: sl.points, keys: s.trendSeries, measure: m, splitInbound: s.splitInboundInBars,
        markers, bands, hourly: sl.hourly, lo: sl.lo, hi, width, height, showLines: trendlines(),
      }));
    } else {
      trend.append(F.drawTrend(document, {
        points: sl.points, keys: s.trendSeries, measure: m, style: st,
        compare, markers, bands, hourly: sl.hourly, lo: sl.lo, hi, width, height, showLines: trendlines(),
      }));
    }
    if (s.showCompare && !compare && st !== "columns") trend.append(node("p", "ai-note", "Previous period: history does not reach back that far yet."));
    if (view.custom && sl.hourly && sl.points.length && sl.points[sl.points.length - 1].t < points[points.length - 1].t - 3 * 86400000) {
      trend.append(node("p", "ai-note", "The phone keeps hourly rows for the last 3 days only - older days show one point each. The laptop page has every hour."));
    }
    table.hidden = !view.table;
    if (view.table) table.append(F.drawTable(document, { points: sl.points, keys: s.trendSeries, measure: m, hourly: sl.hourly }));
  }

  function renderHead() {
    const asOf = $("fbaAsOf");
    if (!data) {
      asOf.textContent = "Waiting for the laptop to send its FBA history (needs Shopper v4.61 on the laptop and Amazon connected there).";
      return;
    }
    if (!data.available) { asOf.textContent = "Read-only."; return; }
    // B-603 (v4.78): one short line; the row count moved behind Details.
    asOf.textContent = (data.pulledAt ? "As of " + F.fmtCT(data.pulledAt) : "No Amazon pull yet") + " · sent " + agoText(data.builtAt);
    asOf.title = data.rowCount + " hourly row(s) on file. Read-only.";
    const link = $("fbaWorkbook");
    if (data.historyUrl) { link.href = data.historyUrl; link.hidden = false; } else link.hidden = true;
  }

  function draw() {
    if (!F) return;
    renderHead();
    const has = !!(data && data.available);
    $("fbaBody").hidden = !has;
    renderBanners();
    if (!has) return;
    renderNow();
    renderControls();
    renderChips();
    renderTrend();
  }

  // ------------------------------------------------------ Dashboard card
  function drawSpark(host, spark) {
    host.textContent = "";
    if (spark.length < 2) { host.append(node("p", "muted small", "7-day trend shows once two days of history exist.")); return; }
    const p = F.sparkPaths(spark, { width: SPARK_W, height: SPARK_H });
    const svgEl = document.createElementNS(NS, "svg");
    svgEl.setAttribute("viewBox", "0 0 " + SPARK_W + " " + SPARK_H);
    svgEl.setAttribute("class", "fba-spark-svg");
    svgEl.setAttribute("role", "img");
    const last = spark[spark.length - 1];
    svgEl.setAttribute("aria-label", "Last 7 days, $ at cost: Available now " + F.fmt(last.available, "value") + ", Inbound now " + F.fmt(last.inbound, "value"));
    for (const [d, color] of [[p.inbound, F.SLOT.orange], [p.available, F.SLOT.blue]]) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.setAttribute("class", "fba-spark-line");
      svgEl.append(path);
    }
    const legend = node("div", "fba-spark-legend");
    for (const [label, color] of [["Available $", F.SLOT.blue], ["Inbound $", F.SLOT.orange]]) {
      const item = node("span", "fba-spark-key");
      const sw = node("span", "ai-swatch");
      sw.style.background = color;
      item.append(sw, document.createTextNode(label));
      legend.append(item);
    }
    legend.append(node("span", "muted small", "last 7 days"));
    host.append(svgEl, legend);
  }

  function drawDashCard() {
    const tiles = $("dashFbaTiles"), bannersEl = $("dashFbaBanners"), empty = $("dashFbaEmpty"), asOf = $("dashFbaAsOf"), spark = $("dashFbaSpark");
    tiles.textContent = "";
    bannersEl.textContent = "";
    spark.textContent = "";
    asOf.textContent = "";
    if (!data || !data.available) {
      empty.hidden = false;
      empty.textContent = !data
        ? "Waiting for the laptop to send its FBA history (needs Shopper v4.61 there)."
        : "Could not read the FBA history on the laptop: " + (data.loadError || "unknown error");
      return;
    }
    // The laptop's settings for the alerts - the card and the FBA tab say the same thing.
    const model = F.fbaCardModel({ points, pulledAt: data.pulledAt, settings: data.settings, ordered: data.ordered || null });
    if (data.error) bannersEl.append(node("div", "dash-banner dash-banner-warn", "⚠ Last Amazon pull failed: " + data.error + " The figures below are from the last good pull."));
    if (model.empty) {
      empty.hidden = false;
      empty.textContent = data.connected === false
        ? "Amazon is not connected - paste the SP-API keys on the laptop's Setup page."
        : "No FBA history on file yet - the first row is written by the laptop's next Amazon pull.";
      return;
    }
    empty.hidden = true;
    asOf.textContent = "(as of " + F.fmtCT(model.asOf) + ")";
    for (const a of model.alerts) bannersEl.append(node("div", "dash-banner dash-banner-warn", "⚠ " + a.text));
    for (const t of model.tiles) {
      const tile = node("div", "dash-tile fba-" + t.key);
      tile.append(node("span", "t-label", t.label), node("b", null, F.fmt(t.units, "units")), node("span", "dash-money", F.fmt(t.value, "value")));
      tiles.append(tile);
    }
    // B-547 (v4.68): Shopper's Ordered (in transit + house + prep), after Amazon's four.
    if (model.ordered) {
      const o = model.ordered;
      const tile = node("div", "dash-tile fba-ordered");
      tile.title = o.hover;
      tile.append(node("span", "t-label", "Ordered (Shopper)"), node("b", null, F.fmt(o.units, "units")), node("span", "dash-money", F.fmt(o.value, "value") + (o.unpricedUnits > 0 ? " · " + o.unpricedUnits + " not in $" : "")));
      tiles.append(tile);
    }
    drawSpark(spark, model.spark);
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    const on = (id, fn) => { const e = $(id); if (e) e.addEventListener("click", fn); };
    on("fbaCustomToggle", () => {
      view.customOpen = !view.customOpen;
      if (!view.customOpen && view.custom) view.custom = null;
      draw();
    });
    on("fbaTableToggle", () => { view.table = !view.table; saveView(); draw(); });
    on("fbaNotesToggle", () => { view.notes = !view.notes; saveView(); draw(); });
    on("fbaTrendlinesToggle", () => { view.trendlines = !trendlines(); saveView(); draw(); });
    on("fbaApplyCustom", () => {
      const fv = $("fbaFrom").value, tv = $("fbaTo").value;
      // v4.68: the dates picked are Central days.
      const f = fv ? F.centralDayStart(fv) : null;
      const t = tv ? F.centralDayEnd(tv) : null;
      if (f == null && t == null) return;
      if (f != null && t != null && f > t) { banner($("fbaBanners"), "From is after To - nothing changed.", "error"); return; }
      view.custom = { from: f, to: t };
      draw();
    });
    // Redraw on a WIDTH change only (a phone turned sideways). A browser's
    // toolbar sliding away changes the height and fires resize too - a
    // redraw then would wipe the read-out under the reader's finger.
    let resizeTimer = null;
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        if (!$("fbaPane").hidden) draw();
      }, 200);
    });
  }

  // Called by app.js on every poll. Redraws only when the laptop sent
  // something new, so a tooltip or an open date picker is never torn down
  // by the 3-second poll.
  function render(fba) {
    const key = JSON.stringify(fba || null);
    if (key === lastKey) return;
    lastKey = key;
    setData(fba);
    drawDashCard();
    draw();
  }

  // Called when the FBA tab is opened: the chart is drawn at the pane's
  // real width, which is 0 while the pane is hidden.
  function shown() { draw(); }

  if (!F) {
    self.ShopperFbaView = { render() {}, shown() {}, missing: true };
    return;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  self.ShopperFbaView = { render, shown };
})();
