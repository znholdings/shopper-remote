// Shopper Remote - the phone app (P-15, v2.93).
//
// ---------------------------------------------------------------------
// WHAT THIS IS
// ---------------------------------------------------------------------
// A mirror of the Buy Queue side pane, plus a start button. It renders
// what the laptop publishes to the relay and relays back what Zach taps.
//
// ⚠ It contains NO buy logic and it NEVER answers a prompt on his behalf.
// Every pause the laptop shows, this shows, and it waits either way. A
// missed notification results in a run that stays paused - which is the
// correct outcome - never in a run that proceeds because nobody replied.
//
// ⚠ Command names here must match lib/remote-protocol.js's whitelist
// exactly. Anything else is refused by the laptop, by design.
const CFG = window.SHOPPER_REMOTE_CONFIG || {};

// Bumped by hand with every PWA upload. If this does not match what you
// just deployed, the phone is serving a cached copy - see P-35.
const APP_BUILD = "v2.0.40";
const POLL_MS = 3000;

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of [
  "app","deviceName","signOutBtn","liveBanner","signinView","signInBtn","signinError",
  "pickerView","deviceList","mainView","tabRun","tabBuylist","runPane","buylistPane",
  "promptCard","promptTitle","promptDetail","promptExpiry","promptFields","promptActions",
  "runStatus","currentStep","tSpent","tNeeded","tToday","tBought","tDefaultNote",
  "startRow","modeSelect","startBtn","resumeSavedBtn","controlRow","pauseBtn","resumeBtn",
  "retryFailedBtn","finishNowBtn","abortBtn","unstickNote","addAsin","addQty","addPriority","addBtn",
  "lineCount","lines","log","generateBtn","approveAllBtn","buylistMeta","buylistApproved",
  "buylistApprovedBar","buylistApprovedFill","buylistItems","toast","installHint",
  "progress","progressText","genCard","genStep","genLog","previewBtn","discardSavedBtn",
  "blAddAsin","blAddQty","blAddBtn",
  // B-466 (v4.51): House / Prep for "Add an ASIN".
  "addDest",
  "pushRow","pushBtn","refreshBtn","reloadBtn","buildStamp",
  // v2.98: P-63 (promptReason/promptDetails), P-53 (skipFailedBtn),
  // P-64 (nowStrip), P-67 (densityRow), P-65 (report*), P-58 (soundBtn).
  "promptReason","promptDetails","skipFailedBtn","nowStrip","nowAsin","nowStep",
  "densityRow","logSection","reportCard","reportUrgent","reportSummary","reportBuckets","soundBtn",
  // B-459 (v4.49): the read-only Inventory tab.
  "tabInventory","inventoryPane","invAsOf","invHouse","invPrep","invTransit",
  "invArrivalsCount","invArrivals","invProductCount","invFilter","invRows",
  // B-465 (v4.50): tap a House / Prep / In transit tile for its products.
  "invBucketPanel","invBucketTitle","invBucketNote","invBucketTable",
  // B-875 (v2.0.25): set every House count from its Receive tally.
  "invReceiveAllBtn",
  // B-912 (v2.0.29): print the open batch's labels from the phone.
  "invPrintLabelsBtn","invPrintLabelsNote",
  // B-490 (v4.56): the read-only Dashboard tab.
  "tabDashboard","dashboardPane","dashAsOf","dashTiles","dashDoNext","dashDoCount",
  "dashLastRun","dashLastHead","dashLastSub","dashNightly","dashChecks",
  // B-510/B-511 (v4.61): the read-only FBA tab (remote/fba-view.js draws it).
  "tabFba","fbaPane",
  // B-741 (v2.01): the Min tab (remote/belowmin-view.js draws it).
  "tabBelowMin","belowMinPane",
  // B-742 (v2.0.7): the Ship tab (remote/wizard-view.js draws it).
  "tabWizard","wizardPane","wizardHost",
  // B-765 (v2.0.8): the Cash tab (remote/cashflow-view.js draws it).
  "tabCashFlow","cashFlowPane",
  // B-662 (v4.85): the Bank view, opened from the Bank balance tile.
  "bankPane","bankBack","bankBal","bankAsOf","bankCount","bankRows",
  // B-776 (v2.0.9): the report card's heading (it also shows the LAST run's report).
  "reportHead",
]) els[id] = $(id);

// --------------------------------------------------------------- state
let session = null;      // { access_token, refresh_token, expiresAt }
let deviceId = null;     // the laptop we are driving
let deviceName = "";
let lastPayload = null;
let pollTimer = null;
// B-464 (v4.50): when the laptop's row was last written (device_state.updated_at).
let lastUpdatedAt = null;
// B-465 (v4.50): which Inventory tile is open - "house" | "prep" | "transit" | null.
let invBucket = null;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function toast(text, isError) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  els.toast.classList.toggle("error", !!isError);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 3500);
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// ---------------------------------------------------------------- auth
function readTokensFromHash() {
  if (!location.hash) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  if (!access_token || !refresh_token) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return { access_token, refresh_token, expiresAt: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000 };
}

function signIn() {
  const redirect = location.origin + location.pathname;
  location.href = `${CFG.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`;
}

