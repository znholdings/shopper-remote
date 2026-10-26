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
    const res = await R.sb(`device_state?device_id=eq.${ROW}&select=device_id,v,payload,updated_at&limit=1`);
    if (!res.ok) return { ok: false, reason: res.reason || "no answer" };
    const r = Array.isArray(res.json) ? res.json[0] : null;
    if (!r) return { ok: true, exists: false, v: 0, entries: {}, sv: 1 };
    const val = r.payload && isObj(r.payload.value) ? r.payload.value : {};
    return { ok: true, exists: true, v: Number(r.v) || 0, entries: isObj(val.entries) ? val.entries : {}, sv: Number(val.sv) || 1, at: Date.parse(r.updated_at || "") || 0 };
  }
  async function readComputers() {
    const R = self.ShopperRemote;
    const res = await R.sb(`device_state?device_id=like.${COMPUTERS}*&select=device_id,payload,updated_at`);
    if (!res.ok || !Array.isArray(res.json)) return [];
    const out = [];
    for (const r of res.json) {
      const v = r && r.payload && r.payload.value;
      if (v && v.id) out.push({ id: String(v.id), name: String(v.name || "computer"), role: v.role === "viewer" ? "viewer" : "main", seenAt: Number(v.seenAt) || 0, settingsV: Number(v.settingsV) || 0, settingsAt: Number(v.settingsAt) || 0 });
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
    if (v === undefined || v === null) return undefined;
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
  function waitingFor() {
    if (!sent || !row) return [];
    const now = Date.now();
    return computers.filter((c) => now - c.seenAt < STALE_MS && c.settingsV < sent.v).map((c) => c.name);
  }

  async function save(spec, ctl, val) {
    const key = spec.key;
    notes[key] = { text: "Saving...", at: Date.now(), sentAt: 0 };
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
      if (spec.pair) next = { goal: val, setAt: t };
      else if (!ctl.path) next = val;
      else {
        next = isObj(base) ? clone(base) : {};
        setPath(next, ctl.path, val);
      }
      entries[key] = { v: next, at: t, by: "phone", byName: "Phone" };
      const res = await self.ShopperRemote.sb(`device_state?device_id=eq.${ROW}&v=eq.${got.v}&select=device_id,v`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { device_name: "Phone", v: got.v + 1, payload: { value: { sv: 1, entries }, by: "phone", byName: "Phone", at: t }, updated_at: new Date(t).toISOString() },
      });
      if (!res.ok) {
        notes[key] = { text: `Not saved - ${res.reason || "no answer"}`, at: Date.now(), bad: true };
        return draw(true);
      }
      if (Array.isArray(res.json) && res.json.length === 1) {
        sent = { v: got.v + 1, at: t };
        notes[key] = { text: "Saved", at: t, sentAt: t };
        await load();
        return;
      }
    }
    notes[key] = { text: "Not saved - the settings kept changing, try again", at: Date.now(), bad: true };
    draw(true);
  }

  function control(spec, ctl) {
    const cur = controlValue(spec, ctl);
    const kind = ctl.kind || spec.kind;
    let input;
    if (kind === "bool") {
      input = el("input");
      input.type = "checkbox";
      input.checked = cur === true;
      input.addEventListener("change", () => save(spec, ctl, input.checked));
    } else if (kind === "enum") {
      input = el("select", "stg-input");
      const opts = ctl.options || spec.options || [];
      for (const o of opts) {
        const op = el("option", "", o[1]);
        op.value = o[0];
        input.appendChild(op);
      }
      input.value = typeof cur === "string" ? cur : "";
      input.addEventListener("change", () => save(spec, ctl, input.value));
    } else if (kind === "time") {
      input = el("input", "stg-input");
      input.type = "time";
      input.value = typeof cur === "string" ? cur : "";
      input.addEventListener("change", () => {
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) save(spec, ctl, input.value);
      });
    } else {
      input = el("input", "stg-input");
      input.type = "number";
      input.inputMode = "decimal";
      if (spec.min != null) input.min = String(spec.min);
      if (spec.max != null) input.max = String(spec.max);
      if (spec.step != null) input.step = String(spec.step);
      input.value = typeof cur === "number" ? String(cur) : "";
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(n) || (spec.min != null && n < spec.min) || (spec.max != null && n > spec.max)) {
          notes[spec.key] = { text: `Use a number from ${spec.min} to ${spec.max}`, at: Date.now(), bad: true };
          return draw(true);
        }
        save(spec, ctl, n);
      });
    }
    input.setAttribute("aria-label", ctl.label || spec.label);
    if (!row || !row.exists) input.disabled = true;
    return input;
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
    const sig = JSON.stringify([row && row.v, row && row.entries, lines, waiting, status, Object.keys(notes).map((k) => notes[k].text)]);
    if (!force && sig === drawnSig) return;
    // Never redraw under a finger: a focused control keeps the screen until it is released.
    const ae = document.activeElement;
    if (!force && ae && host.contains(ae) && /^(INPUT|SELECT)$/.test(ae.tagName)) return;
    drawnSig = sig;
    host.textContent = "";
    const sync = el("section", "section stg-sync");
    sync.appendChild(el("h3", "section-head", "Computers"));
    if (status) sync.appendChild(el("p", "muted small", status));
    else if (sent && waiting.length) sync.appendChild(el("p", "stg-wait", `Saved - waiting for ${waiting.join(", ")}`));
    else if (sent) sync.appendChild(el("p", "stg-ok", "Saved - every computer has it"));
    for (const l of lines) sync.appendChild(el("p", "small stg-line", l));
    if (!lines.length) sync.appendChild(el("p", "muted small", "No computer has reported in yet."));
    host.appendChild(sync);
    if (row && !row.exists) host.appendChild(el("p", "muted small", "Not shared yet - open Shopper on a computer and give it a minute."));
    for (const [gid, glabel] of SPEC.SETTINGS_GROUPS) {
      const specs = SPEC.SHARED_SETTINGS_SPEC.filter((s) => s.row === SPEC.SETTINGS_ROW && s.group === gid && s.phone);
      if (!specs.length) continue;
      const card = el("details", "section stg-card");
      if (gid === "buying") card.open = true;
      card.appendChild(el("summary", "section-head", glabel));
      for (const spec of specs) {
        for (const ctl of controlsOf(spec)) {
          const r = el("div", "stg-row");
          const lab = el("label", "stg-label", ctl.label || spec.label);
          if (spec.unit && !ctl.path) lab.textContent = `${ctl.label || spec.label} (${spec.unit})`;
          const c = control(spec, ctl);
          if (c.id === "") c.id = "stg_" + spec.key + (ctl.path ? "_" + ctl.path.replace(/\./g, "_") : "");
          lab.htmlFor = c.id;
          r.appendChild(lab);
          r.appendChild(c);
          card.appendChild(r);
          if (spec.note && !ctl.path) card.appendChild(el("p", "muted small stg-note", spec.note));
        }
        const n = notes[spec.key];
        const e = row && row.entries[spec.key];
        let text = n ? n.text : "";
        let bad = !!(n && n.bad);
        // A computer refused it and put its own back: the row now holds somebody else's newer value.
        if (n && n.sentAt && e && e.by !== "phone" && Number(e.at) >= n.sentAt) {
          text = `${e.byName || "A computer"} put it back`;
          bad = true;
        }
        if (text) card.appendChild(el("p", bad ? "small stg-bad" : "small muted", text));
      }
      host.appendChild(card);
    }
    host.appendChild(el("p", "muted small", "Passwords and API keys are never shown or changed here."));
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

  self.ShopperSettingsView = Object.freeze({
    shown() {
      if (timer) clearTimeout(timer);
      drawnSig = "";
      tickLoop();
    },
  });
})();
