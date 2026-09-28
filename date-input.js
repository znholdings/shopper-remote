// remote/date-input.js - B-683 (v4.93). The phone's typed date box.
//
// iOS opens a calendar wheel for <input type="date">, which is slow for an
// expiry date read off a box. This is a plain text box with the numeric
// keypad (inputmode="numeric") that puts the slashes in as he types
// MM/DD/YYYY. Backspace works naturally: while deleting, no trailing slash
// is re-added, so "12/" backspaces to "12".
//
// The save path still sends YYYY-MM-DD (houseExpirySet's `expires`), so the
// laptop side is unchanged. An incomplete or impossible date is never sent.
//
// Classic script (like fba-lib.js / boxes.js): sets self.ShopperDateInput.
// Loaded before parity.js, which uses it. No DOM at load time.
(function (root) {
  "use strict";

  // Digits typed so far -> "MM/DD/YYYY" shape. `deleting` = the edit was a
  // backspace/delete, so a slash is never appended after the last digit.
  function formatTyped(raw, deleting) {
    const d = String(raw == null ? "" : raw).replace(/\D/g, "").slice(0, 8);
    let out = d.slice(0, 2);
    if (d.length > 2) out += "/" + d.slice(2, 4);
    if (d.length > 4) out += "/" + d.slice(4, 8);
    if (!deleting && (d.length === 2 || d.length === 4)) out += "/";
    return out;
  }

  // "MM/DD/YYYY" -> "YYYY-MM-DD", or "" when incomplete or not a real day.
  function typedToIso(text) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text == null ? "" : text).trim());
    if (!m) return "";
    const mo = +m[1], day = +m[2], yr = +m[3];
    if (yr < 2000 || yr > 2099 || mo < 1 || mo > 12 || day < 1) return "";
    const last = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
    if (day > last) return "";
    return `${m[3]}-${m[1]}-${m[2]}`;
  }

  // "YYYY-MM-DD" (what the laptop publishes) -> "MM/DD/YYYY" for the box.
  function isoToTyped(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? "" : iso).trim());
    return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
  }

  // "" = empty box (clear), "YYYY-MM-DD" = good, null = not a date yet.
  function readValue(text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return "";
    return typedToIso(t) || null;
  }

  // Makes a text <input> behave as the typed date box.
  function attach(input) {
    input.type = "text";
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("maxlength", "10");
    input.placeholder = "MM/DD/YYYY";
    input.addEventListener("input", (e) => {
      const deleting = !!(e && typeof e.inputType === "string" && e.inputType.indexOf("delete") === 0);
      const next = formatTyped(input.value, deleting);
      if (next !== input.value) input.value = next;
      input.removeAttribute("aria-invalid");
    });
    return input;
  }

  root.ShopperDateInput = Object.freeze({ formatTyped, typedToIso, isoToTyped, readValue, attach });
})(typeof self !== "undefined" ? self : globalThis);
