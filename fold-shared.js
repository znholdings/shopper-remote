// remote/fold-shared.js - B-2057 / B-2070 (v2.0.158): the phone's folded sections - ONE state shared with both computers.
// The state is the shared setting shopperFoldState = { "<page>:<section>": { o: true|false, at: epochMs } } (lib/fold-state.js is the
// desktop twin; both follow the same rules). The phone reads / writes the shared:settings row DIRECTLY (as remote/settings-view.js does):
// newest `at` per section wins, no write when the row is missing or newer than this phone understands (sv > 1), no other row touched.
// Folds start CLOSED. Built with textContent only. Classic script -> self.ShopperFold.
(function (root) {
  "use strict";

  const KEY = "shopperFoldState";
  const CACHE_KEY = "shopperFoldStateCache";
  const MAX = 300;
  const ROW = encodeURIComponent("shared:settings");

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const goodEntry = (e) => isObj(e) && typeof e.o === "boolean" && isFinite(Number(e.at));

  // ---- pure (same answers as lib/fold-state.js; a test runs both) ---------------------------------
  function readFold(state, key, def) {
    const e = isObj(state) ? state[key] : null;
    return e && typeof e.o === "boolean" ? e.o : !!def;
  }
  function prune(out) {
    const keys = Object.keys(out);
    if (keys.length <= MAX) return out;
    keys.sort((a, b) => (out[a].at || 0) - (out[b].at || 0));
    keys.slice(0, keys.length - MAX).forEach((k) => { delete out[k]; });
    return out;
  }
  function withFold(state, key, open, now) {
    const out = {};
    if (isObj(state)) Object.keys(state).forEach((k) => { if (goodEntry(state[k])) out[k] = { o: state[k].o, at: Number(state[k].at) }; });
    out[key] = { o: !!open, at: now == null ? Date.now() : now };
    return prune(out);
  }
  function mergeFold(a, b) {
    const out = {};
    [isObj(a) ? a : {}, isObj(b) ? b : {}].forEach((src) => {
      Object.keys(src).forEach((k) => {
        const e = src[k];
        if (!goodEntry(e)) return;
        const cur = out[k];
        if (!cur || Number(e.at) >= cur.at) out[k] = { o: e.o, at: Number(e.at) };
      });
    });
    return prune(out);
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- state ----------------------------------------------------------------------------------------
  let state = {};
  let pending = false;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (isObj(c)) { state = mergeFold({}, c.value); pending = !!c.pending; }
  } catch (e) { state = {}; }
  const listeners = [];
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ value: state, pending })); } catch (e) { /* offline nicety */ }
  }
  function emit() {
    listeners.slice().forEach((cb) => { try { cb(); } catch (e) { /* one listener never breaks the rest */ } });
    refresh();
  }
  function get(key, def) { return readFold(state, key, def); }
  function onChange(cb) { if (typeof cb === "function") listeners.push(cb); }

  // ---- the shared row ---------------------------------------------------------------------------------
  async function readRow() {
    const R = root.ShopperRemote;
    if (!R || !R.sb) return { ok: false, reason: "not ready" };
    const res = await R.sb("device_state?device_id=eq." + ROW + "&select=device_id,v,payload,updated_at&limit=1");
    if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || "no answer" };
    const r = Array.isArray(res.json) ? res.json[0] : null;
    if (!r) return { ok: true, exists: false, v: 0, entries: {}, sv: 1 };
    const val = r.payload && isObj(r.payload.value) ? r.payload.value : {};
    return { ok: true, exists: true, v: Number(r.v) || 0, entries: isObj(val.entries) ? val.entries : {}, sv: Number(val.sv) || 1 };
  }
  function remoteFold(got) {
    const e = got && got.entries && got.entries[KEY];
    return e && isObj(e.v) ? e.v : {};
  }

  let pushing = false;
  async function push() {
    if (pushing) return;
    pushing = true;
    try {
      for (let tries = 0; tries < 2; tries++) {
        const got = await readRow();
        if (!got.ok || !got.exists || got.sv > 1) return; // pending stays for the next pull
        const t = Date.now();
        const entries = Object.assign({}, got.entries);
        const merged = mergeFold(remoteFold(got), state);
        entries[KEY] = { v: merged, at: t, by: "phone", byName: "Phone" };
        const res = await root.ShopperRemote.sb("device_state?device_id=eq." + ROW + "&v=eq." + got.v + "&select=device_id,v", {
          method: "PATCH",
          prefer: "return=representation",
          body: { device_name: "Phone", v: got.v + 1, payload: { value: { sv: 1, entries: entries }, by: "phone", byName: "Phone", at: t }, updated_at: new Date(t).toISOString() },
        });
        if (!res || !res.ok) return;
        if (Array.isArray(res.json) && res.json.length === 1) {
          // Review fix: a tap made while this write was in flight is in `state`, not in `merged` - keep it and send it next.
          const now = mergeFold(merged, state);
          const changed = !same(now, state);
          state = now;
          pending = !same(now, merged);
          saveCache();
          if (changed) emit();
          if (pending) pushSoon();
          return;
        }
      }
    } catch (e) { /* pending stays */ } finally { pushing = false; }
  }

  let pushTimer = null;
  function pushSoon() {
    if (typeof setTimeout !== "function") return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; push(); }, 800);
  }

  async function pull() {
    try {
      const got = await readRow();
      if (!got.ok || !got.exists) return;
      const remote = remoteFold(got);
      const merged = mergeFold(remote, state);
      if (!same(merged, state)) { state = merged; saveCache(); emit(); }
      if (!same(merged, mergeFold(remote, {}))) { pending = true; saveCache(); await push(); }
    } catch (e) { /* the next pull tries again */ }
  }

  function set(key, open) {
    if (readFold(state, key, null) === !!open && state[key]) return;
    state = withFold(state, key, open, Date.now());
    pending = true;
    saveCache();
    emit();
    pushSoon();
  }

  // ---- DOM ----------------------------------------------------------------------------------------------
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const defOf = (el) => el.dataset.sfoldDef === "1";

  // Decorate a card with the s55 classes: head = its first h3. Idempotent (no write when already right).
  function section(sec, opts) {
    if (!sec) return null;
    const o = opts || {};
    const key = o.key;
    if (!key) return null;
    const head = Array.prototype.find.call(sec.children, (c) => c.tagName === "H3");
    if (!head) return null;
    if (!sec.classList.contains("s55-sec")) sec.classList.add("s55-sec");
    if (sec.dataset.sfold !== key) sec.dataset.sfold = key;
    const d = o.defaultOpen ? "1" : "0";
    if (sec.dataset.sfoldDef !== d) sec.dataset.sfoldDef = d;
    if (!head.classList.contains("s55-head")) head.classList.add("s55-head");
    if (o.count != null) {
      let c = head.querySelector(".sfold-count");
      if (!c) { c = node("span", "count sfold-count"); head.insertBefore(c, head.querySelector(".s55-toggle")); }
      const t = String(o.count);
      if (c.textContent !== t) c.textContent = t;
    }
    let tog = head.querySelector(".s55-toggle");
    if (!tog) {
      tog = node("button", "s55-toggle");
      tog.type = "button";
      tog.appendChild(node("span", "s55-chev", "▾"));
      head.appendChild(tog);
    }
    paintSection(sec);
    return sec;
  }
  function paintSection(sec) {
    const open = get(sec.dataset.sfold, defOf(sec)) || sec.dataset.sfoldReveal === "1";
    if (sec.classList.contains("s55-closed") === open) sec.classList.toggle("s55-closed", !open);
    const tog = sec.querySelector(".s55-head .s55-toggle");
    if (tog) {
      if (tog.getAttribute("aria-expanded") !== String(open)) tog.setAttribute("aria-expanded", String(open));
      const h = sec.querySelector(".s55-head");
      const label = (open ? "Close " : "Open ") + String((h && h.firstChild && h.firstChild.textContent) || "section").trim();
      if (tog.getAttribute("aria-label") !== label) tog.setAttribute("aria-label", label);
    }
  }

  function effective(el) {
    if (el.dataset.sfoldForce === "1") return true;
    return get(el.dataset.sfold, defOf(el));
  }
  function paintButton(btn, open) {
    const t = (btn.dataset.sfoldLabel || "") + (open ? " ▴" : " ▾");
    if (btn.textContent !== t) btn.textContent = t;
    if (btn.getAttribute("aria-expanded") !== String(open)) btn.setAttribute("aria-expanded", String(open));
  }
  // A "more" fold: a button + the content (hidden when closed).
  function details(label, key, content, opts) {
    const o = opts || {};
    const wrap = node("div", "sfold-det");
    wrap.dataset.sfold = key;
    wrap.dataset.sfoldDef = o.defaultOpen ? "1" : "0";
    if (o.forceOpen) wrap.dataset.sfoldForce = "1";
    const btn = node("button", "sfold-det-btn secondary-btn");
    btn.type = "button";
    btn.dataset.sfoldLabel = label;
    wrap.appendChild(btn);
    if (content) wrap.appendChild(content);
    paintDetails(wrap);
    return wrap;
  }
  function paintDetails(wrap) {
    const open = effective(wrap);
    const btn = wrap.querySelector(".sfold-det-btn");
    if (btn) paintButton(btn, open);
    Array.prototype.forEach.call(wrap.children, (c) => { if (c !== btn && c.hidden !== !open) c.hidden = !open; });
  }
  // For elements a view rebuilds: one button before the first element; every element hidden while closed.
  function group(key, label, els) {
    const list = (els || []).filter(Boolean);
    if (!list.length) return null;
    const first = list[0];
    let btn = first.previousElementSibling;
    if (!(btn && btn.classList && btn.classList.contains("sfold-det-btn") && btn.dataset.sfold === key)) {
      btn = node("button", "sfold-det-btn secondary-btn");
      btn.type = "button";
      btn.dataset.sfold = key;
      first.parentNode.insertBefore(btn, first);
    }
    btn.dataset.sfoldLabel = label;
    btn._sfoldEls = list;
    paintGroup(btn);
    return btn;
  }
  function paintGroup(btn) {
    const open = get(btn.dataset.sfold, false);
    paintButton(btn, open);
    (btn._sfoldEls || []).forEach((e) => { if (e.classList.contains("sfold-hide") === open) e.classList.toggle("sfold-hide", !open); });
  }

  function refresh() {
    if (typeof document === "undefined") return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-sfold]"), (el) => {
      if (el.classList.contains("s55-sec")) paintSection(el);
      else if (el.classList.contains("sfold-det")) paintDetails(el);
      else if (el.classList.contains("sfold-det-btn")) paintGroup(el);
    });
  }

  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest(".sfold-det-btn[data-sfold], .sfold-det-btn");
    if (btn) {
      const holder = btn.dataset.sfold ? btn : btn.parentNode;
      const key = holder && holder.dataset && holder.dataset.sfold;
      if (!key) return;
      const open = holder.classList.contains("sfold-det") ? effective(holder) : get(key, false);
      if (holder.dataset.sfoldForce) delete holder.dataset.sfoldForce;
      set(key, !open);
      refresh();
      return;
    }
    const head = t.closest(".s55-head");
    if (!head) return;
    const sec = head.parentElement;
    if (!sec || !sec.dataset || !sec.dataset.sfold) return;
    if (t.closest("input, select, textarea, a") || (t.closest("button") && !t.closest(".s55-toggle"))) return;
    const open = get(sec.dataset.sfold, defOf(sec)) || sec.dataset.sfoldReveal === "1";
    delete sec.dataset.sfoldReveal;
    set(sec.dataset.sfold, !open);
    refresh();
  }

  // ---- timers -------------------------------------------------------------------------------------------
  function visible() { return typeof document === "undefined" || document.visibilityState !== "hidden"; }
  function start() {
    if (typeof document === "undefined" || typeof setInterval !== "function") return;
    document.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
    let tries = 0;
    const first = setInterval(() => {
      tries++;
      if (root.ShopperRemote && root.ShopperRemote.sb) {
        clearInterval(first);
        pull();
        setInterval(() => { if (visible()) pull(); }, 60000);
      } else if (tries >= 24) clearInterval(first);
    }, 5000);
    if (root.ShopperRemote && root.ShopperRemote.sb) { clearInterval(first); pull(); setInterval(() => { if (visible()) pull(); }, 60000); }
  }
  start();

  root.ShopperFold = Object.freeze({ KEY, get, set, onChange, section, details, group, refresh, pull, _pure: { readFold, withFold, mergeFold }, _push: push });
})(typeof self !== "undefined" ? self : globalThis);