async function token() {
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60000) return session.access_token;
  const resp = await fetch(`${CFG.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.anonKey },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  }).catch(() => null);
  if (!resp || !resp.ok) { signOut(); return null; }
  const j = await resp.json().catch(() => null);
  if (!j || !j.access_token) { signOut(); return null; }
  session = { access_token: j.access_token, refresh_token: j.refresh_token || session.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  store.set("shopper_session", session);
  return session.access_token;
}

function signOut() {
  session = null;
  store.del("shopper_session");
  store.del("shopper_device");
  render();
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const t = await token();
  if (!t) return { ok: false, json: null, reason: "signed out" };
  const headers = { apikey: CFG.anonKey, Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const resp = await fetch(`${CFG.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  if (!resp || !resp.ok) return { ok: false, json: null, reason: resp ? `HTTP ${resp.status}` : "network error" };
  const json = await resp.json().catch(() => null);
  return { ok: true, json };
}

// ------------------------------------------------------------ commands
//
// One function, one shape. `name` must be a key in the laptop's whitelist
// (lib/remote-protocol.js REMOTE_COMMANDS); anything else is refused
// there and reported back on the row.
//
// `signature` is sent as null and `role` as "active" because protocol v1
// reserves both. They exist so device-key signing can be added later
// without a schema migration - see the backlog's forward-compat notes.
async function sendCommand(name, payload = {}, opts = {}) {
  if (!deviceId) return;
  // B-843 (v2.0.22): `quiet` = a background sync (Receive counts) - no "Sent" toast, no progress pill,
  // no error toast; the caller retries on its own.
  const quiet = !!(opts && opts.quiet);
  const res = await sb("commands", {
    // ⚠ P-28 (v2.93): was `return=minimal`, which threw away the row id -
    // and with it any way to ever find out what happened to the command.
    method: "POST",
    prefer: "return=representation",
    body: [{
      v: 1,
      device_id: deviceId,
      name,
      payload,
      issued_at: new Date().toISOString(),
      status: "pending",
      signature: null,
      role: "active",
    }],
  });
  if (!res.ok) { if (!quiet) toast(`Could not send: ${res.reason}`, true); return null; }
  const row = Array.isArray(res.json) ? res.json[0] : null;
  if (quiet) return row && row.id ? row.id : null;
  if (row && row.id) {
    inFlight.set(row.id, { name, at: Date.now() });
    renderInFlight();
  }
  toast("Sent");
  // Poll straight away so the effect shows without waiting a full tick.
  setTimeout(poll, 400);
  // v4.74: the row id, so remote/parity.js can wait for the laptop's answer
  // before a second step (e.g. take leftovers off, THEN dismiss the card).
  return row && row.id ? row.id : null;
}

// v4.74: id -> resolve(status) for callers that wait (remote/parity.js).
const waiters = new Map();
function waitFor(id) {
  return new Promise((resolve) => {
    if (!id) { resolve("not sent"); return; }
    waiters.set(id, resolve);
  });
}
function settleWaiter(id, status) {
  const w = waiters.get(id);
  if (w) { waiters.delete(id); w(status); }
}
self.ShopperRemote = Object.freeze({ sendCommand: (name, payload) => sendCommand(name, payload), waitFor });

// ------------------------------------------------------- command outcomes
//
// P-28 (v2.93). THE BUG THIS CLOSES: the phone used to POST a command,
// toast "Sent", and never look at it again - poll() read device_state and
// nothing else. Meanwhile the laptop writes the real outcome onto that
// same row (remote-bridge.js markCommand() PATCHes status, a 500-char
// reason, and a truncated result) on EVERY path, refusals included.
//
// So a command rejected by the whitelist, stopped by the replay guard, or
// throwing inside its handler looked EXACTLY like one that worked: a
// cheerful "Sent" and then silence. The data was already in the database
// and already being written. Nobody read it.
//
// `inFlight` is also what drives the P-25 progress pill, so one select
// serves both: a command still `pending`/`running` IS the progress.
const inFlight = new Map(); // id -> { name, at }
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

const OUTCOME_LABEL = {
  done: (n) => `${n}: done`,
  error: (n, why) => `${n} failed - ${why || "no reason given"}`,
  rejected: (n, why) => `${n} refused - ${why || "not allowed"}`,
};

async function pollCommandOutcomes() {
  if (!inFlight.size) return;
  const ids = [...inFlight.keys()];
  const res = await sb(
    `commands?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,name,status,reason`
  );
  if (!res.ok || !Array.isArray(res.json)) return;

  for (const row of res.json) {
    const pending = inFlight.get(row.id);
    if (!pending) continue;
    if (row.status === "pending" || row.status === "running") continue;

    inFlight.delete(row.id);
    settleWaiter(row.id, row.status);
    const label = (REMOTE_LABELS[pending.name] || pending.name);
    const fmt = OUTCOME_LABEL[row.status];
    if (row.status === "done") {
      // A success is already visible in the state that came back with it -
      // saying so again for every tap would be noise. Stay quiet.
    } else if (fmt) {
      toast(fmt(label, row.reason), true);
    } else {
      toast(`${label}: ${row.status}${row.reason ? ` - ${row.reason}` : ""}`, true);
    }
  }

  // A command the laptop never picked up (extension asleep, browser shut)
  // would otherwise spin the progress pill forever. Say so instead.
  const now = Date.now();
  for (const [id, c] of [...inFlight.entries()]) {
    if (now - c.at < COMMAND_TIMEOUT_MS) continue;
    inFlight.delete(id);
    settleWaiter(id, "timeout");
    toast(`${REMOTE_LABELS[c.name] || c.name}: no response from the laptop after 5 minutes.`, true);
  }
  renderInFlight();
}

// ------------------------------------------------------------- polling
async function poll() {
  if (!session || !deviceId) return;
  const res = await sb(`device_state?device_id=eq.${encodeURIComponent(deviceId)}&select=payload,updated_at,device_name&limit=1`);
  if (res.ok && Array.isArray(res.json) && res.json[0]) {
    lastPayload = res.json[0].payload || null;
    deviceName = res.json[0].device_name || deviceName;
    lastUpdatedAt = res.json[0].updated_at || lastUpdatedAt;
    renderPayload();
  }
  // B-464: judged on EVERY tick, fetched or not, so a laptop that went
  // quiet cannot keep showing its last word ("Idle") forever.
  renderLiveness(lastPayload && lastPayload.liveness);
  // P-28. Same tick, so an outcome never lags the state it produced.
  await pollCommandOutcomes().catch(() => {});
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

// Plain-language names for the whitelist keys, used in outcome toasts and
// the progress pill. Kept here rather than imported because this page is
// a plain script - the laptop's REMOTE_COMMANDS carries the same labels.
const REMOTE_LABELS = {
  start: "Start Buy Queue", preview: "Refresh preview", pause: "Pause", resume: "Resume",
  abort: "Abort queue", finishNow: "Finish queue now", retryFailed: "Retry failed buy",
  resumeSaved: "Resume saved queue", discardSaved: "Discard saved queue",
  retryLine: "Try again", skipLine: "Skip line", skipPlannedLine: "Skip planned line",
  markBought: "Mark as bought", markNotBought: "Mark not bought", addSourceUrl: "Add source URL",
  addManualLine: "Add ASIN to queue", generateBuylist: "Generate buylist",
  buylistAction: "Buylist action", buylistApproveAll: "Approve all",
  preview: "Refresh preview",
  buylistAddManual: "Add ASIN to buylist",
  boxesRead: "Read boxes", boxesAnswer: "Save answers", boxesUpload: "Upload boxes", boxesClear: "Start over", boxesRemove: "Remove box",
};

// P-25, half one: proof the tap landed. A command that is still pending or
// running IS the progress - no extra channel, no second poll loop.
function renderInFlight() {
  if (!els.progress) return;
  const names = [...inFlight.values()].map((c) => REMOTE_LABELS[c.name] || c.name);
  if (!names.length) { els.progress.hidden = true; return; }
  els.progress.hidden = false;
  els.progressText.textContent =
    names.length === 1 ? `${names[0]}...` : `${names.length} commands running...`;
}

// P-25, half two: what the laptop is actually DOING. `currentStep` and the
// log tail come off buylistState, which has carried them all along - see
// remote-protocol.js's buylistGen note for why the phone never saw them.
function renderBuylistGen(gen) {
  if (!els.genCard) return;
  const running = !!gen && gen.status === "running";
  els.genCard.hidden = !gen || (!running && !gen.error);
  if (!gen) return;
  if (gen.error) {
    els.genStep.textContent = `Generation failed: ${gen.error}`;
    els.genCard.classList.add("failed");
  } else {
    els.genCard.classList.remove("failed");
    const secs = gen.startedAt ? Math.round((Date.now() - gen.startedAt) / 1000) : null;
    els.genStep.textContent =
      (gen.currentStep || "Working...") + (secs != null ? ` · ${secs}s` : "");
  }
  els.genLog.textContent = (gen.log || []).join("\n");
  els.genLog.scrollTop = els.genLog.scrollHeight;
}

// ------------------------------------------------------------ rendering
function render() {
  const signedIn = !!session;
  els.signinView.hidden = signedIn;
  els.pickerView.hidden = !signedIn || !!deviceId;
  els.mainView.hidden = !signedIn || !deviceId;
  els.signOutBtn.hidden = !signedIn;
  els.deviceName.textContent = deviceId ? deviceName : "";
  if (signedIn && !deviceId) loadDevices();
  if (signedIn && deviceId) startPolling();
}

async function loadDevices() {
  const res = await sb("devices?select=device_id,device_name,last_seen,role&order=last_seen.desc");
  if (!res.ok) { els.deviceList.textContent = `Could not load devices: ${res.reason}`; return; }
  const rows = res.json || [];
  if (!rows.length) {
    els.deviceList.innerHTML = `<p class="muted">No laptop has checked in yet. Open Shopper's Phone Remote page on the laptop, sign in there, and this list will fill in.</p>`;
    return;
  }
  els.deviceList.innerHTML = "";
  for (const d of rows) {
    const age = Date.now() - Date.parse(d.last_seen || 0);
    const fresh = Number.isFinite(age) && age < 90000;
    const btn = document.createElement("button");
    btn.className = "device-btn";
    btn.innerHTML = `<span class="d-name">${escapeHtml(d.device_name || d.device_id)}</span>
      <span class="d-state ${fresh ? "good" : "bad"}">${fresh ? "online" : "not checked in recently"}</span>`;
    btn.addEventListener("click", () => {
      deviceId = d.device_id;
      deviceName = d.device_name || d.device_id;
      store.set("shopper_device", { deviceId, deviceName });
      render();
    });
    els.deviceList.appendChild(btn);
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// B-464 (v4.50). MEASURED 2026-09-22: Supabase showed the laptop's row last
// written 2026-09-20 20:24Z, and the phone still said "Idle" 32 hours later -
// the banner only ever repeated what the laptop last SAID. A live laptop
// rewrites its row at least every 45s (HEARTBEAT_MAX_INTERVAL_MS), so 3
// minutes without a write is four missed cycles: say so, on every tab.
const LAPTOP_STALE_MS = 3 * 60 * 1000;

// B-544 (v4.68): Shopper's times are US Central (Pacific only for events at
// the prep center) - shown the same on the phone, not in the phone's own zone.
function centralText(value, opts) {
  const t = typeof value === "number" ? value : Date.parse(value || "");
  if (!Number.isFinite(t)) return "";
  const o = Object.assign({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, opts || {});
  o.timeZone = "America/Chicago";
  return new Date(t).toLocaleString("en-US", o) + " CT";
}

function laptopStaleness(updatedAtIso, nowMs) {
  const t = Date.parse(updatedAtIso || "");
  if (!Number.isFinite(t) || nowMs - t <= LAPTOP_STALE_MS) return "";
  // B-544 (v4.68): Central time, not the phone's own zone.
  const when = new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
  const m = Math.round((nowMs - t) / 60000);
  const h = Math.round(m / 60);
  const ago = m < 60 ? m + " min ago" : h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
  return "Laptop not heard from since " + when + " (" + ago + ") - what you see is its last update.";
}

// The banner Zach asked for: "running" and "go to the machine" must never
// look the same.
function renderLiveness(live) {
  const b = els.liveBanner;
  const stale = laptopStaleness(lastUpdatedAt, Date.now());
  if (stale) {
    b.hidden = false;
    b.className = "live-banner tone-offline";
    b.textContent = stale;
    return;
  }
  if (!live) { b.hidden = true; return; }
  b.hidden = false;
  b.className = `live-banner tone-${live.status}`;
  const label = {
    running: "Running",
    waiting: "Waiting on you",
    paused: "Paused",
    stalled: "Needs you at the laptop",
    offline: "Laptop not responding",
    // B-775 (v2.0.9): a queue that ended is finished, not idle.
    finished: "Finished",
    idle: "Idle",
  }[live.status] || live.status;
  b.textContent = live.reason ? `${label} - ${live.reason}` : label;
}

function renderPayload() {
  const p = lastPayload;
  if (!p) return;
  renderLiveness(p.liveness);
  // B-874 (v2.0.24): the top bar's status line / progress lane (payload.activity).
  if (self.ShopperTopbar) self.ShopperTopbar.update(p.activity);

  const run = p.run || null;
  const status = run ? run.status : "";
  els.runStatus.textContent = status || "idle";
  els.runStatus.className = `pill pill-${status || "idle"}`;
  els.currentStep.textContent = run ? run.currentStep || "" : "";

  els.tSpent.textContent = money(run && run.totalSpent);
  els.tNeeded.textContent = money(p.day && p.day.neededToday);
  // \u26a0\u26a0 P-246 (v3.60): WHERE TODAY'S SPENDING GOAL CAME FROM, MIRRORED
  // ONLY. The phone shows the sentence the desktop produced; it does not
  // compose its own, and it has no control that changes either the default
  // or the goal.
  if (els.tDefaultNote) {
    const note = (p.day && p.day.defaultNote) || "";
    els.tDefaultNote.textContent = note;
    // \u26a0 `el.hidden`, never a class - this app has no `.hidden` rule and
    // v2.94 pinned [hidden] as the last rule precisely so this works.
    els.tDefaultNote.hidden = !note;
  }
  els.tToday.textContent = money(p.day && p.day.spentToday);
  els.tBought.textContent = String((run && run.linesBought) || 0);

  const live = status === "running" || status === "paused" || status === "collecting_urls" || status === "aborting";
  els.startRow.hidden = live;
  els.controlRow.hidden = !live;
  els.unstickNote.hidden = !(p.liveness && (p.liveness.status === "offline" || p.liveness.status === "stalled"));
  els.resumeSavedBtn.hidden = !(p.savedQueue && p.savedQueue.exists) || live;
  if (p.savedQueue && p.savedQueue.exists) {
    els.resumeSavedBtn.textContent = `Resume saved queue (${p.savedQueue.lineCount} lines)`;
  }
  els.pauseBtn.hidden = status !== "running";
  els.resumeBtn.hidden = status !== "paused";
  els.finishNowBtn.hidden = status !== "running";
  // Rule OUTPUT from the laptop - never re-derived here. lib/buy-queue-status.js
  // owns that rule and this page must not keep a second copy of it.
  els.retryFailedBtn.hidden = !(p.lines || []).some((l) => l.retryFailedEligible);
  // P-53 (v2.98): the same rule OUTPUT already used for Retry, now also
  // offering the other answer - give up on this one line and let the rest
  // of the queue run. Reuses skipLine, which has been on the whitelist and
  // handled by background.js since v2.92.
  els.skipFailedBtn.hidden = els.retryFailedBtn.hidden;

  els.discardSavedBtn.hidden = !(p.savedQueue && p.savedQueue.exists) || live;

  renderPrompt(p.prompt);
  // ⚠ P-36. Both of these rebuild their whole list from innerHTML = "",
  // four times a minute. Skipping the rebuild while the user is inside
  // that pane is what makes a quantity box typable at all - see
  // isBeingEdited() for the full reasoning.
  if (!isBeingEdited(els.lines)) renderLines(p.lines || [], p.lineCount || 0, p.truncated, p.progress);
  // P-51: entries arrive pre-formatted as strings now (they were objects,
  // which join() turned into "[object Object]" for the whole log).
  els.log.textContent = (p.log || []).join("\n");
  renderNowStrip(p);
  renderReport(run);
  // B-774 / B-776 (v2.0.9): Right now, the money band, the outcome counts and
  // the end-of-queue report sheet (remote/run-view.js).
  if (self.ShopperRunViewPhone) self.ShopperRunViewPhone.render(p);
  maybePlaySounds(p);
  renderBuylistGen(p.buylistGen);
  if (!isBeingEdited(els.buylistItems)) renderBuylist(p.buylist);
  rcSyncApply(p.inventory);
  renderInventory(p.inventory);
  // B-510/B-511 (v4.61): the FBA tab.
  if (self.ShopperFbaView) self.ShopperFbaView.render(p.fba);
  if (self.ShopperBelowMinView) self.ShopperBelowMinView.render(p.belowMin);
  // B-833 (v2.0.18): Home reads the FBA alerts and the Below Min count, so it is drawn after them.
  renderDashboard(p.dashboard, p);
  // B-742 (v2.0.7): the Ship tab - every tap goes to the laptop as wizardAction.
  if (self.ShopperWizardView) {
    self.ShopperWizardView.render(els.wizardHost, p.wizard ? p.wizard.screen : null, {
      send: (action, payload) => sendCommand("wizardAction", { action, payload }),
    });
  }
  // B-765 (v2.0.8): the Cash tab.
  if (self.ShopperCashFlowView) self.ShopperCashFlowView.render(p.cashFlow);
  // v4.74 (B-567 - B-574): refresh, Needs you, latest arrivals, goal.
  if (self.ShopperParity) self.ShopperParity.render(p);
  // B-579 (v4.75): Box contents -> ScanPower (remote/boxes.js).
  if (self.ShopperBoxes) self.ShopperBoxes.render(p);
  renderInFlight();
}

// ------------------------------------------------------- P-36: don't
// destroy what the user is holding
//
// THE BUG THIS CLOSES. renderBuylist() and renderLines() both start with
// `innerHTML = ""`, so every row, every button and every <input> is
// destroyed and rebuilt on each 3-second poll. Zach: "every time I am
// trying to edit a text box it pulls me out of the text box every few
// seconds which makes it impossible to edit the box." It was not a
// flicker - it was a full DOM teardown, twenty times a minute.
//
// Four things went wrong at once and this fixes all of them:
//   - focus died with the element (and iOS dismissed the keyboard);
//   - a half-typed quantity reverted, because the rebuilt input takes its
//     value from the payload;
//   - the Details panel re-collapsed;
//   - scroll position could jump on a 51-row list.
//
// ⚠ The run pane matters MORE than the buylist here, and it is the half
// nobody had tried: openBoughtForm() collects an order number, a quantity
// and a dollar amount that flow straight into real spend totals, and that
// form lives inside els.lines. It was being wiped mid-entry too.
//
// The rule is deliberately narrow: only skip while focus is genuinely
// inside a field in THAT container. A tap on Approve does not suppress
// anything, the other pane keeps updating, and the moment he leaves the
// field the next tick renders normally. Nothing goes stale for longer
// than one interaction.
function isBeingEdited(container) {
  if (!container) return false;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  return container.contains(el);
}

// Details panels are rebuilt with the rows, so which ones were open has
// to survive outside the DOM or they snap shut under the user.
const expandedAsins = new Set();

// P-42 (2026-09-09): "It's still jittery and slow, although it is
// better." isBeingEdited() above only protects a field being actively
// typed in - it does nothing for "just looking/scrolling", and a full
// innerHTML teardown-and-rebuild (new <img> elements included) every
// 1.5-5s poll tick, even when NOTHING changed, is real, visible jank on
// top of that. Comparing a JSON fingerprint of what was last actually
// rendered is a correct, minimal guard: any real change - including the
// optimistic mutation buylistAction() makes directly to lastPayload.buylist
// before calling renderBuylist() - still serializes differently and still
// renders.
let lastRenderedLinesFp;
let lastRenderedBuylistFp;

// P-61 (v2.98): the line cards printed the raw status enum -
// "confirmed_bought", "needs_cap_approval", "skipped_manual_retailer".
//
// ⚠ HAND-SYNCED COPY. The source of truth is QUEUE_STATUS_LABELS in
// buyqueue/buyqueue.js. It cannot be imported: that file is part of the
// extension bundle, this one is a separately deployed PWA with no shared
// build step between them. Same hazard as the RETRYABLE_LINE_STATUSES
// duplication that B13 (v2.78) had to fix after the two copies drifted -
// if you add or rename a status there, change it here in the same edit.
const QUEUE_STATUS_LABELS = {
  pending: "Queued",
  pool: "In pool",
  buying: "Buying...",
  bought: "Bought",
  assumed_met: "Assumed met",
  confirmed_bought: "Bought (confirmed)",
  needs_confirmation: "Needs confirmation",
  not_bought: "Not bought",
  partial: "Partial",
  failed: "Failed",
  out_of_stock: "Out of stock",
  needs_approval: "Needs price check",
  needs_cap_approval: "Needs cap approval",
  skipped_by_user: "Skipped",
  skipped_no_url: "No source URL",
  skipped_manual_retailer: "Manual buy (unsupported site)",
  skipped_no_cost: "No cost data",
  not_attempted: "Not attempted",
  not_needed: "Not needed",
  confirming: "Confirming...",
};

function statusLabel(status) {
  return QUEUE_STATUS_LABELS[status] || status || "";
}

// P-55 (v2.98), the phone half. line.error is now cleared at the start of
// every attempt on the laptop, but this is the belt to that fix's braces:
// an error message only belongs on a line that is actually STOPPED and
// waiting on a human. The desktop is far less exposed to a stale one -
// buyqueue.js only ever shows it as a hover tooltip on the status pill,
// while this page prints it in red under the card whenever it is truthy.
const ERROR_VISIBLE_STATUSES = new Set([
  "failed",
  "error",
  "needs_approval",
  "needs_cap_approval",
  "needs_confirmation",
  "skipped_no_url",
  "skipped_manual_retailer",
  "skipped_no_cost",
  "not_bought",
]);

// P-67 (v2.98): compact / normal / extended, persisted per phone. Drives a
// class on the Lines container that the CSS and the renderer both key off
// - "normal" is exactly what shipped before this, unchanged.
const DENSITIES = ["compact", "normal", "extended"];
let density = DENSITIES.includes(store.get("density")) ? store.get("density") : "normal";

function setDensity(next) {
  if (!DENSITIES.includes(next)) return;
  density = next;
  store.set("density", next);
  renderDensityButtons();
  // The fingerprint guard compares payload data only, so a density change
  // has to invalidate it by hand or the list would not re-render at all.
  lastRenderedLinesFp = undefined;
  if (lastPayload) renderLines(lastPayload.lines || [], lastPayload.lineCount || 0, lastPayload.truncated);
}

function renderDensityButtons() {
  if (!els.densityRow) return;
  for (const btn of els.densityRow.querySelectorAll(".density-btn")) {
    btn.classList.toggle("active", btn.dataset.density === density);
  }
}

// Formatters. `null` means "no value" and must render as the desktop's
// "-", never as 0 - see numOrNull() in remote-protocol.js.
function fmtQty(n) { return typeof n === "number" && Number.isFinite(n) ? String(n) : "-"; }
function fmtPct(n) { return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)}%` : "-"; }

// P-41 (2026-09-09): "I want confirmed, contingency, and old meat divided
// up into sections like the desktop." Mirrors buylist/buylist.js's own
// SECTION_META (title + order) rather than inventing a second copy of the
// section names - internal key "offbeat" / label "Old Meat" is
// intentional, see that file's own comment on the 2026 rename.
const BUYLIST_SECTIONS = [
  { key: "confirmed", title: "Confirmed Buys" },
  { key: "contingency", title: "Contingency" },
  { key: "offbeat", title: "Old Meat" },
];

// Mirrors lib/buylist.js's lineCost() (qty * unitCost) using the fields
// already on this projected item - i.qty IS the desktop's BUY QTY field
// (see remote-protocol.js's own comment on the buylist.items projection) -
// so this deliberately does not also fall back through blendedQty the way
// the source-of-truth lineCost() does: that field is never sent to the
// phone, and this total should always agree with what "Buy qty" on each
// card already shows.
function lineCostPhone(i) {
  return i.qty != null && i.unitCost != null ? i.qty * i.unitCost : 0;
}

// P-54 (v2.98): the desktop's dual units/orders bars, for the line actually
// being bought. The laptop gates `progress` to the current line already
// (see projectProgress in lib/remote-protocol.js) - this only has to decide
// whether THIS card is that line, and render nothing at all otherwise.
function progressBarsHtml(l, progress) {
  if (!progress || progress.asin !== l.asin || l.status !== "buying") return "";
  const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
  // Same "~N" convention the desktop uses for a dollar-mode estimate.
  const plannedLabel = progress.ordersPlanned
    ? (progress.ordersPlannedEstimated ? `~${progress.ordersPlanned}` : String(progress.ordersPlanned))
    : "?";
  return (
    `<div class="l-progress">` +
    `<div class="l-progress-row"><span class="l-progress-label">Units</span>` +
    `<span class="l-progress-text">${progress.unitsOrdered} / ${progress.unitsTarget || "?"}</span></div>` +
    `<div class="line-progress-bar"><div class="line-progress-fill" style="width:${pct(
      progress.unitsOrdered,
      progress.unitsTarget
    )}%"></div></div>` +
    `<div class="l-progress-row"><span class="l-progress-label">Orders</span>` +
    `<span class="l-progress-text">${progress.ordersPlaced} / ${escapeHtml(plannedLabel)}</span></div>` +
    `<div class="line-progress-bar"><div class="line-progress-fill" style="width:${pct(
      progress.ordersPlaced,
      progress.ordersPlanned
    )}%"></div></div>` +
    `</div>`
  );
}

