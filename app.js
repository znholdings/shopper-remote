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
const APP_BUILD = "v2.97";
const POLL_MS = 3000;

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of [
  "app","deviceName","signOutBtn","liveBanner","signinView","signInBtn","signinError",
  "pickerView","deviceList","mainView","tabRun","tabBuylist","runPane","buylistPane",
  "promptCard","promptTitle","promptDetail","promptExpiry","promptFields","promptActions",
  "runStatus","currentStep","tSpent","tNeeded","tToday","tBought",
  "startRow","modeSelect","startBtn","resumeSavedBtn","controlRow","pauseBtn","resumeBtn",
  "retryFailedBtn","finishNowBtn","abortBtn","unstickNote","addAsin","addQty","addPriority","addBtn",
  "lineCount","lines","log","generateBtn","approveAllBtn","buylistMeta","buylistApproved",
  "buylistApprovedBar","buylistApprovedFill","buylistItems","toast","installHint",
  "progress","progressText","genCard","genStep","genLog","previewBtn","discardSavedBtn",
  "blAddAsin","blAddQty","blAddBtn",
  "pushRow","pushBtn","refreshBtn","reloadBtn","buildStamp",
]) els[id] = $(id);

// --------------------------------------------------------------- state
let session = null;      // { access_token, refresh_token, expiresAt }
let deviceId = null;     // the laptop we are driving
let deviceName = "";
let lastPayload = null;
let pollTimer = null;

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
async function sendCommand(name, payload = {}) {
  if (!deviceId) return;
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
  if (!res.ok) { toast(`Could not send: ${res.reason}`, true); return; }
  const row = Array.isArray(res.json) ? res.json[0] : null;
  if (row && row.id) {
    inFlight.set(row.id, { name, at: Date.now() });
    renderInFlight();
  }
  toast("Sent");
  // Poll straight away so the effect shows without waiting a full tick.
  setTimeout(poll, 400);
}

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
    renderPayload();
  }
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

// The banner Zach asked for: "running" and "go to the machine" must never
// look the same.
function renderLiveness(live) {
  const b = els.liveBanner;
  if (!live) { b.hidden = true; return; }
  b.hidden = false;
  b.className = `live-banner tone-${live.status}`;
  const label = {
    running: "Running",
    waiting: "Waiting on you",
    paused: "Paused",
    stalled: "Needs you at the laptop",
    offline: "Laptop not responding",
    idle: "Idle",
  }[live.status] || live.status;
  b.textContent = live.reason ? `${label} - ${live.reason}` : label;
}

function renderPayload() {
  const p = lastPayload;
  if (!p) return;
  renderLiveness(p.liveness);

  const run = p.run || null;
  const status = run ? run.status : "";
  els.runStatus.textContent = status || "idle";
  els.runStatus.className = `pill pill-${status || "idle"}`;
  els.currentStep.textContent = run ? run.currentStep || "" : "";

  els.tSpent.textContent = money(run && run.totalSpent);
  els.tNeeded.textContent = money(p.day && p.day.neededToday);
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

  els.discardSavedBtn.hidden = !(p.savedQueue && p.savedQueue.exists) || live;

  renderPrompt(p.prompt);
  // ⚠ P-36. Both of these rebuild their whole list from innerHTML = "",
  // four times a minute. Skipping the rebuild while the user is inside
  // that pane is what makes a quantity box typable at all - see
  // isBeingEdited() for the full reasoning.
  if (!isBeingEdited(els.lines)) renderLines(p.lines || [], p.lineCount || 0, p.truncated);
  els.log.textContent = (p.log || []).join("\n");
  renderBuylistGen(p.buylistGen);
  if (!isBeingEdited(els.buylistItems)) renderBuylist(p.buylist);
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

function renderLines(lines, total, truncated) {
  const fp = JSON.stringify([lines, total, truncated]);
  if (fp === lastRenderedLinesFp) return;
  lastRenderedLinesFp = fp;
  els.lineCount.textContent = truncated ? `${lines.length} of ${total}` : String(total);
  els.lines.innerHTML = "";
  for (const l of lines) {
    const row = document.createElement("div");
    row.className = `line line-${l.status}`;
    row.innerHTML =
      `<div class="l-top"><span class="l-asin">${escapeHtml(l.asin)}</span>` +
      `<span class="l-status">${escapeHtml(l.status)}</span></div>` +
      `<div class="l-title">${escapeHtml(l.title)}</div>` +
      `<div class="l-meta">${l.boughtQty}/${l.qty} units · ${money(l.spentDollars)}` +
      // P-30: retailer was ALREADY in the payload and simply never printed.
      `${l.retailer ? ` · ${escapeHtml(l.retailer)}` : ""}` +
      `${l.multipackSize ? ` · pack of ${l.multipackSize}` : ""}` +
      `${l.prepCenter ? " · prep center" : ""}` +
      `${l.sheetRow ? ` · sheet ${escapeHtml(String(l.sheetRow))}` : ""}</div>` +
      `${l.orderNumber ? `<div class="l-meta">order ${escapeHtml(l.orderNumber)}</div>` : ""}` +
      `${l.runResult ? `<div class="l-meta">${escapeHtml(l.runResult)}</div>` : ""}` +
      `${l.sourceUrl ? `<div class="l-meta"><a class="l-src" href="${escapeHtml(l.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a></div>` : ""}` +
      (l.error ? `<div class="l-error">${escapeHtml(l.error)}</div>` : "");
    const actions = document.createElement("div");
    actions.className = "l-actions";
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
  els.promptDetail.textContent = prompt.detail || "";
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

  for (const name of prompt.answers || []) {
    const b = document.createElement("button");
    const destructive = name === "abort" || name === "skipSourceUrl" || name === "fillerSkip" || name === "multipackCancel";
    b.className = destructive ? "secondary-btn" : "primary-btn";
    b.textContent = ANSWER_LABELS[name] || name;
    b.addEventListener("click", () => sendCommand(name, getPayload()));
    els.promptActions.appendChild(b);
  }
}

const ANSWER_LABELS = {
  submitSourceUrl: "Submit URL",
  skipSourceUrl: "Skip this line",
  fillerItem: "Add filler & continue",
  fillerSkip: "Skip this line",
  approvePrice: "Approve change",
  approveCap: "Approve & place order",
  approveOrder: "Place order",
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
    `${bl.generatedAt ? ` · generated ${new Date(bl.generatedAt).toLocaleString()}` : ""}` +
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
els.finishNowBtn.addEventListener("click", () => sendCommand("finishNow"));
els.abortBtn.addEventListener("click", () => {
  if (confirm("Abort the run? Whatever is mid-purchase is interrupted.")) sendCommand("abort");
});
els.addBtn.addEventListener("click", () => {
  const asin = els.addAsin.value.trim().toUpperCase();
  if (!asin) return;
  sendCommand("addManualLine", { asin, qty: Number(els.addQty.value) || 1, priority: els.addPriority.value });
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

els.tabRun.addEventListener("click", () => switchTab("run"));
els.tabBuylist.addEventListener("click", () => switchTab("buylist"));

function switchTab(which) {
  els.runPane.hidden = which !== "run";
  els.buylistPane.hidden = which !== "buylist";
  els.tabRun.classList.toggle("active", which === "run");
  els.tabBuylist.classList.toggle("active", which === "buylist");
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
  // A phone that has been in a pocket for an hour must not show an hour-old
  // screen as if it were live.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();
