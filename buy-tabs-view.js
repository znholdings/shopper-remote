// remote/buy-tabs-view.js - B-2359 / B-2360 (v2.0.205): the phone's Buy page tab bar, on the Buylist tab and the Buy Queue (run) tab.
//
// The laptop's bar (lib/buy-tabs.js + lib/buy-stage-strip.js) as a classic script: 1 Generate (asks first, then the generateBuylist command),
// 2 Approve -> the Buylist tab, 3 Buy -> the run tab. The model below is a COPY of buyStageModel kept equal to the laptop's by
// test/b2359-buy-tabs.test.mjs (the same pattern as run-lib.js = lib/buy-stage.js). It also holds the ONE "+ Add ASIN" box for both tabs
// (B-2360): a run that is running / paused / waiting on a Source URL -> addManualLine (the live queue); otherwise -> buylistAddManual.
// The route is read from the latest payload at the press, never asked. Ship-to maps house <-> home.
// Loaded after app.js; app.js calls render(payload) with every payload. Uses self.ShopperRemote (sendCommand, switchTab) and inPageConfirm.
(function (root) {
  "use strict";
  var LIVE = ["running", "paused", "collecting_urls"];
  var KEYS = ["generate", "approve", "buy"];
  var LABELS = { generate: "Generate", approve: "Approve", buy: "Buy" };
  var num = function (v) { return v == null || v === "" || !isFinite(Number(v)) ? null : Number(v); };

  function stampWords(ms) {
    var t = num(ms);
    if (!t || t <= 0) return "";
    try {
      var d = new Date(t);
      var day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "numeric", day: "numeric" }).format(d).replace(",", "");
      var time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(d);
      return day + " " + time;
    } catch (e) { return ""; }
  }

  // ---- a copy of lib/buy-stage-strip.js buyStageModel (page mode + the legacy rule) ----
  function model(input) {
    var i = input || {};
    var generated = num(i.generated) > 0 ? num(i.generated) : null;
    var n = Math.max(0, Math.floor(num(i.approved && i.approved.n) || 0));
    var of = Math.max(n, Math.floor(num(i.approved && i.approved.of) || 0));
    var q = i.queue && typeof i.queue === "object" ? i.queue : null;
    var lines = q ? Math.max(0, Math.floor(num(q.lines) || 0)) : 0;
    var spend = q ? num(q.spend) : null;
    var running = !!(q && q.running);
    var waiting = !!(q && q.waiting);
    var forced = [1, 2, 3].indexOf(Number(i.stage)) >= 0 ? Number(i.stage) : null;
    var worked = !generated ? 1 : n === 0 ? 2 : 3;
    var pageStage = i.page === "approve" ? 2 : i.page === "buy" ? 3 : null;
    var current = pageStage || forced || worked;
    var generating = !!i.generating;
    var money = function (v) { return v == null ? "" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var subs = {
      generate: generating ? "Building the list..." : generated ? stampWords(generated) || "Done" : "Not yet",
      approve: !generated ? "After Generate" : of ? n + " of " + of + " approved" : "Nothing to approve",
      buy: waiting ? "Needs you" : running ? "Running" + (lines ? " · " + lines + " line" + (lines === 1 ? "" : "s") : "") : lines ? lines + " line" + (lines === 1 ? "" : "s") + (spend != null ? " · " + money(spend) : "") : n > 0 ? "Ready to start" : "After Approve",
    };
    var done = { generate: !!generated, approve: !!generated && n > 0, buy: false };
    var stages = KEYS.map(function (key, k) {
      var nn = k + 1;
      var action = !!pageStage && key === "generate";
      var isCurrent = !action && nn === current;
      var isDone = done[key] && !isCurrent;
      return { n: nn, key: key, label: LABELS[key], sub: subs[key], done: isDone, current: isCurrent, action: action, disabled: action && generating, alert: key === "buy" && waiting, state: isCurrent ? "current" : isDone ? "done" : "todo" };
    });
    return { stages: stages, current: current };
  }

  // ---- the payload -> model input (the laptop reads the same two states from storage) ----
  function waitingOf(p) { var r = p && p.run; return !!(p && p.prompt) || !!(r && r.status === "paused"); }
  function inputFrom(p, page) {
    var bl = (p && p.buylist) || null;
    var items = bl && Array.isArray(bl.items) ? bl.items : [];
    var approved = items.filter(function (it) { return it && it.decision === "approved"; }).length;
    var asMs = function (v) { return typeof v === "number" ? v : v ? Date.parse(v) : NaN; };
    var gen = asMs(bl && bl.generatedAt);
    var run = p && p.run;
    var live = !!(run && LIVE.indexOf(String(run.status || "")) >= 0);
    var lineCount = p && (num(p.lineCount) != null ? num(p.lineCount) : Array.isArray(p.lines) ? p.lines.length : 0);
    return {
      page: page,
      generated: bl && isFinite(gen) && gen > 0 ? gen : null,
      approved: { n: approved, of: items.length },
      queue: live ? { lines: lineCount || 0, spend: null, running: true, waiting: waitingOf(p) } : null,
      generating: !!(p && p.buylistGen && p.buylistGen.status === "running"),
    };
  }

  // ---- the ONE Add ASIN: route, ship-to map, message (kept equal to lib/add-asin-one.js by the same test) ----
  function routeOf(p) { var r = p && p.run; return r && LIVE.indexOf(String(r.status || "")) >= 0 ? "queue" : "buylist"; }
  function mapShip(v, route) { var prep = v === "prep"; return route === "queue" ? (prep ? "prep" : "house") : (prep ? "prep" : "home"); }
  function commandFor(route, v) {
    var asin = String(v.asin || "").trim().toUpperCase();
    var qty = Number(v.qty) > 0 ? Math.floor(Number(v.qty)) : 1;
    var pri = ["high", "medium", "low"].indexOf(v.priority) >= 0 ? v.priority : "medium";
    if (route === "queue") return { name: "addManualLine", payload: { asin: asin, qty: qty, priority: pri, destination: mapShip(v.ship, "queue") } };
    return { name: "buylistAddManual", payload: { asin: asin, qty: qty, priority: pri, prepCenter: mapShip(v.ship, "buylist") === "prep" } };
  }

  // kept equal to lib/add-asin-one.js routeChangedWords by test/b2360-declutter.test.mjs
  function routeChangedWords(route) {
    return route === "queue"
      ? "A run just started - this box now adds to the RUNNING queue (High = buys next). Nothing was added. Check the priority and press Add again."
      : "The run just ended - this box now adds to tonight's list. Nothing was added. Check and press Add again.";
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  var last = null;
  var hosts = [];

  function drawStrip(host, page, p) {
    var m = model(inputFrom(p, page));
    var ol = host.querySelector(".bl-stages");
    ol.textContent = "";
    m.stages.forEach(function (s) {
      var li = el("li", "bl-stage bl-stage-" + s.state + (s.action ? " bl-stage-action" : "") + (s.alert ? " bl-stage-alert" : ""));
      li.dataset.stage = String(s.n);
      var b = el("button", "bl-stage-btn"); b.type = "button";
      if (s.current) b.setAttribute("aria-current", "step");
      if (s.disabled) b.disabled = true;
      var dot = el("span", "bl-stage-dot", s.action ? (s.done ? "↻" : "▶") : s.state === "done" ? "✓" : s.n); dot.setAttribute("aria-hidden", "true");
      var text = el("span", "bl-stage-text");
      text.append(el("span", "bl-stage-label", s.n + " · " + s.label), el("span", "bl-stage-sub", s.sub));
      b.append(dot, text);
      b.addEventListener("click", function () { press(s.key, page, b); });
      li.append(b); ol.append(li);
    });
  }

  function press(key, page, anchor) {
    var R = root.ShopperRemote;
    if (!R) return;
    if (key === "generate") {
      var ask = typeof root.inPageConfirm === "function" ? root.inPageConfirm(anchor, "Generate a new buylist? It replaces today's list.", { yes: "Generate", no: "Cancel" }) : Promise.resolve(false);
      ask.then(function (yes) { if (yes) R.sendCommand("generateBuylist"); });
      return;
    }
    var here = page === "buy" ? "buy" : "approve";
    if (key === here) { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { /* no window */ } return; }
    R.switchTab(key === "approve" ? "buylist" : "run");
  }

  function buildHost(slot, page) {
    var host = el("div", "buy-tabbar");
    host.append(el("ol", "bl-stages"));
    var add = el("div", "buy-add-host");
    var btn = el("button", "secondary-btn buy-add-btn", "+ Add ASIN"); btn.type = "button"; btn.setAttribute("aria-expanded", "false");
    var panel = el("div", "buy-add-panel"); panel.hidden = true;
    var title = el("h3", "buy-add-title");
    var asin = el("input"); asin.placeholder = "ASIN (e.g. B07XBQ1TSK)"; asin.maxLength = 10; asin.setAttribute("autocapitalize", "characters"); asin.autocomplete = "off";
    var qty = el("input"); qty.type = "number"; qty.min = "1"; qty.placeholder = "Qty";
    var pri = el("select"); pri.setAttribute("aria-label", "Priority");
    var ship = el("select"); ship.setAttribute("aria-label", "Ships to");
    [["home", "Home"], ["prep", "Prep Center"]].forEach(function (o) { var x = el("option", "", o[1]); x.value = o[0]; ship.append(x); });
    var go = el("button", "primary-btn", "Add"); go.type = "button";
    var status = el("p", "muted small buy-add-status"); status.hidden = true; status.setAttribute("role", "status");
    panel.append(title, asin, qty, pri, ship, go, status);
    add.append(btn, panel);
    host.append(add);
    slot.textContent = "";
    slot.append(host);
    var route = "buylist";
    function paint() {
      title.textContent = route === "queue" ? "Add to the running queue" : "Add to tonight's list";
      var keep = pri.value || "medium"; pri.textContent = "";
      (route === "queue" ? [["high", "High - runs next"], ["medium", "Medium - end of queue"], ["low", "Low - last"]] : [["high", "High - top of the list"], ["medium", "Medium - bottom of the adjusted list"], ["low", "Low - past 3x goal"]])
        .forEach(function (o) { var x = el("option", "", o[1]); x.value = o[0]; pri.append(x); });
      pri.value = keep;
      go.textContent = route === "queue" ? "Add to queue" : "Add to buylist";
    }
    paint();
    btn.addEventListener("click", function () { panel.hidden = !panel.hidden; btn.setAttribute("aria-expanded", String(!panel.hidden)); if (!panel.hidden) { route = routeOf(last); paint(); } });
    go.addEventListener("click", function () {
      var shown = route, fresh = routeOf(last); // read at the press: the latest payload decides, never what was drawn
      if (fresh !== shown) { route = fresh; paint(); status.hidden = false; status.textContent = routeChangedWords(fresh); return; } // G2 review: nothing sent
      var a = asin.value.trim().toUpperCase();
      if (!a) return;
      var c = commandFor(route, { asin: a, qty: qty.value, priority: pri.value, ship: ship.value });
      var R = root.ShopperRemote;
      if (R) R.sendCommand(c.name, c.payload);
      asin.value = ""; qty.value = "";
      status.hidden = false; status.textContent = route === "queue" ? "Sent to the running queue." : "Sent to tonight's list.";
    });
    // G2 review: every payload redraws an open box whose route changed (a run started / ended while it was open), so the title and priorities match.
    return { host: host, page: page, paint: function () { route = routeOf(last); paint(); }, sync: function () { var r = routeOf(last); if (r !== route) { route = r; paint(); } } };
  }

  function mount() {
    var a = document.getElementById("buyTabsHostBuylist"), b = document.getElementById("buyTabsHostRun");
    if (a) hosts.push(buildHost(a, "approve"));
    if (b) hosts.push(buildHost(b, "buy"));
  }
  function render(p) {
    last = p || null;
    hosts.forEach(function (h) { drawStrip(h.host, h.page, last); h.sync(); });
  }

  root.ShopperBuyTabs = Object.freeze({ model: model, inputFrom: inputFrom, routeOf: routeOf, mapShip: mapShip, commandFor: commandFor, routeChangedWords: routeChangedWords, render: render, mount: mount, stampWords: stampWords });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(); if (last) render(last); });
  else { mount(); }
})(self);