// P-51 (v2.98), replacing the "[object Object]" this space used to print.
// Only ever says something when there IS something to say: a sync that
// failed, or a Prep Center row that didn't land. A clean line renders
// nothing here at all, exactly like the desktop.
function syncHtml(l) {
  const sync = l.sync;
  if (!sync) return "";
  const bits = [];
  for (const sys of sync.systems || []) {
    if (sys.ok) continue;
    bits.push(
      `<div class="l-sync-bad">${escapeHtml(sys.label)} "Ordered" update failed - ${escapeHtml(sys.reason)}</div>`
    );
  }
  const pc = sync.prepCenter;
  if (pc && !pc.ok) {
    bits.push(
      `<div class="l-sync-bad">Prep Center sheet: ${escapeHtml(pc.reason || "not written")}</div>`
    );
  } else if (pc && pc.skipped) {
    bits.push(`<div class="l-sync-warn">Prep Center sheet: ${escapeHtml(pc.reason || "skipped")}</div>`);
  }
  // In extended density, say so even when everything worked - that view's
  // whole job is "tell me everything about this line".
  if (!bits.length && density === "extended") {
    const okNames = (sync.systems || []).filter((x) => x.ok).map((x) => x.label);
    if (pc && pc.ok && !pc.skipped) okNames.push("Prep Center");
    if (okNames.length) bits.push(`<div class="l-meta">synced: ${escapeHtml(okNames.join(", "))}</div>`);
  }
  return bits.join("");
}

function renderLines(lines, total, truncated, progress) {
  const run = (lastPayload && lastPayload.run) || null;
  const fp = JSON.stringify([lines, total, truncated, progress, density, run && run.status, run && run.currentLineId, run && run.retryLaterLineIds]);
  if (fp === lastRenderedLinesFp) return;
  lastRenderedLinesFp = fp;
  els.lineCount.textContent = truncated ? `${lines.length} of ${total}` : String(total);
  els.lines.className = `lines density-${density}`;
  els.lines.innerHTML = "";
  // B-772 / B-774 (v2.0.9): the list in the order the run takes it - Buying
  // now, Up next, Fallback pool, Done (remote/run-lib.js runListGroups, the
  // laptop's rule). While the queue runs, a line that has not started moves
  // up or down (reorderLine); buying and finished lines are locked.
  const RL = self.ShopperRunLib || null;
  const queueStatus = (run && run.status) || "";
  const canMove = !!(RL && RL.canReorderLive(queueStatus));
  const ordered = [];
  if (RL) {
    for (const g of RL.runListGroups(lines, { currentLineId: run && run.currentLineId, queueStatus })) {
      if (!g.lines.length) continue;
      ordered.push({ head: g, count: g.lines.length });
      g.lines.forEach((l, i) => ordered.push({ l, block: canMove ? g.reorder : null, index: i, n: g.lines.length }));
    }
  } else {
    for (const l of lines) ordered.push({ l, block: null });
  }
  for (const item of ordered) {
    if (item.head) {
      const h = document.createElement("div");
      h.className = `l-group l-group-${item.head.key}`;
      h.textContent = `${item.head.title} (${item.count})`;
      els.lines.appendChild(h);
      continue;
    }
    const l = item.l;
    const row = document.createElement("div");
    const outcome = RL ? RL.outcomeOf(l) : "";
    row.className = `line line-${l.status}${outcome ? ` oc-${outcome}` : ""}`;
    // P-55: an error belongs on a line that is stopped and waiting on a
    // human, not on one that is mid-retry or already bought.
    const showError = !!l.error && ERROR_VISIBLE_STATUSES.has(l.status);
    const head =
      `<div class="l-top"><span class="l-asin">${escapeHtml(l.asin)}</span>` +
      // P-61: a label, not the raw enum.
      `<span class="l-status">${escapeHtml(RL ? RL.outcomeLabel(l, QUEUE_STATUS_LABELS, { retryLater: run && run.retryLaterLineIds }) : statusLabel(l.status))}</span></div>` +
      `<div class="l-title">${escapeHtml(l.title)}</div>`;
    if (density === "compact") {
      // Status + title only, for scanning a long list - plus the error, if
      // this line is stopped, because a compact view that hides the one
      // thing needing attention is worse than no compact view.
      row.innerHTML = head + (showError ? `<div class="l-error">${escapeHtml(l.error)}</div>` : "");
    } else {
      row.innerHTML =
        head +
        `<div class="l-meta">${l.boughtQty}/${l.qty} units · ${money(l.spentDollars)}` +
        // P-30: retailer was ALREADY in the payload and simply never printed.
        `${l.retailer ? ` · ${escapeHtml(l.retailer)}` : ""}` +
        `${l.multipackSize ? ` · pack of ${l.multipackSize}` : ""}` +
        `${l.prepCenter ? " · prep center" : ""}` +
        `${l.sheetRow ? ` · sheet ${escapeHtml(String(l.sheetRow))}` : ""}</div>` +
        progressBarsHtml(l, progress) +
        `${l.orderNumber ? `<div class="l-meta">order ${escapeHtml(l.orderNumber)}</div>` : ""}` +
        syncHtml(l) +
        `${l.sourceUrl ? `<div class="l-meta"><a class="l-src" href="${escapeHtml(l.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a></div>` : ""}` +
        `${density === "extended" && l.stopReason ? `<div class="l-meta">${escapeHtml(l.stopReason)}</div>` : ""}` +
        (showError ? `<div class="l-error">${escapeHtml(l.error)}</div>` : "");
    }
    const actions = document.createElement("div");
    actions.className = "l-actions";
    // P-51: the retry the desktop has always offered for a failed RP/SB
    // "Ordered" write, now reachable from the phone. Same handler, same
    // params, and the same warning the desktop puts in its own tooltip.
    for (const sys of (l.sync && l.sync.systems) || []) {
      if (sys.ok) continue;
      const b = lineBtn(`Retry ${sys.label}`, "retrySync", { lineId: l.lineId, asin: l.asin, system: sys.system });
      b.title =
        `Retries the ${sys.label} "Ordered" write for this line's ${(l.sync && l.sync.qty) || 0} bought unit(s). ` +
        `If ${sys.label} recorded part of this before reporting failure, retrying could double it - check there first if a run ever looks off.`;
      actions.appendChild(b);
    }
    if (l.retryable) actions.appendChild(lineBtn("Try again", "retryLine", { lineId: l.lineId, asin: l.asin }));
    if (l.status === "needs_confirmation") {
      // ⚠ "Bought" needs an order number, a real quantity and a real dollar
      // amount - the same three the laptop's own modal collects, and the
      // same three SHOPPER_BUY_QUEUE_MARK_BOUGHT reads (orderNumber /
      // actualQty / actualDollarAmount). Sending the tap alone would book
      // the purchase with nothing in it, and those numbers flow into
      // Spent-so-far and the Orders Placed sheet.
      //
      // A guard that cannot recover a required value must decline, not
      // guess - so this opens a small form instead of firing.
      const boughtBtn = document.createElement("button");
      boughtBtn.className = "mini-btn";
      boughtBtn.textContent = "Bought...";
      boughtBtn.addEventListener("click", () => openBoughtForm(row, l));
      actions.appendChild(boughtBtn);
      actions.appendChild(lineBtn("Not bought", "markNotBought", { lineId: l.lineId, asin: l.asin }));
    }
    if (l.status === "pending" || l.status === "pool") {
      actions.appendChild(lineBtn("Skip", "skipPlannedLine", { lineId: l.lineId, asin: l.asin }));
    }
    // B-772 (v2.0.9): up / down, the same move rule as the laptop's drag.
    if (item.block) {
      const move = (label, title, to, disabled) => {
        const b = lineBtn(label, "reorderLine", { block: item.block, lineIds: RL.moveLiveLine(lines, item.block, l.lineId, to) });
        b.classList.add("l-move");
        b.title = title;
        b.setAttribute("aria-label", title);
        b.disabled = !!disabled;
        actions.appendChild(b);
      };
      move("\u2191", "Move up one place", item.index - 1, item.index === 0);
      move("\u2193", "Move down one place", item.index + 1, item.index >= item.n - 1);
    }
    // P-29: the line actually being worked could not be skipped from the
    // phone at all - only planned ones. `skipLine` was in the whitelist
    // the whole time with nothing wired to it.
    // ⚠ "buying" is the real in-flight line status - confirmed against the
    // set actually compared in background.js/popup.js (buying, pending,
    // pool, failed, needs_approval, needs_cap_approval, needs_confirmation,
    // out_of_stock, skipped_by_user). An invented "in_progress" would have
    // meant a button that never appears - the silent-failure shape again.
    if (l.status === "buying") {
      actions.appendChild(lineBtn("Skip this line", "skipLine", { lineId: l.lineId, asin: l.asin }));
    }
    // P-29: fixing a missing Source Database URL needed the laptop, which
    // is precisely the thing he does not have when he is out.
    if (!l.sourceUrl) {
      const addSrc = document.createElement("button");
      addSrc.className = "mini-btn";
      addSrc.textContent = "Add source URL";
      addSrc.addEventListener("click", () => openSourceUrlForm(row, l));
      actions.appendChild(addSrc);
    }
    if (actions.children.length) row.appendChild(actions);
    els.lines.appendChild(row);
  }
}

// The three fields SHOPPER_BUY_QUEUE_MARK_BOUGHT actually needs. Rendered
// inline under the line rather than as a modal - one hand, one thumb.
function openBoughtForm(row, l) {
  if (row.querySelector(".bought-form")) return;
  const form = document.createElement("div");
  form.className = "bought-form";
  form.innerHTML =
    `<input class="bf-order" placeholder="Order number" />` +
    `<input class="bf-qty" type="number" min="1" placeholder="Qty" value="${l.qty || 1}" />` +
    `<input class="bf-amt" type="number" min="0" step="0.01" placeholder="Total $" />`;
  const confirm = document.createElement("button");
  confirm.className = "primary-btn mini-btn";
  confirm.textContent = "Confirm bought";
  confirm.addEventListener("click", () => {
    const qty = Number(form.querySelector(".bf-qty").value);
    const amt = Number(form.querySelector(".bf-amt").value);
    if (!(qty > 0) || !(amt >= 0) || Number.isNaN(amt)) {
      toast("Quantity and total are required - they go straight into your spend totals.", true);
      return;
    }
    sendCommand("markBought", {
      lineId: l.lineId,
      asin: l.asin,
      orderNumber: form.querySelector(".bf-order").value.trim(),
      actualQty: qty,
      actualDollarAmount: amt,
    });
    form.remove();
  });
  const cancel = document.createElement("button");
  cancel.className = "mini-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => form.remove());
  form.append(confirm, cancel);
  row.appendChild(form);
}

// P-29. `addSourceUrl` needs a URL, so it opens a field rather than
// firing - same principle as the Bought form: a command that cannot
// recover a required value must ask, not guess.
function openSourceUrlForm(row, l) {
  if (row.querySelector(".src-form")) return;
  const form = document.createElement("div");
  form.className = "bought-form src-form";
  form.innerHTML = `<input class="sf-url" type="url" inputmode="url" placeholder="https://www.walmart.com/ip/..." />`;
  const save = document.createElement("button");
  save.className = "primary-btn mini-btn";
  save.textContent = "Save URL";
  save.addEventListener("click", () => {
    const url = form.querySelector(".sf-url").value.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast("That needs to be a full http(s) URL.", true);
      return;
    }
    // ⚠ The handler reads `msg.url`, NOT `msg.sourceUrl` - checked against
    // SHOPPER_BUY_QUEUE_ADD_SOURCE_URL rather than assumed. This very
    // build's first draft wrote sourceUrl and would have shipped a fourth
    // dead button.
    sendCommand("addSourceUrl", { lineId: l.lineId, asin: l.asin, url });
    form.remove();
  });
  const cancel = document.createElement("button");
  cancel.className = "mini-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => form.remove());
  form.append(save, cancel);
  row.appendChild(form);
}

function lineBtn(label, name, payload) {
  const b = document.createElement("button");
  b.className = "mini-btn";
  b.textContent = label;
  b.addEventListener("click", () => sendCommand(name, payload));
  return b;
}

// ------------------------------------------------- P-37: optimistic UI
//
// Even at the new cadence a tap costs a couple of seconds before the
// laptop's own state comes back, and a button that looks inert for two
// seconds gets pressed twice. So a buylist decision is applied to the
// local copy of the payload IMMEDIATELY and re-rendered, then overwritten
// by the real payload when it arrives.
//
// ⚠ This is a DISPLAY guess, never a decision. The laptop remains the
// only thing that decides anything: the guess is unconditionally replaced
// by the next published state, and if the command is refused, P-28's
// outcome poll toasts the reason and the next payload puts the row back
// the way it really is. Nothing here writes to the relay and nothing here
// can approve a line the laptop did not approve.
const OPTIMISTIC_DECISION = {
  approve: "approved",
  unapprove: null,
  block: "blocked",
  contingency: null,
  push: "pushed",
  // promote moves SECTION, not decision - left alone deliberately rather
  // than guessed at, since guessing the wrong field is this feature's
  // most repeated mistake.
};

function optBtn(label, asin, action) {
  const b = document.createElement("button");
  b.className = "mini-btn";
  b.textContent = label;
  b.addEventListener("click", () => buylistAction(asin, action));
  return b;
}

function buylistAction(asin, action, extra = {}) {
  if (lastPayload && lastPayload.buylist && Array.isArray(lastPayload.buylist.items)) {
    const item = lastPayload.buylist.items.find((x) => x.asin === asin);
    if (item) {
      if (Object.prototype.hasOwnProperty.call(OPTIMISTIC_DECISION, action)) {
        item.decision = OPTIMISTIC_DECISION[action];
        item.conditional = false;
      }
      if (action === "conditional" && typeof extra.qty === "number") {
        item.decision = "approved";
        item.conditional = true;
        item.qty = extra.qty;
      }
      item.pendingLocal = true;
      if (!isBeingEdited(els.buylistItems)) renderBuylist(lastPayload.buylist);
    }
  }
  sendCommand("buylistAction", { asin, action, ...extra });
}

// P-49 (2026-09-09): "we need to be able to see and change that" (Prep
// Center). Same optimistic-update shape as buylistAction() above, but its
// own command - SHOPPER_BUYLIST_SET_PREP_CENTER is a dedicated message,
// not a SHOPPER_BUYLIST_ACTION case (see remote-protocol.js's comment on
// why: it doesn't touch budget allocation, just where the line ships).
function buylistSetPrepCenter(asin, prepCenter) {
  if (lastPayload && lastPayload.buylist && Array.isArray(lastPayload.buylist.items)) {
    const item = lastPayload.buylist.items.find((x) => x.asin === asin);
    if (item) {
      item.prepCenter = prepCenter;
      if (!isBeingEdited(els.buylistItems)) renderBuylist(lastPayload.buylist);
    }
  }
  sendCommand("buylistSetPrepCenter", { asin, prepCenter });
}

