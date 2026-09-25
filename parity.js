// remote/parity.js - v4.74 (B-567 - B-574, Zach's phone-parity picks).
//
// The laptop controls Zach picked for the phone. ⚠ Owns no rules: every
// button sends a whitelisted command (lib/remote-protocol.js) that runs the
// laptop's OWN handler - the same message the laptop's button sends - and
// the laptop decides and refuses. What is drawn here is what the laptop
// published. Built with textContent only (no innerHTML).
//
//   B-567 Inventory: Quick / Full refresh + "As of" + the chain's status
//   B-568 Inventory: Needs you cards with their answer buttons
//   B-569 Inventory: Latest arrivals (time dropdown), last update, It arrived
//   B-570 Inventory: pencil edit of one product's house / prep count
//   B-571 Inventory: house expiry date per product (saved to All Orders)
//   B-572 Buylist: Ding (Light / Medium / Heavy + note) and the score reason
//   B-573 Run: daily spending goal + goal-stop mode
//   B-574 FBA: refresh (the one Quick / Full chain, B-576)
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const R = () => self.ShopperRemote || { sendCommand: async () => null, waitFor: async () => "unknown" };

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function btn(label, cls, onClick) {
    const b = node("button", cls || "secondary-btn", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function units(v) {
    const n = Number(v) || 0;
    return (Math.round(n * 1000) / 1000).toLocaleString();
  }
  function editing(container) {
    const a = document.activeElement;
    return !!(container && a && a !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && container.contains(a));
  }

  // ---- time: noon on a picked day, where the order LANDS ---------------
  // Same rule as the laptop's wallInputToIso(`${day}T12:00`, destination):
  // Central for the house, Pacific for the prep centre.
  const ZONE = { house: "America/Chicago", prep: "America/Los_Angeles" };
  function zoneParts(ms, zone) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return o;
  }
  function todayFor(dest) {
    const p = zoneParts(Date.now(), ZONE[dest] || ZONE.house);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function noonIso(day, dest) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
    if (!m) return "";
    const want = Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0);
    let t = want;
    for (let i = 0; i < 3; i++) {
      const p = zoneParts(t, ZONE[dest] || ZONE.house);
      const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      t += want - seen;
    }
    return new Date(t).toISOString();
  }
  function ctText(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
  }

  // Send, then (optionally) wait for the laptop's answer. `after` runs only
  // when the laptop said done - a refused first step never fires the second.
  async function run(name, payload, button, after) {
    if (button) { button.disabled = true; button.dataset.label = button.dataset.label || button.textContent; button.textContent = "Sending…"; }
    const id = await R().sendCommand(name, payload);
    const status = id ? await R().waitFor(id) : "not sent";
    if (button) { button.disabled = false; button.textContent = button.dataset.label; }
    if (status === "done" && after) await after();
    return status;
  }

  // ---- B-567: refresh bar ------------------------------------------------
  function refreshBar(host, p, where) {
    host.textContent = "";
    const rec = p.refresh || null;
    const running = !!(rec && rec.running);
    const row = node("div", "controls parity-refresh");
    const q = btn(running && rec.mode === "quick" ? "Refreshing…" : "Quick refresh", "secondary-btn", () => run("refreshAll", { mode: "quick" }, q));
    const f = btn(running && rec.mode === "full" ? "Refreshing…" : "Full refresh", "primary-btn", () => run("refreshAll", { mode: "full" }, f));
    q.title = "About 20 seconds: everything except reading email.";
    f.title = "About 2.5 minutes: everything, email included.";
    q.disabled = f.disabled = running;
    row.append(q, f);
    host.append(row);
    let line = "";
    if (rec) {
      const label = rec.mode === "quick" ? "Quick refresh" : "Full refresh";
      if (rec.running) line = `${label} running${rec.phase ? " - " + rec.phase : ""}… (started ${ctText(rec.startedAt)})`;
      else if (rec.finishedAt) line = `${label} finished ${ctText(rec.finishedAt)}${rec.notes && rec.notes.length ? " (" + rec.notes.join("; ") + ")" : ""}.` + (rec.problems && rec.problems.length ? " ⚠ " + rec.problems.join("; ") + "." : "");
    }
    if (line) host.append(node("p", "muted small", line));
    if (where === "fba") host.append(node("p", "muted small", "The same Quick / Full refresh as the laptop's Dashboard, Pipeline and FBA pages."));
  }

  // ---- B-568: Needs you ---------------------------------------------------
  function needCard(title, meta, body) {
    const c = node("div", "line need-card");
    const top = node("div", "inv-row-top");
    top.append(node("b", "inv-title", title));
    c.append(top);
    if (meta) c.append(node("div", "l-meta", meta));
    if (body) c.append(node("div", "need-body", body));
    return c;
  }
  function actions() { return node("div", "controls need-actions"); }

  function renderNeeds(host, needs) {
    host.textContent = "";
    const head = node("h3", null, "Needs you ");
    head.append(node("span", "count", needs ? String(needs.total) : "-"));
    host.append(head);
    if (!needs) { host.append(node("p", "muted", "Waiting for the laptop to send these (needs Shopper v4.74 on the laptop).")); return; }
    if (!needs.total) { host.append(node("p", "muted", "Nothing is waiting on you.")); return; }

    for (const f of needs.frozen) {
      const c = needCard(f.title || f.asin, `${f.retailer || "order"} #${f.orderNumber} · ${units(f.units)} units`, "Shopper placed this order, and there is no row for it on All Orders any more. Nothing about it moves until you pick.");
      const a = actions();
      const fix = node("input", "need-input");
      fix.placeholder = "Corrected order number";
      a.append(
        btn("Restore the row", "primary-btn", (e) => run("orderRestore", { orderNumber: f.orderNumber, asin: f.asin }, e.target)),
        fix,
        btn("Repair", "secondary-btn", (e) => { if (fix.value.trim()) run("orderRepair", { orderNumber: f.orderNumber, asin: f.asin, newOrderNumber: fix.value.trim() }, e.target); }),
        btn("Cancel this order", "danger-btn", (e) => { if (confirm(`Cancel order ${f.orderNumber} (${units(f.units)} units)?`)) run("orderCancel", { orderNumber: f.orderNumber, asin: f.asin, units: f.units }, e.target); })
      );
      c.append(a);
      host.append(c);
    }

    for (const o of needs.overdue) {
      const c = needCard(o.title || o.asin, `${o.retailer || "order"} #${o.orderNumber} · to ${o.destination === "prep" ? "Prep" : "the House"} · ${o.ageDays} days ago`,
        `${units(o.open)} of ${units(o.ordered)} units still open. ` + (o.emails ? `${o.emails} delivery email(s) landed.` : "No delivery email has ever landed."));
      const a = actions();
      const day = node("input", "need-input");
      day.type = "date";
      day.value = todayFor(o.destination);
      a.append(
        btn("It arrived", "primary-btn", (e) => run("orderArrived", { orderNumber: o.orderNumber, asin: o.asin, units: o.open, at: noonIso(day.value, o.destination) || new Date().toISOString() }, e.target)),
        day,
        btn("It never arrived", "danger-btn", (e) => { if (confirm(`Mark ${units(o.open)} units of order ${o.orderNumber} as never arrived?`)) run("orderNeverArrived", { orderNumber: o.orderNumber, asin: o.asin, units: o.open }, e.target); }),
        btn("Keep waiting", "secondary-btn", (e) => run("orderKeepWaiting", { key: o.key }, e.target))
      );
      c.append(a);
      host.append(c);
    }

    for (const s of needs.stayed) {
      const c = needCard(`${s.batch} · ${s.location}`, s.at ? `went out ${ctText(Date.parse(s.at) || s.at)}` : "",
        `${s.rows.length} product(s) still read above zero on the ${s.location} shelf when this shipment went out.`);
      for (const r of s.rows) c.append(node("div", "l-meta", `${r.title || r.asin}: shipped ${units(r.shipped)} · left ${units(r.left)} · now ${units(r.now)}`));
      const a = actions();
      a.append(
        btn("They stayed - keep them", "secondary-btn", (e) => run("dismissCheck", { id: s.id }, e.target)),
        btn("None stayed - take them off", "primary-btn", (e) => run("setPartialCounts", {
          destination: s.location,
          entries: s.rows.map((r) => ({ asin: r.asin, units: r.takeOffTo })),
          excludeBatchIds: s.batchId ? [String(s.batchId)] : [],
          note: `Nothing stayed behind from ${s.batch} (B-539, from the phone)`,
        }, e.target, () => run("dismissCheck", { id: s.id })))
      );
      c.append(a);
      host.append(c);
    }

    for (const sp of needs.splits) {
      const c = needCard(`Order ${sp.orderNumber}`, `${sp.retailer} · ${sp.lines.length} products on one order${sp.occurredAt ? " · delivered " + ctText(sp.occurredAt) : ""}`,
        "The delivery email does not say which units belong to which product, so nothing was booked. How many of each actually arrived?");
      const boxes = new Map();
      for (const ln of sp.lines) {
        const r = node("div", "need-split-row");
        r.append(node("span", "inv-title", `${ln.title || ln.asin}${ln.orderedUnits == null ? "" : " - ordered " + units(ln.orderedUnits)}`));
        const box = node("input", "need-input need-num");
        box.type = "number";
        box.min = "0";
        box.step = "1";
        box.placeholder = ln.suggest == null ? "units" : `suggest ${units(ln.suggest)}`;
        boxes.set(ln.asin, box);
        r.append(box);
        c.append(r);
      }
      if (sp.suggestReason) c.append(node("div", "l-meta", `Grey numbers are a suggestion only: ${sp.suggestReason}`));
      const a = actions();
      a.append(
        btn("Book these", "primary-btn", (e) => {
          const allocation = {};
          for (const [asin, box] of boxes) if (String(box.value).trim() !== "") allocation[asin] = String(box.value).trim();
          run("splitBook", { key: sp.key, allocation }, e.target);
        }),
        btn("Leave it in transit", "secondary-btn", (e) => run("splitDismiss", { key: sp.key }, e.target))
      );
      c.append(a);
      host.append(c);
    }
    if (needs.splitOverflow) host.append(node("p", "muted small", `${needs.splitOverflow} more split question(s) wait behind these.`));

    for (const k of needs.checks) {
      const c = needCard(k.title, "", k.body);
      const a = actions();
      a.append(btn(k.button || "Dismiss", "secondary-btn", (e) => run("dismissCheck", { id: k.id }, e.target)));
      c.append(a);
      host.append(c);
    }
    if (needs.shipmentsOnLaptop) host.append(node("p", "muted small", `${needs.shipmentsOnLaptop} shipment question(s) - answer those on the laptop.`));
  }

  // ---- B-569: Latest arrivals ------------------------------------------------
  let latestHours = 24;
  function renderLatest(host, inv) {
    host.textContent = "";
    const head = node("h3", null, "Latest arrivals ");
    const sel = node("select", "need-input");
    for (const h of [2, 8, 12, 24, 48]) {
      const o = node("option", null, `${h} hours`);
      o.value = String(h);
      if (h === latestHours) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener("change", () => { latestHours = Number(sel.value) || 24; renderLatest(host, inv); });
    head.append(sel);
    host.append(head);
    const all = (inv && inv.arrivals && inv.arrivals.latest) || [];
    const floor = Date.now() - latestHours * 3600000;
    const rows = all.filter((r) => Number(r.occurredAtMs) >= floor);
    if (!rows.length) { host.append(node("p", "muted", all.length ? `Nothing in the last ${latestHours} hour(s).` : "Nothing.")); return; }
    const total = rows.reduce((t, r) => t + (Number(r.units) || 0), 0);
    host.append(node("p", "muted small", `${units(total)} units · ${rows.length} delivery event(s) in the last ${latestHours} hour(s)`));
    for (const r of rows) {
      const row = node("div", "line inv-arrival");
      const top = node("div", "inv-row-top");
      top.append(node("span", "inv-title", r.title || r.asin), node("b", "inv-units", r.units == null ? "-" : units(r.units) + "u"));
      row.append(top);
      row.append(node("div", "l-meta", [r.asin, r.retailer, r.destination, r.carrier || "carrier not read yet", ctText(r.occurredAtMs)].filter(Boolean).join(" · ")));
      host.append(row);
    }
  }

  // Called by app.js for every arrival row it draws (B-569).
  function decorateArrival(rowEl, r, kind) {
    if (r.lastUpdate) rowEl.append(node("div", "l-meta", `Last update: ${r.lastUpdate.text}${r.lastUpdate.atMs ? " (" + ctText(r.lastUpdate.atMs) + ")" : ""}`));
    else rowEl.append(node("div", "l-meta muted", "No tracking email yet"));
    if (kind !== "overdue") return;
    const a = actions();
    if (!r.closeOrders || !r.closeOrders.length) {
      a.append(node("span", "muted small", "Refresh to mark this arrived (several orders behind it)."));
      rowEl.append(a);
      return;
    }
    const dest = r.destination === "prep" ? "prep" : "house";
    const day = node("input", "need-input");
    day.type = "date";
    day.value = todayFor(dest);
    const b = btn("It arrived", "primary-btn", async () => {
      if (!day.value) return;
      for (const o of r.closeOrders) {
        const st = await run("orderArrived", { orderNumber: o.orderNumber, asin: r.asin, units: o.units, at: noonIso(day.value, dest), note: "Marked arrived from the phone's Arrivals › Overdue" }, b);
        if (st !== "done") break;
      }
    });
    a.append(b, day);
    rowEl.append(a);
  }

  // ---- B-570 / B-571: product row pencil + expiry ------------------------------
  let expiry = {};
  function decorateProduct(rowEl, r) {
    const a = actions();
    const pencil = btn("✎ Count", "secondary-btn", () => {
      if (rowEl.querySelector(".parity-edit")) return;
      const box = node("div", "parity-edit controls");
      const where = node("select", "need-input");
      for (const [v, t] of [["house", `House (now ${units(r.house)})`], ["prep", `Prep (now ${units(r.prep)})`]]) { const o = node("option", null, t); o.value = v; where.append(o); }
      const num = node("input", "need-input need-num");
      num.type = "number";
      num.step = "any";
      num.placeholder = "units on the shelf";
      const note = node("input", "need-input");
      note.placeholder = "Note (optional)";
      const save = btn("Save", "primary-btn", () => {
        if (num.value === "") return;
        const now = where.value === "prep" ? r.prep : r.house;
        if (!confirm(`Set ${where.value === "prep" ? "Prep" : "House"} for ${r.title || r.asin} from ${units(now)} to ${units(num.value)}? Only this product changes.`)) return;
        run("setCount", { asin: r.asin, destination: where.value, units: Number(num.value) || 0, note: note.value || "Set from the phone" }, save, async () => box.remove());
      });
      box.append(where, num, note, save, btn("Cancel", "secondary-btn", () => box.remove()));
      rowEl.append(box);
      num.focus();
    });
    a.append(pencil);
    if (Number(r.house) > 0) {
      const d = node("input", "need-input");
      d.type = "date";
      d.value = expiry[r.asin] || "";
      d.title = "Expiry date - saved to All Orders, same cell as the laptop's Expires column";
      const save = btn("Save expiry", "secondary-btn", () => run("houseExpirySet", { asin: r.asin, expires: d.value || "" }, save));
      a.append(node("span", "muted small", "Expires"), d, save);
    }
    rowEl.append(a);
  }

  // ---- B-572: buylist ding + score reason -----------------------------------------
  const DING = [["light", "Light (-15%)"], ["medium", "Medium (-35%)"], ["heavy", "Heavy (-60%)"]];
  function decorateBuylistCard(cardEl, i) {
    if (i.scoreReason) {
      const d = node("details", "parity-why");
      d.append(node("summary", null, "Why this Buy Score"));
      d.append(node("pre", "parity-why-text", i.scoreReason));
      cardEl.append(d);
    }
    const a = actions();
    if (i.ding) {
      const label = (DING.find((x) => x[0] === i.ding.level) || [null, i.ding.level])[1];
      a.append(node("span", "l-meta", `Dinged ${label}: ${i.ding.note}`), btn("Remove ding", "secondary-btn", (e) => run("dingRemove", { asin: i.asin }, e.target)));
    } else {
      a.append(btn("Ding…", "secondary-btn", () => {
        if (cardEl.querySelector(".parity-ding")) return;
        const box = node("div", "parity-ding controls");
        const lvl = node("select", "need-input");
        for (const [v, t] of DING) { const o = node("option", null, t); o.value = v; lvl.append(o); }
        const note = node("input", "need-input");
        note.placeholder = "Why (required)";
        const save = btn("Save ding", "primary-btn", () => {
          if (!note.value.trim()) { note.focus(); return; }
          run("dingSet", { asin: i.asin, level: lvl.value, note: note.value.trim(), title: i.title || "" }, save, async () => box.remove());
        });
        box.append(lvl, note, save, btn("Cancel", "secondary-btn", () => box.remove()));
        cardEl.append(box);
      }));
    }
    cardEl.append(a);
  }

  // ---- B-573: goal + stop mode -----------------------------------------------------
  function renderGoal(host, p) {
    if (editing(host)) return;
    host.textContent = "";
    const s = p.spendSettings;
    if (!s) { host.append(node("p", "muted small", "Spending goal: waiting for the laptop (needs Shopper v4.74).")); return; }
    const row = node("div", "controls");
    const goal = node("input", "need-input need-num");
    goal.type = "number";
    goal.min = "0";
    goal.max = "20000";
    goal.step = "1";
    goal.value = String(s.goal || 0);
    const mode = node("select", "need-input");
    for (const [v, t] of [["asap", "Stop after the order it is placing"], ["finishLine", "Finish the current line"]]) { const o = node("option", null, t); o.value = v; if (v === s.goalStopMode) o.selected = true; mode.append(o); }
    const save = btn("Save goal", "primary-btn", () => run("spendSettingsSet", { goal: Number(goal.value) || 0, goalStopMode: mode.value }, save));
    row.append(node("span", "t-label", "Daily goal $"), goal, node("span", "t-label", "When met"), mode, save);
    host.append(row);
    if (s.goalSetAt) host.append(node("p", "muted small", `Goal set ${ctText(s.goalSetAt)}.`));
  }

  function render(p) {
    if (!p) return;
    expiry = p.houseExpiry || {};
    const inv = p.inventory;
    const rkey = JSON.stringify(p.refresh || null);
    for (const [id, where] of [["invRefresh", "inventory"], ["fbaRefresh", "fba"]]) {
      const host = $(id);
      if (host && host.dataset.key !== rkey) { host.dataset.key = rkey; refreshBar(host, p, where); }
    }
    const needs = $("needsSection");
    if (needs && !editing(needs)) {
      const key = JSON.stringify(p.needs || null);
      if (needs.dataset.key !== key) { needs.dataset.key = key; renderNeeds(needs, p.needs); }
    }
    const latest = $("latestSection");
    if (latest && !editing(latest)) {
      const key = JSON.stringify((inv && inv.arrivals && inv.arrivals.latest) || null) + "|" + latestHours;
      if (latest.dataset.key !== key) { latest.dataset.key = key; renderLatest(latest, inv); }
    }
    const goal = $("goalBox");
    if (goal) {
      const key = JSON.stringify(p.spendSettings || null);
      if (goal.dataset.key !== key) { goal.dataset.key = key; renderGoal(goal, p); }
    }
  }

  self.ShopperParity = Object.freeze({ render, decorateArrival, decorateProduct, decorateBuylistCard, noonIso, todayFor });
})();
