// B-2073 (v2.0.158): ShopperPlain - plain words for text the phone shows. Message text only, never product titles.
(function (root) {
  "use strict";
  function note(s) {
    var t = String(s == null ? "" : s);
    t = t.replace(/\s*\(B-\d{3,5}\b[^()]*\)/g, "");            // " (B-1438)", " (B-1479 listing)"
    t = t.replace(/,\s*B-\d{3,5}\b(?=\s*\))/g, "");             // "(purchase limit, B-786)"
    t = t.replace(/\bB-\d{3,5}\s+(?=#)/g, "");                  // "Cancel B-1254 #1045..."
    t = t.replace(/\s*\[[a-z]\d{3,5}-[0-9a-f]{8,}\]/g, "");     // " [c1254-1f5fa80b6caeab89]"
    t = t.replace(/(^|[^\w.])(-?\d+\.\d{3,})u\b/g, function (m, pre, num) { return pre + String(Math.round(Number(num) * 100) / 100) + "u"; });
    return t.replace(/ {2,}/g, " ").trim();
  }
  function when(v) {
    if (v == null) return "";
    var s = String(v).trim(), ms = NaN;
    if (typeof v === "number" && v >= 1e12) ms = v;
    else if (/^\d{12,13}$/.test(s)) ms = Number(s);
    else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) ms = Date.parse(s);
    if (!Number.isFinite(ms)) return s;
    return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
  }
  root.ShopperPlain = Object.freeze({ note: note, when: when });
})(typeof self !== "undefined" ? self : globalThis);
