// lib/amazon-order-number.js - B-2393 / B-2395. The Amazon "I bought it" checks for the pages that cannot import ES modules (the status page and the phone are classic scripts).
// remote/amazon-order-number.js is a BYTE COPY of this file (the phone publishes only top-level remote/ files); test v20214-b2395 pins them equal.
// Same rules as lib/amazon-assist.js normalizeAmazonOrderNumber (3-7-7 digits) and lib/amazon-assist-answer.js (the total) - the tests hold them together.
//   ShopperAmazonOrderNumber.normalize(text) -> "112-1234567-1234567" or null
//   ShopperAmazonOrderNumber.parseTotal(text) -> dollars rounded to cents (> 0), or null  ("$1,234.50", "48.1", "48")
//   ShopperAmazonOrderNumber.totalCeiling(capDollars) -> the most a typed total may be (10 x the line's safety cap, at least $100; $5,000 when the line has no cap)
//   ShopperAmazonOrderNumber.checkTotal(text, capDollars) -> { ok: true, total: null } (blank = book at $0.00 as before) | { ok: true, total } | { ok: false, reason }
(function () {
  "use strict";
  function normalize(v) {
    var m = String(v == null ? "" : v).match(/\b(\d{3}-\d{7}-\d{7})\b/);
    return m ? m[1] : null;
  }
  var NO_CAP_CEILING = 5000;
  function parseTotal(v) {
    var s = String(v == null ? "" : v).trim().replace(/^\$\s*/, "");
    if (!s) return null;
    if (!/^(\d{1,7}|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(s)) return null;
    var n = Number(s.replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  }
  function totalCeiling(capDollars) {
    var c = Number(capDollars);
    if (isFinite(c) && c > 0) return Math.max(100, Math.round(c * 10 * 100) / 100);
    return NO_CAP_CEILING;
  }
  function checkTotal(v, capDollars) {
    var raw = String(v == null ? "" : v).trim();
    if (!raw) return { ok: true, total: null };
    var n = parseTotal(raw);
    if (n == null) {
      var zero = /^\$?\s*0*(\.0*)?$/.test(raw);
      return { ok: false, reason: zero
        ? "Total paid must be more than $0.00 - leave the box blank to book at $0.00 and fix the cost on All Orders. Nothing was booked."
        : "Total paid must be dollars and cents, like 48.17 - leave the box blank to book at $0.00. Nothing was booked." };
    }
    var max = totalCeiling(capDollars);
    if (n > max) return { ok: false, reason: "Total paid $" + n.toFixed(2) + " is more than $" + max.toFixed(2) + ", far above what this line should cost - check the number, or leave the box blank and fix the cost on All Orders. Nothing was booked." };
    return { ok: true, total: n };
  }
  var api = { normalize: normalize, parseTotal: parseTotal, totalCeiling: totalCeiling, checkTotal: checkTotal };
  if (typeof self !== "undefined") self.ShopperAmazonOrderNumber = api;
  if (typeof globalThis !== "undefined") globalThis.ShopperAmazonOrderNumber = api;
})();
