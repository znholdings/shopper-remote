// remote/boxes.js - B-579 (v4.75). Box contents -> ScanPower, on the phone's
// Inventory tab. Zach dictates into the text box (the keyboard's microphone),
// taps Read boxes, checks the boxes the laptop worked out, answers any
// question, taps Upload. ⚠ Owns no rules: the laptop reads the words, works
// out every number, and refuses what it must (lib/box-contents.js,
// background/box-contents-handlers.js). What is drawn here is what the laptop
// published (payload.boxes). Built with textContent only (no innerHTML).
//
// B-711 (v4.95): box contents in steps. The box list lives on the laptop,
// not in this text box: each read ADDS the boxes just said. Every saved box
// has a Remove button; upload stays its own confirmed tap.
// B-712 (v4.96): before the batch reaches ScanPower's Pack step the laptop
// keeps the WORDS (payload.boxes.pending, phase "waiting"); each saved
// message shows with its own Remove, and Re-check reads them once at Pack.
// B-895 (v2.0.28): boxes already in ScanPower (payload.boxes.prior) show
// first - new boxes go after them, and adding on is the default. "Replace
// them instead" is a choice (boxesAnswer {mode}); when the laptop can't
// read those boxes one by one the only choices are Stop (default) or Replace.
// B-896 (v2.0.28): "the rest of 3 Flintstones listings (48 + 48 + 36)"
// shows above the listings it expanded to (box.groups, line.g).
// B-1089 (v2.0.55): the words can never be lost. Read puts them in the
// phone's outbox FIRST (remote/box-outbox.js - saved on the phone, checked)
// and only then empties the text box; they show as "Unsent on this phone"
// until the laptop lists them as stored, and are sent again until it does.
// The text box is never rewritten by the laptop any more (no clear-on-read,
// no put-back): words a read did not turn into boxes stay on the laptop
// (shown below, with Remove). Read is never locked while the laptop works -
// the words queue. "Saved on laptop: N boxes from M messages", "Box C said
// twice - Keep both / Replace", parked lists (Switch back), the archive
// (Restore, 14 days) and Re-read all words are drawn here too. The unsent
// count also goes in #boxesHeaderBadge (the section's header shows it).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const R = () => self.ShopperRemote || { sendCommand: async () => null, waitFor: async () => "unknown" };
  const OB = () => self.ShopperBoxOutbox || null;
  const DRAFT_KEY = "shopperBoxesText";
  // v2.0.54's "words of the read in flight" marker - read once, then dropped (B-1089).
  const SENT_KEY = "shopperBoxesSent";
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
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  function hhmm(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  }

  let built = false;
  let ta, readBtn, batchSel, statusEl, clearBtn, badge, outEl, savedEl, noteEl, moreEl;
  let last = null;
  const picks = {};

  function build() {
    const sec = $("boxesSection");
    if (!sec || built) return !!sec;
    built = true;
    const h = node("h3", null, "Box contents → ScanPower");
    // B-1089: the unsent count, for the section header (Builder A's collapsible header reads it).
    badge = node("span", "bx-badge", "");
    badge.id = "boxesHeaderBadge";
    setBadge("");
    h.appendChild(node("span", null, " "));
    h.appendChild(badge);
    sec.appendChild(h);
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
      // B-1089: nothing is dropped any more - the list is parked (Switch back below).
      say("The next read starts a list for that batch. What is saved for " + last.batch.name + " (" + s.text + ") is parked, not dropped - Switch back any time.");
    });
    readBtn = btn("Read boxes", "primary-btn", async () => {
      const text = ta.value.trim();
      // B-711: no words + saved boxes = re-check them against ScanPower.
      if (!text && !(last && (last.saved || last.pending))) return;
      if (!text) {
        R().sendCommand("boxesRead", { text: "", batchId: batchSel.value || "" });
        return;
      }
      const ob = OB();
      if (!ob) {
        // No outbox (an old page): send, and keep the words in the text box.
        await R().sendCommand("boxesRead", { text, batchId: batchSel.value || "" });
        return;
      }
      // B-1089: into the phone's outbox FIRST (saved + checked), then sent.
      const r = ob.add(text, { source: "phone-stock", batchId: batchSel.value || "" });
      if (!r.ok) { say(r.error); return; }
      ta.value = "";
      lsSet(DRAFT_KEY, "");
      say("");
      readLabel();
      renderOutbox();
    });
    clearBtn = btn("Start over", "ghost-btn", () => {
      const n = OB() ? OB().unsent("phone-stock").length : 0;
      if (!confirm("Clear the text and every saved box? The list goes to the archive - Restore brings it back for 14 days." + (n ? " " + n + " unsent message(s) on this phone still go to the laptop." : ""))) return;
      ta.value = "";
      lsSet(DRAFT_KEY, "");
      lsSet(SENT_KEY, "");
      R().sendCommand("boxesClear", {});
    });
    row.appendChild(batchSel);
    row.appendChild(readBtn);
    row.appendChild(clearBtn);
    sec.appendChild(row);
    noteEl = node("p", "muted bx-note", "");
    noteEl.hidden = true;
    sec.appendChild(noteEl);
    outEl = node("div", "bx-outbox");
    sec.appendChild(outEl);
    savedEl = node("div", "bx-durable");
    sec.appendChild(savedEl);
    statusEl = node("div", "bx-status");
    sec.appendChild(statusEl);
    moreEl = node("div", "bx-more");
    sec.appendChild(moreEl);
    return true;
  }

  // #boxesHeaderBadge: text + data-badge (the section header shows either).
  function setBadge(t) {
    if (!badge) return;
    badge.textContent = t;
    if (badge.dataset) badge.dataset.badge = t;
    else badge.setAttribute("data-badge", t);
    badge.hidden = !t;
  }

  function say(text) {
    if (!noteEl) return;
    noteEl.textContent = text || "";
    noteEl.hidden = !text;
  }

  function readLabel() {
    if (!readBtn) return;
    const saved = !!(last && (last.saved || last.pending));
    readBtn.textContent = !saved ? "Read boxes" : ta.value.trim() ? "Add boxes" : "Re-check with ScanPower";
  }

  // B-1089: v2.0.54 kept the words in the text box until the laptop reported
  // them read (readHash) and put a failed read's words back. Now the text box
  // is only ever changed by his own tap. This runs once for a phone updated
  // mid-shipment: words v2.0.54 sent and the laptop has read leave the text
  // box; anything else stays in it.
  function syncText(b) {
    const sent = lsGet(SENT_KEY).trim();
    if (!sent || !b) return;
    if (b.readHash && b.readHash === textHash(sent)) {
      const cur = ta.value.trim();
      if (cur.startsWith(sent)) ta.value = cur.slice(sent.length).trim();
      lsSet(DRAFT_KEY, ta.value);
    } else if (b.phase === "reading") return; // that read is still going - look again next time
    lsSet(SENT_KEY, "");
  }

  // B-1089: "Unsent on this phone: N (sending…)" + the words, and the badge.
  function renderOutbox() {
    if (!outEl) return;
    const ob = OB();
    const list = ob ? ob.unsent("phone-stock") : [];
    const all = ob ? ob.unsent() : [];
    clear(outEl);
    setBadge(all.length ? all.length + " unsent" : "");
    if (!list.length) { outEl.hidden = true; return; }
    outEl.hidden = false;
    const online = !(R().laptopOnline && !R().laptopOnline());
    outEl.appendChild(node("p", "bx-unsent", "Unsent on this phone: " + list.length + (online ? " (sending…)" : " (the laptop isn't connected - they go as soon as it is)")));
    for (const e of list) {
      const card = node("div", "line bx-unsent-msg");
      card.appendChild(node("div", "l-meta", e.words.length > 400 ? e.words.slice(0, 400) + "…" : e.words));
      const bits = [hhmm(e.at)];
      if (e.sends > 1) bits.push("tried " + e.sends + " times");
      if (e.lastError) bits.push(e.lastError);
      if (e.laptopSaid) bits.push("laptop: " + e.laptopSaid);
      card.appendChild(node("div", "l-meta bx-unsent-meta", bits.filter(Boolean).join(" · ")));
      outEl.appendChild(card);
    }
  }

  // v2.0.55 review: this phone's unsent messages for the list's batch (or for
  // whatever batch the laptop has - "Newest batch").
  function unsentFor(b) {
    const ob = OB();
    if (!ob) return [];
    const bid = b && b.batch ? String(b.batch.id) : "";
    return ob.unsent().filter((e) => !e.batchId || !bid || String(e.batchId) === bid);
  }

  // B-1089: "Saved on laptop: N boxes from M messages · last HH:MM".
  function renderSaved(b) {
    if (!savedEl) return;
    clear(savedEl);
    const d = b && b.durable;
    if (b && b.corrupt) savedEl.appendChild(node("p", "warn-text", "The saved box list could not be read on the laptop (" + b.corrupt.why + "). A copy was kept, and every message is in the journal - tap Re-read all words below."));
    if (!d || (!d.boxes && !d.messages && !d.queued)) return;
    if (d.boxes || d.messages) savedEl.appendChild(node("p", "bx-saved-line", "Saved on laptop: " + d.boxes + " box" + (d.boxes === 1 ? "" : "es") + " from " + d.messages + " message" + (d.messages === 1 ? "" : "s") + (d.lastAt ? " · last " + hhmm(d.lastAt) : "")));
    if (d.queued) savedEl.appendChild(node("p", "muted bx-queued", d.queued + " more message" + (d.queued === 1 ? "" : "s") + " saved - read when this one finishes."));
  }

  // B-1089: parked lists (Switch back), the archive (Restore), Re-read all words.
  function renderMore(b) {
    if (!moreEl) return;
    clear(moreEl);
    const parked = (b && b.parked) || [];
    const arch = (b && b.archive) || [];
    const canReread = !!(b && ((b.durable && b.durable.messages) || b.pending || b.corrupt));
    if (!parked.length && !arch.length && !canReread) return;
    const det = node("details", "bx-more-box");
    if (parked.length || (b && b.corrupt)) det.open = true;
    det.appendChild(node("summary", null, ["Parked lists: " + parked.length, "Archive: " + arch.length, "Re-read all words"].join(" · ")));
    for (const x of parked) {
      const card = node("div", "line bx-parked");
      card.appendChild(node("div", "l-meta", x.text));
      card.appendChild(node("div", "l-meta bx-unsent-meta", "Parked " + hhmm(x.at) + " - " + x.why));
      card.appendChild(btn("Switch back", "ghost-btn bx-switch", () => R().sendCommand("boxesSwitch", { pid: x.pid })));
      det.appendChild(card);
    }
    for (const x of arch) {
      const card = node("div", "line bx-archived");
      card.appendChild(node("div", "l-meta", x.text));
      card.appendChild(node("div", "l-meta bx-unsent-meta", hhmm(x.at) + " - " + x.why));
      card.appendChild(btn("Restore", "ghost-btn bx-restore", () => {
        if (!confirm("Restore " + x.text + "? What is saved now goes to the archive first.")) return;
        R().sendCommand("boxesRestore", { aid: x.aid });
      }));
      det.appendChild(card);
    }
    if (canReread) {
      det.appendChild(node("p", "muted small", "Re-read all words: Claude reads every message saved for this batch again and rebuilds the list (the list now goes to the archive)."));
      det.appendChild(btn("Re-read all words", "ghost-btn bx-reread", () => {
        if (!confirm("Read every saved message for " + (b.batch ? b.batch.name : "this batch") + " again with Claude and rebuild the box list? The list now goes to the archive first.")) return;
        R().sendCommand("boxesReread", { batchId: b.batch ? b.batch.id : "" });
      }));
    }
    moreEl.appendChild(det);
  }

  function fillBatches(b) {
    const list = (b && b.batches) || [];
    const keep = batchSel.value;
    while (batchSel.firstChild) batchSel.removeChild(batchSel.firstChild);
    const o0 = node("option", null, b && b.batch && (b.saved || b.pending) ? b.batch.name + (b.saved ? " (saved boxes)" : " (saved words)") : "Newest house batch");
    o0.value = "";
    batchSel.appendChild(o0);
    for (const x of list) {
      // B-1320: open house batches only; one not at Pack yet keeps the words.
      const o = node("option", null, x.name + " (" + x.id + ")" + (x.step != null && Number(x.step) < 3 ? " - not at Pack yet" : ""));
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
      const shown = {};
      for (const l of x.lines) {
        if (l.g != null && x.groups && x.groups[l.g] && !shown[l.g]) { shown[l.g] = true; card.appendChild(node("div", "l-meta bx-group", x.groups[l.g])); }
        card.appendChild(node("div", l.g != null ? "l-meta bx-group-line" : "l-meta", l.q + " × " + skuName(b, l.i) + (l.r ? " (the rest)" : "")));
      }
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

  // B-712: words kept until the batch reaches the Pack step (B-1089: and
  // words a read did not turn into boxes).
  function renderPending(b, box, withRemove) {
    const pd = b.pending;
    box.appendChild(node("p", "bx-saved", b.phase === "waiting" ? pd.text : "Saved on the laptop, not turned into boxes yet: " + pd.texts.length + " message" + (pd.texts.length === 1 ? "" : "s")));
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

  // B-1089: a letter said again in a later read is kept twice - he picks.
  function renderDupes(b, box) {
    for (const x of b.dupes || []) {
      const wrap = node("div", "bx-dupe");
      wrap.appendChild(node("p", "warn-text", "⚠ Box " + x.letter + " said twice - both are kept. Keep both (the later one becomes a new box) or Replace (keep the one said last)?"));
      const row = node("div", "bx-row");
      row.appendChild(btn("Keep both", "ghost-btn bx-dupe-both", () => R().sendCommand("boxesDupe", { id: b.id, letter: x.letter, choice: "both" })));
      row.appendChild(btn("Replace", "ghost-btn bx-dupe-replace", () => {
        if (!confirm("Keep only the box " + x.letter + " said last? The earlier one goes to the archive.")) return;
        R().sendCommand("boxesDupe", { id: b.id, letter: x.letter, choice: "replace" });
      }));
      wrap.appendChild(row);
      box.appendChild(wrap);
    }
  }

  // B-895: the boxes already in ScanPower, and the Replace choice.
  function renderPrior(b, box) {
    const pr = b.prior;
    if (b.mode === "replace") {
      if (b.existing && b.existing.units > 0) box.appendChild(node("p", "warn-text bx-prior", "Replace chosen: uploading replaces the " + b.existing.units + " units in " + b.existing.boxes + " box(es) ScanPower has now."));
      if (pr && pr.known) box.appendChild(btn("Keep them - add on instead", "ghost-btn bx-mode", () => R().sendCommand("boxesAnswer", { id: b.id, answers: {}, mode: "append" })));
      return;
    }
    if (!pr) return;
    box.appendChild(node("p", pr.known ? "bx-saved bx-prior" : "warn-text bx-prior", pr.text));
    if (pr.known) {
      if (pr.boxes && pr.boxes.length) {
        const det = node("details", "bx-prior-list");
        det.appendChild(node("summary", null, "The " + pr.count + " box" + (pr.count === 1 ? "" : "es") + " already in ScanPower"));
        for (const x of pr.boxes) det.appendChild(node("div", "l-meta", (x.letter || "#") + " → B" + x.num + " · " + (x.size || "?") + " · " + (x.weight == null ? "?" : x.weight) + " lb · " + x.lines.map((l) => l.q + " × " + skuName(b, l.i)).join(", ")));
        box.appendChild(det);
      }
      box.appendChild(btn("Replace them instead", "ghost-btn bx-mode", () => {
        if (!confirm("Replace the " + pr.count + " box(es) (" + pr.units + " units) ScanPower has now with only the new boxes?")) return;
        R().sendCommand("boxesAnswer", { id: b.id, answers: {}, mode: "replace" });
      }));
      return;
    }
    // Contents not known box by box: Stop (default) or Replace.
    box.appendChild(node("p", "warn-text", "Shopper can't read what is in each of those boxes, so adding on would wipe them. Stop here (nothing is sent), or replace them with only the new boxes."));
    const row = node("div", "bx-row");
    const note = node("p", "muted bx-stop-note");
    row.appendChild(btn("Stop - keep ScanPower's boxes", "primary-btn bx-stop", () => { note.textContent = "Stopped - nothing was sent. ScanPower keeps its " + pr.count + " box(es)."; }));
    row.appendChild(btn("Replace them", "ghost-btn bx-mode", () => {
      if (!confirm("Replace the " + pr.count + " box(es) (" + pr.units + " units) ScanPower has now with only the new boxes?")) return;
      R().sendCommand("boxesAnswer", { id: b.id, answers: {}, mode: "replace" });
    }));
    box.appendChild(row);
    box.appendChild(note);
  }

  function renderDraft(b, box) {
    const d = b.draft;
    box.appendChild(node("div", "bx-head", (b.batch ? b.batch.name : "?") + " · Pack group " + (b.packGroup || "?")));
    // B-1089: an upload whose read-back differs stays here (not done).
    if (b.result && b.result.ok === false) {
      box.appendChild(node("p", "error-text", "Uploaded, but ScanPower's pack list differs from the plan:"));
      for (const t of b.result.problems || []) box.appendChild(node("p", "error-text", "• " + t));
      box.appendChild(node("p", "muted", "The box list is kept. Check it in ScanPower; to send it again, tap Re-check with ScanPower and choose Replace."));
    }
    renderPrior(b, box);
    renderDupes(b, box);
    renderCards(b, box, true);
    if (b.pending) renderPending(b, box, true);

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
    // B-895: counts run across every box - the ones already in ScanPower too.
    const mode = b.mode === "replace" ? "replace" : "append";
    const kept = mode === "append" && b.prior && b.prior.known ? b.prior.count : 0;
    const total = kept + d.boxes.length;
    box.appendChild(node("p", "muted bx-placed", placed + " of " + expected + " units placed · " + total + " boxes" + (kept ? " (" + kept + " in ScanPower + " + d.boxes.length + " new)" : "")));

    // v2.0.55 review (B-1089): words this phone has not got to the laptop yet
    // (for this batch) go first - Upload waits for them, and says so.
    const unsentHere = unsentFor(b);
    const queuedThere = b.durable ? (typeof b.durable.queuedHere === "number" ? b.durable.queuedHere : b.durable.queued || 0) : 0;
    if (d.canUpload && (unsentHere.length || queuedThere) && !b.pending) {
      box.appendChild(node("p", "warn-text bx-upload-wait", unsentHere.length
        ? unsentHere.length + " message" + (unsentHere.length === 1 ? " is" : "s are") + " still on this phone, not on the laptop yet - " + (unsentHere.length === 1 ? "it goes" : "they go") + " first, then you can upload."
        : queuedThere + " message" + (queuedThere === 1 ? " is" : "s are") + " saved on the laptop but not read yet - " + (queuedThere === 1 ? "it is" : "they are") + " read first, then you can upload."));
    } else if (d.canUpload && !b.pending) {
      const replacing = mode === "replace" && b.existing && b.existing.units > 0;
      const label = replacing
        ? "I'm done — replace ScanPower's boxes with these " + d.boxes.length
        : "I'm done — upload " + (kept ? total + " boxes (" + kept + " kept + " + d.boxes.length + " new)" : d.boxes.length + " boxes") + " to ScanPower";
      const go = btn(label, "primary-btn bx-upload", () => {
        const where = b.batch ? b.batch.name : "ScanPower";
        const ask = replacing
          ? "Replace ScanPower's " + b.existing.boxes + " box(es) (" + b.existing.units + " units) in " + where + " with these " + d.boxes.length + " boxes?"
          : kept
            ? "Upload " + total + " boxes to " + where + "? The " + kept + " already in ScanPower stay as they are; " + d.boxes.length + " new go after them (" + placed + " units placed in all)."
            : "Upload " + d.boxes.length + " boxes (" + placed + " units) to " + where + "?";
        if (!confirm(ask)) return;
        // Typed and Read since this was drawn: those go first.
        const late = unsentFor(b);
        if (late.length) { say(late.length + " message(s) on this phone are not on the laptop yet - they go first, then upload."); return; }
        go.disabled = true;
        R().sendCommand("boxesUpload", { id: b.id, mode });
      });
      box.appendChild(go);
    } else if (d.canUpload && b.pending) {
      box.appendChild(node("p", "muted", "Some saved words are not turned into boxes yet - tap Re-check with ScanPower, or remove them, then it can upload."));
    } else if (!d.appendBlocked || d.questions.length || d.blocking.length) {
      box.appendChild(node("p", "muted", "Answer the questions or fix the text, then it can upload."));
    }
    // B-1326 (v2.0.79): Upload anyway - the boxes go up as read despite the
    // warnings above (Zach fixes the rest in ScanPower). Two presses: this
    // button, then OK on the list of what it passes over.
    if (!d.canUpload && d.canUploadAnyway && d.anyway && !b.pending) {
      if (unsentHere.length || queuedThere) {
        box.appendChild(node("p", "warn-text bx-upload-wait", (unsentHere.length || queuedThere) + " message(s) are not read on the laptop yet - they go first, then Upload anyway."));
      } else {
        const a = d.anyway;
        box.appendChild(node("p", "muted bx-anyway-note", "Or Upload anyway: the boxes go up as read (" + a.units + " units) and you fix the rest in ScanPower on the computer."));
        const any = btn("Upload anyway", "secondary-btn bx-anyway", () => {
          const where = b.batch ? b.batch.name : "ScanPower";
          const lines = ["Upload anyway to " + where + "?", "The boxes go up as read (" + a.units + " units). Fix the rest in ScanPower.", "", "Passed over:"].concat((a.warnings || []).map((t) => "• " + t));
          if ((a.trims || []).length) lines.push("", "ScanPower takes only what is expected:", ...(a.trims || []).map((t) => "• " + t));
          if ((a.empty || []).length) lines.push("", ...(a.empty || []).map((t) => "• " + t));
          if (!confirm(lines.join("\n"))) return;
          const late = unsentFor(b);
          if (late.length) { say(late.length + " message(s) on this phone are not on the laptop yet - they go first, then Upload anyway."); return; }
          any.disabled = true;
          R().sendCommand("boxesUploadAnyway", { id: b.id, mode, warnSig: a.sig });
        });
        box.appendChild(any);
      }
    }
  }

  function render(p) {
    if (!build()) return;
    const b = p ? p.boxes : null;
    last = b;
    // B-1089: messages the laptop lists as stored leave the phone's outbox.
    if (OB() && b && Array.isArray(b.stored)) OB().confirm(b.stored);
    fillBatches(b);
    renderOutbox();
    renderSaved(b);
    renderMore(b);
    syncText(b);
    readLabel();
    if (editing()) return;
    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
    const phase = b ? b.phase : "idle";
    // B-1089: Read is never locked while the laptop works - the words queue.
    readBtn.disabled = false;
    if (!b || phase === "idle") return;
    if (phase === "reading" || phase === "uploading") {
      statusEl.appendChild(node("p", "bx-working", (phase === "reading" ? "Reading boxes… " : "Uploading… ") + (b.step || "")));
      if (b.pending) renderPending(b, statusEl, false);
      return;
    }
    if (phase === "waiting" && b.pending) {
      renderPending(b, statusEl, true);
      if (b.draft && b.draft.boxes && b.draft.boxes.length) renderCards(b, statusEl, false);
      statusEl.appendChild(node("p", "muted", (b.batch ? b.batch.name : "The batch") + " is not at ScanPower's Pack step yet, so the boxes can't be matched to products. Keep adding boxes. When it reaches Pack, empty the text box and tap Re-check with ScanPower."));
      // B-1325 (v2.0.79): what ScanPower (or its page) said, in plain words.
      if (b.waitWhy) statusEl.appendChild(node("p", "muted bx-wait-why", b.waitWhy));
      return;
    }
    if (phase === "failed") {
      statusEl.appendChild(node("p", "error-text", b.error || "It stopped."));
      if (b.pending) renderPending(b, statusEl, true);
      renderDupes(b, statusEl);
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
