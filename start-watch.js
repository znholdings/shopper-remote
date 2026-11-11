// remote/start-watch.js - B-1955 (v2.0.149): a Start / Resume saved the computer has not confirmed is never read as started.
// Classic script (index.html loads it before app.js). Text only; it reads one shared row and sends nothing.
//   1. A computer older than v2.0.149 answers a slow Start with its 30 s note "no direct response" (status "done"): said here,
//      not shown as nothing.
//   2. A Start HANDED to the other computer is answered "pending" after 25 s (the Main's phone loop does not wait the minutes a
//      hand-over can take). Its real outcome is written by both computers to the hand-over row (shared row
//      "buystart:<computer id>", lib/buy-start-handover.js: pending -> accepted -> started | refused, or canceled / expired).
//      This follows that row for up to 5 minutes and says how it ended; a refusal re-reads the buy lines.
(function (root) {
  "use strict";
  const POLL_MS = 5000;
  const MAX_MS = 5 * 60 * 1000;
  const CLOCK_SLACK_MS = 60 * 1000;
  const ROW = "shared:buystart:";
  const okId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ""));
  const txt = (v, n) => String(v == null ? "" : v).slice(0, n);
  const okReq = (id) => /^[A-Za-z0-9_-]{1,60}$/.test(String(id || "")); // B-1988 (v2.0.150)

  // A finished (status "done") start / resumeSaved answer -> { say, watch }
  function afterDoneVerdict(result) {
    const r = result && typeof result === "object" ? result : {};
    if (r.note === "no direct response") return { say: "the computer has not confirmed it yet - look at the Run page before pressing it again.", watch: false };
    if (r.pending === true && r.started !== true) return { say: "", watch: true };
    return { say: "", watch: false };
  }
  // Is this row value the request this phone's Start made? (from the paired computer, not older than the tap)
  function isMine(value, fromId, sentAt) {
    const v = value && typeof value === "object" ? value : null;
    if (!v || !v.reqId) return false;
    if (fromId && String(v.fromId || "") !== String(fromId)) return false;
    return Number(v.at) >= Number(sentAt) - CLOCK_SLACK_MS;
  }
  // The row's value for the followed request -> null (keep waiting) | { text, bad, refresh }
  function rowVerdict(value, mine, name) {
    const v = value && typeof value === "object" ? value : null;
    if (!v) return null;
    if (mine && v.reqId !== mine) return { text: "", bad: false, refresh: false }; // another Start took the row: nothing to say
    const who = txt(name || "other", 60);
    const res = v.result && typeof v.result === "object" ? v.result : {};
    if (v.status === "started") return { text: "Started on the " + who + " computer.", bad: false, refresh: false };
    if (v.status === "refused") return { text: "The " + who + " computer did not start it: " + txt(res.reason || "no reason given", 300), bad: true, refresh: true };
    if (v.status === "canceled" || v.status === "expired") return { text: "The " + who + " computer did not pick it up - nothing was started.", bad: true, refresh: false };
    return null;
  }

  let current = null; // one hand-over is followed at a time
  function watch(o) {
    o = o || {};
    const d = o.deps || {};
    const R = d.remote || root.ShopperRemote;
    const timer = d.setTimer || ((f, ms) => setTimeout(f, ms));
    const now = d.now || (() => Date.now());
    if (!okId(o.targetId) || !R || typeof R.sb !== "function") return false;
    const my = { id: String(o.targetId), mine: "", want: okReq(o.reqId) ? String(o.reqId) : "", since: now(), stop: false }; // B-1988: want = the request the computer named
    if (current) current.stop = true;
    current = my;
    const step = async () => {
      if (my.stop) return;
      if (now() - my.since > MAX_MS) { my.stop = true; return; }
      let value = null;
      try {
        const res = await R.sb("device_state?device_id=eq." + encodeURIComponent(ROW + my.id) + "&select=payload&limit=1");
        const row = res && res.ok && Array.isArray(res.json) ? res.json[0] : null;
        value = row && row.payload && typeof row.payload === "object" ? row.payload.value : null;
      } catch (e) { value = null; }
      if (my.stop) return;
      // B-1988: the computer named the request -> only that one is followed (an older request still in the row is waited out);
      // a computer older than v2.0.150 names none -> matched by sender + time, as before.
      if (!my.mine && (my.want ? !!value && String(value.reqId || "") === my.want : isMine(value, o.fromId, o.sentAt))) my.mine = String(value.reqId);
      const v = my.mine ? rowVerdict(value, my.mine, o.name) : null;
      if (v) {
        my.stop = true;
        try { if (v.text && typeof R.toast === "function") R.toast(v.text, v.bad); } catch (e) { /* a toast only */ }
        try { if (v.refresh && root.ShopperQueuePreview && typeof root.ShopperQueuePreview.refresh === "function") root.ShopperQueuePreview.refresh({ tapped: true }); } catch (e) { /* a tap still loads it */ }
        return;
      }
      timer(step, POLL_MS);
    };
    timer(step, POLL_MS);
    return true;
  }
  // remote/app.js pollCommandOutcomes, for a start / resumeSaved row that came back "done".
  function afterDone(o) {
    o = o || {};
    const R = (o.deps && o.deps.remote) || root.ShopperRemote;
    const v = afterDoneVerdict(o.result);
    try { if (v.say && R && typeof R.toast === "function") R.toast(txt(o.label || "Start", 60) + ": " + v.say, true); } catch (e) { /* a toast only */ }
    // B-1988: the computer the Start was handed to is in the answer (pendingId) - a Start sent with no Run-on pick is followed too.
    if (v.watch) return watch({ targetId: o.targetId || (o.result && o.result.pendingId) || "", reqId: o.result && o.result.reqId, name: o.result && o.result.pendingOn, fromId: o.fromId, sentAt: o.sentAt, deps: o.deps });
    return false;
  }
  root.ShopperStartWatch = { afterDone, afterDoneVerdict, rowVerdict, isMine, watch, POLL_MS, MAX_MS };
})(typeof globalThis !== "undefined" ? globalThis : this);
