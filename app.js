// Shopper Remote - the phone app (P-15, v2.92).
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
  "lineCount","lines","log","generateBtn","approveAllBtn","buylistMeta","buylistItems","toast","installHint",
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
    method: "POST",
    prefer: "return=minimal",
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
  if (!res.ok) toast(`Could not send: ${res.reason}`, true);
  else toast("Sent");
  // Poll straight away so the effect shows without waiting a full tick.
  setTimeout(poll, 400);
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
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
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

  renderPrompt(p.prompt);
  renderLines(p.lines || [], p.lineCount || 0, p.truncated);
  els.log.textContent = (p.log || []).join("\n");
  renderBuylist(p.buylist);
}

function renderLines(lines, total, truncated) {
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
      `${l.sheetRow ? ` · sheet ${escapeHtml(String(l.sheetRow))}` : ""}</div>` +
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

function lineBtn(label, name, payload) {
  const b = document.createElement("button");
  b.className = "mini-btn";
  b.textContent = label;
  b.addEventListener("click", () => sendCommand(name, payload));
  return b;
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
  if (!bl) { els.buylistMeta.textContent = "No buylist generated yet."; els.buylistItems.innerHTML = ""; return; }
  els.buylistMeta.textContent = `${bl.itemCount} line(s)${bl.generatedAt ? ` · generated ${new Date(bl.generatedAt).toLocaleString()}` : ""}`;
  els.buylistItems.innerHTML = "";
  for (const i of bl.items || []) {
    const row = document.createElement("div");
    row.className = "line";
    row.innerHTML =
      `<div class="l-top"><span class="l-asin">${escapeHtml(i.asin)}</span>` +
      `<span class="l-status">${escapeHtml(i.section)}${i.approved ? " · approved" : ""}</span></div>` +
      `<div class="l-title">${escapeHtml(i.title)}</div>` +
      `<div class="l-meta">qty ${i.qty}${i.score ? ` · score ${i.score.toFixed(2)}` : ""}</div>`;
    const actions = document.createElement("div");
    actions.className = "l-actions";
    actions.appendChild(lineBtn(i.approved ? "Unapprove" : "Approve", "buylistAction", { asin: i.asin, action: i.approved ? "unapprove" : "approve" }));
    actions.appendChild(lineBtn("Reject", "buylistAction", { asin: i.asin, action: "reject" }));
    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "1";
    qty.className = "qty-input";
    qty.value = String(i.qty || 1);
    const setQty = document.createElement("button");
    setQty.className = "mini-btn";
    setQty.textContent = "Set qty";
    // "conditional" is the buylist's own quantity-adjust action - the real
    // one, read out of background.js. There is no separate set-quantity
    // message, and inventing one would mean writing buy logic here.
    setQty.addEventListener("click", () => sendCommand("buylistAction", { asin: i.asin, action: "conditional", qty: Number(qty.value) || 1 }));
    actions.append(qty, setQty);
    row.appendChild(actions);
    els.buylistItems.appendChild(row);
  }
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
async function setupPush() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  els.installHint.hidden = standalone;
  if (!standalone || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    if (!CFG.vapidPublicKey || CFG.vapidPublicKey.startsWith("YOUR-")) return;
    const sub = await reg.pushManager.getSubscription() ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(CFG.vapidPublicKey) });
    await sb("push_subs?on_conflict=endpoint", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [{ endpoint: sub.endpoint, subscription: sub.toJSON(), updated_at: new Date().toISOString() }],
    });
  } catch {
    /* push is a convenience layer - never let it break the app */
  }
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
  setupPush();
  // A phone that has been in a pocket for an hour must not show an hour-old
  // screen as if it were live.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();
