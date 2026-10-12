// remote/house-expiry-view.js - B-1056 (v2.0.52). The expiry date on each
// product of the phone's Stock tab House list (the rows with "Counted N x"
// and "Receive · N"), the same date as the laptop's House on hand "Expires"
// column (B-548 / B-554).
//
//   - Shown under the product's title: "Exp 04/30/2029", or "Add expiry".
//     A date that has passed is flagged like the laptop ("passed", red) -
//     isPast from lib/house-expiry.js.
//   - Tap -> a date box (numeric keypad, slashes put in as he types; any
//     format pasted is fine) -> Save. Read with the laptop's own
//     normalizeExpiry (lib/expiry-date.js, via remote/expiry-lib.js): a
//     half-typed, impossible or already-passed date is refused here and
//     never sent. An empty box + Save removes the date (the laptop's rule).
//   - Saved through the SAME houseExpirySet command remote/parity.js sends
//     (laptop: SHOPPER_HOUSE_EXPIRY_SET -> the latest All Orders row's
//     "Expiration Date"). While the laptop has not answered the row says
//     "Sending to the laptop..." (asleep laptop = it stays until it wakes),
//     like Receive.
//
// What a row is showing (open box, sending, saved, error) is kept HERE by
// ASIN, so the list being rebuilt by a payload never loses it.
//
// Classic script: sets self.ShopperHouseExpiry. Needs self.ShopperExpiry
// (expiry-lib.js) and self.ShopperRemote (app.js) at call time, not load.
(function (root) {
  "use strict";

  const rows = new Map(); // asin -> { open, draft, sending, msg, bad, saved }
  const painters = new Map(); // asin -> the paint of the row on screen now (the list is rebuilt)
  const repaintOf = (asin, fallback) => () => { const p = painters.get(asin); (p || fallback)(); };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function lib() { return root.ShopperExpiry || null; }

  // Today in Central (the house's zone), YYYY-MM-DD.
  function todayIso(nowMs) {
    return new Date(nowMs == null ? Date.now() : nowMs).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  }

  function isoToUs(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? m[2] + "/" + m[3] + "/" + m[1] : "";
  }

  // The date this row shows: a save that just landed wins until the laptop's
  // next payload carries it.
  function currentIso(asin, map) {
    const st = rows.get(asin);
    if (st && st.saved != null) {
      const sent = map && Object.prototype.hasOwnProperty.call(map, asin) ? String(map[asin] || "") : "";
      if (sent === st.saved) st.saved = null;
      else return st.saved;
    }
    const v = map && map[asin];
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
  }

  // -> { text, past } for the row's chip. Pure (tests read it).
  function chipText(iso, today) {
    if (!iso) return { text: "Add expiry", past: false };
    const L = lib();
    const past = L && L.isPast ? L.isPast(iso, today) : iso <= today;
    return { text: "Exp " + isoToUs(iso) + (past ? " · passed" : ""), past };
  }

  // Box text -> { iso, error }. "" = remove the date.
  function readBox(raw, today) {
    const t = String(raw == null ? "" : raw).trim();
    if (!t) return { iso: "", error: "" };
    const L = lib();
    if (!L || !L.normalizeExpiry) return { iso: "", error: "The date reader did not load - reload the app." };
    return L.normalizeExpiry(t, { todayIso: today });
  }

  function failText(status) {
    if (status === "not sent") return "The command did not reach the laptop, so nothing was saved.";
    if (status === "timeout") return "The laptop did not answer, so nothing is confirmed.";
    if (status === "rejected") return "The laptop refused it, so nothing was saved.";
    if (status === "error") return "The laptop could not save it.";
    return "The laptop answered \"" + status + "\", so nothing was saved.";
  }

  // Digits and slashes typed on the keypad get their slashes put in
  // (remote/date-input.js); anything else (a pasted "Apr 1 2029") is left as typed.
  function onType(input, e) {
    const DI = root.ShopperDateInput;
    if (!DI || !DI.formatTyped) return;
    if (!/^[\d/]*$/.test(input.value)) return;
    const deleting = !!(e && typeof e.inputType === "string" && e.inputType.indexOf("delete") === 0);
    const next = DI.formatTyped(input.value, deleting);
    if (next !== input.value) input.value = next;
  }

  async function save(asin, title, raw, repaint) {
    const st = rows.get(asin) || {};
    const today = todayIso();
    const { iso, error } = readBox(raw, today);
    if (error) {
      rows.set(asin, { ...st, open: true, draft: raw, msg: error, bad: true });
      repaint();
      return;
    }
    const R = root.ShopperRemote;
    if (!R || !R.sendCommand) {
      rows.set(asin, { ...st, open: true, draft: raw, msg: "Not connected to the laptop.", bad: true });
      repaint();
      return;
    }
    rows.set(asin, { ...st, open: true, draft: raw, sending: true, msg: "Sending to the laptop...", bad: false });
    repaint();
    let status = "not sent";
    try {
      const id = await R.sendCommand("houseExpirySet", { asin, expires: iso });
      status = id ? await R.waitFor(id) : "not sent";
    } catch (err) {
      status = "error";
    }
    if (status === "done") {
      rows.set(asin, { open: false, draft: "", sending: false, msg: iso ? "Saved to All Orders." : "Expiry removed.", bad: false, saved: iso });
    } else {
      rows.set(asin, { ...(rows.get(asin) || {}), open: true, sending: false, msg: failText(status), bad: true });
    }
    repaint();
  }

  // host = the title cell of one House row. r = the inventory row
  // ({ asin, title }). map = lastPayload.houseExpiry ({ asin: "YYYY-MM-DD" }).
  function decorate(host, r, map) {
    if (!host || !r || !r.asin) return null;
    const asin = r.asin;
    const box = el("div", "hx");
    box.dataset.asin = asin;
    const paint = () => {
      box.textContent = "";
      const st = rows.get(asin) || {};
      const today = todayIso();
      const iso = currentIso(asin, map);
      if (!st.open) {
        const c = chipText(iso, today);
        const chip = el("button", "hx-chip" + (c.past ? " hx-past" : "") + (iso ? "" : " hx-add"), c.text);
        chip.type = "button";
        chip.setAttribute("aria-label", (iso ? "Change the expiry date of " : "Add an expiry date to ") + (r.title || asin));
        chip.addEventListener("click", () => {
          rows.set(asin, { ...(rows.get(asin) || {}), open: true, draft: isoToUs(currentIso(asin, map)), msg: "", bad: false });
          paint();
          const input = box.querySelector("input");
          if (input) input.focus();
        });
        box.appendChild(chip);
        if (st.msg) box.appendChild(el("div", "hx-meta" + (st.bad ? " hx-bad" : " hx-ok"), st.msg));
        return;
      }
      const form = el("div", "hx-edit");
      const input = el("input", "need-input hx-input");
      input.type = "text";
      input.setAttribute("inputmode", "numeric");
      input.setAttribute("autocomplete", "off");
      input.setAttribute("maxlength", "20");
      input.placeholder = "MM/DD/YYYY";
      input.value = st.draft != null ? st.draft : "";
      input.disabled = !!st.sending;
      input.setAttribute("aria-label", "Expiry date for " + (r.title || asin));
      input.addEventListener("input", (e) => {
        onType(input, e);
        const cur = rows.get(asin) || {};
        rows.set(asin, { ...cur, draft: input.value });
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      const ok = el("button", "secondary-btn hx-save", st.sending ? "Sending…" : "Save");
      ok.type = "button";
      ok.disabled = !!st.sending;
      const go = () => { if (!(rows.get(asin) || {}).sending) save(asin, r.title, input.value, repaintOf(asin, paint)); };
      ok.addEventListener("click", go);
      const no = el("button", "ghost-btn hx-cancel", "Cancel");
      no.type = "button";
      no.disabled = !!st.sending;
      no.addEventListener("click", () => { rows.set(asin, { open: false, draft: "", msg: "", bad: false, saved: (rows.get(asin) || {}).saved }); paint(); });
      form.append(input, ok, no);
      box.appendChild(form);
      if (st.msg) box.appendChild(el("div", "hx-meta" + (st.bad ? " hx-bad" : ""), st.msg));
    };
    painters.set(asin, paint);
    paint();
    host.appendChild(box);
    return box;
  }

  root.ShopperHouseExpiry = Object.freeze({ decorate, chipText, readBox, isoToUs, _rows: rows });
})(typeof self !== "undefined" ? self : globalThis);