// ⚠ The prompt renderer relays an answer. It never picks one, never
// pre-selects a destructive default, and never times anything out - the
// filler prompt's own 5-minute clock lives in the laptop's buy loop.
function renderPrompt(prompt) {
  if (!prompt) { els.promptCard.hidden = true; return; }
  els.promptCard.hidden = false;
  els.promptTitle.textContent = prompt.title;
  // P-63 (v2.98): the reason gets its own emphasized line and the long
  // boilerplate goes behind "Details". Zach's own paused-run screenshot had
  // a paragraph of explanation at exactly the same visual weight as the
  // Resume / Retry / Abort buttons under it, so both were easy to skim past
  // on a phone. Nothing about detectPausePrompt() changes - this is purely
  // how the same text is laid out.
  const detail = prompt.detail || "";
  const reason = shortReason(detail);
  els.promptReason.textContent = reason;
  els.promptReason.hidden = !reason;
  els.promptDetail.textContent = detail;
  // No point offering "Details" when the details are just the reason again.
  els.promptDetails.hidden = !detail || detail === reason;
  els.promptDetails.open = false;
  els.promptExpiry.hidden = !prompt.expiresAt;
  if (prompt.expiresAt) {
    const secs = Math.max(0, Math.round((Date.parse(prompt.expiresAt) - Date.now()) / 1000));
    els.promptExpiry.textContent = `This one expires on its own in about ${secs}s - after that the line moves to the end of the queue.`;
  }
  els.promptFields.innerHTML = "";
  els.promptActions.innerHTML = "";

  const field = (id, label, attrs = {}) => {
    const wrap = document.createElement("label");
    wrap.className = "p-field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.id = id;
    Object.assign(input, attrs);
    wrap.append(span, input);
    els.promptFields.appendChild(wrap);
    return input;
  };

  let getPayload = () => ({ asin: prompt.asin, lineId: prompt.lineId });

  if (prompt.kind === "sourceUrl") {
    const url = field("pUrl", "Source URL", { type: "url", placeholder: "https://www.walmart.com/ip/..." });
    const ipu = field("pIpu", "Items per unit", { type: "number", min: "1", value: "1" });
    getPayload = () => ({ asin: prompt.asin, lineId: prompt.lineId, url: url.value.trim(), itemsPerUnit: Number(ipu.value) || 1 });
  } else if (prompt.kind === "filler") {
    const fa = field("pFillerAsin", "Filler ASIN (optional)", { type: "text" });
    const fq = field("pFillerQty", "Qty", { type: "number", min: "1", value: "1" });
    const fu = field("pFillerUrl", "One-off Target URL", { type: "url", placeholder: "https://www.target.com/p/..." });
    // ⚠ The handler's `asin` here is the FILLER item's ASIN, not the paused
    // line's - sending the line's ASIN would pad the cart with another unit
    // of the thing being bought. Parameter names read out of background.js:
    // asin / qty / sourceUrl.
    getPayload = () => ({ asin: fa.value.trim(), qty: Number(fq.value) || 1, sourceUrl: fu.value.trim() });
  } else if (prompt.kind === "multipack") {
    const size = field("pPack", "Units per Walmart pack", { type: "number", min: "1", value: String(prompt.detectedSize || 1) });
    // ⚠ `confirmedSize` - the handler's own parameter name, read out of
    // background.js. A near-miss here (`size`) is a button that appears to
    // work and silently confirms nothing.
    getPayload = () => ({ asin: prompt.asin, lineId: prompt.lineId, confirmedSize: Number(size.value) || 1 });
  }

  // B-911 (v2.0.34): the pack choice (B-906) - one button per pack option, as
  // on the laptop's Buy Queue; each sends approveOrder with choice = the
  // option id. An option that cannot be bought is shown disabled.
  for (const c of Array.isArray(prompt.choices) ? prompt.choices : []) {
    const b = document.createElement("button");
    b.className = c.recommended ? "primary-btn" : "secondary-btn";
    b.textContent = c.label;
    b.disabled = c.enabled !== true;
    b.addEventListener("click", () => sendCommand("approveOrder", { ...getPayload(), approved: true, choice: c.id }));
    els.promptActions.appendChild(b);
  }

  for (const name of prompt.answers || []) {
    const b = document.createElement("button");
    const destructive = name === "abort" || name === "skipSourceUrl" || name === "fillerSkip" || name === "multipackCancel" || name === "declineOrder" || name === "skipLine";
    b.className = destructive ? "secondary-btn" : "primary-btn";
    // B-774 (v2.0.9): a prompt may name its own answers ("Resume anyway",
    // "Skip failed buy") - the same words the laptop's buttons use.
    b.textContent = (prompt.labels && prompt.labels[name]) || ANSWER_LABELS[name] || name;
    // B-777 (v2.0.9): "Place order" sends approved: true (the laptop's own answer).
    b.addEventListener("click", () => sendCommand(name, name === "approveOrder" ? { ...getPayload(), approved: true } : getPayload()));
    els.promptActions.appendChild(b);
  }
}

