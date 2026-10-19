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
    host.append(tile("audit", "Audit findings open", String(data.auditOpen || 0), data.auditOpen ? "decide them on the laptop's Audit page" : "none waiting"));
  }

  // ---- Needs you ----
  function noteFor(key) {
    const n = notes[key];
    if (!n) return null;
    if (n.phase !== "sending" && Date.now() - n.at > NOTE_MS) { delete notes[key]; return null; }
    return n;
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
    } else {
      const box = el("div", "bkm-pick");
      const sel = el("select", "bkm-select");
      sel.setAttribute("aria-label", `Account for ${r.text}`);
      // The account it sits on now (6900) is left out of the list - the pick is a move.
      const blank = el("option", null, "Pick an account");
      blank.value = "";
      sel.append(blank);
      for (const a of data.accounts || []) {
        if (String(a[0]) === String(r.account)) continue;
        const o = el("option", null, `${a[0]} ${a[1]}`);
        o.value = String(a[0]);
        sel.append(o);
      }
      sel.value = picked[r.key] || "";
      const btn = el("button", "primary-btn bkm-book", picked[r.key] ? `Book to ${picked[r.key]}` : "Book it");
      btn.type = "button";
      btn.disabled = !picked[r.key] || !!sending;
      sel.disabled = !!sending;
      sel.addEventListener("change", () => {
        picked[r.key] = sel.value;
        btn.disabled = !sel.value || !!sending;
        btn.textContent = sel.value ? `Book to ${sel.value}` : "Book it";
      });
      btn.addEventListener("click", () => { if (picked[r.key]) pick(r, picked[r.key]); });
      box.append(sel, btn);
      li.append(box);
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

  function render(books) {
    data = books && typeof books === "object" ? books : null;
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
    notes[r.key] = { phase: "sending", text: `Booking to ${code}...`, at: Date.now() };
    redraw();
    let id = null;
    try {
      id = await R.sendCommand("booksLineSet", { lineId: r.lineId, entryId: r.entryId || "", sourceTab: r.sourceTab || "", month: r.month || "", account: code, remember: rememberOn() && (!r.sourceTab || r.sourceTab === "Bank Lines") });
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
    if (status === "done") {
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

  function wire() {
    const box = $("bkmRemember");
    if (box) {
      box.checked = rememberOn();
      box.addEventListener("change", () => { try { localStorage.setItem(REMEMBER_KEY, box.checked ? "on" : "off"); } catch (e) { /* this phone only */ } });
    }
  }

  self.ShopperBooksView = Object.freeze({ render, wire, shown: statusLine });
})();
