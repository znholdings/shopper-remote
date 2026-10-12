// remote/claude-learn-view.js - B-1062 / B-1063 (v2.0.53): "Claude's learning"
// on the phone's Buylist tab, compact. The laptop works everything out
// (lib/claude-learning-view.js projectClaudeLearningForRemote) and sends it on
// the buylist as `claudeLearning`; this file only draws it:
//   - Claude's questions with Approve / Reject + an optional note - the answer
//     goes to the laptop as the claudeScenarioAnswer command (the Buylist
//     page's own SHOPPER_CLAUDE_SCENARIO_ANSWER), so the laptop must be
//     connected for it to be saved;
//   - how Claude's picks scored (last list + a small bar per list);
//   - its rules (folded);
//   - a toggle that puts "Claude: approve 24 / skip" on each card (tap = why).
// Shows only - nothing here changes the list.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SHOW_KEY = "shopperClaudeChipsPhone";
  let showChips = false;
  let drawnKey = "";
  let data = null;
  const drafts = {};
  let flash = "";
  try { showChips = localStorage.getItem(SHOW_KEY) === "1"; } catch (e) { showChips = false; }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function chipText(p) { return p.action === "approve" ? "Claude: approve " + p.qty : "Claude: skip"; }

  function send(id, answer, btns, out) {
    const R = self.ShopperRemote;
    if (!R) { out.textContent = "Not connected."; return; }
    btns.forEach(function (b) { b.disabled = true; });
    out.className = "cl-q-result";
    out.textContent = "Sending to the laptop...";
    const cmdIdOf = { id: null };
    Promise.resolve(R.sendCommand("claudeScenarioAnswer", { id: id, answer: answer, note: drafts[id] || "" }))
      .then(function (cmdId) {
        if (!cmdId) throw new Error("not sent");
        cmdIdOf.id = cmdId;
        return R.waitFor(cmdId);
      })
      .then(function (status) {
        // v2.0.53 review: the laptop refuses an answer older than 50 s
        // (lib/remote-protocol.js maxAgeMs), far inside the phone's 5-minute
        // wait. At the wait's end the phone takes the answer back first
        // (pending -> cancelled, only while still pending); one the laptop
        // already took is not called "not saved".
        if (status !== "timeout") return status;
        return Promise.resolve(R.cancelPending ? R.cancelPending(cmdIdOf.id, "the laptop did not pick it up within 5 minutes - not saved") : false)
          .catch(function () { return false; })
          .then(function (took) {
            if (took) return "taken back";
            return Promise.resolve(R.readCommand ? R.readCommand(cmdIdOf.id) : null)
              .catch(function () { return null; })
              .then(function (row) {
                const st = row && row.status;
                if (st === "done" || st === "failed" || st === "rejected") return st;
                if (st === "pending" || st === "cancelled") return "taken back";
                return "late";
              });
          });
      })
      .then(function (status) {
        if (status === "done") {
          delete drafts[id];
          flash = "Your " + (answer === "approve" ? "Approve" : "Reject") + " was saved on the laptop - Claude reads it next time.";
          out.textContent = "Saved.";
          drawnKey = "";
          render(data);
        } else if (status === "late") {
          out.className = "cl-q-result";
          out.textContent = "The laptop picked this up late and is still saving it - it shows as answered when done.";
        } else if (status === "taken back") {
          btns.forEach(function (b) { b.disabled = false; });
          out.className = "cl-q-result cl-bad";
          out.textContent = "Not saved - the laptop didn't pick it up in 5 minutes (it may be off or asleep). Nothing was sent.";
        } else {
          btns.forEach(function (b) { b.disabled = false; });
          out.className = "cl-q-result cl-bad";
          out.textContent = "Not saved (" + status + ") - the laptop must be connected.";
        }
      })
      .catch(function (e) {
        btns.forEach(function (b) { b.disabled = false; });
        out.className = "cl-q-result cl-bad";
        out.textContent = "Not sent: " + ((e && e.message) || "no connection") + ".";
      });
  }

  function question(s) {
    const card = el("div", "cl-q");
    card.dataset.id = s.id;
    card.appendChild(el("p", "cl-q-text", s.question));
    if (s.reasoning) card.appendChild(el("p", "cl-q-why", "Why: " + s.reasoning));
    const note = el("textarea", "cl-q-note");
    note.rows = 1;
    note.maxLength = 300;
    note.placeholder = "Note (optional)";
    note.setAttribute("aria-label", "Note for Claude (optional)");
    note.value = drafts[s.id] || "";
    note.addEventListener("input", function () { drafts[s.id] = note.value; });
    const row = el("div", "cl-q-btns");
    const yes = el("button", "secondary-btn", "Approve");
    const no = el("button", "secondary-btn", "Reject");
    yes.type = "button";
    no.type = "button";
    const out = el("span", "cl-q-result");
    yes.addEventListener("click", function () { send(s.id, "approve", [yes, no], out); });
    no.addEventListener("click", function () { send(s.id, "reject", [yes, no], out); });
    row.appendChild(yes);
    row.appendChild(no);
    row.appendChild(out);
    card.appendChild(note);
    card.appendChild(row);
    return card;
  }

  function trend(d) {
    const box = el("div", "");
    box.appendChild(el("p", "", d.lastScore || ""));
    if (d.trend && d.trend.length) {
      const t = el("div", "cl-trend");
      d.trend.forEach(function (s) {
        const b = el("div", "cl-tbar");
        const track = el("div", "cl-tbar-track");
        const fill = el("div", "cl-tbar-fill");
        fill.style.height = Math.max(0, Math.min(100, Number(s.pct) || 0)) + "%";
        track.appendChild(fill);
        b.appendChild(el("span", "cl-tbar-pct", (Number(s.pct) || 0) + "%"));
        b.appendChild(track);
        b.appendChild(el("span", "cl-tbar-day", s.label || ""));
        t.appendChild(b);
      });
      box.appendChild(t);
    }
    return box;
  }

  function draw(host, d) {
    host.textContent = "";
    const panel = el("section", "cl-panel cl-phone");
    const head = el("div", "cl-head");
    head.appendChild(el("h2", "cl-title section-head", "Claude's learning"));
    panel.appendChild(head);
    const body = el("div", "cl-body");
    body.appendChild(el("p", "cl-sub", "Claude's guesses about how you pick - shown only, never applied."));
    if (flash) body.appendChild(el("p", "cl-status", flash));
    if (d.status) body.appendChild(el("p", /limit|failed|not usable|did not run/i.test(d.status) ? "cl-status cl-status-warn" : "cl-status", d.status));
    const qs = d.scenarios || [];
    if (qs.length) {
      const q = el("div", "cl-qs");
      q.appendChild(el("h3", "cl-h", "Claude's questions (" + qs.length + ")"));
      qs.forEach(function (s) { q.appendChild(question(s)); });
      body.appendChild(q);
    }
    body.appendChild(trend(d));
    const n = Object.keys(d.predictions || {}).length;
    if (d.predictionNote) {
      const lab = el("label", "cl-toggle");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "claudeChipsTogglePhone";
      cb.checked = showChips;
      cb.disabled = !n;
      cb.addEventListener("change", function () {
        showChips = cb.checked;
        try { localStorage.setItem(SHOW_KEY, showChips ? "1" : "0"); } catch (e) { /* this phone only */ }
        tagCards(d);
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" Claude's pick on each line" + (n ? " (" + n + ")" : "")));
      body.appendChild(lab);
      body.appendChild(el("p", "cl-sub", d.predictionNote));
    }
    if (d.rules && d.rules.length) {
      const det = el("details", "cl-rulesbox");
      det.appendChild(el("summary", "", "What Claude has learned (" + d.rules.length + ")"));
      const ul = el("ul", "cl-rules");
      d.rules.forEach(function (r) {
        const li = el("li", "", r.text);
        li.appendChild(el("span", "cl-rule-ev", " - " + r.evidence + " decisions, " + r.confidence));
        ul.appendChild(li);
      });
      det.appendChild(ul);
      body.appendChild(det);
    }
    panel.appendChild(body);
    host.appendChild(panel);
  }

  // The chip under each card's title (cards carry data-asin; app.js redraws
  // them, so this runs on every render and only touches what changed).
  function tagCards(d) {
    const preds = (showChips && d && d.predictions) || {};
    const cards = document.querySelectorAll("#buylistItems .line[data-asin]");
    cards.forEach(function (card) {
      const p = preds[card.dataset.asin];
      let row = card.querySelector(".cl-phone-chiprow");
      if (!p) { if (row) row.remove(); return; }
      const text = chipText(p);
      if (row && row.getAttribute("data-t") === text) return;
      if (row) row.remove();
      row = el("div", "cl-phone-chiprow");
      row.setAttribute("data-t", text);
      const chip = el("button", "cl-chip s-plain-btn" + (p.action === "approve" ? "" : " cl-skip"), text);
      chip.type = "button";
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const r = row.querySelector(".cl-reason");
        if (r) r.remove();
        else row.appendChild(el("span", "cl-reason", p.reason || "Claude gave no reason"));
      });
      row.appendChild(chip);
      const head = card.querySelector(".bl-headtext") || card;
      head.appendChild(row);
    });
  }

  function render(bl) {
    const host = $("claudeLearnHost");
    if (!host) return;
    const d = bl && bl.claudeLearning && typeof bl.claudeLearning === "object" ? bl.claudeLearning : null;
    data = bl || null;
    if (!d) {
      if (host.childNodes.length) host.textContent = "";
      drawnKey = "";
      return;
    }
    const key = JSON.stringify([d, showChips, flash]);
    const typing = host.contains(document.activeElement) && document.activeElement && document.activeElement.tagName === "TEXTAREA";
    if (key !== drawnKey && !typing) {
      drawnKey = key;
      draw(host, d);
    }
    tagCards(d);
  }

  self.ShopperClaudeLearnView = Object.freeze({ render: render });
})();
