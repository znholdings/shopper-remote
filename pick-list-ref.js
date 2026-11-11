// remote/pick-list-ref.js - B-1961 (v2.0.149): the reference for "the buy list / the buy order changed" while the phone's buy
// lines come from the Run-on pick (the paired Main is silent - remote/app.js followsPick).
// The Main's last update is no reference then (B-1947), so the list never reloaded itself. A computer covering a silent Main
// publishes its own phone row (lib/remote-bridge.js publishBlocked, B-1421) with the same two fields the Main's has: buylistSig
// and buyOrderAt. This reads those two (and the row's time) every 30 s - only while the view asks - and hands them to
// remote/queue-preview-view.js, which compares them exactly as it compares the Main's.
// Every time compared is the PICK's own clock: the row's updated_at, the list's `at`, an order's savedAt. A reference counts only
// when the pick published it AFTER the list on screen was built (and after this phone's last saved move).
// Classic script (index.html loads it before queue-preview-view.js). Reads only; nothing is kept in the phone's storage.
(function (root) {
  "use strict";
  const READ_GAP_MS = 30 * 1000;
  const READ_STALE_MS = 2 * 60 * 1000;
  const SELECT = "updated_at,buylistSig:payload->buylistSig,buyOrderAt:payload->buyOrderAt";
  const okId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ""));
  const st = { id: "", ref: null, readAt: 0, triedAt: 0, reading: false };

  // one device_state row (the select above) -> { at, buylistSig, buyOrderAt } | null
  function refOfRow(row) {
    if (!row || typeof row !== "object") return null;
    const at = Date.parse(row.updated_at);
    if (!Number.isFinite(at)) return null;
    return {
      at,
      buylistSig: typeof row.buylistSig === "string" && row.buylistSig ? row.buylistSig : null,
      buyOrderAt: typeof row.buyOrderAt === "number" && Number.isFinite(row.buyOrderAt) ? row.buyOrderAt : null,
    };
  }
  // -> the reference, or null: no read yet / another pick / not read lately / published before `after` (the pick's clock)
  function refFor(after, pickId, now) {
    const r = st.ref;
    if (!r || !pickId || st.id !== String(pickId)) return null;
    if ((now == null ? Date.now() : now) - st.readAt > READ_STALE_MS) return null;
    if (!(Number(after) > 0) || !(r.at > Number(after))) return null;
    return r;
  }
  // Called from the view's 2 s tick while the list follows the pick. Reads at most every 30 s. -> true when it read.
  async function tick(deps) {
    const d = deps || {};
    const R = d.remote || root.ShopperRemote;
    const now = d.now ? d.now() : Date.now();
    const id = R && typeof R.pickDevice === "function" ? String(R.pickDevice() || "") : "";
    if (id !== st.id) { st.id = id; st.ref = null; st.readAt = 0; st.triedAt = 0; }
    if (!okId(id) || !R || typeof R.sb !== "function" || st.reading) return false;
    if (st.triedAt && now - st.triedAt < READ_GAP_MS) return false;
    st.triedAt = now; st.reading = true;
    try {
      const res = await R.sb("device_state?device_id=eq." + encodeURIComponent(id) + "&select=" + SELECT + "&limit=1");
      const ref = res && res.ok && Array.isArray(res.json) ? refOfRow(res.json[0]) : null;
      if (st.id === id && ref) { st.ref = ref; st.readAt = d.now ? d.now() : Date.now(); }
    } catch (e) { /* the last reference ages out by itself */ }
    st.reading = false;
    return true;
  }
  root.ShopperPickListRef = { tick, refFor, refOfRow, READ_GAP_MS, READ_STALE_MS, SELECT, _state: st };
})(typeof globalThis !== "undefined" ? globalThis : this);
