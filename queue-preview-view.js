// remote/queue-preview-view.js - B-1927 (v2.0.146): the approved buy lines on the phone's Run page BEFORE Start, with the
// controls the laptop's Buy Queue / Buylist pages have: move up / down (the buy order), quantity, Remove (off tonight's
// buy -> back to undecided on the Buylist), Skip today (a Target plan's part), Back to the ranked order.
// Data: Main's answer to the existing `preview` command (thinned by lib/remote-queue-preview.js on Main) - the phone prints it,
// it never works the queue out itself. Host: #queuePreviewHost. Text nodes only; nothing is kept in the phone's storage.
(function () {
  "use strict";
  // ---- shared tiny kit (same text in every *-actions-view.js; see test v20135-phone-buy-actions) ----
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const say = (t, bad) => { try { if (typeof toast === "function") toast(t, !!bad); } catch (e) { /* no toast */ } };
  const pl = () => { try { return typeof lastPayload !== "undefined" ? lastPayload : null; } catch (e) { return null; } };
  const labels = (o) => { try { if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, o); } catch (e) { /* labels are cosmetic */ } };
  const btnOf = (text, cls, fn) => { const b = el("button", cls || "mini-btn", text); b.type = "button"; b.addEventListener("click", () => fn(b)); return b; };
  const typing = (host) => { const a = document.activeElement; return !!(a && host && host.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")); };

  const OFFLINE_TEXT = "The computer isn't connected - the list shows when it is.";
  const ORDER_ACK_GRACE_MS = 15 * 1000; // B-1937
  const START_HOLD_MS = 2000; // B-1987 (v2.0.150): Start waits this long after other lines appeared by themselves
  const AUTO_GAP_MS = 20 * 1000, AUTO_WINDOW_MS = 10 * 60 * 1000, AUTO_MAX = 6, OPENED_STALE_MS = 60 * 1000;
  // opus review G4 (L3): the computer's order reason codes in plain words (buyqueue.js ORDER_REASON_TEXT, short).
  const ORDER_WHY = { regenerated: "the buy list was made again since you arranged it", "no-generation": "no finished buy list yet", version: "your saved order was from an older Shopper", shape: "your saved order could not be read" };
  const LIVE = new Set(["running", "paused", "collecting_urls", "aborting"]);
  const st = { res: null, loading: false, tried: false, failed: false, offline: false, failSig: null, msg: "", loadedAt: 0, autoTimes: [], seenVisible: false, sending: false, pendingOrder: null, moveGen: 0, reloadNext: false, orderAckAt: 0, heldAt: 0 };
  let host = null, drawnKey = "";

  const money = (n) => (typeof n === "number" && Number.isFinite(n) ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  const clock = (ms) => { try { return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
  const now = () => Date.now();
  const lines = () => (st.res && Array.isArray(st.res.lines) ? st.res.lines : []);
  const buyLines = () => lines().filter((l) => l.g === "buy");

  // One command through the quiet send (offline gate + 60 s take-back). -> { ok, result, reason }
  async function run(name, body) {
    const M = self.ShopperManualPrint;
    if (!M || typeof M.runCommand !== "function") return { ok: false, reason: OFFLINE_TEXT, offline: true };
    const out = await M.runCommand(name, body || {}, { followPick: true }); // B-1947: every command of this view goes where its list came from
    const res = out && out.result && typeof out.result === "object" ? out.result : null;
    if (!out || out.status === "offline" || out.status === "not sent") return { ok: false, reason: OFFLINE_TEXT, offline: true };
    if (out.status === "timeout") return { ok: false, reason: "The computer did not answer in 3 minutes." };
    if (out.status !== "done") return { ok: false, reason: String(out.reason || (res && (res.reason || res.error)) || "The computer refused.").slice(0, 200), result: res };
    if (res && res.ok === false) return { ok: false, reason: String(res.reason || res.error || "The computer refused.").slice(0, 200), result: res };
    return { ok: true, result: res };
  }
  const visible = () => {
    try {
      const pane = document.getElementById("runPane");
      if (pane && pane.hidden) return false;
      return !(document.visibilityState === "hidden");
    } catch (e) { return false; }
  };

  // Load the list. auto = not from a tap (counted against the throttle).
  async function refresh(o) {
    o = o || {};
    if (st.loading) { if (o.tapped) st.reloadNext = true; return; } // opus review G4: a tap / a refused move while a load is out loads once more after it
    if (!o.tapped) { st.autoTimes.push(now()); }
    st.loading = true; st.tried = true;
    const gen0 = st.moveGen;
    const sig0 = (pl() || {}).buylistSig || null;
    draw();
    let r;
    try { r = await run("preview", {}); } catch (e) { r = { ok: false, reason: "Not sent: " + ((e && e.message) || "no connection") }; }
    st.loading = false;
    st.loadedAt = now();
    const res = r.result;
    st.offline = !!r.offline;
    // opus review G4 (M1): an answer Main built before the phone's last move landed carries the OLD order - drawing it would undo
    // the move on screen (and the next arrow would send that old order). Keep the phone's order; load again once the move is saved.
    const movedSince = st.moveGen !== gen0 || st.sending || !!st.pendingOrder;
    if (r.ok && res && res.ok === true && res.thin && movedSince) { st.reloadNext = true; }
    else if (r.ok && res && res.ok === true && res.thin) {
      // B-1987 (v2.0.150): a load nobody tapped that put OTHER lines on the screen holds Start for a moment - a tap that was
      // already on its way would sign lines that only just appeared.
      const was = shownNow();
      st.res = res; st.failed = false; st.msg = ""; st.orderAckAt = now();
      if (!o.tapped && shownNow() !== was) st.heldAt = now();
    }
    else if (!r.ok && !(res && res.truncated && !res.thin)) { st.failed = true; st.msg = r.reason || "Could not read the buy lines."; }
    else if (res && res.truncated && !res.thin) { st.failed = true; st.msg = "Too long to show here - open the Buy Queue on the computer."; }
    else if (res && res.note === "no direct response") { st.failed = true; st.msg = "The computer is still building the list - tap Preview again."; }
    else { st.failed = true; st.msg = "The computer's answer had no buy lines - tap Preview again."; }
    if (st.failed) st.failSig = sig0;
    drawnKey = "";
    draw();
    if (st.reloadNext && !st.sending && !st.pendingOrder) { st.reloadNext = false; await refresh({ tapped: true }); }
  }

  function listStale(p) { return !!(st.res && p && p.buylistSig && st.res.listSig && p.buylistSig !== st.res.listSig); }
  // B-1937: the hand-made order was saved somewhere else (the laptop, Main's page) since this list was read.
  function orderStale(p) {
    if (!st.res || !p || typeof p.buyOrderAt !== "number" || typeof st.res.orderAt !== "number") return false;
    if (p.buyOrderAt === st.res.orderAt) return false;
    if (st.sending || st.pendingOrder) return false;
    if (now() - st.orderAckAt < ORDER_ACK_GRACE_MS) return false;
    return true;
  }
  // B-1990 (v2.0.150): the Target plans changed (Skip today, Don't skip, Cancel, a booked order - on any screen) after this list was built.
  // Both numbers are plan stamps (lib/target-plans-at.js); only a NEWER published one counts, so the phone's own Skip today (its list
  // already carries the new stamp) never loads twice.
  function plansStale(p) { return !!(st.res && p && typeof p.targetPlansAt === "number" && typeof st.res.plansAt === "number" && p.targetPlansAt > st.res.plansAt); }
  // B-1947 (v2.0.148): while the Run-on pick answers for a silent Main, the Main's last update is no reference for this list.
  const viaPick = () => { try { const R = self.ShopperRemote; return !!(R && typeof R.followsPick === "function" && R.followsPick()); } catch (e) { return false; } };
  // B-1961 (v2.0.149): ... the PICK's own last update is (remote/pick-list-ref.js): null until the pick has published after this
  // list was built (and after this phone's last saved move) - every time here is the pick's own clock.
  function refOf(p) {
    if (!viaPick()) return p;
    try {
      const P = self.ShopperPickListRef, R = self.ShopperRemote;
      if (!P || !R || typeof R.pickDevice !== "function" || !st.res) return null;
      return P.refFor(Math.max(Number(st.res.at) || 0, Number(st.res.orderAt) || 0), R.pickDevice(), now());
    } catch (e) { return null; }
  }
  function pickRefTick(p) {
    try {
      const P = self.ShopperPickListRef;
      if (P && st.res && !LIVE.has(p.run && p.run.status) && viaPick() && visible()) P.tick({ now: now });
    } catch (e) { /* a tap still loads the list */ }
  }
  function sigStale(p) { const r = refOf(p); return !!r && (listStale(r) || orderStale(r) || plansStale(r)); }

  // Automatic loads: never on a timer; only when the Run page is on screen.
  function maybeAuto(p) {
    const seen = visible();
    const justOpened = seen && !st.seenVisible;
    st.seenVisible = seen;
    if (!seen || st.loading) return;
    const t = now();
    st.autoTimes = st.autoTimes.filter((x) => t - x < AUTO_WINDOW_MS);
    if (st.autoTimes.length >= AUTO_MAX) return;
    if (st.autoTimes.length && t - st.autoTimes[st.autoTimes.length - 1] < AUTO_GAP_MS) return;
    const stale = sigStale(p);
    if (!st.tried) { refresh({}); return; }
    // opus review G4 (M2): after a failed / refused answer only a tap, a new signature (also when no list ever loaded) or - when it
    // failed because the computer was not connected - the computer being back ("the list shows when it is").
    const sigMoved = !st.res && st.failSig && p && p.buylistSig && p.buylistSig !== st.failSig;
    const back = st.offline && (() => { try { const R = self.ShopperRemote; return !!(R && typeof R.laptopOnline === "function" && R.laptopOnline("preview")); } catch (e) { return false; } })();
    if (st.failed && !stale && !sigMoved && !back) return;
    if (st.failed && (sigMoved || back)) { refresh({}); return; }
    if (stale) { refresh({}); return; }
    if (justOpened && st.loadedAt && t - st.loadedAt > OPENED_STALE_MS) refresh({});
  }

  // ---- commands ----
  async function sendOrder() {
    if (st.sending) return;
    st.sending = true;
    try {
      while (st.pendingOrder) {
        const order = st.pendingOrder; st.pendingOrder = null;
        const r = await run("queueSetOrder", { order });
        if (!r.ok) { say(r.reason, true); st.pendingOrder = null; st.reloadNext = true; break; }
        // B-1937: the phone's own move is not "someone else's change" - take Main's save time and show "Your order" at once.
        if (st.res && r.result && r.result.order && Number(r.result.order.savedAt) > 0) {
          st.res.orderAt = Number(r.result.order.savedAt);
          st.res.order = Object.assign({}, st.res.order, { source: "manual", reason: "ok" });
          st.orderAckAt = now(); drawnKey = ""; draw();
        }
      }
    } finally { st.sending = false; }
    // A refusal, or a list answer that came back while the move was out (M1): read Main's list now.
    if (st.reloadNext && !st.loading) { st.reloadNext = false; await refresh({ tapped: true }); }
  }
  // B-1987: the signature of the lines on this screen right now ("" = none).
  function shownNow() {
    if (!st.res || !st.res.thin) return "";
    const R = self.ShopperRunLib;
    const live = !st.res.truncated && R && typeof R.shownSigOf === "function" && typeof R.thinGroups === "function";
    return String((live ? R.shownSigOf(R.thinGroups(lines())) : st.res.shownSig) || "");
  }
  // B-1936: what Start sends - the signature of the lines ON THIS SCREEN (which, how many, in which order) and of the list they came
  // from. null = no buy lines on screen; { busy: true } = a move is still being saved on the computer.
  function startSigs() {
    if (!st.res || !st.res.thin) return null;
    if (st.sending || st.pendingOrder) return { busy: true };
    if (st.heldAt && now() - st.heldAt < START_HOLD_MS) return { fresh: true }; // B-1987
    const R = self.ShopperRunLib;
    const live = !st.res.truncated && R && typeof R.shownSigOf === "function" && typeof R.thinGroups === "function";
    const shownSig = live ? R.shownSigOf(R.thinGroups(lines())) : (st.res.shownSig || null);
    return shownSig ? { listSig: st.res.listSig || null, shownSig } : null;
  }
  const isPlanPart = (l) => !!(l && l.plan === "part");
  function move(asin, dir) {
    if (!st.res || st.res.truncated) return;
    const R = self.ShopperRunLib;
    if (!R || typeof R.moveKeepingPlanParts !== "function") return;
    // opus review H2 (M1): a Target plan's part is bought first (the computer puts the parts on top after applying the order) -
    // only the other lines move, so the screen is the order the run buys and Start's check (B-1936) matches it.
    // (opus review G4 L1 kept: the lines themselves move, so a doubled ASIN keeps both lines.)
    const buy = buyLines();
    const i = buy.findIndex((l) => l.asin === asin && !isPlanPart(l));
    if (i < 0) return;
    const m = R.moveKeepingPlanParts(buy, asin, i + dir, isPlanPart);
    if (!m) return;
    const rest = lines().filter((l) => l.g !== "buy");
    st.res.lines = m.lines.concat(rest);
    st.moveGen++;
    st.pendingOrder = m.order;
    drawnKey = ""; draw();
    sendOrder();
  }
  async function after(r, okText) {
    if (!r.ok) { say(r.reason, true); return; }
    const note = r.result && (r.result.clampNote || r.result.note);
    if (note && r.result.note !== "no direct response") say(String(note).slice(0, 200)); else if (okText) say(okText);
    await refresh({ tapped: true });
  }
  async function resetOrder(b) { const r = await withBusy(b, () => run("queueResetOrder", {})); await after(r, "Back to the ranked order."); }
  async function remove(l, b) {
    if (!window.confirm("Take " + (l.title || l.asin) + " off tonight's buy? It goes back to undecided on the Buylist.")) return;
    const r = await withBusy(b, () => run("buylistAction", { asin: l.asin, action: "unapprove" }));
    await after(r, "Taken off tonight's buy.");
  }
  async function skipToday(l, b) {
    if (!window.confirm("Skip today's part of " + (l.title || l.asin) + "? The Target plan carries on tomorrow.")) return;
    const r = await withBusy(b, () => run("targetPlanSkipToday", { planId: l.planId }));
    await after(r, "Skipped today.");
  }
  async function setQty(l, input, b) {
    const raw = String(input.value == null ? "" : input.value).trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !(n >= 1)) { say("Type a whole number of 1 or more.", true); return; }
    const r = await withBusy(b, () => run("buylistAction", { asin: l.asin, action: "conditional", qty: n }));
    await after(r, "Quantity set to " + n + ".");
  }
  async function withBusy(b, fn) {
    const was = b ? b.textContent : "";
    if (b) { b.disabled = true; b.textContent = "Working..."; }
    try { return await fn(); } finally { if (b) { b.disabled = false; b.textContent = was; } }
  }

  // ---- drawing ----
  function row(l, idx, n, canArrows) {
    const r = el("div", "line qpv-line");
    r.appendChild(el("div", "l-title", l.title || l.asin));
    const bits = [l.asin];
    if (l.retailer) bits.push(l.retailer);
    if (l.qty != null) bits.push(l.qty + " u" + (l.unitCost != null ? " x " + money(l.unitCost) : "") + (l.expectedCost != null ? " = " + money(l.expectedCost) : ""));
    if (l.multipackSize && l.multipackSize > 1) bits.push("pack of " + l.multipackSize);
    if (l.prepCenter) bits.push("prep center");
    if (l.setParts) bits.push(l.setParts + " listings");
    r.appendChild(el("div", "l-meta", bits.join(" · ")));
    const warn = [];
    if (!l.hasValidCost) warn.push("No cost on file");
    if (!l.sourceUrl) warn.push("No source URL yet - Shopper asks at Start");
    if (l.planNote) warn.push(l.planNote);
    if (l.bought != null && l.wanted != null) warn.push(l.bought + " of " + l.wanted + " bought today");
    warn.forEach((w) => r.appendChild(el("div", "qpv-warn", w)));
    const c = l.can || {};
    const acts = el("div", "l-actions");
    if (c.move && canArrows) {
      const mv = el("span", "l-move");
      const up = btnOf("↑", "mini-btn qpv-btn", () => move(l.asin, -1)); up.setAttribute("aria-label", "Move up");
      const dn = btnOf("↓", "mini-btn qpv-btn", () => move(l.asin, 1)); dn.setAttribute("aria-label", "Move down");
      if (idx === 0) up.disabled = true;
      if (idx === n - 1) dn.disabled = true;
      mv.append(up, dn); acts.appendChild(mv);
    }
    if (c.qty) {
      const q = el("input", "qty-input"); q.type = "text"; q.inputMode = "numeric"; q.value = String(l.qty == null ? "" : l.qty);
      q.setAttribute("aria-label", "Quantity");
      acts.append(q, btnOf("Set", "mini-btn qpv-btn", (b) => setQty(l, q, b)));
    }
    if (c.remove) acts.appendChild(btnOf("Remove", "mini-btn qpv-btn danger-btn", (b) => remove(l, b)));
    if (c.skipToday) acts.appendChild(btnOf("Skip today", "mini-btn qpv-btn", (b) => skipToday(l, b)));
    if (acts.children.length) r.appendChild(acts);
    return r;
  }
  function groupBox(box, title, arr, canArrows) {
    if (!arr.length) return;
    box.appendChild(el("div", "l-group", title));
    const wrap = el("div", "lines");
    // opus review H2 (M1): the Target plan parts sit on top and do not move - the first other line has no "up".
    const lead = arr.filter(isPlanPart).length;
    arr.forEach((l, i) => wrap.appendChild(row(l, isPlanPart(l) ? i : i - lead, arr.length - lead, canArrows)));
    box.appendChild(wrap);
  }

  function draw() {
    host = host || document.getElementById("queuePreviewHost");
    if (!host) return;
    const p = pl() || {};
    const status = p.run && p.run.status;
    if (LIVE.has(status)) { if (!host.hidden) { host.hidden = true; host.textContent = ""; drawnKey = ""; } return; }
    host.hidden = false;
    const stale = sigStale(p);
    const key = JSON.stringify([st.res, st.loading, st.failed, st.msg, stale, st.tried]);
    if (key === drawnKey || typing(host)) return;
    drawnKey = key;
    host.textContent = "";
    const box = el("div", "section qpv-box" + (stale || st.loading ? " qpv-stale" : ""));
    const res = st.res;
    if (res) {
      const head = el("div", "qpv-head");
      const total = (res.totals && res.totals.buy || 0) + (res.totals && res.totals.elsewhere || 0) + (res.totals && res.totals.sets || 0);
      head.appendChild(el("h3", "", "Buy lines (" + lines().length + ") · " + money(total)));
      head.appendChild(el("span", "muted small", "as of " + clock(res.at)));
      box.appendChild(head);
      if (res.spendTargetNote) box.appendChild(el("p", "muted small", res.spendTargetNote));
      const ord = el("div", "l-actions qpv-order");
      const hand = res.order && res.order.source === "manual";
      const why = res.order && ORDER_WHY[res.order.reason];
      ord.appendChild(el("span", "muted small", hand ? "Your order" + (res.order.unnamed > 0 ? " - " + res.order.unnamed + " line(s) approved since sit at the bottom" : "") : "Ranked order" + (why ? " - " + why : "")));
      if (hand) ord.appendChild(btnOf("Back to the ranked order", "mini-btn qpv-btn", resetOrder));
      box.appendChild(ord);
      if (res.boughtToday && res.boughtToday.skipped) box.appendChild(el("p", "muted small", res.boughtToday.skipped + " left out - bought today"));
      if (stale) box.appendChild(el("p", "qpv-warn", listStale(refOf(p)) ? "The buy list changed - updating…" : orderStale(refOf(p)) ? "The buy order changed - updating…" : "A Target plan changed - updating…"));
      const cut = !!res.truncated;
      if (cut) {
        const total2 = res.counts ? (res.counts.buy || 0) + (res.counts.elsewhere || 0) + (res.counts.sets || 0) : 0;
        box.appendChild(el("p", "qpv-warn", "showing " + lines().length + " of " + total2 + " - too many lines to reorder here - use the computer."));
      }
      if (!lines().length) {
        box.appendChild(el("p", "muted", "No approved lines - approve lines on the Buylist page."));
        box.appendChild(btnOf("Open the Buylist", "mini-btn qpv-btn", () => { const b = document.getElementById("tabBuylist"); if (b && typeof b.click === "function") b.click(); }));
      }
      groupBox(box, "Buys in this order", buyLines(), !cut);
      groupBox(box, "Buy elsewhere, then confirm", lines().filter((l) => l.g === "elsewhere"), false);
      groupBox(box, "Sets - several listings", lines().filter((l) => l.g === "set"), false);
    }
    if (st.loading && !res) box.appendChild(el("p", "muted", "Loading the buy lines…"));
    if (st.failed && st.msg) box.appendChild(el("p", "qpv-warn", st.msg));
    if (!res && !st.loading && !st.failed && !st.tried) box.appendChild(el("p", "muted small", "Tap Preview to see the approved buy lines."));
    host.appendChild(box);
  }

  function tick() { const p = pl(); if (p) { pickRefTick(p); draw(); if (!LIVE.has(p.run && p.run.status)) maybeAuto(p); } }
  labels({ preview: "Refresh preview" });
  function start() { tick(); setInterval(tick, 2000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperQueuePreview = Object.freeze({ refresh, buyLines, draw, tick, startSigs, _state: st });
})();
