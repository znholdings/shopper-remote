// remote/run-view.js - B-774 / B-776 (v2.0.9): the phone Run tab's
// "Right now" card, money band and outcome counts, and the end-of-queue
// report sheet.
//
// Draws with self.ShopperRunLib (remote/run-lib.js = lib/buy-stage.js,
// spend-left.js, line-outcome.js, queue-order-live.js, last-report.js,
// bundled unchanged) - the SAME rules the laptop's Buy Queue page imports.
// Loaded after app.js and uses its globals (els, store, money, sendCommand,
// switchTab, centralText, reportParts, QUEUE_STATUS_LABELS), like parity.js.
// textContent only; elements close with the `hidden` attribute (v2.94).
(function () {
  "use strict";
  const RL = self.ShopperRunLib;
  const $ = (id) => document.getElementById(id);
  const FINISHED = new Set(["done", "aborted", "error"]);

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  // ------------------------------------------------------------ right now
  function currentLine(p) {
    const run = p.run || {};
    const lines = p.lines || [];
    return lines.find((l) => l.lineId === run.currentLineId) || lines.find((l) => l.asin === run.currentAsin) || null;
  }

  function renderHero(p) {
    const hero = $("runHero");
    if (!hero) return;
    const run = p.run || null;
    if (!run || !RL) { hero.hidden = true; return; }
    hero.hidden = false;
    const status = run.status || "";
    const finished = FINISHED.has(status);
    const line = currentLine(p);
    const waiting = !!p.prompt || status === "paused";
    hero.dataset.state = finished ? "finished" : waiting ? "waiting" : status;
    const stage = run.stage || null;
    const lines = p.lines || [];
    hero.querySelector(".rh-eyebrow").textContent = finished ? "How it ended" : "Right now";
    $("runTracker").hidden = finished;
    if (finished) {
      $("rhTitle").textContent = status === "aborted" ? "The run was aborted" : status === "error" ? "The run stopped with an error" : "The run is finished";
      $("rhMeta").textContent = run.currentStep || "";
    } else if (line) {
      $("rhTitle").textContent = line.title || line.asin;
      const done = lines.filter((l) => !["pending", "pool", "buying", "confirming"].includes(l.status)).length;
      $("rhMeta").textContent = `${line.asin} · line ${Math.min(p.lineCount || lines.length, done + 1)} of ${p.lineCount || lines.length}${line.retailer ? " · " + line.retailer : ""}`;
    } else {
      $("rhTitle").textContent = status === "running" ? "Between lines" : status === "paused" ? "Paused" : status || "-";
      $("rhMeta").textContent = "";
    }
    const prog = p.progress && line && p.progress.asin === line.asin ? p.progress : null;
    const order = $("rhOrder");
    order.hidden = !prog || finished;
    if (prog) order.textContent = RL.orderPosition(prog, stage).text;
    const model = RL.trackerModel({ stage, status, waiting, approvalMode: run.approvalMode || "auto" });
    $("rhStage").textContent = finished ? "" : p.prompt ? `Waiting on you - ${p.prompt.title}` : model.headline || "";
    const tr = $("runTracker");
    const key = JSON.stringify(model.steps.map((s) => [s.id, s.state]));
    if (tr.dataset.key !== key) {
      tr.dataset.key = key;
      tr.textContent = "";
      model.steps.forEach((s, i) => {
        const li = node("li", `rh-step is-${s.state}`);
        if (s.state === "now" || s.state === "waiting") li.setAttribute("aria-current", "step");
        li.title = s.long;
        li.append(node("span", "rh-dot", s.state === "done" ? "✓" : i + 1), node("span", "rh-label", s.label));
        tr.appendChild(li);
      });
    }
    const eng = $("rhEngine");
    const text = !finished && run.engineStep ? run.engineStep : "";
    // The queue says "Opening <line>..." once per line; once the engine is
    // past that, its own sentence is what is happening (B-769's lesson).
    const opening = /^Opening .*\.\.\.$/.test(String(run.currentStep || ""));
    if (text && opening && status === "running" && stage && stage !== "open" && els.currentStep) {
      els.currentStep.textContent = text;
      eng.textContent = "";
      eng.hidden = true;
    } else {
      eng.textContent = text;
      eng.hidden = !text || text === run.currentStep;
    }
  }

  // ------------------------------------------------------------ money
  function renderMoney(p) {
    if (!RL || !$("tRunLeft")) return;
    const run = p.run || {};
    const m = RL.spendLeft({
      totalSpent: run.totalSpent,
      spendTarget: run.spendTarget,
      goal: p.spendSettings ? p.spendSettings.goal : 0,
      neededToday: p.day ? p.day.neededToday : 0,
      spentToday: p.day ? p.day.spentToday : 0,
      dayKnown: !!p.day,
    });
    $("tRunLeft").textContent = p.run ? money(m.run.left) : "-";
    $("tRunTarget").textContent = p.run && m.run.target > 0 ? `of ${money(m.run.target)}` : "";
    $("tRunLeftBox").classList.toggle("is-met", !!p.run && m.run.met);
    $("tLeftToday").textContent = m.day ? money(m.day.left) : "-";
    // "goal $X" - the goal itself (stored goal, else the sheet's Needed today).
    els.tNeeded.textContent = m.day ? money(m.day.goal) : "-";
    $("tDayLeftBox").classList.toggle("is-met", !!(m.day && m.day.met));
    $("tCap").textContent = run.safetyCap != null ? money(run.safetyCap) : "-";
  }

  // ------------------------------------------------------------ outcomes
  const CHIPS = ["success", "partial", "outOfStock", "failed", "needsYou", "skipped", "inProgress", "notStarted", "other"];
  function renderOutcomes(p) {
    const host = $("runOutcomes");
    if (!host || !RL) return;
    const lines = p.lines || [];
    if (!lines.length) { host.hidden = true; return; }
    const c = RL.countOutcomes(lines);
    const key = JSON.stringify(c);
    host.hidden = false;
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.textContent = "";
    for (const k of CHIPS) {
      if (!c[k] && !["success", "outOfStock", "failed"].includes(k)) continue;
      const chip = node("span", `oc-chip tone-${RL.OUTCOME_META[k].tone}`);
      chip.append(node("b", null, c[k]), document.createTextNode(" " + RL.OUTCOME_META[k].plural));
      host.appendChild(chip);
    }
  }

  // ------------------------------------------------------------ report sheet
  let baselineAt; // undefined until the first payload
  let sheetFor = null;

  function openReportSheet(lr) {
    const p = lastPayload || {};
    const report = (lr && lr.report) || (p.run && p.run.report) || null;
    if (!lr || !report) return false;
    const sheet = $("reportSheet");
    $("reportSheetTitle").textContent = lr.status === "aborted" ? "Buy Queue aborted" : lr.status === "error" ? "Buy Queue stopped" : "Buy Queue finished";
    $("reportSheetSummary").textContent = `${RL ? RL.describeLastReport(lr) : ""} ${lr.finishedAt ? centralText(lr.finishedAt) : ""}`.trim();
    const parts = reportParts(report);
    const urgent = $("reportSheetUrgent");
    urgent.innerHTML = parts.urgent;
    urgent.hidden = !parts.urgentCount;
    $("reportSheetBody").innerHTML = parts.summary + parts.buckets;
    sheetFor = lr.finishedAt;
    sheet.hidden = false;
    return true;
  }

  function closeReportSheet() {
    $("reportSheet").hidden = true;
    if (sheetFor) store.set("reportSeenAt", sheetFor);
  }

  function maybePopReport(p) {
    const lr = p.lastReport || null;
    const at = lr ? lr.finishedAt : 0;
    if (baselineAt === undefined) {
      baselineAt = at || 0;
      return;
    }
    if (RL && RL.shouldPopReport({ baselineAt, lastReportAt: at, seenAt: store.get("reportSeenAt") })) {
      baselineAt = at;
      openReportSheet(lr);
    }
  }

  function wire() {
    const close = $("reportSheetClose");
    if (close) close.addEventListener("click", closeReportSheet);
    const sheet = $("reportSheet");
    if (sheet) sheet.addEventListener("click", (e) => { if (e.target === sheet) closeReportSheet(); });
    const last = $("dashLastRun");
    if (last) {
      const open = () => {
        const lr = lastPayload && lastPayload.lastReport;
        if (!openReportSheet(lr)) switchTab("run");
      };
      last.addEventListener("click", open);
      last.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
  }

  function render(p) {
    if (!p) return;
    try {
      renderHero(p);
      renderMoney(p);
      renderOutcomes(p);
      maybePopReport(p);
    } catch (err) {
      console.warn("[Shopper] run view failed", err);
    }
  }

  wire();
  self.ShopperRunViewPhone = { render, openReportSheet, closeReportSheet };
  if (typeof lastPayload !== "undefined" && lastPayload) render(lastPayload);
})();
