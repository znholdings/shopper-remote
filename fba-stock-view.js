// remote/fba-stock-view.js - B-1811 (v2.0.138): "Removals & losses at Amazon" on the phone (Pipeline page, #fbaStockHost).
// Read-only: payload.pages.fbaStock (lib/fba-stock-view.js - the same rows as the laptop's Amazon Inventory card).
// Text nodes only.
(function () {
  "use strict";
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  const pl = () => { try { return typeof lastPayload !== "undefined" ? lastPayload : null; } catch (e) { return null; } };
  const pg = () => { const p = pl(); return p && p.pages && typeof p.pages === "object" ? p.pages : {}; };
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  let drawn = "";
  function draw() {
    const host = document.getElementById("fbaStockHost");
    if (!host) return;
    const v = pg().fbaStock || null;
    const key = JSON.stringify(v);
    if (key === drawn && (host.firstChild || !v)) return;
    drawn = key;
    host.textContent = "";
    const rows = v && Array.isArray(v.rows) ? v.rows : [];
    if (!v || !v.known || !rows.length) return;
    const t = v.totals || {};
    const sec = el("section", "section fs-card");
    sec.appendChild(el("h3", "", "Removals & losses at Amazon"));
    // B-2069 (v2.0.158): the plain summary sits behind an ⓘ; a removal-orders error stays in sight.
    const sumText = "Last " + n(v.windowDays) + " days: " + n(t.lossUnits) + " lost / damaged, " + n(t.disposed) + " disposed, " + n(t.removed) + " removed; " +
      n(t.removing) + " in open removal orders (not counted as owned)." + (v.flagged ? " " + n(v.flagged) + " product(s) lost " + n(v.flagPct) + "% or more." : "");
    if (self.ShopperInfoTip) {
      self.ShopperInfoTip.add(sec.lastElementChild, sumText, { id: "fs-sum" });
      if (v.removalError) sec.appendChild(el("p", "muted small warn-text", "Removal orders: " + v.removalError));
    } else sec.appendChild(el("p", "muted small", sumText + (v.removalError ? " Removal orders: " + v.removalError : "")));
    for (const r of rows) {
      const row = el("div", "fs-line" + (r.flagged ? " fs-flag" : ""));
      row.appendChild(el("b", "", r.title || r.sku || r.asin));
      const bits = [r.asin];
      if (r.lossUnits) bits.push("lost " + n(r.lossUnits) + (r.lossPct != null && r.received ? " of " + n(r.received) + " (" + n(r.lossPct) + "%)" : r.lossPct == null ? " (older stock - no %)" : ""));
      if (r.disposed) bits.push("disposed " + n(r.disposed));
      if (r.removed) bits.push("removed " + n(r.removed));
      if (r.removing) bits.push("being removed " + n(r.removing));
      row.appendChild(el("div", "muted small", bits.join(" · ")));
      sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  function start() { draw(); setInterval(draw, 3000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  self.ShopperFbaStock = Object.freeze({ draw });
})();
