// remote/buy-shots-view.js - B-1173 (v2.0.64): the buy-tab snapshot on each
// Buy Queue line. The laptop publishes, per line, the object path of the
// newest picture in the PRIVATE "buy-shots" bucket (payload.buyShots); this
// file asks Supabase Storage for short-lived signed URLs (signed-in session,
// one request for every path that needs one) and shows a thumbnail; a tap
// opens the full picture. Nothing here is a public URL.
//
// Loads pictures only while the app is open and visible, and - with "Wi-Fi
// only on the phone" on - not when the browser says it is on cellular. Most
// phones (Safari) do not say; then it loads.
//
// Loaded after app.js and uses its globals (token(), CFG) at call time.
// textContent only; the full view closes with the `hidden` attribute.
// B-1250 (v2.0.73): the full view FOLLOWS its line - while it is open, each
// newer picture of that line replaces the one on screen (like a slide show),
// loaded first so the screen never goes blank between pictures.
(function () {
  "use strict";
  const BUCKET = "buy-shots";
  const SIGN_SECONDS = 300;
  const RESIGN_BEFORE_MS = 30000;
  const CACHE_MAX = 200;
  const KIND_LABELS = { product: "Product page", cart: "Cart", placed: "Order placed", verified: "Verified", timed: "Live" };

  const cache = new Map(); // path -> { url, exp }
  let signing = null;
  let lastPayload = null;
  // A sign request that failed waits this long before the next try (not every 3 s poll).
  const SIGN_RETRY_MS = 30000;
  let signBlockedUntil = 0;

  // ------------------------------------------------------------ pure rules
  function connectionType(nav) {
    const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    return c && typeof c.type === "string" && c.type ? c.type : "unknown";
  }
  function onCellular(nav) {
    return connectionType(nav) === "cellular";
  }
  // hidden -> never; Wi-Fi only + the browser SAYS cellular -> no; unknown -> load.
  function shouldLoad({ wifiOnly, hidden, nav } = {}) {
    if (hidden) return false;
    if (wifiOnly && onCellular(nav)) return false;
    return true;
  }
  function absoluteSignedUrl(base, signedURL) {
    const s = String(signedURL || "");
    if (!s) return "";
    if (/^https:\/\//.test(s)) return s;
    return String(base || "").replace(/\/+$/, "") + "/storage/v1" + (s.charAt(0) === "/" ? "" : "/") + s;
  }
  function signRequest({ url, anonKey, token, paths }) {
    return {
      url: String(url || "").replace(/\/+$/, "") + "/storage/v1/object/sign/" + BUCKET,
      init: {
        method: "POST",
        headers: { apikey: String(anonKey || ""), Authorization: "Bearer " + String(token || ""), "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths }),
      },
    };
  }
  function needsSign(path, nowMs) {
    const c = cache.get(path);
    return !c || c.exp - RESIGN_BEFORE_MS <= nowMs;
  }
  // B-1642: a picture older than a minute says so ("Last picture - 7 min ago"), and when the
  // computer has not published for a while says that too - never a live-looking time.
  function caption(e, deps) {
    let kind = KIND_LABELS[e && e.kind] || "Snapshot";
    const at = Number(e && e.at);
    if (!at) return kind;
    const d = new Date(at);
    const nowMs = deps && deps.now != null ? Number(deps.now) : Date.now();
    const age = nowMs - at;
    let text;
    if (age > 60000) {
      const m = Math.max(1, Math.round(age / 60000));
      const ago = m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
      text = "Last picture · " + ago;
    } else {
      text = kind + " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    }
    if (deps && deps.stale) {
      text += " - no update for " + (deps.staleMin || Math.max(1, Math.round(age / 60000))) + " min, waiting for " + (deps.deviceName || "the computer") + " to reconnect";
    }
    return text;
  }

  // ------------------------------------------------------------ signing
  async function signPaths(paths, deps = {}) {
    const cfg = deps.cfg || self.SHOPPER_REMOTE_CONFIG || {};
    const getToken = deps.getToken || (typeof token === "function" ? token : null); // eslint-disable-line no-undef
    const f = deps.fetchImpl || (typeof fetch === "function" ? fetch : null);
    const nowMs = deps.now ? deps.now() : Date.now();
    if (!paths.length || !getToken || !f || !cfg.url) return 0;
    const t = await getToken();
    if (!t) return 0;
    const req = signRequest({ url: cfg.url, anonKey: cfg.anonKey, token: t, paths });
    const resp = await f(req.url, req.init).catch(() => null);
    if (!resp || !resp.ok) return 0;
    const list = await resp.json().catch(() => null);
    let n = 0;
    for (const r of Array.isArray(list) ? list : []) {
      const signed = r && (r.signedURL || r.signedUrl);
      if (!r || r.error || !signed || !r.path) continue;
      cache.set(r.path, { url: absoluteSignedUrl(cfg.url, signed), exp: nowMs + SIGN_SECONDS * 1000 });
      n++;
    }
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return n;
  }

  // ------------------------------------------------------------ drawing
  function hintEl(doc) {
    let h = doc.getElementById("buyShotsHint");
    if (h) return h;
    const lines = doc.getElementById("lines");
    if (!lines || !lines.parentNode) return null;
    h = doc.createElement("p");
    h.id = "buyShotsHint";
    h.className = "bs-hint";
    h.hidden = true;
    lines.parentNode.insertBefore(h, lines);
    return h;
  }

  function fullEl(doc) {
    let f = doc.getElementById("buyShotsFull");
    if (f) return f;
    f = doc.createElement("div");
    f.id = "buyShotsFull";
    f.className = "bs-full";
    f.hidden = true;
    f.setAttribute("role", "dialog");
    f.setAttribute("aria-label", "Buy tab snapshot");
    const img = doc.createElement("img");
    img.alt = "Buy tab snapshot";
    const cap = doc.createElement("div");
    cap.className = "bs-cap";
    f.appendChild(img);
    f.appendChild(cap);
    f.addEventListener("click", () => {
      f.hidden = true;
      img.removeAttribute("src");
      f.removeAttribute("data-line-id");
      f.removeAttribute("data-path");
    });
    doc.body.appendChild(f);
    return f;
  }

  const FULL_TAIL = " - updates live · tap to close";
  function openFull(doc, url, text, lineId, path) {
    const f = fullEl(doc);
    f.querySelector("img").src = url;
    f.querySelector(".bs-cap").textContent = text + FULL_TAIL;
    f.setAttribute("data-line-id", lineId || "");
    f.setAttribute("data-path", path || "");
    f.hidden = false;
  }

  // B-1250: the open full view shows line `lineId`; a newer picture of it replaces the one shown.
  function followFull(doc, lineId, url, path, text) {
    const f = doc.getElementById("buyShotsFull");
    if (!f || f.hidden || !lineId || f.getAttribute("data-line-id") !== lineId) return false;
    if (f.getAttribute("data-path") === path) return false;
    f.setAttribute("data-path", path);
    const img = f.querySelector("img");
    const show = () => {
      if (f.hidden || f.getAttribute("data-path") !== path) return;
      img.src = url;
      f.querySelector(".bs-cap").textContent = text + FULL_TAIL;
    };
    const Img = doc.defaultView && doc.defaultView.Image;
    if (typeof Img !== "function") { show(); return true; }
    const pre = new Img();
    pre.onload = show;
    // Not loaded (an expired link): forget it, so the next poll tries again.
    pre.onerror = () => { if (f.getAttribute("data-path") === path) f.removeAttribute("data-path"); };
    pre.src = url;
    return true;
  }

  function clearThumbs(doc) {
    for (const n of doc.querySelectorAll("#lines .bs-shot")) n.remove();
  }

  function render(p, deps = {}) {
    const doc = deps.doc || document;
    const nav = deps.nav || (typeof navigator !== "undefined" ? navigator : null);
    lastPayload = p || null;
    const bs = p && p.buyShots ? p.buyShots : null;
    const hint = hintEl(doc);
    const mode = bs ? bs.mode : "off";
    const hasRun = !!(p && p.run);
    const cellularBlocked = !!(bs && bs.wifiOnly && onCellular(nav));
    if (hint) {
      if (hasRun && mode === "off") {
        hint.textContent = "Snapshots off - turn them on in Settings → Phone Remote on either computer (one shared setting).";
        hint.hidden = false;
      } else if (hasRun && cellularBlocked) {
        hint.textContent = "Snapshots paused on cellular (Wi-Fi only).";
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }
    if (mode === "off" || !bs || !bs.lines) {
      clearThumbs(doc);
      return { shown: 0, toSign: 0 };
    }
    const hidden = deps.hidden != null ? deps.hidden : !!doc.hidden;
    if (!shouldLoad({ wifiOnly: !!bs.wifiOnly, hidden, nav })) return { shown: 0, toSign: 0, held: true };
    const nowMs = deps.now ? deps.now() : Date.now();
    const toSign = [];
    let shown = 0;
    for (const row of doc.querySelectorAll("#lines .line[data-line-id]")) {
      const e = bs.lines[row.getAttribute("data-line-id")];
      let btn = row.querySelector(".bs-shot");
      if (!e || !e.path) {
        if (btn) btn.remove();
        continue;
      }
      if (needsSign(e.path, nowMs)) {
        toSign.push(e.path);
        continue;
      }
      const url = cache.get(e.path).url;
      if (!btn) {
        btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "bs-shot";
        const img = doc.createElement("img");
        img.alt = "Buy tab snapshot";
        img.loading = "lazy";
        img.decoding = "async";
        const cap = doc.createElement("span");
        cap.className = "bs-cap";
        btn.appendChild(img);
        btn.appendChild(cap);
        btn.addEventListener("click", () => openFull(doc, btn.getAttribute("data-url"), btn.getAttribute("data-cap"), row.getAttribute("data-line-id"), btn.getAttribute("data-path")));
        const top = row.querySelector(".l-title") || row.querySelector(".l-top");
        if (top && top.nextSibling) row.insertBefore(btn, top.nextSibling);
        else row.appendChild(btn);
      }
      if (btn.getAttribute("data-path") !== e.path) {
        btn.setAttribute("data-path", e.path);
        btn.querySelector("img").src = url;
      }
      const text = caption(e, { now: nowMs, stale: deps.stale, staleMin: deps.staleMin, deviceName: deps.deviceName });
      btn.setAttribute("data-url", url);
      btn.setAttribute("data-cap", text);
      btn.querySelector(".bs-cap").textContent = text;
      followFull(doc, row.getAttribute("data-line-id"), url, e.path, text);
      shown++;
    }
    if (toSign.length && !signing && nowMs >= signBlockedUntil) {
      signing = signPaths([...new Set(toSign)], deps)
        .catch(() => 0)
        .then((n) => {
          signing = null;
          if (!n) signBlockedUntil = (deps.now ? deps.now() : Date.now()) + SIGN_RETRY_MS;
          else if (lastPayload) render(lastPayload, deps);
        });
    }
    return { shown, toSign: toSign.length };
  }

  self.ShopperBuyShotsPhone = { render, shouldLoad, onCellular, connectionType, absoluteSignedUrl, signRequest, signPaths, caption, openFull, followFull, _cache: cache, _signing: () => signing, _reset: () => { cache.clear(); signing = null; signBlockedUntil = 0; lastPayload = null; } };
})();
