// remote/books-view.js - v2.0.73 builder E, B-1232: the phone's "Books" section.
//
// A mirror of the laptop's Books page: what the laptop published in the
// payload's `books` (lib/books-phone.js projectBooksForRemote - built from the
// Books page's own reply), drawn here. Nothing is worked out on the phone.
//   - tiles: the Books' cash and card balances, this month's P&L, the Needs you
//     count (the Books page tile's own count), months closed / open, audit
//     findings open;
//   - Needs you: the oldest rows (the laptop sends at most 50, with the total),
//     each with an account picker and a "Book it" button. The pick goes to the
//     laptop as the remote command booksLineSet = the Books page picker's own
//     SHOPPER_BOOKS_LINE_SET (lib/remote-protocol.js checks its fields). Rows
//     the laptop answers another way (a card payment waiting for its Chase
//     line, a line booked the wrong way round, a closed month) say so and
//     have no picker.
// B-1278 (v2.0.74): card-payment and wrong-way-round rows now get the
// laptop's OWN answers (the row says which - lib/books-phone.js): the
// laptop's lead line, a picker without the bank / card accounts on a card
// payment, "Nothing - the Chase line books it" (booksLineClear = the page's
// clear: true, confirmed first), and a wrong-way-round pick previewed first
// (the laptop's words: what is voided, what is booked) and sent only on
// "Re-book it". A line in a closed month still has no picker.
// B-1277 (v2.0.74): Reload - asks the laptop to read the Books again now
// (booksReload; the laptop allows it once a minute, and so does this button).
// One pick at a time; a pick the laptop never picks up says so (5 minutes,
// app.js) and nothing is re-sent on its own.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const REMEMBER_KEY = "shopperBooksPhoneRemember";
  const NOTE_MS = 3 * 60 * 1000;
  let data = null;
  let drawnKey = "";
  let sending = "";
  const notes = {}; // row key -> { phase, text, at }
  const picked = {}; // row key -> account code chosen, not sent yet
  // B-1278: = books/books.js NOTHING_CHOICE / NOTHING_LABEL (the test holds them together).
  const NOTHING = "__nothing__";
  const NOTHING_LABEL = "Nothing - the Chase line books it";
  // B-1277: = lib/books-phone-reload.js BOOKS_PHONE_RELOAD_GAP_MS (the laptop refuses inside it anyway).
  const RELOAD_GAP_MS = 60 * 1000;
  let reloadUntil = 0;
  let reloadAt = 0; // the books.at the Reload was pressed against (0 = not waiting)
  let reloadTimer = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function money(cents) {
    const c = Math.round(Number(cents) || 0);
    const abs = (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (c < 0 ? "-$" : "$") + abs;
  }
  // B-1600 (v2.0.116): the pick's payload - with the picked row's own amount (rowCents, Dr + cents) like the Books page
  // (books/books.js lineSetMessage, B-1580), so only the row picked moves. Only a feed tab's row carries one (never Bank Lines).
  // <booksPickPayload>
  function pickPayload(r, code, remember) {
    const p = { lineId: r.lineId, entryId: r.entryId || "", sourceTab: r.sourceTab || "", month: r.month || "", account: code, remember: !!remember && (!r.sourceTab || r.sourceTab === "Bank Lines") };
    const rc = Number(r.rowCents);
    if (r.sourceTab && r.sourceTab !== "Bank Lines" && Number.isInteger(rc) && rc !== 0) p.rowCents = rc;
    return p;
  }
  // </booksPickPayload>
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthLabel(m) {
    const x = /^(\d{4})-(\d{2})$/.exec(String(m || ""));
    return x ? MONTHS[Number(x[2]) - 1] + " " + x[1] : String(m || "");
  }
  function shortMonth(m) {
    const x = /^(\d{4})-(\d{2})$/.exec(String(m || ""));
    return x ? MONTHS[Number(x[2]) - 1] : String(m || "");
  }
  function rememberOn() {
    try { return localStorage.getItem(REMEMBER_KEY) !== "off"; } catch (e) { return true; }
  }
  function accountName(code) {
    const list = data && Array.isArray(data.accounts) ? data.accounts : [];
    const a = list.find((x) => x && String(x[0]) === String(code));
    return a ? a[1] : "";
  }

  // ---- tiles (the Home tab's tile classes: dash-tile gl-tile) ----
  function tile(id, label, value, sub, wide) {
    const n = el("div", "dash-tile gl-tile bkm-tile" + (wide ? " wide" : ""));
    n.dataset.tile = id;
    n.append(el("span", "t-label", label));
    if (value != null) n.append(el("b", "gl-num", value));
    if (sub) n.append(el("span", "dash-money gl-sub", sub));
    return n;
  }
  function drawTiles(host) {
    host.textContent = "";
    const cash = tile("cash", "Cash and cards", null, "", true);
    const rows = el("div", "gl-bank-rows");
    for (const c of data.cash || []) {
      const row = el("div", "gl-bank-row");
      row.dataset.code = c.code;
      // A card's balance is a credit (owed): shown as owed, positive.
      const value = c.kind === "card" ? (c.cents <= 0 ? money(-c.cents) + " owed" : money(c.cents) + " in credit") : money(c.cents);
      row.append(el("span", "gl-bank-label", `${c.code} ${c.name}`), el("span", "gl-bank-value", value));
      rows.append(row);
    }
    if (!(data.cash || []).length) rows.append(el("span", "dash-money gl-sub", "No balances in the reply."));
    cash.append(rows);
    host.append(cash);
    const pl = data.pl;
    const p = tile("pl", `${monthLabel(data.month)} P&L`, pl ? money(pl.netIncome) : "-", pl ? "net income" : "", true);
    if (pl) {
      const split = el("div", "gl-split");
      for (const [l, v] of [["Revenue", pl.revenue], ["COGS", pl.cogs], ["Expenses", pl.expenses]]) {
        const it = el("span", "gl-split-item");
        it.append(el("span", "gl-split-label", l), el("span", "gl-split-value", money(v)));
        split.append(it);
      }
      p.append(split);
    }
    host.append(p);
    const needs = tile("needs", "Needs you", String(data.needsCount || 0), data.gustoWaiting ? `${data.gustoWaiting} waiting on Gusto (not counted)` : "lines to categorise");
    needs.classList.add("dash-tap");
    needs.setAttribute("role", "button");
    needs.tabIndex = 0;
    const go = () => { const c = $("bkmNeedsCard"); if (c && c.scrollIntoView) c.scrollIntoView({ block: "start" }); };
    needs.addEventListener("click", go);
    needs.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    host.append(needs);
    const closed = data.monthsClosed || [];
    const open = data.monthsOpen || [];
    host.append(tile("months", "Months", `${closed.length} closed`, open.length ? `open: ${open.map(shortMonth).join(", ")}` : "none open"));
    // B-1840 (v2.0.139): the Tie-outs tile - each total the Books can be held against, and whether it is off.
    const tie = data.tieout && Array.isArray(data.tieout.rows) ? data.tieout.rows : null;
    if (tie) {
      const off = tie.filter((r) => r.state === "off");
      const t = tile("tieout", "Tie-outs", off.length ? `${off.length} off` : "all tie", tie.length ? `${tie.length} checked` : "nothing checked yet");
      const list = el("div", "gl-tie-rows");
      for (const r of tie) {
        const row = el("div", "gl-tie-row");
        row.dataset.state = r.state;
        row.append(el("span", "gl-tie-label", `${r.state === "ok" ? "OK" : r.state === "off" ? "OFF" : "?"} ${r.label}`));
        if (r.detail) row.append(el("span", "dash-money gl-sub", r.detail));
        // B-1853: the card lines' own detail (duplicates voided, payments from ··0034) under an OFF row.
        if (r.state === "off" && Array.isArray(r.more) && r.more[0]) row.append(el("span", "dash-money gl-sub gl-tie-more", r.more[0]));
        // v2.0.143 (B-1875): the unmatched orders of an OFF purchases row (first 5) and the Gmail card proof.
        if (r.state === "off" && Array.isArray(r.unmatched) && r.unmatched.length) {
          const box = el("div", "gl-tie-unmatched");
          for (const u of r.unmatched.slice(0, 5)) box.append(el("span", "dash-money gl-sub", `${u.r || "?"} ${u.n} ${u.d} ${money(u.gap)}`));
          if (r.unmatched.length > 5) box.append(el("span", "dash-money gl-sub", `+${r.unmatched.length - 5} more`));
          const pb = el("button", "primary-btn bkm-book", "Find the card (Gmail)");
          pb.type = "button";
          pb.disabled = !!sending;
          pb.addEventListener("click", () => runCardProof(r));
          box.append(pb);
          const pn = noteFor("proof:" + r.key);
          if (pn) box.append(el("div", "bkm-note muted small", pn.text));
          row.append(box);
        }
        list.append(row);
      }
      t.append(list);
      host.append(t);
    }
    host.append(tile("audit", "Audit findings open", String(data.auditOpen || 0), data.auditOpen ? "decide them on the laptop's Audit page" : "none waiting"));
  }

  // ---- Needs you ----
  function noteFor(key) {
    const n = notes[key];
    if (!n) return null;
    if (n.phase !== "sending" && Date.now() - n.at > NOTE_MS) { delete notes[key]; return null; }
    return n;
  }
  // B-1278: = books/books.js signPreviewText (money out = Dr <account> / Cr <bank>,
  // money in = Dr <bank> / Cr <account>); the laptop sent the bank and the amount.
  function signPreviewText(sign, code) {
    const cents = Math.round(Number(sign && sign.cents) || 0);
    const bank = String((sign && sign.bank) || "");
    const legs = cents < 0 ? `Dr ${code} / Cr ${bank}` : `Dr ${bank} / Cr ${code}`;
    return `Re-book this line: its current entry is voided, then ${legs} ${money(Math.abs(cents))} is booked.`;
  }
  function bookLabel(r, code) {
    if (!code) return "Book it";
    if (code === NOTHING) return "Set to nothing";
    return r.kind === "sign" ? "Re-book it" : `Book to ${code}`;
  }
  function rowEl(r) {
    const li = el("li", "bkm-row");
    li.dataset.key = r.key;
    if (r.kind) li.dataset.kind = r.kind;
    const top = el("div", "bkm-top");
    top.append(el("span", "bkm-amt" + (r.cents < 0 ? " bkm-out" : " bkm-in"), money(r.cents)), el("span", "bkm-date", r.date));
    if (r.month && r.month !== data.month) top.append(el("span", "bkm-month", monthLabel(r.month)));
    li.append(top, el("div", "bkm-what", r.text));
    if (r.reason) li.append(el("div", "bkm-why muted small", r.reason));
    if (r.sug) li.append(el("div", "bkm-sug", `Claude suggests ${r.sug}${accountName(r.sug) ? " " + accountName(r.sug) : ""}`));
    const n = noteFor(r.key);
    if (!r.pick) {
      li.append(el("div", "bkm-lead", r.why || "Answer this one on the laptop."));
      // B-1853 (v2.0.141): a duplicate card line is voided / a card payment from ··0034 booked with one tap (the laptop does the work).
      if (r.action && (r.action.type === "dupe-void" || r.action.type === "card-pay-book" || r.action.type === "card-gone-void")) {
        const ab = el("button", "primary-btn bkm-book", r.action.type === "card-pay-book" ? "Book it (Dr 2000 / Cr 3000)" : "Void this line");
        ab.type = "button";
        ab.disabled = !!sending;
        ab.addEventListener("click", () => runAction(r));
        li.append(ab);
      }
    } else {
      // B-1278: the laptop's own lead line on a card payment / wrong-way-round row.
      if (r.lead) li.append(el("div", "bkm-lead", r.lead));
      const box = el("div", "bkm-pick");
      const sel = el("select", "bkm-select");
      sel.setAttribute("aria-label", `Account for ${r.text}`);
      // A parked Journal line: the account it sits on now (6900) is left out of
      // the list - the pick is a move (the laptop ignores a pick of it too).
      // B-1278 (v2.0.74): a waiting bank line keeps its as-booked account in the
      // list, as on the laptop - "pick its account again" re-books a line booked
      // the wrong way round, and 2200 is still the usual answer on a late Gusto line.
      const parked = String(r.key || "").startsWith("j:");
      const blank = el("option", null, !parked && r.account ? `${r.account} (as booked)` : "Pick an account");
      blank.value = "";
      sel.append(blank);
      // B-1278: "Nothing - the Chase line books it" (a card line booked before its Chase line).
      if (r.nothing) {
        const none = el("option", null, NOTHING_LABEL);
        none.value = NOTHING;
        sel.append(none);
      }
      const omit = Array.isArray(r.omit) ? r.omit.map(String) : [];
      for (const a of data.accounts || []) {
        if (parked && String(a[0]) === String(r.account)) continue;
        if (omit.includes(String(a[0]))) continue;
        const o = el("option", null, `${a[0]} ${a[1]}`);
        o.value = String(a[0]);
        sel.append(o);
      }
      sel.value = picked[r.key] || "";
      const btn = el("button", "primary-btn bkm-book", bookLabel(r, picked[r.key]));
      btn.type = "button";
      btn.disabled = !picked[r.key] || !!sending;
      sel.disabled = !!sending;
      // B-1278: a wrong-way-round pick says what is voided and what is booked before anything is sent.
      const preview = el("div", "bkm-sign-preview");
      preview.setAttribute("role", "status");
      const cancel = el("button", "secondary-btn bkm-cancel", "Cancel");
      cancel.type = "button";
      const showPreview = () => {
        const on = r.kind === "sign" && !!r.sign && !!picked[r.key];
        preview.textContent = on ? signPreviewText(r.sign, picked[r.key]) : "";
        preview.hidden = !on;
        cancel.hidden = !on;
      };
      sel.addEventListener("change", () => {
        picked[r.key] = sel.value;
        btn.disabled = !sel.value || !!sending;
        btn.textContent = bookLabel(r, sel.value);
        showPreview();
      });
      cancel.addEventListener("click", () => {
        delete picked[r.key];
        sel.value = "";
        btn.disabled = true;
        btn.textContent = bookLabel(r, "");
        showPreview();
      });
      btn.addEventListener("click", () => {
        const code = picked[r.key];
        if (!code) return;
        if (code === NOTHING && !confirm(`Set this card line to nothing? Its entries are voided - the Chase line books this payment.`)) return;
        pick(r, code);
      });
      box.append(sel, btn, cancel);
      li.append(box, preview);
      showPreview();
    }
    if (n) li.append(el("div", "bkm-note bkm-note-" + n.phase, n.text));
    return li;
  }
  function drawNeeds() {
    const card = $("bkmNeedsCard");
    const ul = $("bkmNeeds");
    const more = $("bkmNeedsMore");
    const rows = data.needs || [];
    $("bkmNeedsCount").textContent = String(data.needsCount || 0);
    ul.textContent = "";
    for (const r of rows) ul.append(rowEl(r));
    if (!rows.length) ul.append(el("li", "bkm-empty muted", "Nothing needs you."));
    const total = Number(data.needsTotal) || rows.length;
    more.hidden = total <= rows.length;
    more.textContent = total > rows.length ? `Showing the oldest ${rows.length} of ${total}. The rest are on the laptop's Books page.` : "";
    card.hidden = false;
    // v2.0.145 (B-1907): the seat's checks - own list, no pick controls.
    const fcl = $("bkmForClaude");
    const fcard = $("bkmForClaudeCard");
    if (fcl && fcard) {
      const fc = data.forClaude || [];
      fcl.textContent = "";
      for (const r of fc) fcl.append(rowEl({ ...r, pick: false, reason: "" }));
      $("bkmForClaudeCount").textContent = String(Number(data.forClaudeTotal) || fc.length);
      fcard.hidden = !fc.length;
    }
    // Notes for rows that have gone (booked) stay above the list a while.
    const gone = Object.keys(notes).filter((k) => !rows.some((r) => r.key === k) && noteFor(k));
    const box = $("bkmDone");
    box.textContent = "";
    for (const k of gone) box.append(el("p", "bkm-note bkm-note-" + notes[k].phase, notes[k].text));
    box.hidden = !gone.length;
  }

  function statusLine() {
    const s = $("bkmStatus");
    if (!s) return;
    if (!data) { s.textContent = "Waiting for the laptop's Books..."; return; }
    const at = Number(data.at) || 0;
    const mins = at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;
    s.textContent = `${data.month ? monthLabel(data.month) + " · " : ""}read from the Books ${mins == null ? "" : mins < 1 ? "just now" : `${mins} min ago`} (again every 10 minutes and after each change).`;
  }

  function draw() {
    const banner = $("bkmBanner");
    const body = $("bkmBody");
    statusLine();
    if (!data) { body.hidden = true; banner.hidden = true; return; }
    if (data.error) { banner.textContent = `The laptop could not read the Books: ${data.error}`; banner.hidden = false; }
    else if (!data.workbook) { banner.textContent = data.note || "No Books workbook on the laptop yet."; banner.hidden = false; }
    else banner.hidden = true;
    body.hidden = !!data.error || !data.workbook;
    if (body.hidden) return;
    drawTiles($("bkmTiles"));
    drawNeeds();
  }

  function render(books, pull) {
    data = books && typeof books === "object" ? books : null;
    pullData = pull && typeof pull === "object" ? pull : null;
    reloadState();
    pullState();
    const key = JSON.stringify(data) + "|" + JSON.stringify(notes) + "|" + sending;
    if (key === drawnKey) { statusLine(); return; }
    drawnKey = key;
    draw();
  }
  function redraw() { drawnKey = ""; render(data); }

  async function pick(r, code) {
    const R = self.ShopperRemote;
    if (!R || !R.sendCommand || sending) return;
    if (R.laptopOnline && !R.laptopOnline()) {
      notes[r.key] = { phase: "failed", text: "The laptop isn't connected - nothing was sent.", at: Date.now() };
      redraw();
      return;
    }
    sending = r.key;
    const nothing = code === NOTHING;
    notes[r.key] = { phase: "sending", text: nothing ? "Setting it to nothing..." : `Booking to ${code}...`, at: Date.now() };
    redraw();
    let id = null;
    try {
      // B-1278: "Nothing" is its own command (the laptop fixes clear / account / remember).
      id = nothing
        ? await R.sendCommand("booksLineClear", { lineId: r.lineId, entryId: r.entryId || "", sourceTab: r.sourceTab || "", month: r.month || "" })
        : await R.sendCommand("booksLineSet", pickPayload(r, code, rememberOn()));
    } catch (e) { id = null; }
    if (!id) {
      sending = "";
      notes[r.key] = { phase: "failed", text: "Not sent - the phone could not reach the laptop's relay. Try again.", at: Date.now() };
      redraw();
      return;
    }
    let status = "done";
    try { if (R.waitFor) status = await R.waitFor(id); } catch (e) { status = "done"; }
    let row = null;
    try { if (R.readCommand) row = await R.readCommand(id); } catch (e) { row = null; }
    const res = row && row.result && typeof row.result === "object" ? row.result : null;
    sending = "";
    delete picked[r.key];
    if (status === "done" && nothing) {
      const v = res && Number(res.voided) > 0 ? ` (${res.voided} entr${Number(res.voided) === 1 ? "y" : "ies"} voided)` : "";
      notes[r.key] = { phase: "done", text: `${r.date} ${r.text.slice(0, 40)}: set to nothing - the Chase line books this payment${v}.`, at: Date.now() };
    } else if (status === "done") {
      const rem = res && res.remembered;
      const extra = res && res.corrected ? ` (its month is closed - a correcting entry dated ${res.postedOn || "today"})` : "";
      const said = rem && rem.ruleId ? ` Remembered: always book ${rem.key} to ${rem.account}.` : rem && rem.skipped ? ` Not remembered (${rem.skipped}).` : "";
      notes[r.key] = { phase: "done", text: `${r.date} ${r.text.slice(0, 40)}: booked to ${code}${accountName(code) ? " " + accountName(code) : ""}${extra}.${said}`, at: Date.now() };
    } else if (status === "timeout") {
      notes[r.key] = { phase: "failed", text: "No answer from the laptop in 5 minutes - check the laptop's Books page before picking again.", at: Date.now() };
    } else {
      notes[r.key] = { phase: "failed", text: `Not booked: ${String((row && row.reason) || (res && res.error) || status)}`, at: Date.now() };
    }
    redraw();
  }

  // B-1853: the one-tap Needs-you actions (booksDupeVoid / booksCardPayBook), same phases as pick().
  async function runAction(r) {
    const R = self.ShopperRemote;
    if (!R || !R.sendCommand || sending || !r.action) return;
    if (R.laptopOnline && !R.laptopOnline()) {
      notes[r.key] = { phase: "failed", text: "The laptop isn't connected - nothing was sent.", at: Date.now() };
      redraw();
      return;
    }
    const void_ = r.action.type === "dupe-void" || r.action.type === "card-gone-void";
    sending = r.key;
    notes[r.key] = { phase: "sending", text: void_ ? "Voiding the duplicate line..." : "Booking the card payment...", at: Date.now() };
    redraw();
    let id = null;
    try {
      id = r.action.type === "card-gone-void" ? await R.sendCommand("booksCardGoneVoid", { lineId: r.action.lineId }) : void_ ? await R.sendCommand("booksDupeVoid", { lineId: r.action.lineId, keepId: r.action.keepId }) : await R.sendCommand("booksCardPayBook", { hhId: r.action.hhId });
    } catch (e) { id = null; }
    if (!id) {
      sending = "";
      notes[r.key] = { phase: "failed", text: "Not sent - the phone could not reach the laptop's relay. Try again.", at: Date.now() };
      redraw();
      return;
    }
    let status = "done";
    try { if (R.waitFor) status = await R.waitFor(id); } catch (e) { status = "done"; }
    let row = null;
    try { if (R.readCommand) row = await R.readCommand(id); } catch (e) { row = null; }
    const res = row && row.result && typeof row.result === "object" ? row.result : null;
    sending = "";
    if (status === "done" && res && res.ok !== false) {
      notes[r.key] = { phase: "done", text: res.note ? String(res.note) : void_ ? `Voided the duplicate line (${Number(res.voided) || 0} entr${Number(res.voided) === 1 ? "y" : "ies"} voided).` : `Booked${res.entryId ? ` (entry ${res.entryId})` : ""}.`, at: Date.now() };
    } else if (status === "timeout") {
      notes[r.key] = { phase: "failed", text: "No answer from the laptop in 5 minutes - check the laptop's Books page before tapping again.", at: Date.now() };
    } else {
      notes[r.key] = { phase: "failed", text: `Not done: ${String((res && res.error) || (row && row.reason) || status)}`, at: Date.now() };
    }
    redraw();
  }

  // ---- v2.0.143 (B-1875): which card paid the unmatched orders (Gmail, on the laptop; <= 10 orders) ----
  async function runCardProof(r) {
    const R = self.ShopperRemote;
    const key = "proof:" + r.key;
    if (!R || !R.sendCommand || sending) return;
    if (R.laptopOnline && !R.laptopOnline()) { notes[key] = { phase: "failed", text: "The laptop isn't connected - nothing was sent.", at: Date.now() }; redraw(); return; }
    sending = key;
    notes[key] = { phase: "sending", text: "Searching Gmail for the card...", at: Date.now() };
    redraw();
    let id = null;
    try { id = await R.sendCommand("booksCardProof", { lineIds: r.unmatched.slice(0, 10).map((u) => u.n) }); } catch (e) { id = null; }
    if (!id) { sending = ""; notes[key] = { phase: "failed", text: "Not sent - the phone could not reach the laptop's relay. Try again.", at: Date.now() }; redraw(); return; }
    let status = "done";
    try { if (R.waitFor) status = await R.waitFor(id); } catch (e) { status = "done"; }
    let row = null;
    try { if (R.readCommand) row = await R.readCommand(id); } catch (e) { row = null; }
    const res = row && row.result && typeof row.result === "object" ? row.result : null;
    sending = "";
    if (status === "done" && res && res.ok !== false) {
      const list = Array.isArray(res.orders) ? res.orders : [];
      const named = list.filter((o) => o && Array.isArray(o.last4) && o.last4.length);
      const unseen = named.filter((o) => !o.connected);
      notes[key] = { phase: "done", text: `${list.length} order(s) searched; ${named.length} named a card${named.length ? " (" + [...new Set(named.flatMap((o) => o.last4))].map((d) => "··" + d).join(", ") + ")" : ""}${unseen.length ? `; ${unseen.length} paid with a card Books does not see - on Needs you.` : "."}`, at: Date.now() };
    } else if (status === "timeout") {
      notes[key] = { phase: "failed", text: "No answer from the laptop in 5 minutes - check the laptop's Books page before tapping again.", at: Date.now() };
    } else {
      notes[key] = { phase: "failed", text: `Not done: ${String((res && res.error) || (row && row.reason) || status)}`, at: Date.now() };
    }
    redraw();
  }

  // ---- B-1277: Reload ----
  function reloadState() {
    const btn = $("bkmReload");
    const note = $("bkmReloadNote");
    if (!btn) return;
    const now = Date.now();
    // The fresh copy arrived (its read time moved): the wait is over.
    if (reloadAt && data && Number(data.at) > reloadAt) {
      reloadAt = 0;
      if (note) { note.textContent = "Reloaded."; note.dataset.phase = "done"; }
    }
    const left = Math.max(0, Math.ceil((reloadUntil - now) / 1000));
    // A minute on and still the old copy: say so (the laptop keeps its last good read when a read fails).
    if (reloadAt && left === 0) {
      reloadAt = 0;
      if (note) { note.textContent = "No fresh copy came back - this is the laptop's last read (its log says why)."; note.dataset.phase = "failed"; }
    }
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Reload (${left} s)` : "Reload";
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    if (left > 0) reloadTimer = setTimeout(reloadState, 1000);
  }
  async function reload() {
    const R = self.ShopperRemote;
    const note = $("bkmReloadNote");
    const say = (text, phase) => { if (note) { note.textContent = text; note.dataset.phase = phase; } };
    if (!R || !R.sendCommand || Date.now() < reloadUntil) return;
    if (R.laptopOnline && !R.laptopOnline()) { say("The laptop isn't connected - nothing was sent.", "failed"); return; }
    reloadUntil = Date.now() + RELOAD_GAP_MS;
    reloadAt = Number(data && data.at) || 1;
    say("Asking the laptop to read the Books again...", "sending");
    reloadState();
    let id = null;
    try { id = await R.sendCommand("booksReload", {}); } catch (e) { id = null; }
    if (!id) { reloadAt = 0; reloadUntil = 0; say("Not sent - the phone could not reach the laptop's relay. Try again.", "failed"); reloadState(); return; }
    let status = "done";
    try { if (R.waitFor) status = await R.waitFor(id); } catch (e) { status = "done"; }
    if (status === "done") {
      if (reloadAt) say("The laptop is reading the Books - they show here in a moment.", "sending");
    } else {
      let row = null;
      try { if (R.readCommand) row = await R.readCommand(id); } catch (e) { row = null; }
      const res = row && row.result && typeof row.result === "object" ? row.result : null;
      reloadAt = 0;
      say(status === "timeout" ? "No answer from the laptop in 5 minutes." : `Not reloaded: ${String((res && res.error) || (row && row.reason) || status)}`, "failed");
    }
    reloadState();
  }

  // ---- B-1902 (v2.0.145): Pull and categorise now - Main runs it; progress comes back in publishState's booksPull ----
  let pullData = null;
  let pullSentAt = 0;
  function pullState() {
    const btn = $("bkmPullNow");
    const note = $("bkmReloadNote");
    if (!btn) return;
    const p = pullData;
    const running = !!(p && p.running);
    btn.disabled = running || Date.now() - pullSentAt < 5000;
    if (!note) return;
    if (running) {
      const lines = (p.lines || []).slice(-2).join(" · ");
      note.textContent = `${p.handedTo ? `Running on the ${p.handedTo} computer: ` : "Running: "}${lines || "pulling every source, then categorising..."}`;
      note.dataset.phase = "sending";
    } else if (p && p.result && pullSentAt && Number(p.at) >= pullSentAt) {
      note.textContent = String(p.result).slice(0, 300);
      note.dataset.phase = "done";
    }
  }
  async function pullNow() {
    const R = self.ShopperRemote;
    const note = $("bkmReloadNote");
    const say = (text, phase) => { if (note) { note.textContent = text; note.dataset.phase = phase; } };
    if (!R || !R.sendCommand || (pullData && pullData.running) || Date.now() - pullSentAt < 5000) return;
    if (R.laptopOnline && !R.laptopOnline()) { say("The laptop isn't connected - nothing was sent.", "failed"); return; }
    pullSentAt = Date.now();
    say("Asking the Main computer to pull and categorise the Books...", "sending");
    pullState();
    let id = null;
    try { id = await R.sendCommand("booksPullNow", {}); } catch (e) { id = null; }
    if (!id) { pullSentAt = 0; say("Not sent - the phone could not reach the laptop's relay. Try again.", "failed"); pullState(); return; }
    say("Started on the Main computer - progress below.", "sending");
    pullState();
  }

  function wire() {
    const pb = $("bkmPullNow");
    if (pb) pb.addEventListener("click", () => { pullNow(); });
    const rb = $("bkmReload");
    if (rb) rb.addEventListener("click", () => { reload(); });
    const box = $("bkmRemember");
    if (box) {
      box.checked = rememberOn();
      box.addEventListener("change", () => { try { localStorage.setItem(REMEMBER_KEY, box.checked ? "on" : "off"); } catch (e) { /* this phone only */ } });
    }
  }

  self.ShopperBooksView = Object.freeze({ render, wire, shown: statusLine });
})();