// The one short sentence worth reading first. A pause detail is usually a
// long sentence with the actual cause quoted inside it ("Target cart purity
// check failed..."); when there is no quote, the first sentence is the
// closest thing to a headline. Falls back to a hard truncation rather than
// showing a paragraph in the emphasized slot.
function shortReason(detail) {
  if (!detail) return "";
  const quoted = detail.match(/["“]([^"”]{4,200})["”]/);
  if (quoted) return quoted[1];
  const firstSentence = (detail.match(/^[^.!?]*[.!?]/) || [])[0];
  if (firstSentence && firstSentence.trim().length <= 160) return firstSentence.trim();
  return detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
}

const ANSWER_LABELS = {
  submitSourceUrl: "Submit URL",
  skipSourceUrl: "Skip this line",
  fillerItem: "Add filler & continue",
  fillerSkip: "Skip this line",
  approvePrice: "Approve change",
  approveCap: "Approve & place order",
  approveOrder: "Place order",
  // B-774 (v2.0.9): the laptop's decline, and the failure pause's retry.
  declineOrder: "Skip this order",
  // B-904 (v2.0.28): the safety-cap prompt's skip (its own label wins).
  skipLine: "Skip this line",
  retryFailed: "Retry failed buy",
  multipackOk: "Yes, proceed",
  multipackCancel: "No, skip this buy",
  resume: "Resume (skip it)",
  abort: "Abort run",
};

function renderBuylist(bl) {
  if (!bl) {
    els.buylistMeta.textContent = "No buylist generated yet.";
    els.buylistApproved.textContent = "";
    els.buylistItems.innerHTML = "";
    lastRenderedBuylistFp = undefined;
    return;
  }
  const fp = JSON.stringify(bl);
  if (fp === lastRenderedBuylistFp) return;
  lastRenderedBuylistFp = fp;

  els.buylistMeta.textContent =
    `${bl.itemCount} line(s)${bl.truncated ? ` (showing first ${(bl.items || []).length})` : ""}` +
    `${bl.generatedAt ? ` · generated ${centralText(bl.generatedAt)}` : ""}` +
    `${bl.excludedCount ? ` · ${bl.excludedCount} other ASIN${bl.excludedCount === 1 ? "" : "s"} left out` : ""}`;

  // P-43: "I need to know how much $ approved we have when I approve a buy
  // but we've lost that whole part of the desktop UI." Same math as the
  // desktop's computeApprovedTotals() (buylist.js) - sum of lineCost()
  // over every currently-approved item, all sections combined.
  const approvedTotal = (bl.items || [])
    .filter((i) => i.decision === "approved")
    .reduce((sum, i) => sum + lineCostPhone(i), 0);
  els.buylistApproved.textContent = (bl.items || []).length ? `Approved: ${money(approvedTotal)}` : "";

  // P-47: "a horizontal version of what's on the desktop." Desktop's tube
  // (buylist.js) fills against 1.5x Spend Needed, with "met" once Approved
  // reaches Spend Needed itself - same math here. Spend Needed IS
  // day.neededToday (background.js: `neededToday: spendBreakdown.spendTarget`,
  // the exact field buylist.js's own tube reads as spendTarget), already on
  // the phone for the Run tab's own "Needed today" tile - no new field.
  const neededToday = Number(lastPayload && lastPayload.day && lastPayload.day.neededToday) || 0;
  const hasTarget = (bl.items || []).length > 0 && neededToday > 0;
  els.buylistApprovedBar.hidden = !hasTarget;
  if (hasTarget) {
    const tubeTop = neededToday * 1.5;
    const fillPct = Math.min(100, (approvedTotal / tubeTop) * 100);
    els.buylistApprovedFill.style.width = `${fillPct}%`;
    els.buylistApprovedFill.classList.toggle("pc-met", approvedTotal >= neededToday);
  }

  els.buylistItems.innerHTML = "";

  // P-41: "I want confirmed, contingency, and old meat divided up into
  // sections like the desktop." Grouped in the desktop's own fixed order
  // (SECTION_META), each with a line count and $ total.
  for (const sec of BUYLIST_SECTIONS) {
    const items = (bl.items || []).filter((i) => i.section === sec.key);
    if (!items.length) continue;
    const total = items.reduce((sum, i) => sum + lineCostPhone(i), 0);
    // P-48: "a bold yellow line around each section... to make it more
    // obvious." One wrapper per section so the border can go around the
    // whole group, not just the heading.
    const sectionWrap = document.createElement("div");
    sectionWrap.className = "bl-section";
    const head = document.createElement("h2");
    head.className = "section-head bl-section-head";
    head.innerHTML =
      `${escapeHtml(sec.title)} <span class="count">${items.length} line${items.length === 1 ? "" : "s"} · ${money(total)}</span>`;
    sectionWrap.appendChild(head);

    // P-45: Claude's plain-English read on the Old Meat pool - shown on
    // the desktop (buylist.js's renderOldMeatAssessment()), never sent to
    // the phone before. Only ever set alongside the Old Meat section.
    if (sec.key === "offbeat" && bl.poolAssessment) {
      const box = document.createElement("div");
      box.className = "old-meat-box";
      box.innerHTML = `<strong>🥩 Old Meat pool:</strong> ${escapeHtml(bl.poolAssessment)}`;
      sectionWrap.appendChild(box);
    }

    for (const i of items) sectionWrap.appendChild(buylistCard(i));
    els.buylistItems.appendChild(sectionWrap);
  }

  // A grouped view must never silently DROP a line. shapeBuylistItem()
  // always sets one of the three keys above, so this should stay empty -
  // it exists so a future section value doesn't just vanish from the UI.
  const grouped = new Set(BUYLIST_SECTIONS.map((s) => s.key));
  const ungrouped = (bl.items || []).filter((i) => !grouped.has(i.section));
  if (ungrouped.length) {
    const sectionWrap = document.createElement("div");
    sectionWrap.className = "bl-section";
    const head = document.createElement("h2");
    head.className = "section-head bl-section-head";
    head.textContent = `Other (${ungrouped.length})`;
    sectionWrap.appendChild(head);
    for (const i of ungrouped) sectionWrap.appendChild(buylistCard(i));
    els.buylistItems.appendChild(sectionWrap);
  }
}

// The card builder - unchanged from the pre-P-41 renderBuylist() body
// except for the P-40 Prep Center badge. Returns the row; the caller
// appends it (grouped by section as of P-41).
function buylistCard(i) {
  const row = document.createElement("div");
  row.className = `line bl-${i.decision || "undecided"}`;

  // P-26. The five fields Zach named as what decides an approve/reject
  // (answered 2026-09-09), plus the title and thumbnail he asked for.
  // Everything else lives behind the Details toggle - a phone card
  // cannot carry the desktop's twenty columns and should not try.
  const head = document.createElement("div");
  head.className = "bl-head";
  if (i.thumbnailUrl) {
    const img = document.createElement("img");
    img.className = "bl-thumb";
    img.loading = "lazy";
    img.alt = "";
    img.src = i.thumbnailUrl;
    // A dead image URL must not leave a broken-image glyph in the row.
    img.addEventListener("error", () => img.remove());
    head.appendChild(img);
  }
  const headText = document.createElement("div");
  headText.className = "bl-headtext";
  headText.innerHTML =
    `<div class="l-top"><span class="l-asin">${escapeHtml(i.asin)}</span>` +
    // P-40: "there's no indication if something is prep center or not."
    `${i.prepCenter ? `<span class="pc-badge">Prep Center</span>` : ""}` +
    `<span class="l-status">${escapeHtml(i.section)}${decisionSuffix(i)}</span></div>` +
    `<div class="l-title">${escapeHtml(i.title)}</div>`;
  head.appendChild(headText);
  row.appendChild(head);

  const stats = document.createElement("div");
  stats.className = "bl-stats";
  stats.innerHTML =
    statCell("Buy qty", fmtQty(i.qty)) +
    statCell("SB rec", fmtQty(i.sbQty)) +
    statCell("RP rec", fmtQty(i.rpQtyRaw)) +
    statCell("SB mgn", fmtPct(i.sbMarginPct)) +
    statCell("RP mgn", fmtPct(i.rpMarginPct));
  row.appendChild(stats);

  const more = document.createElement("div");
  more.className = "bl-more";
  more.innerHTML =
    statCell("Score", i.score != null ? i.score.toFixed(2) : "-") +
    statCell("Unit cost", i.unitCost != null ? money(i.unitCost) : "-") +
    statCell("SB ROI", fmtPct(i.sbRoiPct)) +
    statCell("RP ROI", fmtPct(i.rpRoiPct)) +
    statCell("SB vel", fmtQty(i.sbVelocity)) +
    statCell("RP vel", fmtQty(i.rpVelocity)) +
    statCell("RP inbound", fmtQty(i.rpInboundQty)) +
    statCell("RP total", fmtQty(i.rpTotalQuantity)) +
    statCell("Supplier", i.supplierNames ? escapeHtml(i.supplierNames) : "-");

  // P-36: remembered outside the DOM, because the DOM is disposable.
  more.hidden = !expandedAsins.has(i.asin);
  const toggle = document.createElement("button");
  toggle.className = "mini-btn bl-toggle";
  toggle.textContent = more.hidden ? "Details" : "Hide";
  toggle.addEventListener("click", () => {
    more.hidden = !more.hidden;
    if (more.hidden) expandedAsins.delete(i.asin);
    else expandedAsins.add(i.asin);
    toggle.textContent = more.hidden ? "Details" : "Hide";
  });

  const actions = document.createElement("div");
  actions.className = "l-actions";
  // ⚠ `decision` is a STRING, not a boolean - see P-27. `!!i.approved`
  // was always false, so this toggle could never say "Unapprove".
  const isApproved = i.decision === "approved";
  const approveBtn = document.createElement("button");
  approveBtn.className = "mini-btn";
  approveBtn.textContent = isApproved ? "Unapprove" : "Approve";
  approveBtn.addEventListener("click", () =>
    buylistAction(i.asin, isApproved ? "unapprove" : "approve")
  );
  actions.appendChild(approveBtn);
  // ⚠⚠ P-31 (v2.93). The button that used to sit here sent
  // `action: "reject"`. SHOPPER_BUYLIST_ACTION's switch has NO "reject"
  // case - the real set, read off the switch, is:
  //
  //     approve · unapprove · conditional · promote · contingency ·
  //     block · push
  //
  // and anything else falls to `default:` which responds
  // { ok: false, reason: "Unknown action reject" }. So the phone's
  // Reject button never worked on any row, in any version, and P-28 is
  // exactly why nobody found out: the phone threw that refusal away and
  // toasted "Sent". Both halves of that failure are fixed in this build.
  //
  // The desktop has no Reject either - its legend is approve, conditional
  // approve, promote (up), demote to contingency (down), push (right),
  // block (no symbol). The phone now offers that same set and no
  // invented ones.
  actions.appendChild(optBtn("Promote", i.asin, "promote"));
  actions.appendChild(optBtn("Demote", i.asin, "contingency"));
  actions.appendChild(optBtn("Push", i.asin, "push"));
  actions.appendChild(optBtn("Block", i.asin, "block"));

  // P-49: the write half of the Prep Center badge above - mirrors the
  // desktop's own .prep-center-toggle checkbox (buylist.js), same
  // optimistic-then-confirm pattern every other action here uses.
  const pcLabel = document.createElement("label");
  pcLabel.className = "pc-toggle";
  pcLabel.title = "Ship this item to the Prep Center warehouse instead of Home.";
  const pcCheckbox = document.createElement("input");
  pcCheckbox.type = "checkbox";
  pcCheckbox.checked = !!i.prepCenter;
  pcCheckbox.addEventListener("change", () => buylistSetPrepCenter(i.asin, pcCheckbox.checked));
  pcLabel.append(pcCheckbox, document.createTextNode("Prep Center"));
  actions.appendChild(pcLabel);

  actions.appendChild(toggle);

  const qty = document.createElement("input");
  qty.type = "number";
  qty.min = "1";
  qty.className = "qty-input";
  // ⚠ P-27: this used to be `String(i.qty || 1)` reading a field that did
  // not exist, so it showed 1 on EVERY row. Tapping Set qty on an
  // untouched 216-unit line silently proposed dropping it to 1.
  qty.value = String(i.qty != null ? i.qty : (i.recommendedQty != null ? i.recommendedQty : 1));
  const setQty = document.createElement("button");
  setQty.className = "mini-btn";
  setQty.textContent = "Set qty";
  // "conditional" is the buylist's own quantity-adjust action - the real
  // one, read out of background.js. There is no separate set-quantity
  // message, and inventing one would mean writing buy logic here.
  setQty.addEventListener("click", () => buylistAction(i.asin, "conditional", { qty: Number(qty.value) || 1 }));
  actions.append(qty, setQty);

  row.appendChild(actions);
  row.appendChild(more);
  // v4.74 (B-572): Ding + "Why this Buy Score" (remote/parity.js).
  if (self.ShopperParity) self.ShopperParity.decorateBuylistCard(row, i);
  return row;
}

function statCell(label, value) {
  return `<div class="bl-stat"><span class="bs-label">${label}</span><span class="bs-value">${value}</span></div>`;
}

function decisionSuffix(i) {
  if (!i.decision) return "";
  if (i.decision === "approved") return i.conditional ? " · approved (adjusted)" : " · approved";
  return ` · ${escapeHtml(i.decision)}`;
}

// ------------------------------------------------------------ controls
els.signInBtn.addEventListener("click", signIn);
els.signOutBtn.addEventListener("click", signOut);
els.startBtn.addEventListener("click", () => sendCommand("start", { approvalMode: els.modeSelect.value }));
els.resumeSavedBtn.addEventListener("click", () => sendCommand("resumeSaved"));
els.pauseBtn.addEventListener("click", () => sendCommand("pause"));
els.resumeBtn.addEventListener("click", () => sendCommand("resume"));
els.retryFailedBtn.addEventListener("click", () => sendCommand("retryFailed"));
els.skipFailedBtn.addEventListener("click", () => {
  // The failing line is identifiable from the same projected flag the button
  // itself is gated on, so there is nothing new to send from the laptop.
  const line = ((lastPayload && lastPayload.lines) || []).find((l) => l.retryFailedEligible);
  if (!line) return toast("No failed line to skip.", true);
  sendCommand("skipLine", { lineId: line.lineId, asin: line.asin });
});
if (els.densityRow) {
  for (const btn of els.densityRow.querySelectorAll(".density-btn")) {
    btn.addEventListener("click", () => setDensity(btn.dataset.density));
  }
}
els.soundBtn.addEventListener("click", () => {
  // ⚠ primeAudio() MUST run synchronously inside this handler - iOS only
  // grants an AudioContext the right to make noise from a real gesture.
  if (!soundsOn) {
    if (!primeAudio()) return toast("This browser has no Web Audio support.", true);
    soundsOn = true;
    store.set("soundsOn", true);
    renderSoundButton();
    playSound("chunk-complete");
    toast("Sounds on.");
  } else {
    soundsOn = false;
    store.set("soundsOn", false);
    renderSoundButton();
    toast("Sounds off.");
  }
});
els.finishNowBtn.addEventListener("click", () => sendCommand("finishNow"));
// B-875 (v2.0.25): set every House count from its Receive tally.
els.invReceiveAllBtn.addEventListener("click", invOpenReceiveAll);
// B-912 (v2.0.29): "Print FNSKU labels" - the laptop runs its follow-the-batch print and this
// waits for its answer (the command row's result) so the phone can say what printed.
// B-937 (v2.0.35): a product over the label cap is ASKED about before anything prints - the
// laptop answers with `askPrompt` (lib/remote-protocol.js labelCapPrompt): one "Print N labels
// for <title>?" per product with Yes / Skip; once each has an answer the same command goes again
// with approved / declined. Nothing is answered for Zach.
function invLabelCapAsk(note, prompt, onAnswered) {
  const picks = {};
  const box = invNode("div", "lbl-ask");
  box.appendChild(invNode("div", "muted", (prompt.title || "Over the label cap") + " - " + (prompt.detail || "nothing has printed yet.")));
  for (const it of prompt.items || []) {
    const row = invNode("div", "lbl-ask-row");
    row.appendChild(invNode("div", "lbl-ask-q", it.question || ("Print " + it.total + " labels?")));
    const btns = invNode("div", "lbl-ask-btns");
    const mk = (answer, cls) => {
      const x = invNode("button", cls, (prompt.labels && prompt.labels[answer]) || (answer === "yes" ? "Yes" : "Skip"));
      x.type = "button";
      x.dataset.fnsku = it.fnsku;
      x.dataset.answer = answer;
      x.addEventListener("click", () => {
        picks[it.fnsku] = answer;
        for (const y of btns.querySelectorAll("button")) y.disabled = true;
        row.appendChild(invNode("div", "muted", answer === "yes" ? "Will print." : "Skipped."));
        if ((prompt.items || []).every((z) => picks[z.fnsku])) {
          onAnswered({
            approved: prompt.items.filter((z) => picks[z.fnsku] === "yes").map((z) => z.fnsku),
            declined: prompt.items.filter((z) => picks[z.fnsku] === "skip").map((z) => z.fnsku),
          });
        }
      });
      btns.appendChild(x);
    };
    mk("yes", "primary-btn");
    mk("skip", "secondary-btn");
    row.appendChild(btns);
    box.appendChild(row);
  }
  note.appendChild(box);
}
function invLabelsText(status, r, res) {
  let text = status === "done" ? "Printed." : `Not printed (${status}).`;
  const where = res && res.batches && res.batches.length ? " - " + res.batches.map((x) => x.name || x.batchId).join(", ") : "";
  const labels = res && Number.isFinite(Number(res.printedLabels)) ? Number(res.printedLabels) : res && res.printed && res.printed.length ? res.printed.reduce((t, p) => t + (p.total || 0), 0) : 0;
  const products = res && Number.isFinite(Number(res.printedProducts)) ? Number(res.printedProducts) : res && res.printed ? res.printed.length : 0;
  if (res && res.truncated) text = "The laptop answered, but its answer was too long to show - check the laptop's Last prints.";
  else if (labels > 0) text = `Printed ${labels} label(s) for ${products} product(s)${where}.`;
  else if (res && res.askPrompt) text = "Nothing printed yet:";
  else if (res && res.nothing) text = "Nothing to print - everything in the open batch is printed already.";
  else if (res && res.error) text = `Not printed: ${res.error}`;
  else if (r && r.reason) text = `Not printed: ${r.reason}`;
  if (res && Number(res.declined) > 0) text += ` Skipped on your answer: ${res.declined}.`;
  if (res && res.held && res.held.length) text += " Held (over the cap - print from the laptop): " + res.held.map((h) => (h.title || h.fnsku) + " x" + h.total).join(", ") + ".";
  return text;
}
async function invPrintLabels(answers = null) {
  const b = els.invPrintLabelsBtn, note = els.invPrintLabelsNote;
  if (!b || (b.disabled && !answers)) return;
  b.disabled = true; note.hidden = false; note.textContent = "Asking the laptop to print\u2026";
  try {
    const id = await sendCommand("printLabels", answers ? { approved: answers.approved, declined: answers.declined } : {});
    const status = await waitFor(id);
    let text = status === "done" ? "Printed." : `Not printed (${status}).`;
    let ask = null;
    if (id) {
      const row = await sb(`commands?id=eq.${encodeURIComponent(id)}&select=result,reason`);
      const r = row.ok && Array.isArray(row.json) && row.json[0] ? row.json[0] : null;
      const res = r && r.result;
      text = invLabelsText(status, r, res);
      ask = res && res.askPrompt && Array.isArray(res.askPrompt.items) && res.askPrompt.items.length ? res.askPrompt : null;
    }
    note.textContent = text;
    if (ask) invLabelCapAsk(note, ask, (a) => invPrintLabels(a));
  } catch (err) {
    note.textContent = `Not printed: ${err.message}`;
  } finally {
    b.disabled = false;
  }
}
if (els.invPrintLabelsBtn) els.invPrintLabelsBtn.addEventListener("click", () => invPrintLabels());
els.abortBtn.addEventListener("click", () => {
  if (confirm("Abort the run? Whatever is mid-purchase is interrupted.")) sendCommand("abort");
});
els.addBtn.addEventListener("click", () => {
  const asin = els.addAsin.value.trim().toUpperCase();
  if (!asin) return;
  sendCommand("addManualLine", {
    asin,
    qty: Number(els.addQty.value) || 1,
    priority: els.addPriority.value,
    destination: els.addDest && els.addDest.value === "prep" ? "prep" : "house",
  });
  els.addAsin.value = "";
  els.addQty.value = "";
});
els.generateBtn.addEventListener("click", () => sendCommand("generateBuylist"));
els.approveAllBtn.addEventListener("click", () => sendCommand("buylistApproveAll"));

// P-29. Four commands the laptop has always accepted with nothing on the
// phone to send them.
//
// `preview` matters most: the deploy README's own acceptance checklist
// says "a preview refresh arrives", and until now that step could not be
// performed from the phone at all.
els.previewBtn.addEventListener("click", () => sendCommand("preview"));

// Destructive, so it confirms - same treatment as Abort.
els.discardSavedBtn.addEventListener("click", () => {
  if (confirm("Discard the saved queue? It cannot be brought back.")) sendCommand("discardSaved");
});

els.blAddBtn.addEventListener("click", () => {
  const asin = els.blAddAsin.value.trim().toUpperCase();
  if (!asin) return;
  sendCommand("buylistAddManual", { asin, qty: Number(els.blAddQty.value) || 1 });
  els.blAddAsin.value = "";
  els.blAddQty.value = "";
});
// P-34: the ONLY place permission is ever requested, and it is a tap.
els.pushBtn.addEventListener("click", () => setupPush((msg, bad) => toast(msg, !!bad)));

// P-35. Two different jobs that are easy to confuse:
//   Refresh    - ask the relay for state again, right now.
//   Reload app - throw away the CACHED app.js / styles.css / config.js and
//                fetch them fresh. This is the one that matters after a
//                deploy: a Home Screen app has no address bar and no
//                reload button, so without this the only way to pick up a
//                new build is deleting the icon and re-adding it.
els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.disabled = true;
  try {
    await poll();
    toast("Refreshed");
  } finally {
    els.refreshBtn.disabled = false;
  }
});

els.reloadBtn.addEventListener("click", () => {
  // A query string is what actually defeats the cache here; reload(true)
  // is non-standard and ignored by WebKit.
  const base = location.href.split("?")[0].split("#")[0];
  location.replace(base + "?r=" + Date.now());
});

els.tabDashboard.addEventListener("click", () => switchTab("dashboard"));
els.tabRun.addEventListener("click", () => switchTab("run"));
els.tabBuylist.addEventListener("click", () => switchTab("buylist"));
els.tabInventory.addEventListener("click", () => switchTab("inventory"));
els.tabFba.addEventListener("click", () => switchTab("fba"));
els.tabBelowMin.addEventListener("click", () => switchTab("belowmin"));
els.tabWizard.addEventListener("click", () => switchTab("wizard"));
els.tabCashFlow.addEventListener("click", () => switchTab("cashflow"));
if (self.ShopperBelowMinView) self.ShopperBelowMinView.wire();
if (self.ShopperCashFlowView) self.ShopperCashFlowView.wire();
// B-663 (v4.85): the arrivals line opens the Arrivals boxes on the Inventory tab.
function openArrivals() {
  switchTab("inventory");
  if (els.invArrivals && els.invArrivals.scrollIntoView) els.invArrivals.scrollIntoView({ block: "start" });
}
// B-662 (v4.85): the Bank view's way back.
els.bankBack.addEventListener("click", () => switchTab("dashboard"));
els.invFilter.addEventListener("input", () => renderInventory(lastPayload && lastPayload.inventory));
// B-465: a tile opens its bucket's table; the same tile closes it.
for (const tile of document.querySelectorAll(".inv-total[data-bucket]")) {
  const toggle = () => {
    invBucket = invBucket === tile.dataset.bucket ? null : tile.dataset.bucket;
    renderInventory(lastPayload && lastPayload.inventory);
  };
  tile.addEventListener("click", toggle);
  tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
}

// P-64 (v2.98): with 14+ lines the currently-buying card scrolls out of
// view, and the one-line step narration lives up by the controls, away from
// where he is actually looking. Sticky strip, no new payload fields -
// currentAsin and currentStep have both always been projected.
function renderNowStrip(p) {
  const run = p.run || null;
  const busy = run && (run.status === "running" || run.status === "collecting_urls");
  const asin = run && run.currentAsin;
  const step = run && run.currentStep;
  if (!busy || (!asin && !step)) {
    els.nowStrip.hidden = true;
    return;
  }
  els.nowStrip.hidden = false;
  const line = asin ? (p.lines || []).find((l) => l.asin === asin) : null;
  els.nowAsin.textContent = asin ? (line && line.title ? `${asin} - ${line.title}` : asin) : "";
  // B-774 (v2.0.9): the engine's own sentence when there is one (the queue's
  // "Opening X..." used to sit here for the whole line).
  els.nowStep.textContent = (run && run.engineStep) || step || "";
}

