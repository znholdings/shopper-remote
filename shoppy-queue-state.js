// remote/shoppy-queue-state.js - B-2361 (v2.0.205): classic-script copy of lib/shoppy-queue-state.js (self.ShoppyQueueState), kept equal by
// test/b2361-shoppy-state.test.mjs. Which Shoppy queue animation the phone's Buylist / Buy Queue header shows. Pure.
(function (root) {
  "use strict";
  var SHOPPY_FILES = { run: "shoppy-queue-run.gif", pause: "shoppy-queue-pause.gif", fail: "shoppy-queue-failure.gif", finish: "shoppy-queue-finish.gif" };
  var SHOPPY_STILLS = { run: "shoppy-queue-run-still.png", pause: "shoppy-queue-pause-still.png", fail: "shoppy-queue-failure-still.png", finish: "shoppy-queue-finish-still.png" };
  var LIVE = ["running", "paused", "collecting_urls"];
  function shoppyVisual(input) {
    var o = input || {};
    var run = o.run, prompt = o.prompt;
    if (!run || typeof run !== "object") return { visual: null, runKey: "" };
    var status = String(run.status || "");
    var runKey = String(run.queueId || run.startedAt || "");
    if (status === "error") return { visual: "fail", runKey: runKey };
    if (status === "done") return { visual: "finish", runKey: runKey };
    if (LIVE.indexOf(status) >= 0) {
      var waiting = status !== "running" || !!prompt;
      return { visual: waiting ? "pause" : "run", runKey: runKey };
    }
    return { visual: null, runKey: runKey };
  }
  function shoppySrc(visual, runKey, opts) {
    var still = !!(opts && opts.still), base = (opts && opts.base) || "";
    if (!visual || !SHOPPY_FILES[visual]) return "";
    if (still) return base + SHOPPY_STILLS[visual];
    return base + SHOPPY_FILES[visual] + (visual === "finish" && runKey ? "?run=" + encodeURIComponent(String(runKey)) : "");
  }
  root.ShoppyQueueState = Object.freeze({ shoppyVisual: shoppyVisual, shoppySrc: shoppySrc, SHOPPY_FILES: SHOPPY_FILES, SHOPPY_STILLS: SHOPPY_STILLS });
})(self);
