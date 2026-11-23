// remote/settings-view.js - B-1501 (v2.0.104): the phone's Settings screen. ONE set of settings on the laptop, the Optiplex and the phone.
//
// The phone writes the shared row (device_state "shared:settings") DIRECTLY - read it, put one key's new value in with the time and
// "phone" as the sender, save it only if nobody changed the row meanwhile (the row's generation v). That works with both computers off:
// they take it on their next minute. (A command to the Main would die after 5 minutes, and a Viewer in failover refuses non-read-only ones.)
// The computers check every value they take (lib/shared-settings.js); one they refuse comes back as THEIR value with a newer time, and
// this screen says "Laptop put it back".
// What can be changed here, its labels and its limits come from lib/shared-settings-spec.js (remote/settings-lib.js, generated).
// Keys that hold a password or an API key are in a different row this screen never reads and never edits.
(function () {
  "use strict";
  const SPEC = self.ShopperSettingsSpec;
  const $ = (id) => document.getElementById(id);
  const ROW = encodeURIComponent("shared:settings");
  const COMPUTERS = encodeURIComponent("shared:computer:");
  const POLL_MS = 10 * 1000;
  const STALE_MS = 5 * 60 * 1000; // = lib/job-failover.js MAIN_STALE_MS
  let row = null; // { v, entries, at } | null = not shared yet
  let computers = [];
  let timer = null;
  let loadedAt = 0;
  let status = "";
  let sent = null; // { v, at } of the last save from this phone
  const notes = {}; // key -> { text, at }
  // B-2293 (d): what a tapped control shows while its save runs (memory only; the stored value is drawn again the moment the save ends)
  const pending = {}; // pendKey -> the value just tapped
  const pendKey = (spec, ctl) => spec.key + "|" + (ctl.path || "");
  const NET_MS = 15000; // a stalled network ends a save (and its disabled control) instead of waiting for ever
  let drawnSig = "";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function getPath(obj, path) {
    if (!path) return obj;
    let cur = obj;
    for (const p of path.split(".")) {
      if (!isObj(cur)) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  function setPath(obj, path, val) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isObj(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  async function readRow() {
    const R = self.ShopperRemote;
    if (!R || !R.sb) return { ok: false, reason: "not ready" };
    const res = await R.sb(`device_state?device_id=eq.${ROW}&select=device_id,v,payload,updated_at&limit=1`, { timeoutMs: NET_MS });
    if (!res.ok) return { ok: false, reason: res.reason || "no answer" };
    const r = Array.isArray(res.json) ? res.json[0] : null;
    if (!r) return { ok: true, exists: false, v: 0, entries: {}, sv: 1 };
    const val = r.payload && isObj(r.payload.value) ? r.payload.value : {};
    return { ok: true, exists: true, v: Number(r.v) || 0, entries: isObj(val.entries) ? val.entries : {}, sv: Number(val.sv) || 1, at: Date.parse(r.updated_at || "") || 0 };
  }
  async function readComputers() {
    const R = self.ShopperRemote;
    const res = await R.sb(`device_state?device_id=like.${COMPUTERS}*&select=device_id,payload,updated_at`, { timeoutMs: NET_MS });
    if (!res.ok || !Array.isArray(res.json)) return [];
    const out = [];
    for (const r of res.json) {
      const v = r && r.payload && r.payload.value;
      if (v && v.id) out.push({ id: String(v.id), name: String(v.name || "computer"), role: v.role === "viewer" ? "viewer" : "main", seenAt: Number(v.seenAt) || 0, settingsV: Number(v.settingsV) || 0, settingsAt: Number(v.settingsAt) || 0, settingsFps: isObj(v.settingsFps) ? v.settingsFps : null, vacationSeen: isObj(v.vacationSeen) ? v.vacationSeen : null });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : 1));
    return out;
  }

  function entryValue(spec) {
    const e = row && row.entries[spec.key];
    return e && e.v !== undefined ? e.v : undefined;
  }
  function controlValue(spec, ctl) {
    const v = entryValue(spec);
    if (v === undefined || v === null) return ctl.path ? undefined : spec.def; // B-2169: a setting on until turned off shows on
    if (spec.pair) return isObj(v) ? v.goal : undefined;
    return getPath(v, ctl.path || "");
  }

  function syncLines() {
    const now = Date.now();
    const rowV = row ? row.v : 0;
    return computers.map((c) => {
      const silent = now - c.seenAt >= STALE_MS;
      return `${c.name}: ${SPEC.settingsSyncWords({ settingsV: c.settingsV, settingsAt: c.settingsAt, seenAt: c.seenAt, silent, isMe: false }, rowV, now).replace(/^Settings: /, "")}`;
    });
  }
  // B-1641: how many shared settings hold a different value on the two computers right now (their heartbeat fingerprints), null = not known.
  function differCount() {
    const now = Date.now();
    const live = computers.filter((c) => c.settingsFps && now - c.seenAt < STALE_MS);
    if (live.length < 2) return null;
    const a = live[0].settingsFps, b = live[1].settingsFps;
    let n = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) n++;
    return n;
  }
  function waitingFor() {
    if (!sent || !row) return [];
    const now = Date.now();
    return computers.filter((c) => now - c.seenAt < STALE_MS && c.settingsV < sent.v).map((c) => c.name);
  }

  // B-2293 (d): a tap shows its own value (and "Saving…") until the save ends, then the stored value is drawn - never a snap back to the old pick.
  async function save(spec, ctl, val) {
    const track = !ctl.mutate;
    const pk = pendKey(spec, ctl);
    if (track) pending[pk] = val;
    try {
      await saveCore(spec, ctl, val);
    } catch (err) {
      notes[spec.key] = { text: `Not saved - ${(err && err.message) || "no answer"}`, at: Date.now(), bad: true }; // never a stuck "Saving…"
    } finally {
      if (track) delete pending[pk]; // on EVERY exit
      draw(true);
    }
  }
  async function saveCore(spec, ctl, val) {
    const key = spec.key;
    notes[key] = { text: "Saving…", at: Date.now(), sentAt: 0, path: ctl.path || "", busy: true };
    draw(true);
    for (let tries = 0; tries < 2; tries++) {
      const got = await readRow();
      if (!got.ok) {
        notes[key] = { text: `Not saved - ${got.reason}`, at: Date.now(), bad: true };
        return draw(true);
      }
      if (!got.exists || got.sv > 1) {
        notes[key] = { text: got.exists ? "Not saved - a newer Shopper is sharing these" : "Not shared yet - open Shopper on a computer first", at: Date.now(), bad: true };
        return draw(true);
      }
      const t = Date.now();
      const entries = { ...got.entries };
      const base = entries[key] ? entries[key].v : null;
      let next;
      if (typeof ctl.mutate === "function") {
        // B-2249 review: the change is applied to the row as read just now (never to the last poll), then checked like a computer would
        next = isObj(base) ? clone(base) : {};
        const refused = ctl.mutate(next);
        const norm = spec.key === VACATION && !refused ? SPEC.normalizeVacationSetting(next) : { ok: !refused, reason: refused };
        const vr = spec.key === VACATION && norm.ok ? vacationRefusal(base, next) : "";
        if (vr) {
          notes[key] = { text: `Not saved - ${vr}`, at: Date.now(), bad: true };
          return draw(true);
        }
        if (!norm.ok) {
          notes[key] = { text: `Not saved - ${norm.reason}`, at: Date.now(), bad: true };
          return draw(true);
        }
        if (norm.value) next = norm.value;
      } else if (spec.pair) next = { goal: val, setAt: t };
      else if (!ctl.path) next = val;
      else {
        next = isObj(base) ? clone(base) : {};
        setPath(next, ctl.path, val);
        const vr = spec.key === VACATION ? vacationRefusal(base, next) : "";
        if (vr) {
          notes[key] = { text: `Not saved - ${vr}`, at: Date.now(), bad: true };
          return draw(true);
        }
      }
      entries[key] = { v: next, at: t, by: "phone", byName: "Phone" };
      const res = await self.ShopperRemote.sb(`device_state?device_id=eq.${ROW}&v=eq.${got.v}&select=device_id,v`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { device_name: "Phone", v: got.v + 1, payload: { value: { sv: 1, entries }, by: "phone", byName: "Phone", at: t }, updated_at: new Date(t).toISOString() },
        timeoutMs: NET_MS,
      });
      if (!res.ok && res.reason === "timed out") {
        // the write may or may not have landed: say so, then show what is stored (the reload below)
        notes[key] = { text: "Not sure it saved - showing what is stored", at: Date.now(), bad: true };
        if (!ctl.mutate) delete pending[pendKey(spec, ctl)];
        await load();
        return;
      }
      if (!res.ok) {
        notes[key] = { text: `Not saved - ${res.reason || "no answer"}`, at: Date.now(), bad: true };
        return draw(true);
      }
      if (Array.isArray(res.json) && res.json.length === 1) {
        sent = { v: got.v + 1, at: t };
        notes[key] = { text: "Saved ✓", at: t, sentAt: t };
        if (!ctl.mutate) delete pending[pendKey(spec, ctl)]; // the stored value is drawn by the reload
        await load();
        return;
      }
    }
    notes[key] = { text: "Not saved - the settings kept changing, try again", at: Date.now(), bad: true };
    draw(true);
  }

  function control(spec, ctl) {
    const pk = pendKey(spec, ctl);
    const busy = pk in pending; // a save of this control is running: show what was tapped, and no second tap
    const cur = busy ? pending[pk] : controlValue(spec, ctl);
    const kind = ctl.kind || spec.kind;
    let input;
    if (kind === "bool") {
      input = el("input");
      input.type = "checkbox";
      input.checked = cur === true;
      // B-2282a (v2.0.196): an on / off setting is a switch (still a real checkbox)
      input.className = "stg-switch";
      input.setAttribute("role", "switch");
      input.setAttribute("aria-checked", input.checked ? "true" : "false");
      input.addEventListener("change", () => { input.setAttribute("aria-checked", input.checked ? "true" : "false"); save(spec, ctl, input.checked); });
    } else if (kind === "enum") {
      const opts = ctl.options || spec.options || [];
      if (opts.length >= 2 && opts.length <= 4) {
        // B-2282a (v2.0.196): up to four choices = segmented buttons (a pick saves at once, through the same save); more stays a select
        input = el("div", "stg-seg");
        input.setAttribute("role", "radiogroup");
        for (const o of opts) {
          const on = typeof cur === "string" && cur === o[0];
          const b = el("button", "stg-seg-btn" + (on ? " is-on" : ""), o[1]);
          b.type = "button";
          b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", on ? "true" : "false");
          b.dataset.value = o[0];
          b.addEventListener("click", () => { if (b.getAttribute("aria-checked") !== "true") save(spec, ctl, o[0]); });
          input.appendChild(b);
        }
      } else {
        input = el("select", "stg-input");
        for (const o of opts) {
          const op = el("option", "", o[1]);
          op.value = o[0];
          input.appendChild(op);
        }
        input.value = typeof cur === "string" ? cur : "";
        input.addEventListener("change", () => save(spec, ctl, input.value));
      }
    } else if (kind === "time") {
      input = el("input", "stg-input");
      input.type = "time";
      input.value = typeof cur === "string" ? cur : "";
      input.addEventListener("change", () => {
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) save(spec, ctl, input.value);
      });
    } else if (kind === "date") {
      // B-2179 (v2.0.175): a calendar date (Walmart vacation mode's return day) - only a real YYYY-MM-DD is saved.
      input = el("input", "stg-input");
      input.type = "date";
      input.value = typeof cur === "string" ? cur : "";
      input.addEventListener("change", () => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
          if (spec.key === VACATION) saveVacation(spec, (cand) => { cand[ctl.path] = input.value; });
          else save(spec, ctl, input.value);
        } else if (spec.key === VACATION && input.value === "" && ctl.path === "latestDate") {
          saveVacation(spec, (cand) => { cand.latestDate = ""; }); // clearing the latest day = no range (the earliest day alone)
        }
      });
    } else if (kind === "dayChips") {
      input = dayChips(spec);
    } else {
      input = el("input", "stg-input");
      input.type = "number";
      input.inputMode = "decimal";
      // B-2167 (v2.0.172): a control on an object's field carries its own range (ctl), else the whole key's (spec).
      const lo = ctl.min ?? spec.min, hi = ctl.max ?? spec.max, st = ctl.step ?? spec.step;
      if (lo != null) input.min = String(lo);
      if (hi != null) input.max = String(hi);
      if (st != null) input.step = String(st);
      if (ctl.placeholder != null) input.placeholder = String(ctl.placeholder); // the default, when the stored object has no field yet
      input.value = typeof cur === "number" ? String(cur) : "";
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(n) || (lo != null && n < lo) || (hi != null && n > hi)) {
          notes[spec.key] = { text: `Use a number from ${lo} to ${hi}`, at: Date.now(), bad: true };
          return draw(true);
        }
        save(spec, ctl, n);
      });
    }
    input.setAttribute("aria-label", ctl.label || spec.label);
    if (busy || !row || !row.exists) {
      if (input.classList.contains("stg-seg")) { for (const b of input.querySelectorAll("button")) b.disabled = true; if (busy) input.setAttribute("aria-busy", "true"); }
      else input.disabled = true;
    }
    return input;
  }

  // B-2249 (v2.0.188): Walmart vacation mode's range on the phone. Every change goes through the same check the computers run
  // (lib/walmart-vacation-days.js normalizeVacationSetting, in settings-lib.js) so the phone never saves what a computer would refuse,
  // and what it saves is already cleaned (skip days outside the range dropped).
  const VACATION = "shopperWalmartVacation";
  // B-2262 (1): turning vacation on (or moving its earliest day while on) runs the computers' own save check - the earliest day must be after today.
  function vacationRefusal(base, next) {
    if (!isObj(next) || next.on !== true) return "";
    const was = isObj(base) ? base : {};
    if (was.on === true && was.returnDate === next.returnDate) return "";
    // the phone saves each control on its own: turning vacation on before a date is picked stays allowed (as before; lines are held until a date is set) -
    // only a picked date that is today or earlier is refused, with the computers' own words
    if (!String(next.returnDate || "").trim()) return "";
    return SPEC.vacationSaveRefusal(next, Date.now());
  }
  // mutate(value) changes the fresh value in place and may return a refusal text.
  function saveVacation(spec, mutate) {
    return save(spec, { path: "", mutate }, undefined);
  }
  function dayChips(spec) {
    const wrap = el("div", "stg-chips");
    const cur = entryValue(spec);
    const range = SPEC.vacationRange(isObj(cur) ? cur : {});
    if (!range.days.length) {
      wrap.appendChild(el("span", "muted small", range.noDate ? "Pick the earliest day first." : "The range is longer than 14 days - shorten it."));
      return wrap;
    }
    const skipped = new Set(range.skipDates);
    for (const d of range.days) {
      const b = el("button", "stg-chip" + (skipped.has(d) ? " is-skipped" : ""), SPEC.dayWithWeekday(d));
      b.type = "button";
      b.setAttribute("aria-pressed", skipped.has(d) ? "true" : "false");
      b.setAttribute("aria-label", `${SPEC.dayWithWeekday(d)}${skipped.has(d) ? " - skipped, tap to use it" : " - tap to skip it"}`);
      b.addEventListener("click", () => {
        saveVacation(spec, (cand) => {
          // toggled on the FRESH row's range and skips, not on what this page last drew
          const fresh = SPEC.vacationRange(cand);
          if (!fresh.days.includes(d)) return "the range changed - look again";
          const next = new Set(fresh.skipDates);
          if (next.has(d)) next.delete(d);
          else next.add(d);
          if (next.size >= fresh.days.length) return "keep at least one day - every day in the range is skipped";
          cand.skipDates = fresh.days.filter((x) => next.has(x));
          return undefined;
        });
      });
      if (!row || !row.exists) b.disabled = true;
      wrap.appendChild(b);
    }
    return wrap;
  }

  function controlsOf(spec) {
    if (spec.phone === true) return [{ path: "", label: spec.label, kind: spec.kind, options: spec.options }];
    return Array.isArray(spec.phone) ? spec.phone : [];
  }

  function draw(force) {
    const host = $("stgBody");
    if (!host) return;
    const waiting = waitingFor();
    const lines = syncLines();
    const differ = differCount();
    const sig = JSON.stringify([row && row.v, row && row.entries, lines, differ, waiting, status, Object.keys(notes).map((k) => notes[k].text)]);
    if (!force && sig === drawnSig) return;
    // Never redraw under a finger: a focused control keeps the screen until it is released.
    const ae = document.activeElement;
    if (!force && ae && host.contains(ae) && /^(INPUT|SELECT)$/.test(ae.tagName)) return;
    drawnSig = sig;
    host.textContent = "";
    const sync = el("section", "section stg-sync");
    sync.appendChild(el("h3", "section-head", "Computers"));
    if (self.ShopperInfoTip) self.ShopperInfoTip.add(sync.lastElementChild, "Passwords and API keys are never shown or changed here.", { id: "stg-keys" }); // B-2069 (v2.0.158)
    if (status) sync.appendChild(el("p", "muted small", status));
    else if (sent && waiting.length) sync.appendChild(el("p", "stg-wait", `Saved - waiting for ${waiting.join(", ")}`));
    else if (sent) sync.appendChild(el("p", "stg-ok", "Saved - every computer has it"));
    for (const l of lines) sync.appendChild(el("p", "small stg-line", l));
    if (!lines.length) sync.appendChild(el("p", "muted small", "No computer has reported in yet."));
    if (differ === 0) sync.appendChild(el("p", "stg-ok small", "All shared settings match on both computers."));
    else if (differ > 0) sync.appendChild(el("p", "stg-wait small", `${differ} setting${differ === 1 ? "" : "s"} differ between the computers - Settings → Data & logs → This computer lists them.`));
    host.appendChild(sync);
    // B-2285 item 2b: ONE "On the computer" card for the computer-level things (the drawer has one row for it).
    const onComp = el("section", "section stg-oncomp");
    onComp.appendChild(el("h3", "section-head", "On the computer"));
    onComp.appendChild(el("p", "muted small", "Accounts and sign-ins, Phone remote set-up, label printer, Data & logs."));
    host.appendChild(onComp);
    if (row && !row.exists) host.appendChild(el("p", "muted small", "Not shared yet - open Shopper on a computer and give it a minute."));
    for (const [gid, glabel] of SPEC.SETTINGS_GROUPS) {
      const specs = SPEC.SHARED_SETTINGS_SPEC.filter((s) => s.row === SPEC.SETTINGS_ROW && s.group === gid && s.phone);
      if (!specs.length) continue;
      // B-2285 item 2a: a fold with a visible arrow and a remembered open state (fold-targets.js adds the toggle; settings:<gid> in shopperFoldState); starts closed.
      const card = el("section", "section stg-card");
      card.dataset.gid = gid;
      card.appendChild(el("h3", "section-head", glabel));
      for (const spec of specs) {
        // what this setting's last save said (a computer that put it back wins over our own "Saved")
        const n = notes[spec.key];
        const e = row && row.entries[spec.key];
        let text = n ? n.text : "";
        let bad = !!(n && n.bad);
        // A computer refused it and put its own back: the row now holds somebody else's newer value.
        if (n && n.sentAt && e && e.by !== "phone" && Number(e.at) >= n.sentAt) {
          text = `${e.byName || "A computer"} put it back`;
          bad = true;
        }
        // B-2282a: a setting with one control shows its "Saved ✓" / refusal INSIDE its row; several controls keep one line under them
        const single = controlsOf(spec).length === 1;
        for (const ctl of controlsOf(spec)) {
          const r = el("div", "stg-row");
          const lab = el("label", "stg-label", ctl.label || spec.label);
          if (spec.unit && !ctl.path) lab.textContent = `${ctl.label || spec.label} (${spec.unit})`;
          const c = control(spec, ctl);
          if (c.id === "") c.id = "stg_" + spec.key + (ctl.path ? "_" + ctl.path.replace(/\./g, "_") : "");
          lab.htmlFor = c.id;
          if ((ctl.kind || spec.kind) === "dayChips") r.classList.add("stg-row-chips");
          r.appendChild(lab);
          r.appendChild(c);
          const here = n && n.busy && n.path === (ctl.path || "");
          if ((single || here) && text) r.appendChild(el("p", bad ? "small stg-bad stg-row-note" : "small stg-saved stg-row-note", text));
          card.appendChild(r);
          if (spec.note && !ctl.path) card.appendChild(el("p", "muted small stg-note", spec.note));
        }
        // B-2249 / B-2251: what the vacation setting means right now (the computers' own sentence; the "last seen" day lives on the computer that buys).
        if (spec.key === VACATION) card.appendChild(el("p", "small muted stg-vac-status", SPEC.vacationStatusLine(entryValue(spec), Date.now(), SPEC.newestVacationSeen(computers.map((c) => c.vacationSeen)))));
        // the card-level line carries the final Saved / refusal; "Saving…" shows in the tapped row when there is one
        const shownInRow = n && n.busy && controlsOf(spec).some((c) => (c.path || "") === n.path);
        if (text && !single && !shownInRow) card.appendChild(el("p", bad ? "small stg-bad" : "small muted", text));
        if (bad) card.dataset.sfoldReveal = "1"; // a refusal never hides in a closed card
      }
      host.appendChild(card);
    }
    if (pendingJump) { const h = pendingJump; pendingJump = ""; applyJump(h); }
  }

  async function load() {
    try {
      const [r, c] = await Promise.all([readRow(), readComputers()]);
      if (r.ok) {
        row = r;
        status = "";
      } else status = `Could not read the settings (${r.reason})`;
      computers = c;
      loadedAt = Date.now();
    } catch (err) {
      status = "Could not read the settings";
    }
    draw(false);
  }

  function tickLoop() {
    const pane = $("settingsPane");
    if (!pane || pane.hidden) {
      timer = null;
      return;
    }
    load().finally(() => {
      timer = setTimeout(tickLoop, POLL_MS);
    });
  }

  // B-1791 (v2.0.135): a Settings row in the drawer -> its card. Accounts / Phone remote / Data & logs are computer-level: they land on the
  // Computers card with one line saying so (the phone never reads the secrets row).
  const JUMP_CARD = { buying: "buying", pipeline: "pipeline", labels: "labels" };
  let pendingJump = "";
  function applyJump(h) {
    const host = $("stgBody");
    if (!host) return false;
    let target = null;
    if (JUMP_CARD[h]) {
      target = host.querySelector('section.stg-card[data-gid="' + JUMP_CARD[h] + '"]');
      // a drawer pick opens and remembers that section (B-2285 item 2a)
      if (target && self.ShopperFold) self.ShopperFold.set("settings:" + JUMP_CARD[h], true);
    } else {
      target = host.querySelector(".stg-oncomp"); // B-2285 item 2b: accounts / phone / data all land on the one card
    }
    // B-2285 item 1: scroll only when the card is off the visible part of the screen (above the header or below the fold) - and then to just under the header, never to the very top edge
    if (target && target.getBoundingClientRect) {
      const bar = $("topBar");
      const headerH = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
      const t = target.getBoundingClientRect().top;
      if (t < headerH || t > (window.innerHeight || 0) - 120) window.scrollTo(0, Math.max(0, (window.scrollY || 0) + t - headerH - 8));
    }
    return !!target;
  }
  // The pane draws after it is shown (it reads the shared row first), so the jump is also applied once after the next draw.
  function jump(hash) {
    pendingJump = String(hash || "");
    return applyJump(pendingJump);
  }

  // B-2040 (v2.0.154): the Receive pop-up reads / remembers its Packs / Pieces choice through the SAME shared row the Settings
  // screen writes (no screen drawn). readValue -> the stored value or undefined; writeValue -> true when it saved.
  async function readValue(key) {
    const got = await readRow();
    if (!got.ok || !got.exists) return undefined;
    const e = got.entries[key];
    return e && e.v !== undefined ? e.v : undefined;
  }
  async function writeValue(key, val) {
    const spec = SPEC.SHARED_SETTINGS_SPEC.find((s) => s.key === key && s.row === SPEC.SETTINGS_ROW);
    if (!spec || SPEC.checkSettingValue(spec, val).ok !== true) return false;
    for (let tries = 0; tries < 2; tries++) {
      const got = await readRow();
      if (!got.ok || !got.exists || got.sv > 1) return false;
      const t = Date.now();
      const entries = { ...got.entries, [key]: { v: val, at: t, by: "phone", byName: "Phone" } };
      const res = await self.ShopperRemote.sb(`device_state?device_id=eq.${ROW}&v=eq.${got.v}&select=device_id,v`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { device_name: "Phone", v: got.v + 1, payload: { value: { sv: 1, entries }, by: "phone", byName: "Phone", at: t }, updated_at: new Date(t).toISOString() },
      });
      if (!res.ok) return false;
      if (Array.isArray(res.json) && res.json.length === 1) { sent = { v: got.v + 1, at: t }; return true; }
    }
    return false;
  }

  self.ShopperSettingsView = Object.freeze({
    jump,
    readValue,
    writeValue,
    shown() {
      if (timer) clearTimeout(timer);
      drawnSig = "";
      tickLoop();
    },
  });
})();