// P-65 (v2.98): the end-of-queue report, phone-shaped. The desktop's own
// renderReport() is a dense <table> that does not fit here, so this mirrors
// its CONTENT model (urgent items first and loud, then the money summary,
// then one stacked section per outcome bucket) rather than its markup.
const REPORT_BUCKET_LABELS = {
  bought: "Bought",
  partial: "Partial",
  failed: "Failed",
  needsApproval: "Needs price check",
  // B-774 (v2.0.9): a safety cap never approved had no section.
  needsCapApproval: "Needs cap approval",
  outOfStock: "Out of stock",
  skippedNoUrl: "No source URL",
  skippedManualRetailer: "Manual buy (unsupported site)",
  skippedNoCost: "No cost data",
  notAttempted: "Not attempted",
  notNeeded: "Not needed",
  needsConfirmation: "Needs confirmation",
  notBought: "Not bought",
  skippedByUser: "Skipped by you",
};

function renderReport(run) {
  // B-776 (v2.0.9): once the queue is cleared on the laptop, the Run tab
  // keeps showing the LAST finished run's report (storage
  // shopperBuyQueueLastReport, projected as lastReport).
  const lr = (lastPayload && lastPayload.lastReport) || null;
  const own = run && run.report;
  const report = own || (lr && lr.report) || null;
  if (!report) {
    els.reportCard.hidden = true;
    return;
  }
  els.reportCard.hidden = false;
  if (els.reportHead) {
    els.reportHead.textContent = own ? "Run report" : `Last run report${lr && lr.finishedAt ? " · " + centralText(lr.finishedAt) : ""}`;
  }
  const parts = reportParts(report);
  els.reportUrgent.hidden = !parts.urgentCount;
  els.reportUrgent.innerHTML = parts.urgent;
  els.reportSummary.innerHTML = parts.summary;
  els.reportBuckets.innerHTML = parts.buckets;
}

// The report as three HTML strings (escaped), shared by the Run tab's card
// and the report sheet (remote/run-view.js).
function reportParts(report) {

  // The two lists that exist precisely because they are easy to miss - see
  // buildBuyQueueReport's own comment quoting Zach on reporting these
  // "boldly". Never truncated, never collapsed.
  const urgent = report.urgentTodo || [];
  const urgentHtml = urgent.length
    ? `<h3 class="report-urgent-head">Urgent - needs you (${urgent.length})</h3>` +
      urgent.map((t) => `<div class="report-urgent-item">${escapeHtml(t.text)}</div>`).join("")
    : "";

  const v = report.verification || {};
  const pcv = report.prepCenterVerification;
  const checks = [];
  for (const key of ["replenPulse", "sellerboard"]) {
    const c = v[key];
    if (!c) continue;
    checks.push(
      `${escapeHtml(c.label)}: ${c.checked} checked, ${c.matched} matched, ${c.fixed} fixed, ${c.stillWrong} still wrong`
    );
  }
  if (pcv) {
    checks.push(
      `${escapeHtml(pcv.label)}: ${pcv.checked} checked, ${pcv.present} on the sheet, ${pcv.fixed} written by the re-check, ${pcv.missing} missing`
    );
  }

  const summaryHtml =
    `<div class="report-money">` +
    `<span>Spent <strong>${money(report.totalSpent)}</strong></span>` +
    `<span>Target ${money(report.spendTarget)}</span>` +
    `${report.shortfall > 0 ? `<span class="report-short">Short ${money(report.shortfall)}</span>` : ""}` +
    `</div>` +
    (checks.length ? `<div class="report-checks">${checks.map((c) => `<div>${c}</div>`).join("")}</div>` : "") +
    ((report.manualTodo || []).length
      ? `<details class="report-manual"><summary>To do by hand (${report.manualTodo.length})</summary>` +
        report.manualTodo.map((t) => `<div class="report-manual-item">${escapeHtml(t)}</div>`).join("") +
        `</details>`
      : "");

  const buckets = report.buckets || {};
  const RL = self.ShopperRunLib || null;
  const bucketsHtml = Object.keys(REPORT_BUCKET_LABELS)
    .filter((k) => buckets[k])
    .map((k) => {
      const b = buckets[k];
      const rows = b.lines
        .map(
          (l) =>
            `<div class="report-line"><span class="report-line-asin">${escapeHtml(l.asin)}</span>` +
            `<span class="report-line-title">${escapeHtml(l.title)}</span>` +
            `<span class="report-line-qty">${l.boughtQty}/${l.qty} · ${money(l.spentDollars)}${RL && (l.endedOutOfStock || l.limitReached || l.recoveryDefect) ? ` · ${escapeHtml(RL.outcomeLabel(l, QUEUE_STATUS_LABELS))}` : ""}</span>` +
            `${l.stopReason || l.error ? `<span class="report-line-note">${escapeHtml(l.stopReason || l.error)}</span>` : ""}</div>`
        )
        .join("");
      return (
        `<details class="report-bucket"><summary>${escapeHtml(REPORT_BUCKET_LABELS[k])} (${b.count})</summary>` +
        rows +
        (b.truncated ? `<div class="muted small">Showing ${b.lines.length} of ${b.count}.</div>` : "") +
        `</details>`
      );
    })
    .join("");
  return { urgent: urgentHtml, urgentCount: urgent.length, summary: summaryHtml, buckets: bucketsHtml };
}

// ------------------------------------------------------------- P-58
// Sounds, the phone's own implementation.
//
// The extension's four sounds cannot be reused as a mechanism: an MV3
// service worker cannot play audio at all, so background.js drives a hidden
// chrome.offscreen document, and chrome.offscreen does not exist in a
// browser or an installed PWA. The four .wav files themselves are also not
// worth shipping here - they are synthesized tones already (see the
// backlog's own note about swapping in real ones), so the same tones are
// generated with Web Audio instead: no binary assets to deploy, nothing to
// fetch, and it works with the app offline.
//
// ⚠ iOS is the real constraint, and it is the same shape as P-34's
// notification bug: Safari blocks audio that is not the direct result of a
// user gesture, silently. An AudioContext created and resumed inside a real
// tap keeps working afterwards, so the "Sounds: on" button is not a
// preference toggle with a side effect - the tap IS what makes sound
// possible at all. Kept off by default for that reason: a switch he has to
// press once, in the app, is honest; a setting that silently does nothing
// is the failure this pattern already produced once.
let audioCtx = null;
let soundsOn = !!store.get("soundsOn");
const SOUND_SPECS = {
  "order-placed": [[880, 0.09], [1320, 0.13]],
  "chunk-complete": [[660, 0.08], [990, 0.11]],
  "queue-finished": [[523, 0.12], [659, 0.12], [784, 0.22]],
  alert: [[440, 0.16], [330, 0.24]],
};

function primeAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return true;
}

function playSound(kind) {
  if (!soundsOn || !audioCtx || audioCtx.state !== "running") return;
  const spec = SOUND_SPECS[kind];
  if (!spec) return;
  let at = audioCtx.currentTime + 0.01;
  for (const [freq, dur] of spec) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    // Ramped, not switched: a bare start/stop on a sine is an audible click.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    at += dur;
  }
}

function renderSoundButton() {
  if (!els.soundBtn) return;
  els.soundBtn.textContent = soundsOn ? "Sounds: on" : "Sounds: off";
  els.soundBtn.classList.toggle("active", soundsOn);
}

// The phone has poll-based state and no event stream, so a sound has to be
// driven by DIFFING one payload against the last - never by "the payload
// says bought", which would fire on every tick for the rest of the run.
// Deliberately silent on the very first payload after opening the app: the
// whole run's history arrives at once there, and replaying it as a burst of
// sounds would be noise, not information.
let prevSoundState = null;

function soundStateOf(p) {
  const run = p.run || null;
  const lines = {};
  for (const l of p.lines || []) lines[l.lineId] = l.status;
  return {
    status: (run && run.status) || "",
    totalSpent: (run && run.totalSpent) || 0,
    promptKind: p.prompt ? p.prompt.kind : null,
    lines,
  };
}

const SOUND_DONE_STATUSES = new Set(["bought", "confirmed_bought", "partial", "assumed_met"]);
const SOUND_END_STATUSES = new Set(["done", "aborted", "error"]);

function maybePlaySounds(p) {
  const next = soundStateOf(p);
  const prev = prevSoundState;
  prevSoundState = next;
  if (!prev || !soundsOn) return;

  // A run that just ended outranks everything else that happened on the
  // same tick - one sound per tick, the most important one.
  if (SOUND_END_STATUSES.has(next.status) && !SOUND_END_STATUSES.has(prev.status)) {
    playSound("queue-finished");
    return;
  }
  // A prompt that has just appeared is the one thing that actually needs
  // him; same transition-only rule the push notification uses.
  if (next.promptKind && next.promptKind !== prev.promptKind) {
    playSound("alert");
    return;
  }
  const finished = Object.keys(next.lines).some(
    (id) => SOUND_DONE_STATUSES.has(next.lines[id]) && !SOUND_DONE_STATUSES.has(prev.lines[id] || "")
  );
  if (finished) {
    playSound("chunk-complete");
    return;
  }
  if (next.totalSpent > prev.totalSpent) playSound("order-placed");
}

// B-834 (v2.0.18): the Min tab's Send bar sits right above the bottom tab bar;
// the bar's real height (it changes with the theme and the home-indicator
// inset) is measured into --tabbar-h.
function syncTabBarHeight() {
  try {
    const bar = document.querySelector("#mainView > .tabs");
    const h = bar ? bar.offsetHeight : 0;
    if (h > 0) document.documentElement.style.setProperty("--tabbar-h", h + "px");
  } catch (e) { /* the CSS fallback is a good guess */ }
}
window.addEventListener("resize", syncTabBarHeight);
try {
  if (typeof ResizeObserver === "function") {
    const barEl = document.querySelector("#mainView > .tabs");
    if (barEl) new ResizeObserver(syncTabBarHeight).observe(barEl);
  }
} catch (e) { /* resize + switchTab cover it */ }

function switchTab(which) {
  syncTabBarHeight();
  // B-874 (v2.0.24): the top bar names the tab ("SHOPPER Run").
  if (self.ShopperTopbar) self.ShopperTopbar.tab(which);
  els.runPane.hidden = which !== "run";
  els.buylistPane.hidden = which !== "buylist";
  els.inventoryPane.hidden = which !== "inventory";
  els.dashboardPane.hidden = which !== "dashboard";
  els.fbaPane.hidden = which !== "fba";
  els.belowMinPane.hidden = which !== "belowmin";
  els.wizardPane.hidden = which !== "wizard";
  els.tabWizard.classList.toggle("active", which === "wizard");
  // B-765 (v2.0.8): the Cash tab; its charts are drawn at the pane's real width.
  els.cashFlowPane.hidden = which !== "cashflow";
  els.tabCashFlow.classList.toggle("active", which === "cashflow");
  if (which === "cashflow" && self.ShopperCashFlowView) self.ShopperCashFlowView.shown();
  // B-662 (v4.85): the Bank view is part of the Dashboard (no tab button of its own).
  els.bankPane.hidden = which !== "bank";
  if (which === "bank") scrollAppTop();
  els.tabFba.classList.toggle("active", which === "fba");
  els.tabBelowMin.classList.toggle("active", which === "belowmin");
  // The chart is drawn at the pane's real width, which is 0 while hidden.
  if (which === "fba" && self.ShopperFbaView) self.ShopperFbaView.shown();
  els.tabDashboard.classList.toggle("active", which === "dashboard" || which === "bank");
  els.tabRun.classList.toggle("active", which === "run");
  els.tabBuylist.classList.toggle("active", which === "buylist");
  els.tabInventory.classList.toggle("active", which === "inventory");
}

// ------------------------------------------------ B-459: Inventory (read-only)
//
// Every figure is what the laptop's pipeline last STORED (lib/remote-
// inventory.js projects it; nothing here adds, merges or re-dates). Built
// with textContent only. Rebuilt only when the projection or the filter
// changes, so the 3-second poll never fights the filter box.
let lastInventoryKey = "";

