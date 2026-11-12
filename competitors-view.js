// remote/competitors-view.js - B-2043 (v2.0.154): Competitor ASINs (Sourcing) on the phone. Rows come from payload.pages.competitors (the laptop page's own
// SHOPPER_COMP_GET, thinned: 100 rows a list). Writes (each one laptop handler): compSeen {asins}, compSeenAll {seller | all:true}, compUnseen {asins}, compTrack {seller, action}.
// The filter numbers are read-only here - "change on the desktop" (Zach 11/11). DOM API, textContent only.
(function (root) {
  "use strict";
  var P = root.ShopperPhonePages;
  var doc = root.document;
  var pane = doc.getElementById("competitorsPane");
  if (!P || !pane) return;
  var U = P.ui;
  if (typeof REMOTE_LABELS !== "undefined") Object.assign(REMOTE_LABELS, { compSeen: "Competitors: tick off", compSeenAll: "Competitors: mark all seen", compUnseen: "Competitors: take the seen mark off", compTrack: "Competitors: pin / drop / add" });

  var data = null;
  var tab = "candidates";
  var pick = "";
  var sig = "";
  var f = {};

  function money(v) { return v == null ? "-" : "$" + Number(v).toFixed(2); }
  function nz(v) { return v == null ? "-" : String(v); }
  function label(id) { var s = data && (data.sellers || []).filter(function (x) { return x.id === id; })[0]; return s && s.name ? s.name : id; }
  function link(text, href) { var a = U.el("a", "", text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }

  function row(it, showSeen) {
    var r = U.el("div", "line pg-cp-row" + (it.seen ? " pg-cp-seen" : ""));
    var main = U.el("div", "pg-cp-main");
    var t = U.el("div", "");
    if (it.score != null) t.appendChild(U.el("b", "pg-cp-score", it.score + " "));
    var stores = Math.max(Number(it.stores) || 0, (it.sellers || []).length);
    if (stores >= 2) t.appendChild(U.el("b", "pg-cp-multi", "In " + stores + " storefronts "));
    t.appendChild(doc.createTextNode(String(it.title || it.asin)));
    main.appendChild(t);
    main.appendChild(U.el("div", "muted small", [it.asin, "rank " + nz(it.rank), money(it.price), "sold/mo " + nz(it.sold), "offers " + nz(it.offers), it.amazon ? "Amazon on listing" : "", "first seen " + it.firstSeen, "from " + (it.sellers || []).map(label).join(", ")].filter(Boolean).join(" · ")));
    if (it.verdict === "filtered") main.appendChild(U.el("div", "small pg-cp-why", "Filtered: " + it.reason));
    var links = U.el("div", "pg-cp-links small");
    links.appendChild(link("A", "https://www.amazon.com/dp/" + it.asin));
    links.appendChild(link("K", "https://keepa.com/#!product/1-" + it.asin));
    links.appendChild(link("G", "https://www.google.com/search?q=" + encodeURIComponent(String(it.title || it.asin).slice(0, 120))));
    main.appendChild(links);
    r.appendChild(main);
    if (showSeen && !it.seen) {
      var b = U.btn("✓ Seen", "mini-btn", function () { U.send("compSeen", { asins: [it.asin] }, b).then(function (res) { U.say(res, "Marked seen"); }); });
      r.appendChild(b);
    } else if (it.seen) {
      var u = U.btn("Undo", "mini-btn", function () { U.send("compUnseen", { asins: [it.asin] }, u).then(function (res) { U.say(res, "Back to not seen"); }); });
      r.appendChild(u);
    }
    return r;
  }
  function list(title, items, showSeen, empty) {
    var s = U.section(title + " (" + items.length + ")");
    if (!items.length) s.appendChild(U.el("p", "muted small", empty));
    items.forEach(function (it) { s.appendChild(row(it, showSeen)); });
    return s;
  }

  function filtersBox() {
    var fl = data.filters || { rows: [] };
    var s = U.section("Filters");
    s.appendChild(U.el("p", "muted small", (fl.learned ? "Learned from " + fl.winnersUsed + " of your winners." : "Using defaults - not enough sales history yet.") + " To change a number, change it on the desktop."));
    (fl.rows || []).forEach(function (r) { s.appendChild(U.el("div", "pg-kv small", r.label + ": " + nz(r.value) + (r.yours != null ? " (yours; learned " + nz(r.learned) + ")" : " (learned)"))); });
    s.appendChild(U.el("div", "pg-kv small", "Amazon on the listing: " + (fl.amazonOk ? "allowed" : "filtered out")));
    return s;
  }

  function sellersTab() {
    var out = doc.createDocumentFragment();
    var s = U.section("Sellers (" + (data.sellers || []).length + ")");
    (data.sellers || []).forEach(function (r) {
      var c = U.el("div", "pg-card");
      var tracked = r.state === "dropped" ? "dropped" : r.tracked === "pinned" ? "pinned" : r.tracked === "added" ? "added by you" : r.tracked === "auto" ? "tracked (auto)" : "not tracked";
      c.appendChild(U.el("b", "", r.name || r.id));
      c.appendChild(U.el("div", "muted small", [r.name ? r.id : "", r.overlapPct + "% overlap", r.asins + " ASINs shared", r.fbaAsins + " FBA / " + r.fbmAsins + " FBM", r.bbDays + " Buy Box days", tracked, (r.unseenCandidates || 0) + " new to look at", (r.unseen != null ? r.unseen : r.unseenCandidates || 0) + " not seen yet"].filter(Boolean).join(" · ")));
      var acts = U.el("div", "pg-row");
      if ((r.unseen != null ? r.unseen : r.unseenCandidates) > 0) { var m = U.btn("Mark all seen", "mini-btn", function () { U.send("compSeenAll", { seller: r.id }, m).then(function (res) { U.say(res, "Marked seen"); }); }); acts.appendChild(m); }
      if (r.state !== "pinned") { var p = U.btn("Pin", "mini-btn", function () { U.send("compTrack", { seller: r.id, action: "pin" }, p).then(function (res) { U.say(res, "Pinned"); }); }); acts.appendChild(p); }
      if (r.state !== "dropped") { var d = U.btn("Drop", "danger-btn", function () { U.confirmSend("Stop tracking " + (r.name || r.id) + "?", "compTrack", { seller: r.id, action: "drop" }, d, "Dropped"); }); acts.appendChild(d); }
      if (r.state) { var cl = U.btn("Back to auto", "mini-btn", function () { U.send("compTrack", { seller: r.id, action: "clear" }, cl).then(function (res) { U.say(res, "Back to auto"); }); }); acts.appendChild(cl); }
      c.appendChild(acts);
      s.appendChild(c);
    });
    if (!(data.sellers || []).length) s.appendChild(U.el("p", "muted small", "No sellers ranked yet - the first read has to finish on the computer."));
    out.appendChild(s);
    var add = U.section("Add a seller");
    f.add = U.input("text", { placeholder: "Seller id (starts with A) or storefront link", autocapitalize: "characters" });
    add.appendChild(U.field("Seller", f.add));
    var ab = U.btn("Add seller", "primary-btn", function () {
      var v = f.add.value.trim();
      if (!v) { U.toast("Type the seller id or paste the link.", true); return; }
      U.send("compTrack", { seller: v, action: "add" }, ab).then(function (res) { U.say(res, "Added"); if (res.ok) f.add.value = ""; });
    });
    add.appendChild(ab);
    out.appendChild(add);
    out.appendChild(filtersBox());
    return out;
  }

  function allTab() {
    var out = doc.createDocumentFragment();
    var s = U.section("Everything added (" + (data.counts ? data.counts.all + " not seen" : (data.all || []).length) + ")");
    var ids = [];
    (data.all || []).forEach(function (x) { (x.sellers || []).forEach(function (i) { if (ids.indexOf(i) < 0) ids.push(i); }); });
    var sel = U.select([["", "All sellers"]].concat(ids.map(function (i) { return [i, label(i)]; })));
    sel.value = pick;
    sel.addEventListener("change", function () { pick = sel.value; draw(); });
    s.appendChild(sel);
    var rowsFor = (data.all || []).filter(function (x) { return !pick || (x.sellers || []).indexOf(pick) >= 0; });
    var unseenHere = rowsFor.filter(function (x) { return !x.seen; }).length;
    var bulk = U.el("div", "pg-row");
    if (pick && unseenHere) { var m = U.btn("Mark all seen (" + unseenHere + ")", "mini-btn", function () { U.send("compSeenAll", { seller: pick }, m).then(function (res) { U.say(res, "Marked seen"); }); }); bulk.appendChild(m); }
    var everything = data.counts ? data.counts.all : (data.all || []).filter(function (x) { return !x.seen; }).length;
    if (everything) { var ev = U.btn("Mark everything seen (" + everything + ")", "mini-btn", function () { U.confirmSend("Mark all " + everything + " as seen?", "compSeenAll", { all: true }, ev, "Marked seen"); }); bulk.appendChild(ev); }
    s.appendChild(bulk);
    var rows = rowsFor;
    rows.forEach(function (it) { s.appendChild(row(it, true)); });
    if (!rows.length) s.appendChild(U.el("p", "muted small", "Nothing here yet."));
    out.appendChild(s);
    return out;
  }

  function draw() {
    pane.textContent = "";
    if (!data) { pane.appendChild(U.el("p", "muted small pg-sec", "Competitor ASINs load from the computer...")); return; }
    var st = data.status || {};
    var head = U.section("");
    var pg = st.running ? (st.progress || { label: "Working…", pct: 0, counts: "", left: "" }) : null;
    if (pg) {
      var box = U.el("div", "pg-cp-prog");
      box.appendChild(U.el("div", "pg-cp-prog-step small", pg.label || "Working…"));
      var track = U.el("div", "pg-cp-prog-track"); track.setAttribute("role", "progressbar"); track.setAttribute("aria-valuenow", String(pg.pct || 0));
      var fill = U.el("div", "pg-cp-prog-fill"); fill.style.width = (pg.pct || 0) + "%";
      track.appendChild(fill); box.appendChild(track);
      box.appendChild(U.el("div", "muted small", [pg.counts, pg.left].filter(Boolean).join(" · ")));
      head.appendChild(box);
    }
    head.appendChild(U.el("p", "muted small", "Last read " + (st.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : "never") + " · " + (st.tokensToday || 0) + " of " + (st.cap || 0) + " Keepa tokens used today"));
    if (st.role403) head.appendChild(U.el("p", "small pg-cp-why", "Amazon refused the daily offer read - the SP-API app needs the Pricing role."));
    var tabs = U.el("div", "pg-row");
    [["candidates", "Candidates"], ["sellers", "Sellers"], ["all", "All new"]].forEach(function (t) {
      var n = data.counts ? (t[0] === "candidates" ? data.counts.candidates : t[0] === "all" ? data.counts.all : 0) : 0;
      var b = U.btn(t[1] + (n > 0 ? " (" + n + ")" : ""), tab === t[0] ? "primary-btn" : "mini-btn", function () { tab = t[0]; draw(); });
      tabs.appendChild(b);
    });
    head.appendChild(tabs);
    pane.appendChild(head);
    if (tab === "sellers") pane.appendChild(sellersTab());
    else if (tab === "all") pane.appendChild(allTab());
    else {
      var c = data.candidates || { today: [], older: [] };
      pane.appendChild(list("Found today", c.today || [], true, st.hasData ? "Nothing new today that passes the filters." : "No data yet - the first read runs on the computer after 4 AM Central."));
      pane.appendChild(list("Earlier, not ticked off", c.older || [], true, "Nothing older is waiting."));
      var fs = U.section("Filtered (" + (data.filteredTotal || 0) + ")");
      (data.filtered || []).slice(0, 30).forEach(function (it) { fs.appendChild(row(it, true)); });
      if (!(data.filtered || []).length) fs.appendChild(U.el("p", "muted small", "Nothing filtered yet."));
      pane.appendChild(fs);
    }
  }

  function render(p) {
    var d = U.pageData(p, "competitors");
    var s = JSON.stringify(d);
    if (s === sig) return;
    sig = s;
    data = d;
    draw();
  }

  draw();
  P.register("competitors", { pane: pane, render: render });
})(self);
