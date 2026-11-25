// remote/shoppy-queue-view.js - B-2361 (v2.0.205): the Shoppy queue animations in the phone's header, on the Buylist and Buy Queue (run) tabs.
// The phone twin of lib/shoppy-queue-header.js: PRESENTATION ONLY (sends nothing, writes no queue data). It reads the payload the app already has
// (p.run + p.prompt) through self.ShoppyQueueState (remote/shoppy-queue-state.js = lib/shoppy-queue-state.js), shows ONE <img> that changes only when
// the visual or the run changes, and moves the header's own progress track and status line into a group beside it (moved back when idle).
// The group wraps to its own header row (title + buttons keep the first). A finish plays once per run (localStorage "shoppyFinishSeen" = display memory);
// reduced motion shows the still. app.js calls update(payload) with every payload; topbar-view.js tab() calls tab(which).
(function (root) {
  "use strict";
  var Q = root.ShoppyQueueState;
  var SEEN_KEY = "shoppyFinishSeen";
  var PLAY_MS = 2700;
  var SHOW_ON = { run: 1, buylist: 1 };
  var current = "run";
  var last = null;
  var applied = { visual: null, runKey: "" };
  var group = null, img = null, stack = null, homes = null, playTimer = 0, lastSrc = "";

  function reduced() { try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function seen() { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; } }
  function markSeen(k) { try { localStorage.setItem(SEEN_KEY, String(k)); } catch (e) { /* memory only */ } }

  function build(bar) {
    var track = bar.querySelector(".s-tb-track"), line = bar.querySelector(".s-tb-line");
    var main = bar.querySelector(".s-tb-main");
    if (!track || !line || !main) return false;
    homes = { track: { parent: track.parentNode, next: track.nextSibling }, line: { parent: line.parentNode, next: line.nextSibling }, trackEl: track, lineEl: line };
    group = document.createElement("div"); group.className = "s-tb-qgroup"; group.hidden = true;
    img = document.createElement("img"); img.className = "s-tb-qimg"; img.alt = ""; img.setAttribute("aria-hidden", "true");
    stack = document.createElement("div"); stack.className = "s-tb-qstack";
    group.appendChild(img); group.appendChild(stack);
    bar.insertBefore(group, bar.querySelector(".s-tb-actions") ? bar.querySelector(".s-tb-actions").nextSibling : null);
    return true;
  }
  function putBack(node, home) { var next = home.next && home.next.parentNode === home.parent ? home.next : null; home.parent.insertBefore(node, next); }
  function setSrc(src) { if (src !== lastSrc) { lastSrc = src; img.src = src; } }

  function show(bar, visual, runKey) {
    if (!applied.visual) { stack.appendChild(homes.trackEl); stack.appendChild(homes.lineEl); group.hidden = false; bar.setAttribute("data-shoppy", "on"); }
    var still = reduced();
    if (visual === "finish" && !still && seen() === String(runKey)) still = true;
    setSrc(Q.shoppySrc(visual, runKey, { still: still }));
    clearTimeout(playTimer); playTimer = 0;
    if (visual === "finish" && !still) {
      var arm = function () { clearTimeout(playTimer); playTimer = setTimeout(function () { markSeen(runKey); playTimer = 0; }, PLAY_MS); };
      arm(); img.addEventListener("load", arm, { once: true });
    }
    applied = { visual: visual, runKey: runKey };
  }
  function hide(bar) {
    clearTimeout(playTimer); playTimer = 0;
    if (applied.visual) {
      putBack(homes.trackEl, homes.track); putBack(homes.lineEl, homes.line);
      group.hidden = true; bar.removeAttribute("data-shoppy");
    }
    applied = { visual: null, runKey: "" };
  }

  function redraw() {
    var bar = document.getElementById("topBar");
    if (!bar || !Q) return;
    if (!group && !build(bar)) return;
    var v = SHOW_ON[current] && last ? Q.shoppyVisual({ run: last.run || null, prompt: last.prompt || null }) : { visual: null, runKey: "" };
    if (!v.visual) { hide(bar); return; }
    if (v.visual === applied.visual && v.runKey === applied.runKey) return;
    show(bar, v.visual, v.runKey);
  }

  root.ShopperShoppyView = Object.freeze({
    update: function (p) { last = p || null; redraw(); },
    tab: function (which) { current = which; redraw(); },
    applied: function () { return { visual: applied.visual, runKey: applied.runKey }; },
  });
})(self);
