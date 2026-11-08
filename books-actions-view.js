// remote/books-actions-view.js - v2.0.135 (B-1797, chunk P3): the Books buttons the phone could not send.
//   Ask (booksAsk), audit run + findings + decide, Close a month, COGS confirm / unconfirm, one-off entry, account map,
//   Rebuild / Check / Put back (each behind a confirm), Drive export. Books rules (add / set / loans): renderRules(host, payload),
//   exported for the page shell (remote/books-rules-view.js, builder C).
// Host (index.html, builder C): #bkmActionsHost; app.js calls ShopperBooksActions.render(payload) with the whole projection
// (payload.books = months, payload.pages.{booksAsk,booksAudit,booksCogs,booksRules,booksAccountMap,booksRebuild}).
// Never on the phone: file uploads (learn / fill bench / shadow import / CSV), passwords, keys.
(function () {
  "use strict";
  // ---- shared by the four *-actions-view.js files (identical copy; the first one loaded wins) ----
  function makeAct() {
    const WAIT_MS = 3 * 60 * 1000;
    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = String(text);
      return n;
    }
    function toast(text, isError) {
      const t = document.getElementById("toast");
      if (!t) return;
      t.textContent = text;
      t.hidden = false;
      t.classList.toggle("error", !!isError);
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { t.hidden = true; }, 3500);
    }
    function btn(text, cls, onClick) {
      const b = el("button", "secondary-btn ops-btn" + (cls ? " " + cls : ""), text);
      b.type = "button";
      if (onClick) b.addEventListener("click", onClick);
      return b;
    }
    // The reason a finished command row failed, or "" when it worked.
    function failure(status, row) {
      const res = row && row.result && typeof row.result === "object" ? row.result : null;
      if (status !== "done") return (row && row.reason) || ("the computer said " + status);
      if (res && res.ok === false) return res.error || res.reason || res.message || "the computer said no";
      return "";
    }
    // One labelled button -> optional window.confirm -> one command -> toast. Never two sends for one tap.
    async function run(o) {
      if (o.btn && (o.btn.disabled || o.btn.dataset.busy)) return { ok: false, busy: true };
      if (o.confirm && !window.confirm(o.confirm)) return { ok: false, cancelled: true };
      const R = self.ShopperRemote;
      if (!R) { toast("Not connected.", true); return { ok: false }; }
      let pill = null;
      if (o.btn) {
        o.btn.disabled = true;
        o.btn.dataset.busy = "1";
        pill = el("span", "ops-pill", "Working...");
        pill.setAttribute("role", "status");
        if (o.btn.parentNode) o.btn.parentNode.insertBefore(pill, o.btn.nextSibling);
      }
      let out = { ok: false };
      try {
        const id = await R.sendCommand(o.name, o.payload || {});
        if (!id) { toast("Not sent - check the connection.", true); return out; }
        const status = await Promise.race([R.waitFor(id), new Promise((r) => setTimeout(() => r("timeout"), WAIT_MS))]);
        const row = await R.readCommand(id).catch(() => null);
        const why = failure(status, row);
        const res = row && row.result && typeof row.result === "object" ? row.result : null;
        if (why) toast((o.fail || "Not done") + ": " + String(why).slice(0, 160), true);
        else if (res && res.note === "no direct response") toast("Started on the computer - watch the activity bar.");
        else toast(o.ok || "Done");
        out = { ok: !why, row, result: res, status };
        if (!why && typeof o.done === "function") o.done(res, row);
      } catch (e) {
        toast("Not sent: " + ((e && e.message) || "no connection"), true);
      } finally {
        if (pill) pill.remove();
        if (o.btn) { o.btn.disabled = false; delete o.btn.dataset.busy; }
      }
      return out;
    }
    const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
    const arr = (v) => (Array.isArray(v) ? v : []);
    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    // Don't redraw under a finger: a focused field or a running button holds the redraw.
    const editing = (host) => !!(host && (host.querySelector("[data-busy]") || (host.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))));
    return { el, toast, btn, run, failure, clip, arr, obj, editing };
  }
  if (!document.getElementById("ops-act-css")) {
    const st = document.createElement("style");
    st.id = "ops-act-css";
    st.textContent = ".ops-card{margin:10px 0;padding:8px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px}.ops-card h3{margin:0 0 6px;font-size:15px}.ops-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.ops-line{padding:6px 0;border-top:1px solid color-mix(in srgb,currentColor 15%,transparent);overflow-wrap:anywhere}.ops-pill{font-size:12px;opacity:.8}.ops-btn{min-height:40px}.ops-in{min-height:36px;max-width:100%;box-sizing:border-box}";
    document.head.appendChild(st);
  }
  const A = self.ShopperOpsAct || (self.ShopperOpsAct = makeAct());
  const { el, toast, btn, run, clip, arr, obj, editing } = A;

  Object.assign(typeof REMOTE_LABELS !== "undefined" ? REMOTE_LABELS : {}, {
    booksAsk: "Ask about Books", booksAuditRun: "Run Books audit", booksAuditDecide: "Decide audit finding", booksClose: "Close month",
    booksMailFind: "Find the order in Gmail", booksDupeVoid: "Void duplicate card line", booksCardPayBook: "Book card payment", booksCardGoneVoid: "Void card line (not on Plaid)", booksCogsConfirm: "Confirm COGS", booksCogsUnconfirm: "Unconfirm COGS", booksEntryPost: "Post entry", booksAccountMapSet: "Map account",
    booksRebuildCheck: "Check rebuild", booksRebuildPreview: "Preview rebuild", booksRebuild: "Clean rebuild", booksRebuildPutBack: "Put Books back", booksExportDrive: "Export to Drive",
    booksRulesAdd: "Add rule", booksRulesSet: "Save rules", booksLoanSet: "Save loan", booksLoanRemove: "Remove loan",
  });

  const $ = (id) => document.getElementById(id);
  const DECISIONS = ["accepted", "rejected", "needs-you"];
  const ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
  let sig = "";
  let entryFormId = "";
  let lastCheck = "";
  let lastPreview = null; // Opus review (v2.0.135): the phone's own preview (booksRebuildPreview) - the token the Rebuild sends
  function newFormId() {
    let tail = "";
    for (let i = 0; i < 8; i++) tail += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    return "je-" + Date.now().toString(36) + "-" + tail;
  }
  function card(title, cls) {
    const c = el("section", "ops-card " + (cls || ""));
    c.appendChild(el("h3", "", title));
    return c;
  }
  function field(label, node) {
    const w = el("label", "ops-row");
    w.append(el("span", "muted small", label), node);
    return w;
  }
  function input(type, ph, label, extra) {
    const i = el("input", "ops-in");
    i.type = type;
    if (ph) i.placeholder = ph;
    i.setAttribute("aria-label", label);
    if (extra) for (const k of Object.keys(extra)) i.setAttribute(k, extra[k]);
    return i;
  }
  function select(opts, label) {
    const s = el("select", "ops-in");
    s.setAttribute("aria-label", label);
    for (const o of opts) {
      const v = Array.isArray(o) ? o[0] : o;
      const x = el("option", "", Array.isArray(o) ? o[1] : o);
      x.value = v;
      s.appendChild(x);
    }
    return s;
  }
  const accountsOf = (pages) => arr(obj(pages.booksRules).accounts).slice(0, 60).map((a) => (Array.isArray(a) ? [clip(a[0], 20), clip(a[0], 20) + " " + clip(a[1], 40)] : [clip(a.code, 20), clip(a.code, 20) + " " + clip(a.name, 40)]));
  const monthsOf = (books, pages) => {
    const b = obj(books);
    const set = new Set([...arr(b.monthsOpen), ...arr(b.monthsClosed).slice(-2), ...Object.keys(obj(pages.booksAudit))]);
    return [...set].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  };

  // ---- Ask ----
  function askCard(ba) {
    const a = obj(ba);
    const c = card("Ask about the books", "ops-ask");
    const answers = obj(a.answers);
    const sections = Array.isArray(a.sections) && a.sections.length ? a.sections.map((s) => clip(s, 40)) : Object.keys(answers).length ? Object.keys(answers).slice(0, 12) : ["books"];
    const sec = select(sections, "Section");
    const q = el("textarea", "ops-in ops-ask-q");
    q.rows = 2; q.maxLength = 500; q.placeholder = "Ask a question about this month's books";
    q.setAttribute("aria-label", "Question");
    const go = btn("Ask", "ops-ask-go");
    go.addEventListener("click", () => {
      const text = q.value.trim();
      if (!text) { toast("Type a question first.", true); return; }
      run({ name: "booksAsk", payload: { section: sec.value, question: text.slice(0, 500) }, btn: go, ok: "Asked - the answer shows below when it lands", done: () => { q.value = ""; } });
    });
    c.append(sec, q, go);
    if (a.left != null) c.appendChild(el("p", "muted small", clip(a.left, 6) + " question(s) left today" + (a.cap != null ? " of " + clip(a.cap, 6) : "") + "."));
    const box = el("div", "ops-ask-answers");
    const draw = () => {
      box.textContent = "";
      for (const x of arr(answers[sec.value]).slice(-3).reverse()) {
        const line = el("div", "ops-line");
        line.appendChild(el("div", "muted small", clip(x.question || x.q, 200)));
        line.appendChild(el("div", "", clip(x.text || x.answer || (typeof x === "string" ? x : ""), 1500)));
        box.appendChild(line);
      }
    };
    sec.addEventListener("change", draw);
    draw();
    c.appendChild(box);
    return c;
  }

  // ---- audit ----
  function auditCard(books, pages) {
    const months = monthsOf(books, pages);
    const c = card("Books audit", "ops-audit");
    if (!months.length) { c.appendChild(el("p", "muted small", "No month to audit yet.")); return c; }
    const sel = select(months, "Month");
    const runB = btn("Run the audit", "ops-audit-run");
    runB.addEventListener("click", () => run({ name: "booksAuditRun", payload: { month: sel.value }, confirm: "Run the audit of " + sel.value + "? It calls the audit models.", btn: runB, ok: "Audit started on the computer" }));
    const top = el("div", "ops-row");
    top.append(sel, runB);
    c.appendChild(top);
    const box = el("div", "ops-audit-findings");
    const draw = () => {
      box.textContent = "";
      const st = obj(obj(pages.booksAudit)[sel.value]);
      if (st.running) box.appendChild(el("p", "muted small", "Audit running on the computer..."));
      const fs = arr(st.findings).slice(0, 30);
      if (!fs.length) { box.appendChild(el("p", "muted small", "No findings for " + sel.value + ".")); return; }
      for (const f of fs) {
        const line = el("div", "ops-line ops-finding");
        line.dataset.finding = clip(f.findingId, 120);
        line.appendChild(el("div", "", "[" + clip(f.severity, 20) + "] " + clip(f.title, 120)));
        line.appendChild(el("div", "muted small", clip(f.detail, 300)));
        const row = el("div", "ops-row");
        for (const d of DECISIONS) {
          const b = btn(d === "needs-you" ? "Needs me" : d[0].toUpperCase() + d.slice(1), "ops-decide" + (f.decision === d ? " is-on" : ""));
          b.dataset.decision = d;
          b.setAttribute("aria-pressed", f.decision === d ? "true" : "false");
          b.addEventListener("click", () => run({ name: "booksAuditDecide", payload: { findingId: clip(f.findingId, 120), decision: d }, btn: b, ok: "Saved: " + d }));
          row.appendChild(b);
        }
        line.appendChild(row);
        box.appendChild(line);
      }
    };
    sel.addEventListener("change", draw);
    draw();
    c.appendChild(box);
    return c;
  }

  // ---- close ----
  function closeCard(books) {
    const open = arr(obj(books).monthsOpen).filter((m) => /^\d{4}-\d{2}$/.test(m));
    if (!open.length) return null;
    const c = card("Close a month", "ops-close");
    const sel = select(open, "Month to close");
    const b = btn("Close this month", "ops-close-go");
    b.addEventListener("click", () => run({ name: "booksClose", payload: { month: sel.value }, confirm: "Close " + sel.value + "? Reconcile runs first; a closed month only takes correcting entries.", btn: b, ok: "Closing on the computer" }));
    const r = el("div", "ops-row");
    r.append(sel, b);
    c.appendChild(r);
    return c;
  }

  // ---- COGS confirm ----
  function cogsCard(rows0) {
    const rows = arr(Array.isArray(rows0) ? rows0 : obj(rows0).rows).slice(0, 50);
    if (!rows.length) return null;
    const c = card("COGS to confirm", "ops-bcogs");
    for (const r of rows) {
      const id = clip(r.entryId, 120);
      if (!ID_RE.test(id)) continue;
      const line = el("div", "ops-line ops-bcogs-row");
      line.appendChild(el("div", "", clip(r.title || r.memo || id, 100) + (r.amount != null ? " - " + clip(r.amount, 20) : "")));
      const on = !!r.confirmed;
      const b = btn(on ? "Unconfirm" : "Confirm", on ? "ops-bcogs-un" : "ops-bcogs-do");
      b.addEventListener("click", () => run({ name: on ? "booksCogsUnconfirm" : "booksCogsConfirm", payload: { lines: [id] }, btn: b, ok: on ? "Unconfirmed" : "Confirmed" }));
      line.appendChild(b);
      c.appendChild(line);
    }
    return c;
  }

  // ---- B-1839 (v2.0.139): find the missing order in Gmail ----
  // Up to 10 no-order COGS charges; sends their ids only. Reads Gmail on the laptop, writes nothing.
  const money = (c) => (Number(c) < 0 ? "-" : "") + "$" + (Math.abs(Number(c) || 0) / 100).toFixed(2);
  function findCard(rows0) {
    const rows = arr(rows0).filter((r) => r && ID_RE.test(clip(r.lineId, 120))).slice(0, 10);
    if (!rows.length) return null;
    const c = card("Find the order in Gmail", "ops-bfind");
    c.appendChild(el("div", "muted small", "Charges with no order found. Looks in Gmail only - nothing is booked."));
    const out = el("div", "ops-bfind-out");
    const b = btn("Find for all shown (" + rows.length + ")", "ops-bfind-do");
    b.addEventListener("click", () => run({
      name: "booksMailFind", payload: { lineIds: rows.map((r) => clip(r.lineId, 120)) }, btn: b, ok: "Searched Gmail",
      done: (res) => {
        out.textContent = "";
        const list = arr(obj(res).results);
        if (!list.length) { out.appendChild(el("div", "ops-line", "Nothing came back.")); return; }
        for (const x of list) {
          const line = el("div", "ops-line ops-bfind-row");
          line.appendChild(el("div", "", clip(x.date, 10) + " " + money(x.cents) + (x.retailer ? " - " + clip(x.retailer, 20) : "")));
          const cands = arr(x.candidates);
          // review: a reply shortened for the relay keeps only how many were found (x.found) - never "none found" then.
          if (!cands.length && Number(x.found) > 0) line.appendChild(el("div", "muted small", Number(x.found) + " order number(s) found - the list is on the laptop's Books page (too long for the phone)."));
          else if (!cands.length) line.appendChild(el("div", "muted small", clip(x.note || (arr(x.searches).some((s) => s && s.ok === false) ? "A Gmail search failed." : "No order mail found."), 100)));
          for (const cd of cands) line.appendChild(el("div", "small", "Order " + clip(cd.orderNumber, 40) + (cd.known === false ? " - NOT on the ledger" : cd.known ? " - already on the ledger" : "") + (cd.subject ? " - " + clip(cd.subject, 60) : "")));
          out.appendChild(line);
        }
        if (obj(res).capped) out.appendChild(el("div", "muted small", "Only the first 10 charges were searched."));
      },
    }));
    c.append(b, out);
    return c;
  }

  // ---- one-off entry ----
  function entryCard(pages) {
    const c = card("One-off journal entry", "ops-entry");
    if (!entryFormId) entryFormId = newFormId();
    const accts = accountsOf(pages);
    const date = input("text", "MM/DD/YYYY", "Entry date");
    if (self.ShopperDateInput && self.ShopperDateInput.attach) self.ShopperDateInput.attach(date);
    const amount = input("text", "Amount, e.g. 125.50", "Amount", { inputmode: "decimal" });
    const mk = (label) => { const s = accts.length ? select(accts, label) : input("text", "Account code", label); return s; };
    const debit = mk("Debit account"), credit = mk("Credit account");
    const memo = input("text", "Memo", "Memo", { maxlength: "200" });
    const bank = input("text", "Bank line id (optional)", "Bank line id", { maxlength: "120" });
    c.append(field("Date", date), field("Amount", amount), field("Debit", debit), field("Credit", credit), field("Memo", memo), field("Bank line", bank));
    const go = btn("Post entry", "ops-entry-go");
    go.addEventListener("click", () => {
      const D = self.ShopperDateInput;
      const iso = D && D.readValue ? D.readValue(date.value) : "";
      if (!iso) { toast("Type the date as MM/DD/YYYY.", true); return; }
      const amt = amount.value.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(amt) || Number(amt) <= 0) { toast("Amount: a positive number, no minus.", true); return; }
      const d = debit.value.trim(), k = credit.value.trim();
      if (!d || !k || d === k) { toast("Pick two different accounts.", true); return; }
      const form = { date: iso, memo: memo.value.trim().slice(0, 200), lines: [{ account: d, side: "debit", amount: amt }, { account: k, side: "credit", amount: amt }] };
      run({
        name: "booksEntryPost", payload: { formId: entryFormId, form, bankLineId: bank.value.trim().slice(0, 120) },
        confirm: "Post a journal entry of $" + amt + " (debit " + d + ", credit " + k + ") dated " + iso + "?", btn: go, ok: "Entry posted",
        done: () => { entryFormId = newFormId(); amount.value = ""; memo.value = ""; bank.value = ""; },
      });
    });
    c.appendChild(go);
    return c;
  }

  // ---- account map ----
  function mapCard(am) {
    const rows = arr(Array.isArray(am) ? am : obj(am).rows).slice(0, 30);
    if (!rows.length) return null;
    const c = card("Unmapped bank accounts", "ops-map");
    for (const r of rows) {
      const line = el("div", "ops-line ops-map-row");
      line.appendChild(el("div", "", clip(r.name || r.accountId, 80) + (r.mask ? " ..." + clip(r.mask, 8) : "") + (r.institution ? " · " + clip(r.institution, 40) : "")));
      const code = input("text", "Books account code", "Books account for " + clip(r.name || r.accountId, 40), { maxlength: "20" });
      code.value = clip(r.code, 20);
      const b = btn("Save", "ops-map-save");
      b.addEventListener("click", () => {
        if (!code.value.trim()) { toast("Type the Books account code.", true); return; }
        run({ name: "booksAccountMapSet", payload: { accountId: clip(r.accountId, 120), code: code.value.trim().slice(0, 20), mask: clip(r.mask, 20), name: clip(r.name, 120), institution: clip(r.institution, 120) }, btn: b, ok: "Account mapped" });
      });
      const row = el("div", "ops-row");
      row.append(code, b);
      line.appendChild(row);
      c.appendChild(line);
    }
    return c;
  }

  // ---- rebuild / check / put back ----
  function rebuildCard(rb) {
    const r = obj(rb);
    const c = card("Clean rebuild", "ops-rebuild");
    c.appendChild(el("p", "muted small", "Rewrites a year of the Journal. Each button asks first."));
    const status = el("p", "small ops-rebuild-status", lastCheck || (r.pending ? "A rebuild is pending a check (backup " + clip(obj(r.pending).backup, 60) + ")." : ""));
    const row = el("div", "ops-row");
    const check = btn("Check", "ops-rb-check");
    check.addEventListener("click", () => run({
      name: "booksRebuildCheck", payload: {}, confirm: "Check the Journal against the last rebuild's backup?", btn: check, ok: "Checked",
      done: (res) => { lastCheck = clip(obj(res).text || obj(res).state || "Checked.", 300); status.textContent = lastCheck; },
    }));
    const prev = btn("Preview", "ops-rb-preview");
    prev.addEventListener("click", () => run({
      name: "booksRebuildPreview", payload: {}, btn: prev, ok: "Preview ready",
      done: (res) => {
        const x = obj(res);
        lastPreview = x.token ? { year: x.year, token: String(x.token), months: arr(x.months).map(String) } : null;
        status.textContent = lastPreview ? (lastPreview.months.length ? "Preview: " + lastPreview.months.join(", ") + " would be cleaned." : "Preview: nothing to clean.") : "No preview came back.";
      },
    }));
    const go = btn("Rebuild", "ops-rb-go");
    go.addEventListener("click", () => {
      const pv = obj(lastPreview || r.preview);
      const months = arr(pv.months).map((m) => clip(m, 7)).slice(0, 12);
      if (!pv.token || !months.length) { toast("Press Preview first - the rebuild runs only on what a preview showed.", true); return; }
      run({
        name: "booksRebuild", payload: { year: Number(pv.year) || new Date().getFullYear(), token: String(pv.token), months },
        confirm: "Clean-rebuild " + months.join(", ") + "? It rewrites the Journal (a backup tab is kept).", btn: go, ok: "Rebuild started on the computer",
      });
    });
    const back = btn("Put back", "ops-rb-back");
    back.addEventListener("click", () => run({
      name: "booksRebuildPutBack", payload: {}, confirm: "Put the Journal back from the rebuild's backup tab? Entries made since are lost.", btn: back, ok: "Put-back started on the computer",
    }));
    row.append(check, prev, go, back);
    c.append(row, status);
    return c;
  }

  // ---- export ----
  function exportCard() {
    const c = card("Export", "ops-export");
    const y = new Date().getFullYear();
    const sel = select([String(y), String(y - 1)], "Year");
    const b = btn("Export to Drive", "ops-export-go");
    b.addEventListener("click", () => run({ name: "booksExportDrive", payload: { year: Number(sel.value) }, btn: b, ok: "Exporting to Drive on the computer" }));
    const r = el("div", "ops-row");
    r.append(sel, b);
    c.append(r, el("p", "muted small", "The CSV download is on the computer."));
    return c;
  }

  // ---- Books rules page (shell: books-rules-view.js) ----
  function renderRules(host, payload) {
    if (!host) return;
    const br = obj(obj(obj(payload).pages).booksRules);
    const s = JSON.stringify(br);
    if (host.dataset.sig === s && host.childNodes.length) return;
    if (editing(host)) return;
    host.dataset.sig = s;
    host.textContent = "";
    const accts = accountsOf({ booksRules: br });
    const rules = arr(br.rules).slice(0, 200);
    const add = card("Add a rule", "ops-rule-add");
    const key = input("text", "Vendor / match text", "Rule match text", { maxlength: "120" });
    const acct = accts.length ? select(accts, "Rule account") : input("text", "Account code", "Rule account", { maxlength: "120" });
    const addB = btn("Add rule", "ops-rule-add-go");
    addB.addEventListener("click", () => {
      if (!key.value.trim() || !acct.value.trim()) { toast("Fill the match text and the account.", true); return; }
      run({ name: "booksRulesAdd", payload: { rules: [{ key: key.value.trim().toUpperCase().slice(0, 120), account: acct.value.trim().slice(0, 120), count: 1 }] }, btn: addB, ok: "Rule added", done: () => { key.value = ""; } });
    });
    add.append(field("Match", key), field("Account", acct), addB);
    host.appendChild(add);
    if (rules.length) {
      const set = card("Rules (" + rules.length + ")", "ops-rules");
      const edits = rules.map((r) => ({ r, acct: clip(r.account, 120), off: false }));
      edits.forEach((e) => {
        const line = el("div", "ops-line ops-rule-row");
        line.appendChild(el("div", "", clip(e.r.key, 80) + (e.r.count ? " (" + Number(e.r.count) + ")" : "")));
        const sel = accts.length ? select(accts, "Account for " + clip(e.r.key, 40)) : input("text", "Account", "Account for " + clip(e.r.key, 40));
        sel.value = e.acct;
        sel.addEventListener("change", () => { e.acct = sel.value; });
        const cb = el("input"); cb.type = "checkbox"; cb.setAttribute("aria-label", "Switch off " + clip(e.r.key, 40));
        cb.addEventListener("change", () => { e.off = cb.checked; });
        const r2 = el("div", "ops-row");
        r2.append(sel, cb, el("span", "muted small", "off"));
        line.appendChild(r2);
        set.appendChild(line);
      });
      const save = btn("Save rule changes", "ops-rules-save");
      save.addEventListener("click", () => {
        // Opus review (v2.0.135): SHOPPER_BOOKS_RULES_SET switches off every rule missing from its list and needs each rule's own
        // columns - so every rule is sent whole (a switched-off one as active:false), and never from a cut / column-less list.
        if (Number(br.total) > rules.length || rules.some((r) => !r.ruleId || !r.matchField || !r.pattern)) { toast("Change the whole rules list on the computer (Books > Rules) - the phone's copy is not complete.", true); return; }
        const out = edits.map((e) => ({ ruleId: clip(e.r.ruleId, 80), matchField: clip(e.r.matchField, 40), pattern: String(e.r.pattern).slice(0, 500), account: clip(e.acct || e.r.account, 120), priority: e.r.priority === "" || e.r.priority == null ? "" : Number(e.r.priority), active: e.r.active !== false && !e.off, note: String(e.r.note == null ? "" : e.r.note).slice(0, 200) }));
        if (!out.some((o) => o.active)) { toast("That would switch every rule off.", true); return; }
        run({ name: "booksRulesSet", payload: { rules: out.slice(0, 200) }, confirm: "Replace the Rules tab with these " + out.length + " rule(s)? Rules you switched off go inactive.", btn: save, ok: "Rules saved" });
      });
      set.appendChild(save);
      host.appendChild(set);
    }
    // loans
    const loans = arr(br.loans).slice(0, 20);
    const lc = card("Loans", "ops-loans");
    const form = { id: "" };
    const lender = input("text", "Lender", "Lender", { maxlength: "60" });
    const start = input("text", "MM/DD/YYYY", "Loan start date");
    if (self.ShopperDateInput && self.ShopperDateInput.attach) self.ShopperDateInput.attach(start);
    const principal = input("text", "Starting balance", "Principal", { inputmode: "decimal" });
    const rate = input("text", "Annual rate % (or leave empty)", "Rate", { inputmode: "decimal" });
    const pay = input("text", "Payment", "Payment", { inputmode: "decimal" });
    const freq = select(["weekly", "biweekly", "monthly", "daily"], "Frequency");
    const term = input("text", "Term (payments)", "Term", { inputmode: "numeric" });
    const account = accts.length ? select(accts, "Loan account") : input("text", "Loan account", "Loan account");
    const note = input("text", "Note", "Note", { maxlength: "200" });
    for (const loan of loans) {
      const line = el("div", "ops-line ops-loan-row");
      line.appendChild(el("div", "", clip(loan.name || loan.lender || loan.id, 80) + " · " + clip(loan.account, 20)));
      const row = el("div", "ops-row");
      const edit = btn("Edit", "ops-loan-edit");
      edit.addEventListener("click", () => {
        form.id = clip(loan.id, 120);
        lender.value = clip(loan.lender || loan.name, 60);
        const D = self.ShopperDateInput;
        start.value = D && D.isoToTyped ? D.isoToTyped(clip(loan.start, 10)) : clip(loan.start, 10);
        principal.value = loan.principal != null ? String(Number(loan.principal) / 100) : "";
        rate.value = loan.ratePct != null ? String(loan.ratePct) : "";
        pay.value = loan.payment != null ? String(Number(loan.payment) / 100) : "";
        if (loan.frequency) freq.value = loan.frequency;
        term.value = loan.term != null ? String(loan.term) : "";
        if (loan.account) account.value = clip(loan.account, 20);
        note.value = clip(loan.note, 200);
        lender.focus();
      });
      const rm = btn("Remove", "ops-loan-rm");
      rm.addEventListener("click", () => run({ name: "booksLoanRemove", payload: { id: clip(loan.id, 120) }, confirm: "Remove this loan from Books?", btn: rm, ok: "Loan removed" }));
      row.append(edit, rm);
      line.appendChild(row);
      lc.appendChild(line);
    }
    lc.append(field("Lender", lender), field("Start", start), field("Principal", principal), field("Rate %", rate), field("Payment", pay), field("Frequency", freq), field("Term", term), field("Account", account), field("Note", note));
    const saveL = btn("Save loan", "ops-loan-save");
    saveL.addEventListener("click", () => {
      const D = self.ShopperDateInput;
      const iso = D && D.readValue ? D.readValue(start.value) : "";
      if (!iso) { toast("Type the start date as MM/DD/YYYY.", true); return; }
      if (!(Number(principal.value) > 0)) { toast("Type the starting balance.", true); return; }
      const loan = { lender: lender.value.trim() || "Kapitus", start: iso, principal: principal.value.trim(), ratePct: rate.value.trim(), payment: pay.value.trim(), frequency: freq.value, term: term.value.trim(), account: account.value.trim(), note: note.value.trim() };
      if (form.id) loan.id = form.id;
      run({ name: "booksLoanSet", payload: { loan }, btn: saveL, ok: "Loan saved" });
    });
    lc.appendChild(saveL);
    host.appendChild(lc);
  }

  function render(p) {
    const payload = obj(p), pages = obj(payload.pages), books = obj(payload.books);
    const rulesHost = $("booksRulesActionsHost");
    if (rulesHost) renderRules(rulesHost, payload);
    const host = $("bkmActionsHost");
    if (!host) return;
    const s = JSON.stringify([books.monthsOpen, books.monthsClosed, pages.booksAsk, pages.booksAudit, pages.booksCogs, books.cogsNoOrder, pages.booksAccountMap, pages.booksRebuild, accountsOf(pages)]);
    if (s === sig && host.childNodes.length) return;
    if (editing(host)) return;
    sig = s;
    host.textContent = "";
    for (const c of [askCard(pages.booksAsk), auditCard(books, pages), closeCard(books), cogsCard(pages.booksCogs), findCard(books.cogsNoOrder), entryCard(pages), mapCard(pages.booksAccountMap), rebuildCard(pages.booksRebuild), exportCard()]) if (c) host.appendChild(c);
  }

  self.ShopperBooksActions = Object.freeze({ render, renderRules, askCard, auditCard, closeCard, cogsCard, findCard, entryCard, mapCard, rebuildCard, exportCard });
})();
