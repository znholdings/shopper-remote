// remote/daily-view.js - B-1257 (v2.0.73): "The Daily" on the phone (Home).
//
// Zach 10/19: The Daily on the phone too - a button on the Home tab. The SAME
// steps as the laptop page (dashboard/daily.js): the rules are
// self.ShopperGlance (remote/dash-lib.js = lib/dashboard-todo.js +
// lib/daily-steps.js, the laptop's own code). The phone is a mirror: the
// steps come from the Do next rows app.js already builds, the state from the
// laptop's payload (dashboard.extra.daily - lib/daily-store.js dailyForRemote,
// which also says which listings are new), and every tap is ONE remote command,
// `dailyAction` -> the laptop's SHOPPER_DAILY_ACTION (lib/remote-protocol.js
// whitelist). Until the laptop's next payload carries a tap, the phone shows
// it applied (the same reducer, applyDailyAction) - for 3 minutes at most.
// Mark done / Dismiss on notifications stay on the laptop (read-only here).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const PENDING_MS = 3 * 60 * 1000;
  let ctx = null; // the last update()
  let open = false;
  let i = 0;
  let steps = null; // this run's step list (fixed while open)
  let doneToday = [];
  const session = new Map(); // step id -> "reviewed" | "done" | "ignored"
  const showAll = new Set();
  const pending = []; // [{ msg, at }]

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function button(label, cls, fn) {
    const b = node("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // The payload's state with this phone's not-yet-confirmed taps on top.
  function effectiveState() {
    const G = self.ShopperGlance;
    const d = ctx && ctx.daily;
    let st = G.normalizeDailyState(d ? { steps: d.steps } : null);
    const now = Date.now();
    for (let k = pending.length - 1; k >= 0; k--) if (now - pending[k].at > PENDING_MS) pending.splice(k, 1);
    for (const p of pending) {
      const r = G.applyDailyAction(st, p.msg, p.at);
      if (r.ok) st = r.state;
    }
    return st;
  }

  function send(msg, quiet) {
    pending.push({ msg, at: Date.now() });
    const R = self.ShopperRemote;
    if (R) (quiet ? R.sendQuiet : R.sendCommand)("dailyAction", msg);
    if (ctx && ctx.rerender) ctx.rerender();
  }

  // Called by app.js renderDashboard on every payload. rows = every Do next row.
  // -> { rows (without the ignored ones, re-ranked), hidden }
  function update(c) {
    ctx = c;
    const G = self.ShopperGlance;
    const btn = $("dashDailyBtn");
    if (!G || !G.filterIgnoredRows || !c) {
      if (btn) btn.disabled = true;
      return { rows: (c && c.rows) || [], hidden: [] };
    }
    if (btn) btn.disabled = false;
    const st = effectiveState();
    const out = G.filterIgnoredRows(c.rows, st, Date.now());
    const line = $("dashDoHidden");
    if (line) {
      line.textContent = "";
      line.hidden = !out.hidden.length;
      if (out.hidden.length) {
        line.appendChild(node("span", null, out.hidden.length + " hidden by The Daily: " + out.hidden.map((h) => h.label).join(", ") + ". "));
        line.appendChild(button("Undo in The Daily", "linkish daily-undo-link", () => show(true)));
      }
    }
    if (open) draw();
    return out;
  }

  function show(toSummary) {
    if (!ctx) return;
    const G = self.ShopperGlance;
    const m = G.buildDailySteps(ctx.rows, effectiveState(), Date.now(), { fresh: (ctx.daily && ctx.daily.fresh) || {} });
    steps = m.steps;
    doneToday = m.doneToday;
    session.clear();
    showAll.clear();
    i = toSummary ? steps.length : 0;
    open = true;
    const pane = $("dashboardPane");
    if (pane) pane.classList.add("daily-on");
    $("dailyPane").hidden = false;
    draw();
    try { window.scrollTo(0, 0); } catch (e) { /* fine */ }
  }
  function close() {
    open = false;
    const pane = $("dashboardPane");
    if (pane) pane.classList.remove("daily-on");
    $("dailyPane").hidden = true;
  }

  // ---- drawing ---------------------------------------------------------------
  function overview() {
    const G = self.ShopperGlance;
    const ov = G.dailyOverview(ctx.overviewInput || {});
    const grid = node("div", "dy-ov-grid");
    for (const sec of ov.sections) {
      const box = node("div", "dy-ov-box dy-ov-" + sec.id);
      box.appendChild(node("b", "dy-ov-title", sec.title));
      for (const r of sec.rows) {
        const line = node("div", "dy-ov-row dy-dir-" + (r.dir || "flat"));
        line.appendChild(node("span", "dy-ov-label", r.label));
        line.appendChild(node("span", "dy-ov-value", r.value));
        if (r.sub) line.appendChild(node("span", "dy-ov-sub", r.sub));
        box.appendChild(line);
      }
      if (sec.note) box.appendChild(node("p", "dy-ov-note muted small", sec.note));
      grid.appendChild(box);
    }
    return grid;
  }

  function listing(s) {
    const G = self.ShopperGlance;
    const box = node("div", "dy-listing");
    const all = showAll.has(s.id);
    box.appendChild(node("p", "dy-fresh-line muted", s.reviewedAt
      ? s.freshCount + " new since you reviewed this " + G.dailyWhenText(s.reviewedAt) + (s.allCount ? " · " + s.allCount + " in all" : "") + "."
      : "First review - all " + (s.allCount || s.items.length) + " listed."));
    const list = all ? s.items : s.freshItems;
    if (list.length) {
      const ul = node("ul", "dy-lines");
      for (const it of list) ul.appendChild(node("li", "dy-line", it.text || it.key));
      box.appendChild(ul);
    } else box.appendChild(node("p", "muted", "Nothing new."));
    const more = (all ? s.allCount : s.freshCount) - list.length;
    if (more > 0) box.appendChild(node("p", "muted small", "+" + more + " more - the full list is on the laptop."));
    if (s.reviewedAt && s.items.length > s.freshItems.length) {
      box.appendChild(button(all ? "Show only the new ones (" + s.freshItems.length + ")" : "Show all " + s.items.length, "linkish dy-showall", () => {
        if (all) showAll.delete(s.id); else showAll.add(s.id);
        draw();
      }));
    }
    return box;
  }

  function stepNode(s) {
    const wrap = node("div", "dy-step");
    const head = node("div", "dy-step-head");
    head.appendChild(node("span", "dy-step-n muted small", "Step " + (i + 1) + " of " + steps.length));
    head.appendChild(node("h3", "dy-step-title", s.label));
    const st = session.get(s.id);
    if (st) head.appendChild(node("span", "count dy-step-state", st === "done" ? "Done for today" : st === "ignored" ? "Ignored" : "Reviewed"));
    wrap.appendChild(head);
    if (s.kind === "overview") { wrap.appendChild(overview()); return wrap; }
    const r = s.row;
    wrap.classList.add("dy-sev-" + r.severity);
    wrap.appendChild(node("p", "dy-row-title", r.title));
    if (s.kind === "listing") wrap.appendChild(listing(s));
    else {
      if (r.detail) wrap.appendChild(node("p", "dy-detail muted", r.detail));
      for (const n of r.notifs || []) {
        const c = node("div", "line dash-notif sev-" + n.severity);
        c.appendChild(node("b", null, n.title));
        if (n.detail) c.appendChild(node("div", "l-meta", n.detail));
        wrap.appendChild(c);
      }
      if (r.notifs && r.notifs.length) wrap.appendChild(node("p", "muted small", "Mark done / Dismiss are on the laptop."));
    }
    if (r.go && r.go.target && r.go.target !== "expand" && ctx.go) {
      const label = r.go.target === "runreviews" ? "Run tab" : r.go.label;
      wrap.appendChild(button("Open " + label, "secondary-btn dy-go-btn", () => { close(); ctx.go(r.go.target); }));
    }
    return wrap;
  }

  function summary() {
    const G = self.ShopperGlance;
    const wrap = node("div", "dy-step dy-summary");
    wrap.appendChild(node("h3", "dy-step-title", "Summary"));
    const c = { reviewed: 0, done: 0, ignored: 0 };
    for (const v of session.values()) c[v]++;
    const left = steps.filter((s) => !session.has(s.id)).length;
    wrap.appendChild(node("p", null, c.reviewed + " reviewed · " + c.done + " done for today · " + c.ignored + " ignored" + (left ? " · " + left + " not looked at yet" : "") + "."));
    if (doneToday.length) {
      wrap.appendChild(node("b", "dy-sum-head", "Done for today earlier"));
      for (const s of doneToday) {
        const li = node("div", "dy-sum-item");
        li.appendChild(node("span", null, s.label));
        li.appendChild(button("Review again", "linkish", () => {
          send({ action: "undone", step: s.id });
          doneToday = doneToday.filter((x) => x.id !== s.id);
          steps.push(s);
          draw();
        }));
        wrap.appendChild(li);
      }
    }
    wrap.appendChild(node("b", "dy-sum-head", "Ignored"));
    const ign = G.dailyIgnoredList(effectiveState(), Date.now());
    if (!ign.length) wrap.appendChild(node("p", "muted", "Nothing is ignored."));
    for (const g of ign) {
      const li = node("div", "dy-sum-item dy-ignored");
      li.dataset.step = g.id;
      li.appendChild(node("span", null, g.label + " - " + g.text));
      li.appendChild(button("Undo", "secondary-btn dy-undo", () => {
        send({ action: "unignore", step: g.id });
        if (session.get(g.id) === "ignored") session.delete(g.id);
        show(true);
      }));
      wrap.appendChild(li);
    }
    wrap.appendChild(button("Back to Home", "primary-btn dy-home", close));
    return wrap;
  }

  function controls(s) {
    const G = self.ShopperGlance;
    const box = node("div", "dy-controls");
    const nav = node("div", "dy-nav");
    const back = button("Back", "secondary-btn", () => { if (i > 0) { i--; draw(); } });
    back.disabled = i === 0;
    nav.appendChild(back);
    nav.appendChild(button("Done for today", "secondary-btn dy-done", () => {
      send({ action: "done", step: s.id, asOf: ctx.daily && ctx.daily.at ? ctx.daily.at : undefined });
      session.set(s.id, "done");
      i++;
      draw();
    }));
    nav.appendChild(button(i === steps.length - 1 ? "Finish" : "Next", "primary-btn dy-next", () => {
      send({ action: "review", step: s.id, asOf: ctx.daily && ctx.daily.at ? ctx.daily.at : undefined }, true);
      if (!session.has(s.id)) session.set(s.id, "reviewed");
      i++;
      draw();
    }));
    box.appendChild(nav);
    const ig = node("div", "dy-ignore");
    const lab = node("label", "dy-ignore-label", "Ignore for");
    const sel = node("select", "dy-ignore-select");
    sel.id = "dyIgnoreForPhone";
    lab.htmlFor = sel.id;
    const o0 = node("option", null, "Pick...");
    o0.value = "";
    sel.appendChild(o0);
    for (const ch of G.DAILY_IGNORE_CHOICES) {
      const o = node("option", null, ch.label);
      o.value = ch.key;
      sel.appendChild(o);
    }
    const go = button("Ignore", "secondary-btn dy-ignore-btn", () => {
      if (!sel.value) return;
      send({ action: "ignore", step: s.id, choice: sel.value });
      session.set(s.id, "ignored");
      i++;
      draw();
    });
    go.disabled = true;
    sel.addEventListener("change", () => { go.disabled = !sel.value; });
    ig.appendChild(lab);
    ig.appendChild(sel);
    ig.appendChild(go);
    box.appendChild(ig);
    return box;
  }

  function draw() {
    const host = $("dailyPane");
    if (!host || !steps) return;
    if (i > steps.length) i = steps.length;
    host.textContent = "";
    const top = node("div", "dy-top");
    top.appendChild(button("‹ Home", "linkish dy-close", close));
    top.appendChild(node("b", "dy-top-title", "The Daily"));
    host.appendChild(top);
    const strip = node("div", "dy-steps");
    steps.forEach((s, k) => {
      const st = session.get(s.id);
      const chip = button(k + 1 + ". " + s.label, "dy-chip" + (k === i ? " dy-chip-on" : "") + (st ? " dy-chip-" + st : ""), () => { i = k; draw(); });
      strip.appendChild(chip);
    });
    strip.appendChild(button("Summary", "dy-chip" + (i >= steps.length ? " dy-chip-on" : ""), () => { i = steps.length; draw(); }));
    host.appendChild(strip);
    const card = node("div", "section dy-card");
    if (i >= steps.length) card.appendChild(summary());
    else {
      card.appendChild(stepNode(steps[i]));
      card.appendChild(controls(steps[i]));
    }
    host.appendChild(card);
  }

  function wire() {
    const b = $("dashDailyBtn");
    if (b) b.addEventListener("click", () => show(false));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  self.ShopperDailyView = Object.freeze({ update, show, close, isOpen: () => open });
})();
