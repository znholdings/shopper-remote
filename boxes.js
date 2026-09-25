// remote/boxes.js - B-579 (v4.75). Box contents -> ScanPower, on the phone's
// Inventory tab. Zach dictates into the text box (the keyboard's microphone),
// taps Read boxes, checks the boxes the laptop worked out, answers any
// question, taps Upload. ⚠ Owns no rules: the laptop reads the words, works
// out every number, and refuses what it must (lib/box-contents.js,
// background/box-contents-handlers.js). What is drawn here is what the laptop
// published (payload.boxes). Built with textContent only (no innerHTML).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const R = () => self.ShopperRemote || { sendCommand: async () => null, waitFor: async () => "unknown" };
  const DRAFT_KEY = "shopperBoxesText";

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function btn(label, cls, onClick) {
    const b = node("button", cls || "secondary-btn", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

  let built = false;
  let ta, readBtn, batchSel, statusEl, clearBtn;
  let last = null;
  const picks = {};

  function build() {
    const sec = $("boxesSection");
    if (!sec || built) return !!sec;
    built = true;
    sec.appendChild(node("h3", null, "Box contents → ScanPower"));
    sec.appendChild(node("p", "muted small", "Say each box: letter, size (U-Haul Large, or 19 by 17 by 14), weight, and what's in it. Tap the keyboard's microphone to dictate."));
    ta = node("textarea", "bx-text");
    ta.id = "boxesText";
    ta.rows = 7;
    ta.placeholder = "Box A is a U-Haul large, 46 lbs. It has 24 Kotex regular 50-count and 22 Crest Pro-Health Smooth. Box B ...";
    ta.value = lsGet(DRAFT_KEY);
    ta.addEventListener("input", () => lsSet(DRAFT_KEY, ta.value));
    sec.appendChild(ta);
    const row = node("div", "bx-row");
    batchSel = node("select", "bx-batch");
    batchSel.setAttribute("aria-label", "ScanPower batch");
    readBtn = btn("Read boxes", "primary-btn", async () => {
      const text = ta.value.trim();
      if (!text) return;
      readBtn.disabled = true;
      await R().sendCommand("boxesRead", { text, batchId: batchSel.value || "" });
      readBtn.disabled = false;
    });
    clearBtn = btn("Start over", "ghost-btn", () => {
      if (!confirm("Clear the text and the box draft?")) return;
      ta.value = "";
      lsSet(DRAFT_KEY, "");
      R().sendCommand("boxesClear", {});
    });
    row.appendChild(batchSel);
    row.appendChild(readBtn);
    row.appendChild(clearBtn);
    sec.appendChild(row);
    statusEl = node("div", "bx-status");
    sec.appendChild(statusEl);
    return true;
  }

  function fillBatches(b) {
    const list = (b && b.batches) || [];
    const keep = batchSel.value;
    while (batchSel.firstChild) batchSel.removeChild(batchSel.firstChild);
    const o0 = node("option", null, "Newest batch");
    o0.value = "";
    batchSel.appendChild(o0);
    for (const x of list) {
      const o = node("option", null, x.name + " (" + x.id + ")");
      o.value = x.id;
      batchSel.appendChild(o);
    }
    batchSel.value = list.some((x) => x.id === keep) ? keep : "";
  }

  function editing() {
    const a = document.activeElement;
    return !!(statusEl && a && statusEl.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  function skuName(b, i) {
    const s = (b.skus || []).find((x) => x.i === i);
    return s ? s.t : "#" + i;
  }

  function renderDraft(b, box) {
    const d = b.draft;
    box.appendChild(node("div", "bx-head", (b.batch ? b.batch.name : "?") + " · Pack group " + (b.packGroup || "?")));
    if (b.existing && b.existing.units > 0) box.appendChild(node("p", "warn-text", "ScanPower already has " + b.existing.units + " units in " + b.existing.boxes + " box(es) here. Uploading replaces them."));
    const list = node("div", "lines");
    for (const x of d.boxes) {
      const card = node("div", "line bx-box");
      card.appendChild(node("div", "bx-box-title", (x.letter || "#") + " → B" + x.num + " · " + (x.size || "?") + (x.L ? " (" + x.L + "×" + x.W + "×" + x.H + ")" : "") + " · " + (x.weight == null ? "?" : x.weight) + " lb"));
      if (!x.lines.length) card.appendChild(node("div", "l-meta", "no units"));
      for (const l of x.lines) card.appendChild(node("div", "l-meta", l.q + " × " + skuName(b, l.i) + (l.r ? " (the rest)" : "")));
      list.appendChild(card);
    }
    box.appendChild(list);

    if (d.questions.length) {
      const qs = node("div", "bx-questions");
      qs.appendChild(node("h4", null, "Questions"));
      for (const q of d.questions) {
        const wrap = node("label", "p-field");
        wrap.appendChild(node("span", null, q.text));
        let input;
        if (q.options) {
          input = node("select", "bx-pick");
          const o0 = node("option", null, "Pick one…");
          o0.value = "";
          input.appendChild(o0);
          for (const o of q.options) { const op = node("option", null, o.label); op.value = o.value; input.appendChild(op); }
        } else {
          input = node("input", null);
          input.type = "number";
          input.inputMode = "decimal";
        }
        input.value = picks[q.id] || "";
        input.addEventListener("change", () => { picks[q.id] = input.value; });
        wrap.appendChild(input);
        qs.appendChild(wrap);
      }
      qs.appendChild(btn("Save answers", "secondary-btn", () => {
        const answers = {};
        for (const q of d.questions) if (picks[q.id]) answers[q.id] = picks[q.id];
        if (!Object.keys(answers).length) return;
        R().sendCommand("boxesAnswer", { id: b.id, answers });
      }));
      box.appendChild(qs);
    }
    for (const t of d.blocking) box.appendChild(node("p", "error-text", "⛔ " + t));
    for (const t of d.flags) box.appendChild(node("p", "warn-text", "⚠ " + t));
    for (const t of d.notes || []) box.appendChild(node("p", "muted", "Note: " + t));
    const placed = d.totals.reduce((s, t) => s + t.placed, 0);
    const expected = d.totals.reduce((s, t) => s + t.expected, 0);
    box.appendChild(node("p", "muted", placed + " of " + expected + " units placed · " + d.boxes.length + " boxes"));

    if (d.canUpload) {
      let replace = null;
      if (b.existing && b.existing.units > 0) {
        const lab = node("label", "bx-replace");
        replace = node("input", null);
        replace.type = "checkbox";
        lab.appendChild(replace);
        lab.appendChild(node("span", null, " Replace what ScanPower has now"));
        box.appendChild(lab);
      }
      const go = btn("Upload " + d.boxes.length + " boxes to ScanPower", "primary-btn bx-upload", () => {
        if (replace && !replace.checked) { alert("Tick “Replace” first - ScanPower already has boxes here."); return; }
        if (!confirm("Upload " + d.boxes.length + " boxes (" + placed + " units) to " + (b.batch ? b.batch.name : "ScanPower") + "?")) return;
        go.disabled = true;
        R().sendCommand("boxesUpload", { id: b.id, replaceExisting: !!(replace && replace.checked) });
      });
      box.appendChild(go);
    } else {
      box.appendChild(node("p", "muted", "Answer the questions or fix the text, then it can upload."));
    }
  }

  function render(p) {
    if (!build()) return;
    const b = p ? p.boxes : null;
    last = b;
    fillBatches(b);
    if (editing()) return;
    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
    const phase = b ? b.phase : "idle";
    readBtn.disabled = phase === "reading" || phase === "uploading";
    if (!b || phase === "idle") return;
    if (phase === "reading" || phase === "uploading") {
      statusEl.appendChild(node("p", "bx-working", (phase === "reading" ? "Reading boxes… " : "Uploading… ") + (b.step || "")));
      return;
    }
    if (phase === "failed") {
      statusEl.appendChild(node("p", "error-text", b.error || "It stopped."));
      return;
    }
    if (phase === "done" && b.result) {
      const r = b.result;
      statusEl.appendChild(node("p", r.ok ? "bx-ok" : "error-text", r.ok
        ? "✓ Uploaded and checked: ScanPower shows " + r.boxes + " boxes, " + r.units + " units, every box as planned. Confirm and continue in ScanPower when ready."
        : "Uploaded, but ScanPower's pack list differs from the plan:"));
      for (const t of r.problems || []) statusEl.appendChild(node("p", "error-text", "• " + t));
      return;
    }
    if (phase === "review" && b.draft) renderDraft(b, statusEl);
  }

  self.ShopperBoxes = Object.freeze({ render });
})();
