// remote/boxes.js - B-579 (v4.75). Box contents -> ScanPower, on the phone's
// Inventory tab. Zach dictates into the text box (the keyboard's microphone),
// taps Read boxes, checks the boxes the laptop worked out, answers any
// question, taps Upload. ⚠ Owns no rules: the laptop reads the words, works
// out every number, and refuses what it must (lib/box-contents.js,
// background/box-contents-handlers.js). What is drawn here is what the laptop
// published (payload.boxes). Built with textContent only (no innerHTML).
//
// B-711 (v4.95): box contents in steps. The box list lives on the laptop,
// not in this text box: each read ADDS the boxes just said (a letter said
// again replaces that box), the text box empties once the laptop reports the
// words read (readHash), and a failed read puts the words back (failedText).
// Every saved box has a Remove button; upload stays its own confirmed tap.
// B-712 (v4.96): before the batch reaches ScanPower's Pack step the laptop
// keeps the WORDS (payload.boxes.pending, phase "waiting"); each saved
// message shows with its own Remove, and Re-check reads them once at Pack.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const R = () => self.ShopperRemote || { sendCommand: async () => null, waitFor: async () => "unknown" };
  const DRAFT_KEY = "shopperBoxesText";
  const SENT_KEY = "shopperBoxesSent"; // B-711: the words of the read in flight
  // Same as textHash in lib/box-contents-steps.js (test v495 checks parity).
  function textHash(s) {
    const t = String(s == null ? "" : s).trim();
    let h = 5381;
    for (let k = 0; k < t.length; k++) h = ((h * 33) ^ t.charCodeAt(k)) >>> 0;
    return h.toString(16);
  }

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
    ta.addEventListener("input", () => { lsSet(DRAFT_KEY, ta.value); readLabel(); });
    sec.appendChild(ta);
    const row = node("div", "bx-row");
    batchSel = node("select", "bx-batch");
    batchSel.setAttribute("aria-label", "ScanPower batch");
    batchSel.addEventListener("change", () => {
      const s = last && (last.saved || last.pending);
      if (!s || !last.batch || !batchSel.value || batchSel.value === last.batch.id) return;
      if (!confirm("Start a new box list for that batch? What is saved for " + last.batch.name + " (" + s.text + ") will be dropped when it reads.")) batchSel.value = "";
    });
    readBtn = btn("Read boxes", "primary-btn", async () => {
      const text = ta.value.trim();
      // B-711: no words + saved boxes = re-check them against ScanPower.
      if (!text && !(last && (last.saved || last.pending))) return;
      lsSet(SENT_KEY, text);
      readBtn.disabled = true;
      await R().sendCommand("boxesRead", { text, batchId: batchSel.value || "" });
      readBtn.disabled = false;
    });
    clearBtn = btn("Start over", "ghost-btn", () => {
      if (!confirm("Clear the text and every saved box?")) return;
      ta.value = "";
      lsSet(DRAFT_KEY, "");
      lsSet(SENT_KEY, "");
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

  function readLabel() {
    if (!readBtn) return;
    const saved = !!(last && (last.saved || last.pending));
    readBtn.textContent = !saved ? "Read boxes" : ta.value.trim() ? "Add boxes" : "Re-check with ScanPower";
  }

  // B-711: empty the text box once the laptop has read those words; put
  // them back when a read failed and the box is empty.
  function syncText(b) {
    if (!b) return;
    const sent = lsGet(SENT_KEY).trim();
    if (sent && b.readHash && b.readHash === textHash(sent)) {
      const cur = ta.value.trim();
      if (cur.startsWith(sent)) ta.value = cur.slice(sent.length).trim();
      lsSet(DRAFT_KEY, ta.value);
      lsSet(SENT_KEY, "");
    } else if (b.phase === "failed" && b.failedText && !ta.value.trim()) {
      ta.value = b.failedText;
      lsSet(DRAFT_KEY, ta.value);
      lsSet(SENT_KEY, "");
    }
  }

  function fillBatches(b) {
    const list = (b && b.batches) || [];
    const keep = batchSel.value;
    while (batchSel.firstChild) batchSel.removeChild(batchSel.firstChild);
    const o0 = node("option", null, b && b.batch && (b.saved || b.pending) ? b.batch.name + (b.saved ? " (saved boxes)" : " (saved words)") : "Newest batch");
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

  // B-711: the saved box list. Remove only while the draft is up for review.
  function renderCards(b, box, withRemove) {
    const d = b.draft;
    if (b.saved) box.appendChild(node("p", "bx-saved", b.saved.text));
    const list = node("div", "lines");
    for (const x of d.boxes) {
      const card = node("div", "line bx-box");
      card.appendChild(node("div", "bx-box-title", (x.letter || "#") + " → B" + x.num + " · " + (x.size || "?") + (x.L ? " (" + x.L + "×" + x.W + "×" + x.H + ")" : "") + " · " + (x.weight == null ? "?" : x.weight) + " lb"));
      if (!x.lines.length) card.appendChild(node("div", "l-meta", "no units"));
      for (const l of x.lines) card.appendChild(node("div", "l-meta", l.q + " × " + skuName(b, l.i) + (l.r ? " (the rest)" : "")));
      if (withRemove && x.key) {
        const rm = btn("Remove", "ghost-btn bx-remove", () => {
          if (!confirm("Remove box " + x.key + " from the saved boxes?")) return;
          rm.disabled = true;
          R().sendCommand("boxesRemove", { id: b.id, key: x.key });
        });
        card.appendChild(rm);
      }
      list.appendChild(card);
    }
    box.appendChild(list);
  }

  // B-712: words kept until the batch reaches the Pack step.
  function renderPending(b, box, withRemove) {
    const pd = b.pending;
    box.appendChild(node("p", "bx-saved", pd.text));
    const list = node("div", "lines");
    pd.texts.forEach((t, n) => {
      const card = node("div", "line bx-box");
      card.appendChild(node("div", "l-meta", t));
      if (withRemove) {
        const rm = btn("Remove", "ghost-btn bx-remove", () => {
          if (!confirm("Remove this saved message?")) return;
          rm.disabled = true;
          R().sendCommand("boxesRemove", { id: b.id, key: "w" + n });
        });
        card.appendChild(rm);
      }
      list.appendChild(card);
    });
    box.appendChild(list);
  }

  function renderDraft(b, box) {
    const d = b.draft;
    box.appendChild(node("div", "bx-head", (b.batch ? b.batch.name : "?") + " · Pack group " + (b.packGroup || "?")));
    if (b.existing && b.existing.units > 0) box.appendChild(node("p", "warn-text", "ScanPower already has " + b.existing.units + " units in " + b.existing.boxes + " box(es) here. Uploading replaces them."));
    renderCards(b, box, true);

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
      const go = btn("I'm done — upload " + d.boxes.length + " boxes to ScanPower", "primary-btn bx-upload", () => {
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
    syncText(b);
    readLabel();
    if (editing()) return;
    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
    const phase = b ? b.phase : "idle";
    readBtn.disabled = phase === "reading" || phase === "uploading";
    if (!b || phase === "idle") return;
    if (phase === "reading" || phase === "uploading") {
      statusEl.appendChild(node("p", "bx-working", (phase === "reading" ? "Reading boxes… " : "Uploading… ") + (b.step || "")));
      return;
    }
    if (phase === "waiting" && b.pending) {
      renderPending(b, statusEl, true);
      if (b.draft && b.draft.boxes && b.draft.boxes.length) renderCards(b, statusEl, false);
      statusEl.appendChild(node("p", "muted", (b.batch ? b.batch.name : "The batch") + " is not at ScanPower's Pack step yet, so the boxes can't be matched to products. Keep adding boxes. When it reaches Pack, empty the text box and tap Re-check with ScanPower."));
      return;
    }
    if (phase === "failed") {
      statusEl.appendChild(node("p", "error-text", b.error || "It stopped."));
      if (b.pending) renderPending(b, statusEl, false);
      // B-711: the saved boxes are still saved - show them.
      if (b.draft && b.draft.boxes && b.draft.boxes.length) {
        renderCards(b, statusEl, false);
        statusEl.appendChild(node("p", "muted", "Your saved boxes are kept. Add more, or tap Re-check with ScanPower (empty text box) to get back to the upload."));
      }
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
