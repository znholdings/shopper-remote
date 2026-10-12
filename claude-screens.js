// remote/claude-screens.js - B-1058 / B-1059 (v2.0.53): the Claude box at the
// top of the phone's FBA and Cash tabs - the laptop's daily summary, "Write
// again" and Ask Claude.
//
// Owns no rules. The box is the laptop pages' own code (claude-screen-lib.js
// = lib/claude-screen-view.js, wrapped unchanged); the summary, the answers
// and what is left today come in the payload (payload.claudeScreens, built by
// the laptop - lib/claude-screen-store.js). A question or "Write again" is a
// command to the laptop (screenAsk / screenSummaryWrite): the laptop runs the
// call, caps it and logs it, and the result arrives in the next payload.
// Laptop not heard from -> the box says so and sends nothing.
(function () {
  "use strict";
  const V = self.ShopperClaudeView;
  const R = () => self.ShopperRemote || { sendCommand: async () => null, waitFor: async () => "not sent", commandRow: async () => null, cancelPending: async () => false };
  const HOSTS = { fba: "fbaClaude", cash: "cfmClaude" };
  const panels = {};
  let last = null; // { all, offline }

  // v2.0.53 review: the laptop refuses screenAsk / screenSummaryWrite older
  // than 50 s (lib/remote-protocol.js maxAgeMs), far inside the phone's 5-minute
  // wait (app.js COMMAND_TIMEOUT_MS). At the wait's end the phone first takes
  // the command back (pending -> cancelled, only while still pending); only a
  // command taken back (or still pending, so past the laptop's 50 s) is called
  // "Nothing was asked". One the laptop already took is still running.
  const NOT_ASKED_TEXT = "The laptop didn't pick this up in 5 minutes - it may be off or asleep. Nothing was asked.";
  const STILL_RUNNING_TEXT = "The laptop picked this up late and is still on it - it shows here when done.";

  function why(status, row) {
    if (status === "timeout") return NOT_ASKED_TEXT;
    if (status === "not sent") return "Could not send it to the laptop.";
    const reason = row && (row.reason || (row.result && row.result.error));
    return reason ? String(reason) : `The laptop said ${status}.`;
  }

  async function readRow(id) {
    try { return R().commandRow ? await R().commandRow(id) : null; } catch (e) { return null; }
  }

  async function run(screen, name, payload, sentText) {
    if (!last || last.offline) return { ok: false, error: V.CSX_OFFLINE_TEXT };
    const p = panels[screen];
    const id = await R().sendCommand(name, payload);
    if (!id) return { ok: false, error: "Could not send it to the laptop." };
    if (p) p.say(sentText);
    const status = await R().waitFor(id);
    if (status === "timeout") {
      let took = false;
      try { took = R().cancelPending ? !!(await R().cancelPending(id, "the laptop did not pick it up within 5 minutes - not run")) : false; } catch (e) { took = false; }
      if (took) return { ok: false, error: NOT_ASKED_TEXT };
      const now = await readRow(id);
      const st = now && now.status;
      if (st === "done") { if (p) p.say(""); return { ok: true }; }
      if (st === "failed" || st === "rejected") return { ok: false, error: why(st, now) };
      if (st === "pending" || st === "cancelled") return { ok: false, error: NOT_ASKED_TEXT };
      return { ok: false, error: STILL_RUNNING_TEXT };
    }
    if (status === "done") { if (p) p.say(""); return { ok: true }; }
    const row = await readRow(id);
    return { ok: false, error: why(status, row) };
  }

  function ensure(screen) {
    if (panels[screen]) return panels[screen];
    const host = document.getElementById(HOSTS[screen]);
    if (!host || !V) return null;
    const panel = V.createClaudePanel(document, {
      onAgain: () => run(screen, "screenSummaryWrite", { screen }, "Asked the laptop to write it again..."),
      onAsk: (question) => {
        const id = "ph_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
        return run(screen, "screenAsk", { screen, question, id }, "Sent to the laptop - Claude's answer shows below when it is ready...");
      },
    }, { btnClass: "secondary-btn" });
    host.textContent = "";
    host.append(panel.root);
    panels[screen] = panel;
    return panel;
  }

  // meta = { offline } from app.js (laptop not heard from in 3 minutes).
  function render(payload, meta) {
    const all = payload && payload.claudeScreens && typeof payload.claudeScreens === "object" ? payload.claudeScreens : null;
    const offline = !!(meta && meta.offline);
    last = { all, offline };
    for (const screen of Object.keys(HOSTS)) {
      const panel = ensure(screen);
      if (!panel) continue;
      const view = all ? all[screen] : null;
      panel.update(V.claudePanelModel(view, { askLeft: all ? all.askLeft : 0, caps: all ? all.caps : undefined, today: all ? all.day : "", offline: offline || !all, now: Date.now() }));
    }
  }

  if (!V) {
    self.ShopperClaudeScreens = { render() {}, missing: true };
    return;
  }
  self.ShopperClaudeScreens = { render };
})();
