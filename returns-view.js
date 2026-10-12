// remote/returns-view.js - B-1071 (v2.0.54). Process returns on the phone's Ship tab.
//
// The laptop's Pipeline "Process returns" (B-1070) from the couch: a "Process
// returns" button at the top of the Ship tab opens a sheet that
//   1. asks the laptop for the open ScanPower batches (returnsLookup, reads only),
//   2. on a pick, asks for that batch's preview (returnsLookup {batchId}): every
//      ASIN, its title and the units that will post - only the units not posted
//      yet when the batch grew after an earlier post (B-1072), and the products
//      that shrank (nothing is posted for those),
//   3. Post -> returnsPost {batchId, destination, sig}: the LAPTOP re-reads the
//      batch and the ledger itself, refuses when anything moved since this
//      preview, and posts through the same writer as the laptop page
//      ("FBA Returns <batch name>", idempotent); the result line shows here.
//
// Owns no rules: everything is decided on the laptop
// (background/returns-batch-handlers.js, lib/returns-batch.js).
//
// The laptop must be there - the same rule as Manual Print (B-1057): a laptop
// that has gone quiet gets NOTHING sent ("The laptop isn't connected - ..."),
// the laptop refuses a command older than 50 s (lib/remote-protocol.js
// maxAgeMs) and the phone takes back one still not picked up at 60 s
// (ShopperRemote.cancelPending) - so a post the phone called "not run" can
// never run later. The command loop is remote/manual-print-view.js
// runCommand (one copy).
//
// v2.0.54 review: returns-named batches come first and are marked "Returns
// batch"; any other batch can still be picked, but its preview warns and Post
// needs a second press ("Yes, post N unit(s) anyway" -> confirmNotReturns).
// After a post with no answer (timeout / "no direct response") Post stays OFF
// until the batch is read again (Back -> Pick): the first post may still land.
//
// Classic script: sets self.ShopperReturnsView and draws its button into
// #returnsHost (index.html, the Ship tab) on load. Built with textContent only.
(function (root) {
  "use strict";

  const OFFLINE_READ = "The laptop isn't connected - the returns batches can't be read now.";
  const OFFLINE_POST = "The laptop isn't connected - nothing was posted.";

  let cur = null; // the open sheet

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  const remote = () => root.ShopperRemote || null;
  const mp = () => root.ShopperManualPrint || null;
  function online() {
    const R = remote();
    return !!(R && typeof R.laptopOnline === "function" && R.laptopOnline());
  }
  // The laptop refused it as too old: it was not connected when the phone sent it.
  const tooLate = (o) => o.status === "rejected" && /was not connected/.test(String(o.reason || ""));
  async function run(name, payload) {
    const M = mp();
    if (!M || typeof M.runCommand !== "function") return { status: "not sent" };
    return M.runCommand(name, payload);
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US") : String(v == null ? "" : v));
  const shelf = (w) => (w === "prep" ? "Prep" : "House");

  // A read's outcome -> { res } | { text }.
  function lookupOutcome(out) {
    const o = out || {};
    const res = o.result && typeof o.result === "object" ? o.result : null;
    if (o.status === "offline" || tooLate(o)) return { text: OFFLINE_READ };
    if (o.status === "not sent") return { text: "The request did not reach the laptop." };
    if (o.status === "timeout") return { text: "The laptop did not answer in 3 minutes." };
    if (res && res.truncated) return { text: "The laptop answered, but its answer was too long to show - use the laptop's Pipeline page." };
    if (res && res.note === "no direct response") return { text: "ScanPower took too long - try again." };
    if (o.status === "done" && res && res.ok) return { res };
    if (res && res.error) return { text: "Could not read ScanPower: " + res.error + (res.loginRequired ? " - sign in at unity.scanpower.com on the laptop and try again." : "") };
    if (o.status === "rejected") return { text: "The laptop refused it" + (o.reason ? " - " + o.reason : "") + "." };
    return { text: "Could not read ScanPower: " + (o.reason || "no answer") + "." };
  }

  const RECHECK = " Post stays off until you pick the batch again (a fresh read).";
  // A post's outcome -> { text, tone: "ok" | "bad" | "", changed, blocked, needsConfirm }.
  // blocked = the post may still land: Post stays off until a fresh lookup.
  function postOutcome(out) {
    const o = out || {};
    const res = o.result && typeof o.result === "object" ? o.result : null;
    if (o.status === "offline" || tooLate(o)) return { text: OFFLINE_POST, tone: "bad" };
    if (o.status === "not sent") return { text: "The post did not reach the laptop, so nothing was posted.", tone: "bad" };
    if (o.status === "timeout") return { text: "The laptop did not answer in 3 minutes - check the laptop's Pipeline page before trying again." + RECHECK, tone: "bad", blocked: true };
    if (res && res.truncated) return { text: "The laptop answered, but its answer was too long to show - check the laptop's Pipeline page before trying again." + RECHECK, tone: "", blocked: true };
    if (res && res.note === "no direct response") return { text: "The laptop has not finished after 30 s - check the laptop's Pipeline page before trying again." + RECHECK, tone: "", blocked: true };
    if (res && res.changed) return { text: res.error || "The batch changed since the preview - nothing was posted.", tone: "bad", changed: true };
    if (res && res.needsConfirm) return { text: res.error || "This doesn't look like a returns batch - nothing was posted.", tone: "bad", needsConfirm: true };
    if (res && res.ok && typeof res.line === "string" && res.line) return { text: res.line, tone: "ok" };
    if (res && res.error) return { text: "Not posted: " + res.error, tone: "bad" };
    if (o.status === "rejected") return { text: "Not posted: the laptop refused it" + (o.reason ? " - " + o.reason : "") + ".", tone: "bad" };
    return { text: "Not posted: " + (o.reason || "the laptop said no") + ".", tone: "bad" };
  }

  function close() {
    const m = cur;
    if (!m || m.busy) return;
    m.overlay.remove();
    document.removeEventListener("keydown", m.onKey);
    cur = null;
  }

  function open() {
    if (cur) { cur.busy = false; close(); }
    const overlay = el("div", "rc-overlay rtn-overlay");
    const card = el("div", "rc-card rtn-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Process returns");
    const head = el("div", "rc-head");
    const heads = el("div", "rc-heads");
    const kicker = el("div", "rtn-kicker", "Process returns");
    const title = el("div", "rc-title rtn-title", "Pick the ScanPower batch");
    const sub = el("div", "rc-asin rtn-sub", "");
    heads.append(kicker, title, sub);
    const x = el("button", "rc-x rtn-x", "✕");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    head.append(heads, x);
    const note = el("div", "rtn-note", "Units that came back from Amazon and are going out again go back on the shelf. Build the batch in ScanPower first; the laptop reads it.");
    const status = el("div", "rc-msg rtn-status");
    const retry = el("button", "rc-btn rtn-retry", "Try again");
    retry.type = "button";
    retry.hidden = true;
    const body = el("div", "rtn-body");
    const foot = el("div", "rc-foot rtn-foot");
    const result = el("div", "rc-msg rtn-result");
    card.append(head, note, status, retry, body, foot, result);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const m = { overlay, card, busy: false, onKey: null, view: "list", batch: null, preview: null, where: "house", ready: null, armed: false, postBlocked: false };
    cur = m;
    const say = (box, text, tone) => { box.textContent = text || ""; box.className = box.className.replace(/\s*rc-msg-(ok|bad)/g, "") + (tone ? " rc-msg-" + tone : ""); };
    const button = (label, cls, onClick) => { const b = el("button", "rc-btn " + (cls || ""), label); b.type = "button"; b.addEventListener("click", onClick); return b; };
    // While the laptop works every button waits (Close too - closing would hide the answer).
    const lock = () => {
      for (const b of card.querySelectorAll("button")) b.disabled = m.busy;
      const go = card.querySelector(".rtn-post");
      if (go && !m.busy && (!(m.preview && m.preview.products) || m.postBlocked)) go.disabled = true;
    };

    // 1. The open batches.
    const showList = (res) => {
      m.view = "list";
      m.batch = null;
      m.preview = null;
      title.textContent = "Pick the ScanPower batch";
      sub.textContent = "";
      body.textContent = "";
      foot.textContent = "";
      const list = (res && res.batches) || [];
      if (!list.length) { say(status, "ScanPower shows no open batch (steps 1-3). Build the returns batch there first.", ""); }
      else say(status, "", "");
      const ul = el("div", "rtn-list");
      // A row per batch: its name and facts as words (readable in Retro), one Pick button.
      for (const b of list) {
        const row = el("div", "rtn-batch");
        row.dataset.batch = b.batchId;
        const words = el("div", "rtn-batch-words");
        if (b.returns) row.classList.add("rtn-batch-returns");
        words.append(el("div", "rtn-batch-name", b.name || b.batchId), el("div", "rtn-batch-meta", (b.returns ? "Returns batch · " : "") + "Step " + b.step + " · " + shelf(b.where) + " · " + num(b.units) + " unit(s)"));
        const go = button("Pick", "rtn-pick", () => { m.ready = pick(b); });
        go.setAttribute("aria-label", "Pick " + (b.name || b.batchId));
        row.append(words, go);
        ul.appendChild(row);
      }
      if (res && res.more) ul.appendChild(el("div", "rtn-more", "and " + res.more + " more - use the laptop for those."));
      body.appendChild(ul);
      foot.appendChild(button("Close", "rc-quiet rtn-close", close));
    };

    const loadList = async () => {
      retry.hidden = true;
      say(result, "", "");
      if (!online()) { say(status, OFFLINE_READ, "bad"); retry.hidden = false; retry.onclick = () => { m.ready = loadList(); }; body.textContent = ""; return; }
      say(status, "Asking the laptop for the open ScanPower batches…", "");
      const out = await run("returnsLookup", {});
      if (cur !== m) return;
      const got = lookupOutcome(out);
      if (got.res) { showList(got.res); return; }
      say(status, got.text, "bad");
      retry.hidden = false;
      retry.onclick = () => { m.ready = loadList(); };
    };

    // 2. One batch's preview.
    const showPreview = (p) => {
      m.view = "preview";
      m.preview = p;
      m.armed = false;
      m.postBlocked = false; // a fresh read: Post may go again
      m.where = (p.batch && p.batch.where) === "prep" ? "prep" : "house";
      title.textContent = (p.batch && p.batch.name) || "Returns batch";
      sub.textContent = p.orderNumber || "";
      body.textContent = "";
      foot.textContent = "";
      say(status, p.products ? p.products + " product(s), " + num(p.newUnits) + " unit(s) to put back." : "Nothing new to post - every unit in this batch is already on the shelf.", p.products ? "" : "ok");
      const lines = el("div", "rtn-lines");
      for (const l of p.lines || []) {
        const row = el("div", "rtn-line" + (l.units > 0 ? "" : " rtn-line-done"));
        const words = el("div", "rtn-line-words");
        words.append(el("div", "rtn-line-title", l.title || l.asin), el("div", "rtn-line-meta", l.asin + (l.posted ? " · " + num(l.posted) + " posted before · " + num(l.inBatch) + " in the batch" : "")));
        row.append(words, el("div", "rtn-line-units", l.units > 0 ? "+" + num(l.units) : "0"));
        lines.appendChild(row);
      }
      if (p.more) lines.appendChild(el("div", "rtn-more", "and " + p.more + " more product(s) - all of them post."));
      body.appendChild(lines);
      if (p.alreadyPosted > 0) body.appendChild(el("div", "rtn-note rtn-already", num(p.alreadyPosted) + " unit(s) of this batch were posted before. Only the units added since then post - nothing is posted twice."));
      if (p.shrankCount) {
        body.appendChild(el("div", "rc-msg rc-msg-bad rtn-shrank", p.shrankCount + " product(s) have fewer units in the batch than were already posted: " + (p.shrank || []).map((s) => (s.title || s.asin) + " (posted " + num(s.posted) + ", now " + num(s.inBatch) + ")").join(", ") + ". Nothing is taken back and nothing negative is posted."));
      }
      if (p.skipped) body.appendChild(el("div", "rc-msg rc-msg-bad rtn-skipped", p.skipped + " item(s) in the batch have no ASIN and are not posted."));
      // v2.0.54 review: the guards.
      if (p.products && p.looksReturns === false) body.appendChild(el("div", "rc-msg rc-msg-bad rtn-notreturns", (p.warning || "This doesn't look like a returns batch.") + " Press Post, then confirm."));
      if (p.stockWarning) body.appendChild(el("div", "rc-msg rc-msg-bad rtn-stock", p.stockWarning));
      if (p.ignoredPaste) body.appendChild(el("div", "rc-msg rc-msg-bad rtn-ignored", p.ignoredPaste));
      const whereWrap = el("label", "rtn-where");
      const where = el("select", "rc-input rtn-where-pick");
      for (const w of ["house", "prep"]) { const o = el("option", "", w === "prep" ? "Prep centre" : "House"); o.value = w; where.appendChild(o); }
      where.value = m.where;
      where.addEventListener("change", () => { m.where = where.value === "prep" ? "prep" : "house"; });
      whereWrap.append(el("span", "rtn-lab", "Shelf"), where);
      if (p.products) body.appendChild(whereWrap);
      const go = button(p.products ? "Put " + num(p.newUnits) + " unit(s) back on the shelf" : "Nothing to post", "rc-primary rtn-post", () => { m.ready = doPost(); });
      go.disabled = !p.products;
      foot.append(go, button("Back", "rc-quiet rtn-back", () => { m.ready = loadList(); }));
    };

    const pick = async (b) => {
      if (m.busy) return;
      m.batch = b;
      say(result, "", "");
      if (!online()) { say(status, OFFLINE_READ, "bad"); return; }
      m.busy = true;
      lock();
      say(status, "Asking the laptop to read " + (b.name || b.batchId) + " from ScanPower…", "");
      const out = await run("returnsLookup", { batchId: b.batchId });
      m.busy = false;
      if (cur !== m) return;
      lock();
      const got = lookupOutcome(out);
      if (got.res) { showPreview(got.res); return; }
      say(status, got.text, "bad");
    };

    // 3. Post.
    const doPost = async () => {
      const p = m.preview;
      if (!p || m.busy || !p.products || m.postBlocked) return;
      const needsConfirm = p.looksReturns === false;
      if (needsConfirm && !m.armed) {
        // The first press only arms: the second, explicit press posts.
        m.armed = true;
        const go = card.querySelector(".rtn-post");
        if (go) go.textContent = "Yes, post " + num(p.newUnits) + " unit(s) anyway";
        say(result, (p.warning || "This doesn't look like a returns batch.") + " Press again to post it anyway.", "bad");
        return;
      }
      say(result, "", "");
      if (!online()) { say(result, OFFLINE_POST, "bad"); return; }
      m.busy = true;
      lock();
      say(result, "Asking the laptop to post…", "");
      const payload = { batchId: p.batch.batchId, destination: m.where, sig: p.sig };
      if (needsConfirm && m.armed) payload.confirmNotReturns = true;
      const out = await run("returnsPost", payload);
      m.busy = false;
      if (cur !== m) return;
      const shown = postOutcome(out);
      if (shown.blocked) m.postBlocked = true;
      lock();
      if (shown.changed) {
        // The batch moved since this preview: read it again - nothing posted.
        await pick(m.batch);
        if (cur !== m) return;
        say(result, shown.text, "bad");
        return;
      }
      if (shown.needsConfirm) {
        m.armed = false;
        const go = card.querySelector(".rtn-post");
        if (go) go.textContent = "Put " + num(p.newUnits) + " unit(s) back on the shelf";
      }
      say(result, shown.text, shown.tone);
      if (shown.tone === "ok") {
        const go = card.querySelector(".rtn-post");
        if (go) { go.disabled = true; go.textContent = "Posted"; }
      }
    };

    m.onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", m.onKey);
    x.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    m.ready = loadList();
    return m;
  }

  // The Ship tab's entry: one button above the wizard.
  function mount(host) {
    if (!host || host.__rtn) return;
    host.__rtn = true;
    const wrap = el("div", "rtn-entry");
    const b = el("button", "rc-btn rtn-open", "Process returns");
    b.type = "button";
    b.addEventListener("click", () => open());
    wrap.append(b, el("div", "rtn-entry-note", "Put a ScanPower returns batch back on the shelf."));
    host.appendChild(wrap);
  }

  root.ShopperReturnsView = Object.freeze({ open, close, mount, lookupOutcome, postOutcome, OFFLINE_READ, OFFLINE_POST, _current: () => cur });
  if (typeof document !== "undefined" && document.getElementById) mount(document.getElementById("returnsHost"));
})(typeof self !== "undefined" ? self : globalThis);