function invNode(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

// B-645 (v4.84): partial units as a fraction ("1,060 1/3"). A copy of
// lib/unit-fraction.js formatUnitsFraction (this page is a classic script);
// test/v484-build.test.mjs runs both over the same values.
function shopperUnitsFraction(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "0";
  const sign = x < 0 ? "-" : "";
  const a = Math.abs(x);
  let whole = Math.floor(a + 1e-9);
  const frac = a - whole;
  if (frac < 0.0005) return sign + whole.toLocaleString("en-US");
  if (1 - frac < 0.0005) return sign + (whole + 1).toLocaleString("en-US");
  let best = null;
  for (const d of [2, 3, 4, 5, 6, 8, 10, 12]) {
    const num = Math.round(frac * d);
    if (num <= 0 || num >= d) continue;
    const err = Math.abs(frac - num / d);
    if (!best || err < best.err - 1e-9) best = { num, d, err };
  }
  if (!best) {
    whole = Math.round(a);
    return (whole === 0 ? "" : sign) + whole.toLocaleString("en-US");
  }
  const gcd = (p, q) => (q ? gcd(q, p % q) : p);
  const g = gcd(best.num, best.d);
  const f = `${best.num / g}/${best.d / g}`;
  return sign + (whole ? `${whole.toLocaleString("en-US")} ${f}` : f);
}
self.shopperUnitsFraction = shopperUnitsFraction;

function invUnits(v) {
  return shopperUnitsFraction(Number(v) || 0);
}

function invDay(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function invAgo(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "never";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
}

function invArrivalBox(title, box, tone, kind) {
  const wrap = invNode("div", "inv-box" + (tone ? " inv-box-" + tone : ""));
  const head = invNode("div", "inv-box-head");
  head.appendChild(invNode("b", null, title));
  head.appendChild(invNode("span", "count", box.rowCount + " product(s) · " + invUnits(box.units) + "u"));
  wrap.appendChild(head);
  if (!box.rows.length) {
    wrap.appendChild(invNode("div", "muted", "Nothing."));
    return wrap;
  }
  for (const r of box.rows) {
    const row = invNode("div", "line inv-arrival" + (r.destination === "prep" ? " dest-prep" : r.destination === "house" ? " dest-house" : "")); // B-801 (v2.0.10)
    const top = invNode("div", "inv-row-top");
    top.appendChild(invNode("span", "inv-title", r.title || r.asin));
    top.appendChild(invNode("b", "inv-units", invUnits(r.units) + "u"));
    row.appendChild(top);
    const bits = [r.asin, r.retailer, r.destination === "prep" ? "to Prep" : r.destination === "house" ? "to House" : ""];
    if (r.date) bits.push((r.isGuess ? "~" : "") + invDay(r.date));
    if (r.daysLate > 0) bits.push(r.daysLate + "d late");
    if (r.carrier) bits.push(r.carrier);
    row.appendChild(invNode("div", "l-meta", bits.filter(Boolean).join(" · ")));
    // v4.74 (B-569): last update, and "It arrived" + date (every row since B-691).
    if (self.ShopperParity) self.ShopperParity.decorateArrival(row, r, kind || "");
    wrap.appendChild(row);
  }
  if (box.rowCount > box.rows.length) wrap.appendChild(invNode("div", "muted", "+" + (box.rowCount - box.rows.length) + " more on the laptop"));
  return wrap;
}

function renderInventory(inv) {
  // v4.74: rows now carry inputs (count, expiry, It arrived date) - never
  // rebuild under a finger that is typing (P-36's rule).
  if (isBeingEdited(els.inventoryPane)) return;
  const filter = (els.invFilter.value || "").trim().toLowerCase();
  const key = JSON.stringify(inv || null) + "|" + JSON.stringify((lastPayload && lastPayload.houseExpiry) || null) + "|" + filter + "|" + invBucket;
  if (key === lastInventoryKey) return;
  lastInventoryKey = key;
  els.invArrivals.textContent = "";
  els.invRows.textContent = "";
  if (!inv || !inv.available) {
    els.invAsOf.textContent = inv
      ? "Nothing on file yet - run a refresh on the laptop's Inventory Pipeline page."
      : "Waiting for the laptop to send inventory (needs Shopper v4.49 on the laptop).";
    els.invHouse.textContent = els.invPrep.textContent = els.invTransit.textContent = "-";
    els.invArrivalsCount.textContent = els.invProductCount.textContent = "";
    renderInvBucket(null);
    return;
  }
  els.invAsOf.textContent = "As of the laptop's last pipeline refresh, " + invAgo(inv.generatedAt) + " (" + new Date(inv.generatedAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT).";
  els.invHouse.textContent = invUnits(inv.totals.house);
  els.invPrep.textContent = invUnits(inv.totals.prep);
  els.invTransit.textContent = invUnits(inv.totals.inTransit);
  renderInvBucket(inv);

  const a = inv.arrivals;
  if (!a) {
    els.invArrivalsCount.textContent = "";
    els.invArrivals.appendChild(invNode("div", "muted", "The arrivals report was not built on the last refresh."));
  } else {
    const c = a.counts;
    els.invArrivalsCount.textContent = c.guessed ? "(~ = estimated from past lead time)" : "";
    if (a.overdue.rowCount) els.invArrivals.appendChild(invArrivalBox("Overdue", a.overdue, "bad", "overdue"));
    els.invArrivals.appendChild(invArrivalBox("Today", a.today, "good"));
    els.invArrivals.appendChild(invArrivalBox("Tomorrow", a.tomorrow));
    for (const b of a.later) els.invArrivals.appendChild(invArrivalBox(invDay(b.day), b));
    if (a.laterDayCount > a.later.length) els.invArrivals.appendChild(invNode("div", "muted", "+" + (a.laterDayCount - a.later.length) + " more day(s) on the laptop"));
    if (a.undated.rowCount) els.invArrivals.appendChild(invArrivalBox("No date yet", a.undated));
  }

  const rows = inv.rows.filter((r) => !filter || r.asin.toLowerCase().includes(filter) || (r.title || "").toLowerCase().includes(filter));
  els.invProductCount.textContent = "(" + (filter ? rows.length + " of " : "") + inv.productCount + ")";
  for (const r of rows) {
    const row = invNode("div", "line inv-product");
    const top = invNode("div", "inv-row-top");
    top.appendChild(invNode("span", "inv-title", r.title || r.asin));
    row.appendChild(top);
    const nums = invNode("div", "inv-nums");
    nums.appendChild(invNode("span", "inv-n inv-house" + (r.house < 0 ? " inv-neg" : ""), "House " + invUnits(r.house)));
    nums.appendChild(invNode("span", "inv-n inv-prep" + (r.prep < 0 ? " inv-neg" : ""), "Prep " + invUnits(r.prep)));
    nums.appendChild(invNode("span", "inv-n inv-transit", "Transit " + invUnits(r.inTransit)));
    row.appendChild(nums);
    row.appendChild(invNode("div", "l-meta", r.asin));
    // v4.74 (B-570/B-571): pencil count + house expiry date.
    if (self.ShopperParity) self.ShopperParity.decorateProduct(row, r);
    els.invRows.appendChild(row);
  }
  if (inv.rowsTruncated) els.invRows.appendChild(invNode("div", "muted", "Showing the " + inv.rows.length + " largest - the rest are on the laptop."));
}

// B-465 (v4.50). One bucket's products, largest first. Read-only, from the
// rows the laptop already sent - nothing is fetched or re-added here.
const INV_BUCKETS = {
  house: { field: "house", label: "House" },
  prep: { field: "prep", label: "Prep" },
  transit: { field: "inTransit", label: "In transit" },
};

function invBucketRows(rows, bucket) {
  const b = INV_BUCKETS[bucket];
  if (!b) return [];
  return (rows || [])
    .filter((r) => Number(r[b.field]) !== 0 && Number.isFinite(Number(r[b.field])))
    .sort((x, y) => Number(y[b.field]) - Number(x[b.field]));
}

// B-840 (v2.0.21): "Receive" - count a delivery a chunk at a time (remote/receive-count.js).
// The tally lives on this phone only. Nothing is sent until Zach answers "Yes, set it";
// then it goes as the SAME setCount command the pencil uses (the laptop owns the rule).
function invReceiveError(status) {
  if (status === "not sent") return "The command did not reach the laptop, so nothing was saved.";
  if (status === "timeout") return "The laptop did not answer, so nothing is confirmed. Check the Pipeline page before you try again.";
  if (status === "rejected") return "The laptop refused it, so nothing was saved.";
  if (status === "error") return "The laptop could not save it.";
  return "The laptop answered \"" + status + "\", so nothing was saved.";
}

// B-843 (v2.0.22): the tally follows Zach between the phone and the laptop. A tally edited here is sent
// to the laptop (the quiet command receiveTallySet, newest edit per product wins); what the laptop holds
// arrives in every inventory payload (inventory.receiveTallies) and is merged in. Without the laptop the
// tally still works on its own, as before.
const rcSync = { started: false, timers: new Map(), lastSent: new Map() };
function rcSyncSend(e) {
  const asin = e.asin;
  clearTimeout(rcSync.timers.get(asin));
  rcSync.timers.set(asin, setTimeout(() => {
    rcSync.timers.delete(asin);
    rcSync.lastSent.set(asin, { at: Date.now(), updatedAt: e.updatedAt });
    sendCommand("receiveTallySet", { asin, chunks: e.chunks, updatedAt: e.updatedAt }, { quiet: true }).catch(() => {});
  }, 600));
}
function rcSyncStart() {
  if (rcSync.started || !self.ShopperReceive || !self.ShopperReceive.onStoreChange) return;
  rcSync.started = true;
  self.ShopperReceive.onStoreChange(rcSyncSend);
  // B-933 (v2.0.35): the x on a "Counted N" chip clears that tally - the Receive labels follow.
  if (self.ShopperReceive.onBadgeClear) self.ShopperReceive.onBadgeClear(() => invRefreshReceiveButtons());
}
function rcSyncApply(inv) {
  const RC = self.ShopperReceive;
  if (!RC || !RC.applyRemote) return;
  rcSyncStart();
  if (!inv || !inv.receiveTallies) return;
  const changed = RC.applyRemote(inv.receiveTallies);
  if (changed.length) invRefreshReceiveButtons();
  invPaintReceiveAll(inv);
  // Anything counted here that the laptop does not have yet (a command that never arrived) goes again,
  // at most every 30 s per product.
  for (const e of RC.diffNewer(inv.receiveTallies)) {
    if (rcSync.timers.has(e.asin)) continue;
    const s = rcSync.lastSent.get(e.asin);
    if (s && s.updatedAt === e.updatedAt && Date.now() - s.at < 30000) continue;
    rcSyncSend(e);
  }
}

// The row buttons show the tally in progress ("Receive · 36"). The count rides in a no-wrap span so a
// narrow button breaks between "Receive" and "· 36", never after the dot.
function invSetReceiveLabel(b, asin) {
  const label = self.ShopperReceive.buttonLabel(asin);
  const at = label.indexOf(" ");
  b.textContent = at < 0 ? label : label.slice(0, at + 1);
  if (at >= 0) b.appendChild(invNode("span", "rc-tally", label.slice(at + 1)));
}

// The pop-up calls this on every change of a tally.
function invRefreshReceiveButtons() {
  if (!self.ShopperReceive) return;
  for (const b of els.invBucketTable.querySelectorAll(".rc-row-btn")) invSetReceiveLabel(b, b.dataset.asin);
  self.ShopperReceive.paintBadges(els.invBucketTable);
  invPaintReceiveAll(lastPayload && lastPayload.inventory);
}

function invOpenReceive(r) {
  if (!self.ShopperReceive) return;
  rcSyncStart();
  self.ShopperReceive.open({
    asin: r.asin,
    title: r.title || r.asin,
    expected: r.house,
    expectedText: invUnits(r.house),
    format: invUnits,
    where: "House",
    onChange: invRefreshReceiveButtons,
    onConfirm: async (units) => {
      const id = await sendCommand("setCount", { asin: r.asin, destination: "house", units, note: "Receive count from the phone" });
      const status = id ? await waitFor(id) : "not sent";
      return { ok: status === "done", error: status === "done" ? "" : invReceiveError(status) };
    },
  });
}

function invReceiveButton(r) {
  const b = invNode("button", "rc-row-btn");
  invSetReceiveLabel(b, r.asin);
  b.type = "button";
  b.dataset.asin = r.asin;
  b.setAttribute("aria-label", "Receive count for " + (r.title || r.asin));
  b.addEventListener("click", () => invOpenReceive(r));
  return b;
}

function renderInvBucket(inv) {
  for (const t of document.querySelectorAll(".inv-total[data-bucket]")) {
    const on = !!(inv && inv.available) && t.dataset.bucket === invBucket;
    t.classList.toggle("inv-total-on", on);
    t.setAttribute("aria-pressed", on ? "true" : "false");
  }
  els.invBucketTable.textContent = "";
  invPaintReceiveAll(inv);
  const b = INV_BUCKETS[invBucket];
  if (!b || !inv || !inv.available) { els.invBucketPanel.hidden = true; return; }
  els.invBucketPanel.hidden = false;
  const rows = invBucketRows(inv.rows, invBucket);
  els.invBucketTitle.textContent = b.label + " - " + rows.length + " product(s)";
  els.invBucketNote.textContent = inv.rowsTruncated
    ? "Only the " + inv.rows.length + " largest products reach the phone; the total above counts them all."
    : "";
  els.invBucketNote.hidden = !inv.rowsTruncated;
  if (!rows.length) {
    els.invBucketTable.appendChild(invNode("caption", "muted", "Nothing here."));
    return;
  }
  const head = invNode("tr");
  head.appendChild(invNode("th", null, "Product"));
  head.appendChild(invNode("th", null, "ASIN"));
  head.appendChild(invNode("th", "inv-num", "Units"));
  const thead = invNode("thead");
  thead.appendChild(head);
  const tbody = invNode("tbody");
  // B-840: only the House list gets a Receive button, under each product's ASIN.
  const withReceive = invBucket === "house" && !!self.ShopperReceive;
  for (const r of rows) {
    const tr = invNode("tr");
    const titleCell = invNode("td", "inv-title", r.title || r.asin);
    // B-844 (v2.0.22): a count in progress shows as a clear pill on the product's own line.
    if (withReceive) {
      const badge = invNode("span", "rc-badge");
      badge.dataset.asin = r.asin;
      // B-950 (v2.0.37): green when the count equals House, yellow when it doesn't.
      if (r.house != null && r.house !== "") { badge.dataset.house = String(r.house); badge.dataset.houseText = invUnits(r.house); }
      badge.hidden = true;
      titleCell.appendChild(badge);
      self.ShopperReceive.paintBadges(badge);
    }
    tr.appendChild(titleCell);
    const asinCell = invNode("td", "inv-asin", r.asin);
    if (withReceive) asinCell.appendChild(invReceiveButton(r));
    tr.appendChild(asinCell);
    tr.appendChild(invNode("td", "inv-num" + (Number(r[b.field]) < 0 ? " inv-neg" : ""), invUnits(r[b.field])));
    tbody.appendChild(tr);
  }
  els.invBucketTable.appendChild(thead);
  els.invBucketTable.appendChild(tbody);
}

// B-875 (v2.0.25): every product on the House list with a Receive tally -> its House count, in one
// go. Zach: the same as "Make this the House count" -> "Yes, set it" for each - the SAME setCount
// command the single confirm sends, one product at a time; the pop-up (receive-count.js openSetAll)
// shows the list first and clears each tally only after the laptop said done.
function invReceiveAllRows(inv) {
  return invBucketRows(inv && inv.rows, "house").map((r) => ({ asin: r.asin, title: r.title || r.asin, house: r.house }));
}

function invPaintReceiveAll(inv) {
  const b = els.invReceiveAllBtn;
  if (!b) return;
  const RC = self.ShopperReceive;
  const on = invBucket === "house" && !!(inv && inv.available) && !!(RC && RC.planSetAll && RC.openSetAll);
  const count = on ? RC.planSetAll(invReceiveAllRows(inv)).changes.length : 0;
  b.hidden = !count;
  b.textContent = "Set " + count + " House count" + (count === 1 ? "" : "s") + " from Receive";
}

function invOpenReceiveAll() {
  const RC = self.ShopperReceive;
  const inv = lastPayload && lastPayload.inventory;
  if (!RC || !RC.openSetAll || !inv) return;
  rcSyncStart();
  RC.openSetAll({
    rows: invReceiveAllRows(inv),
    format: invUnits,
    where: "House",
    write: async (asin, units) => {
      const id = await sendCommand("setCount", { asin, destination: "house", units, note: "Receive count from the phone" });
      const status = id ? await waitFor(id) : "not sent";
      return { ok: status === "done", error: status === "done" ? "" : invReceiveError(status) };
    },
    onDone: () => {
      invRefreshReceiveButtons();
      invPaintReceiveAll(lastPayload && lastPayload.inventory);
    },
  });
}

// ------------------------------------------------------------ push (iOS)
//
// On iPhone this does nothing at all until the app is on the Home Screen -
// Safari itself refuses. That is why the hint below is shown rather than
// silently failing: a prompt he never sees is a run that sits paused.
// ⚠⚠ P-34. THIS COULD NEVER HAVE WORKED, AND IT FAILED IN SILENCE.
//
// The v2.92/v2.93 version of this function was called once, from page
// init, right after render(). Inside it sat:
//
//     if (Notification.permission === "default")
//       await Notification.requestPermission();
//
// WebKit requires TRANSIENT USER ACTIVATION for requestPermission(). With
// no activation iOS Safari rejects the call silently - no prompt, no
// error, no rejected promise worth catching. Zach added the app to his
// Home Screen, signed in, and was simply never asked. There was nothing
// to see, which is why it took a code read to find.
//
// So permission is now only ever requested from a real tap, and every
// outcome says what happened. `report` is the callback the button passes
// in; the init path calls this with no reporter, purely to re-attach an
// EXISTING subscription, and never asks for anything.
async function setupPush(report) {
  const say = typeof report === "function" ? report : () => {};
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  els.installHint.hidden = standalone;

  // Every one of these used to be a bare `return`. Each is now a sentence.
  if (!standalone) {
    say("Add this to your Home Screen first - Safari refuses notifications in a browser tab.", true);
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    say("This iOS version does not support web push. iOS 16.4 or newer is required.", true);
    return;
  }
  if (!CFG.vapidPublicKey || CFG.vapidPublicKey.startsWith("YOUR-")) {
    say("Push is not configured - config.js has no VAPID key.", true);
    return;
  }
  if (Notification.permission === "denied") {
    // iOS REMEMBERS this, and re-asking does nothing at all. Say where to
    // undo it rather than looping on a call that cannot succeed.
    say("Notifications are blocked. Turn them on in iOS Settings > Notifications > Shopper.", true);
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register("sw.js");

    if (Notification.permission === "default") {
      // ⚠ Must be inside the tap. Do not hoist, defer, or await anything
      // slow before this line - the activation is spent quickly.
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        say("Notifications were not allowed.", true);
        return;
      }
    }

    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CFG.vapidPublicKey),
      }));

    const res = await sb("push_subs?on_conflict=endpoint", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [{ endpoint: sub.endpoint, subscription: sub.toJSON(), updated_at: new Date().toISOString() }],
    });
    if (!res.ok) {
      say("Could not save the subscription: " + res.reason, true);
      return;
    }
    say("Notifications are on.");
    renderPushButton();
  } catch (err) {
    // Still never allowed to break the app - but no longer allowed to be
    // invisible either.
    say("Could not turn on notifications: " + (err && err.message ? err.message : String(err)), true);
  }
}

// Shown until permission is actually granted, so the state is legible
// rather than inferred from an absence of notifications.
// P-35. Several hours went today on symptoms whose only cause was "the
// phone is running an older copy than you think". This makes that a
// glance instead of a database query: the app version plus the first few
// characters of the VAPID key, which is what actually differs between a
// current and a stale config.js.
function renderBuildStamp() {
  if (!els.buildStamp) return;
  const key = (CFG.vapidPublicKey || "").slice(0, 6) || "none";
  els.buildStamp.textContent = APP_BUILD + " · key " + key;
}

function renderPushButton() {
  if (!els.pushRow) return;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const granted = typeof Notification !== "undefined" && Notification.permission === "granted";
  els.pushRow.hidden = !standalone || granted;
}


function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------ boot
(function boot() {
  if (!CFG.url || CFG.url.includes("YOUR-PROJECT")) {
    els.signinError.hidden = false;
    els.signinError.textContent = "This app has not been configured yet - config.js still has placeholder values.";
  }
  const fromHash = readTokensFromHash();
  session = fromHash || store.get("shopper_session");
  if (fromHash) store.set("shopper_session", session);
  const dev = store.get("shopper_device");
  if (dev) { deviceId = dev.deviceId; deviceName = dev.deviceName; }
  render();
  // No reporter: this re-attaches an EXISTING subscription and must never
  // ask for permission (P-34 - it cannot succeed here anyway).
  setupPush();
  renderPushButton();
  renderBuildStamp();
  // v2.98: both read persisted state, so they have to paint once at boot -
  // the poll-driven renderers never touch either control.
  renderDensityButtons();
  renderSoundButton();
  // A phone that has been in a pocket for an hour must not show an hour-old
  // screen as if it were live.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();

// ------------------------------------------------ B-490: Dashboard (read-only)
//
// A mirror of the laptop's Dashboard as it last built it (lib/remote-
// dashboard.js projects the SAME snapshot the desktop page renders; nothing
// here recomputes a figure). textContent only. Rebuilt only when the
// projection changes, so the 3-second poll costs nothing on a quiet day.
let lastDashboardKey = "";

function dashMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  return "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dashMoneyShort(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return "$" + Math.round(Number(v)).toLocaleString();
}

function dashAgoMs(ms) {
  if (!ms) return "never";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 48 ? h + " h ago" : Math.round(h / 24) + " days ago";
}

// B-795 (v2.0.9): a Dashboard pipeline tile opens the matching view on the
// Inventory tab - House / Prep / In transit open that tile's product table,
// On hand the totals, Products the product list.
function openInventoryView(bucket, anchor) {
  invBucket = bucket || null;
  switchTab("inventory");
  renderInventory(lastPayload && lastPayload.inventory);
  const target = anchor === "products" ? els.invFilter : bucket ? els.invBucketPanel : els.inventoryPane;
  if (target && !target.hidden && target.scrollIntoView) target.scrollIntoView({ block: "start" });
  else scrollAppTop();
}

// B-796 (v2.0.9) / B-798 (v2.0.10): the page scrolls again (B-798 undid
// B-796's #app scroller); resetting both stays harmless.
function scrollAppTop() {
  window.scrollTo(0, 0);
  if (els.app) els.app.scrollTop = 0;
}

// B-662 (v4.85): the Bank view. Read-only; textContent only.
function renderBank(sp) {
  els.bankBal.textContent = dashMoney(sp && sp.bankBalance);
  els.bankAsOf.textContent = sp && sp.bankAsOf ? "read " + invAgo(new Date(sp.bankAsOf).toISOString()) : "";
  els.bankRows.textContent = "";
  const rows = sp && Array.isArray(sp.bankRecent) ? sp.bankRecent : null;
  if (!rows) {
    els.bankCount.textContent = "";
    els.bankRows.appendChild(invNode("div", "muted", "Not read yet - refresh the Dashboard on the laptop."));
    return;
  }
  els.bankCount.textContent = "(" + rows.length + ")";
  if (!rows.length) els.bankRows.appendChild(invNode("div", "muted", "No transactions on the Bank tab."));
  for (const r of rows) {
    const row = invNode("div", "line bank-row");
    const top = invNode("div", "bank-top");
    top.appendChild(invNode("span", "bank-what", r.title || r.asin || r.flag || "Entry"));
    top.appendChild(invNode("b", "bank-amt", r.totalDollars == null ? "-" : (r.totalDollars < 0 ? "-" : "") + dashMoney(Math.abs(r.totalDollars))));
    row.appendChild(top);
    const meta = [r.date, r.units != null ? r.units + "u" : "", r.runningBalance != null ? "balance " + dashMoney(r.runningBalance) : "", r.flag]
      .filter(Boolean)
      .join(" · ");
    if (meta) row.appendChild(invNode("div", "l-meta", meta));
    els.bankRows.appendChild(row);
  }
}

// B-833 (v2.0.18): Home = "Glance + To-do" - the laptop Dashboard's layout. The
// tiles and the Do next list come from self.ShopperGlance (remote/dash-lib.js =
// lib/dashboard-todo.js, the SAME code the laptop runs); every button jumps to
// this app's own tabs. Nothing here works out a figure.
let glOpen = new Set(); // Do next rows opened in place (read-only on the phone)

function glGo(target) {
  const go = {
    buylist: () => switchTab("buylist"),
    buyqueue: () => switchTab("run"),
    pipeline: () => openInventoryView(null),
    arrivals: () => openArrivals(),
    belowmin: () => switchTab("belowmin"),
    runreviews: () => switchTab("run"),
    fba: () => switchTab("fba"),
    wizard: () => switchTab("wizard"),
    cashflow: () => switchTab("cashflow"),
    bank: () => switchTab("bank"),
    plaid: () => switchTab("bank"),
    // B-941 (v2.0.35): Seller Central's Voice of the Customer page.
    voc: () => window.open("https://sellercentral.amazon.com/voice-of-the-customer", "_blank", "noopener"),
  }[target];
  if (go) go();
}

function glTap(node, fn) {
  node.classList.add("dash-tap");
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.addEventListener("click", fn);
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  });
  return node;
}

function glTile(t) {
  const n = invNode("div", "dash-tile gl-tile gl-tone-" + (t.tone || "flat") + (t.id === "stock" || t.id === "plaid" ? " wide" : ""));
  n.dataset.tile = t.id;
  n.appendChild(invNode("span", "t-label", t.label));
  // B-944 (v2.0.36): the Bank Balances box - its three rows instead of one big number.
  if (!(Array.isArray(t.rows) && t.value === "")) n.appendChild(invNode("b", "gl-num", t.value));
  if (Array.isArray(t.rows)) {
    const list = invNode("div", "gl-bank-rows");
    for (const r of t.rows) {
      const row = invNode("div", r.connected ? "gl-bank-row" : "gl-bank-row gl-bank-off");
      row.dataset.bank = r.key;
      row.appendChild(invNode("span", "gl-bank-label", r.label));
      row.appendChild(invNode("span", "gl-bank-value", r.value));
      list.appendChild(row);
    }
    n.appendChild(list);
  }
  if (t.sub) n.appendChild(invNode("span", "dash-money gl-sub", t.sub));
  if (t.split) {
    const row = invNode("div", "gl-split");
    for (const s of t.split) {
      const item = invNode("span", "gl-split-item");
      item.appendChild(invNode("span", "gl-split-label", s.label));
      item.appendChild(invNode("span", "gl-split-value", s.value));
      row.appendChild(item);
    }
    n.appendChild(row);
  }
  return glTap(n, () => glGo(t.target));
}

function glRow(r) {
  const row = invNode("div", "line gl-row gl-sev-" + r.severity);
  row.dataset.row = r.id;
  const top = invNode("div", "gl-row-top");
  top.appendChild(invNode("span", "gl-rank", r.rank));
  const main = invNode("div", "gl-main");
  main.appendChild(invNode("b", "gl-title", r.title));
  if (r.detail) main.appendChild(invNode("div", "l-meta", r.detail));
  top.appendChild(main);
  row.appendChild(top);
  const body = invNode("div", "gl-expand");
  body.hidden = !glOpen.has(r.id);
  const fill = () => {
    body.textContent = "";
    for (const n of r.notifs || []) {
      const c = invNode("div", "line dash-notif sev-" + n.severity);
      const t = invNode("div", "inv-row-top");
      t.appendChild(invNode("span", "dash-sev", n.severity));
      t.appendChild(invNode("span", "inv-title", n.title));
      c.appendChild(t);
      if (n.detail) c.appendChild(invNode("div", "l-meta", n.detail));
      if (n.examples && n.examples.length) {
        const ul = invNode("ul", "dash-ex");
        for (const e of n.examples) ul.appendChild(invNode("li", null, e));
        if (n.count > n.examples.length) ul.appendChild(invNode("li", null, "+" + (n.count - n.examples.length) + " more"));
        c.appendChild(ul);
      }
      body.appendChild(c);
    }
    if (r.notifs && r.notifs.length) body.appendChild(invNode("div", "muted small", "Mark done / Dismiss are on the laptop."));
  };
  if (!body.hidden) fill();
  const btn = invNode("button", "primary-btn gl-go", r.go.target === "runreviews" ? "Run tab" : r.go.label);
  btn.type = "button";
  if (r.go.target === "expand") {
    btn.setAttribute("aria-expanded", String(!body.hidden));
    btn.addEventListener("click", () => {
      if (glOpen.has(r.id)) glOpen.delete(r.id); else glOpen.add(r.id);
      body.hidden = !glOpen.has(r.id);
      if (!body.hidden) fill();
      btn.setAttribute("aria-expanded", String(!body.hidden));
    });
  } else {
    btn.addEventListener("click", () => glGo(r.go.target));
  }
  row.appendChild(btn);
  row.appendChild(body);
  return row;
}

function renderDashboard(d, p) {
  const G = self.ShopperGlance;
  if (!d || !G) {
    lastDashboardKey = "";
    for (const k of ["dashTiles", "dashDoNext"]) els[k].textContent = "";
    els.dashAsOf.textContent = "Waiting for the laptop to send its Dashboard (needs Shopper v4.56 on the laptop, and the Dashboard opened there once).";
    els.dashDoCount.textContent = els.dashNightly.textContent = "";
    els.dashLastHead.textContent = "-";
    els.dashLastSub.textContent = "";
    return;
  }
  const fba = self.ShopperFbaView && self.ShopperFbaView.glance ? self.ShopperFbaView.glance() : { ok: false, empty: true, alerts: [], tiles: [] };
  const arrCounts = p && p.inventory && p.inventory.arrivals ? p.inventory.arrivals.counts : null;
  const bm = p && p.belowMin && p.belowMin.count != null ? Number(p.belowMin.count) : null;
  const ex = d.extra || {};
  const money = d.pipeline.money || null;
  const tiles = G.buildTiles({
    spend: d.spend,
    bank: d.spend.bankBalance,
    plaid: ex.plaid || null,
    now: Date.now(),
    stranded: ex.stranded || null,
    cash: ex.cash || null,
    stock: {
      house: money ? money.house : null,
      prep: money ? money.prep : null,
      inTransit: money ? money.inTransit : null,
      fba: fba.ok && !fba.empty ? G.fbaStockValue(fba.tiles) : null,
    },
  });
  const rows = G.buildDoNext({
    loaded: true,
    notifications: d.notifications,
    notificationCount: d.openCount,
    nextRun: d.nextRun,
    nightlyReady: !!(ex.nightly && ex.nightly.readyAt),
    needsYou: d.pipeline.available ? d.pipeline.needsYou : 0,
    arrivalsToday: d.pipeline.available ? d.pipeline.arrivalsToday : 0,
    overdue: arrCounts ? arrCounts.overdue : 0,
    belowMin: Number.isFinite(bm) ? bm : null,
    runReviews: d.runReviews,
    fbaAlerts: fba.alerts,
    stranded: ex.stranded || null,
    // B-941 (v2.0.35): listings at Poor / Very poor CX Health.
    voc: ex.voc || null,
    // B-971 (v2.0.39): a background check that failed or went quiet.
    bgChecks: ex.bgChecks || null,
    // B-862 (v2.0.23): listings deactivated for a pricing error.
    pricingErrors: ex.pricingErrors || null,
    now: Date.now(),
  });
  const key = JSON.stringify([tiles, rows.map((r) => [r.id, r.title, r.detail, r.severity, r.go.label, (r.notifs || []).map((n) => n.key)]), d.lastRun, ex.nightly, d.remoteBuiltAt, d.stale, d.spend.bankRecent, ex.bgChecks || null]);
  if (key === lastDashboardKey) return;
  lastDashboardKey = key;
  for (const k of ["dashTiles", "dashDoNext"]) els[k].textContent = "";
  els.dashAsOf.textContent =
    "Figures from the laptop's last Dashboard refresh, " + dashAgoMs(d.remoteBuiltAt) + "." +
    (d.stale ? " Refresh on the laptop for live figures." : "") + " Read-only.";

  for (const t of tiles) els.dashTiles.appendChild(glTile(t));
  renderBank(d.spend);

  els.dashDoCount.textContent = "(" + rows.length + ")";
  if (!rows.length) {
    const unknown = !d.nextRun || d.nextRun.state === "unknown";
    els.dashDoNext.appendChild(invNode("div", "muted", unknown ? "Nothing flagged - but today's spend figures are not loaded (refresh the Dashboard on the laptop)." : "All caught up. Nothing needs you right now."));
  }
  for (const r of rows) els.dashDoNext.appendChild(glRow(r));

  // status: last run (tap = its report) + the nightly buy list
  const last = d.lastRun;
  if (!last.available) {
    els.dashLastHead.textContent = "No run yet";
    els.dashLastSub.textContent = "";
  } else {
    els.dashLastHead.textContent = last.status + (last.totalSpent != null ? " · " + dashMoneyShort(last.totalSpent) : "");
    els.dashLastSub.textContent =
      last.bought + " bought · " + last.failed + " failed" +
      (last.finishedAt ? " · " + centralText(last.finishedAt) : "");
  }
  const nt = ex.nightly;
  els.dashNightly.textContent = !nt ? "" : nt.enabled && nt.nextAt ? "Next nightly buy list: " + centralText(nt.nextAt) : "Nightly buy list: off";
  // B-971 (v2.0.39): "Voice of the Customer: read 2h ago - 0 Poor / 1 Fair".
  if (els.dashChecks) {
    els.dashChecks.textContent = "";
    if (ex.bgChecks && G.bgCheckLines) {
      for (const c of G.bgCheckLines(ex.bgChecks, Date.now())) els.dashChecks.appendChild(invNode("div", c.failed || c.stale ? "warn-text" : "", c.line));
    }
  }
}
