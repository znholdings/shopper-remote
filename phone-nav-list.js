// remote/phone-nav-list.js - B-1791 (v2.0.135): the phone drawer is built from the laptop's NAV.
//
// remote/nav-lib.js (GENERATED from lib/sidenav.js by test/_phone-nav-bundle.mjs) carries the NAV groups, their pages, the group
// icons and ALSO_CURRENT. This file draws them into #phoneNav .pn-list: six groups with a badge each, every page in the laptop's
// order and with the laptop's name (no alias words), then the three ALSO_CURRENT pages under Buy.
//
// PHONE_TABS below is the ONE place a laptop page is wired to a phone tab. A page that is not in it still shows (as "On the
// computer only"), so a new laptop page can never be silently missing from the phone's drawer.
//
// Loaded BEFORE app.js (app.js collects the tab buttons by id). Classic script, DOM API only (the icon svg goes through DOMParser).
// Opening / closing the drawer stays in phone-nav.js (it closes on a tap of any .tab).
(function (root) {
  "use strict";
  var SPEC = root.ShopperNavSpec;
  var doc = root.document;
  var list = doc && doc.querySelector("#phoneNav .pn-list");
  if (!SPEC || !list) return;

  // key: the NAV page id; for the Settings children (they share id "setup") "setup#<hash>" or "path:<path>"; ALSO_CURRENT: "path:<path>".
  // tab: the phone tab name switchTab() takes. id: the button id. legacy: app.js (or packing-view.js) already wires that button's click.
  // post: what to do after the switch ("daily" opens The Daily, "endofrun" opens the report, "settings" jumps to a card).
  var PHONE_TABS = {
    dashboard: { tab: "dashboard", id: "tabDashboard", legacy: true },
    daily: { tab: "daily", id: "tabDaily" },
    competitors: { tab: "competitors", id: "tabCompetitors" }, // B-2043 (v2.0.154)
    buylist: { tab: "buylist", id: "tabBuylist", legacy: true },
    buyqueue: { tab: "run", id: "tabRun", legacy: true },
    manualbuy: { tab: "manualbuy", id: "tabManualBuy" },
    blacklist: { tab: "blacklist", id: "tabBlacklist" },
    pipeline: { tab: "inventory", id: "tabInventory", legacy: true },
    wizard: { tab: "wizard", id: "tabWizard", legacy: true },
    packing: { tab: "", id: "tabPacking", legacy: true },
    catalog: { tab: "catalog", id: "tabCatalog", legacy: true },
    belowmin: { tab: "belowmin", id: "tabBelowMin", legacy: true },
    bank: { tab: "bank", id: "tabBank" },
    books: { tab: "books", id: "tabBooks", legacy: true },
    fba: { tab: "fba", id: "tabFba", legacy: true },
    cashflow: { tab: "cashflow", id: "tabCashFlow", legacy: true },
    "setup#accounts": { tab: "settings", id: "tabSettings", legacy: true, post: "settings", hash: "accounts" },
    "setup#buying": { tab: "settings", id: "tabSettings_buying", post: "settings", hash: "buying" },
    "setup#pipeline": { tab: "settings", id: "tabSettings_pipeline", post: "settings", hash: "pipeline" },
    "setup#phone": { tab: "settings", id: "tabSettings_phone", post: "settings", hash: "phone" },
    "setup#labels": { tab: "settings", id: "tabSettings_labels", post: "settings", hash: "labels" },
    "setup#data": { tab: "settings", id: "tabSettings_data", post: "settings", hash: "data" },
    "path:books/rules.html": { tab: "booksrules", id: "tabBooksRules" },
    "path:setup/shipping.html": { desktop: true },
    "path:amazon/settings.html": { desktop: true },
    "path:status/status.html": { tab: "runstatus", id: "tabRunStatus", also: true },
    "path:runreviews/runreviews.html": { tab: "runreviews", id: "tabRunReviews", also: true },
    "path:buyqueue/endofrun.html": { tab: "run", id: "tabEndOfRun", also: true, post: "endofrun" }
  };

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function icon(name) {
    var wrap = el("span", "pn-gicon");
    try {
      var d = new DOMParser().parseFromString(SPEC.icon(name, 20), "image/svg+xml");
      if (d && d.documentElement && d.documentElement.nodeName === "svg") wrap.appendChild(doc.importNode(d.documentElement, true));
    } catch (e) { /* no icon is fine */ }
    return wrap;
  }
  function keyOf(item) {
    if (item.id === "setup") return item.hash ? "setup#" + item.hash : "path:" + item.path;
    return item.id;
  }
  function entryOf(key) { return PHONE_TABS[key] || { desktop: true }; }
  function switchTo(tab) { if (typeof root.switchTab === "function") root.switchTab(tab); }

  function post(entry) {
    if (entry.post === "settings") {
      var S = root.ShopperSettingsView;
      if (S && S.jump) S.jump(entry.hash);
    } else if (entry.post === "endofrun") {
      var p = root.lastPayload || (typeof lastPayload !== "undefined" ? lastPayload : null);
      var V = root.ShopperRunViewPhone;
      if (V && V.openReportSheet && p && ((p.run && p.run.report) || p.lastReport)) V.openReportSheet();
    }
  }

  function pageRow(item, key) {
    var entry = entryOf(key);
    var b = el("button", "tab pn-sub" + (entry.also ? " pn-also" : "") + (entry.desktop ? " pn-desktop" : ""));
    b.type = "button";
    if (entry.id && !entry.desktop) b.id = entry.id;
    b.setAttribute("data-nav-key", key);
    if (entry.tab) b.setAttribute("data-tab", entry.tab);
    if (entry.hash) b.setAttribute("data-hash", entry.hash);
    if (entry.also) b.setAttribute("data-also", "1");
    b.appendChild(el("span", "tab-label", item.label));
    if (entry.also) b.appendChild(el("span", "pn-alias", "also"));
    if (entry.desktop) {
      b.title = "On the computer only";
      b.addEventListener("click", function () {
        if (root.ShopperRemote && root.ShopperRemote.toast) root.ShopperRemote.toast("On the computer only");
        else if (typeof root.toast === "function") root.toast("On the computer only");
      });
      return b;
    }
    // app.js (and packing-view.js) already wire the legacy buttons' own switch; the others, and any follow-up step, are wired here.
    if (!entry.legacy || entry.post) {
      b.addEventListener("click", function () {
        if (entry.tab) switchTo(entry.tab);
        post(entry);
      });
    }
    return b;
  }

  function build() {
    list.textContent = "";
    var seen = Object.create(null);
    SPEC.NAV.forEach(function (g) {
      var grp = el("div", "pn-group is-open");
      grp.setAttribute("data-nav-group", g.group);
      var head = el("button", "pn-group-head");
      head.type = "button";
      head.setAttribute("aria-expanded", "true");
      head.appendChild(icon(g.icon));
      head.appendChild(el("span", "pn-group-label", g.label));
      head.appendChild(el("span", "pn-badge"));
      head.addEventListener("click", function () {
        var open = !grp.classList.contains("is-open");
        grp.classList.toggle("is-open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
      });
      var items = el("div", "pn-items");
      grp.appendChild(head);
      grp.appendChild(items);
      g.items.forEach(function (item) {
        var key = keyOf(item);
        seen[key] = true;
        items.appendChild(pageRow(item, key));
      });
      if (g.group === "buy") {
        Object.keys(SPEC.ALSO_CURRENT).forEach(function (path) {
          var info = SPEC.ALSO_CURRENT[path];
          if (info.group !== g.group) return;
          var key = "path:" + path;
          var label = { "status/status.html": "Run status", "runreviews/runreviews.html": "Run reviews", "buyqueue/endofrun.html": "End-of-run report" }[path] || path;
          items.appendChild(pageRow({ label: label, path: path }, key));
        });
      }
      list.appendChild(grp);
    });
    var run = list.querySelector("#tabRun");
    if (run) run.classList.add("active");
  }

  function setActive(which) {
    var all = list.querySelectorAll(".tab");
    var done = false;
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      var on = !done && !t.hasAttribute("data-also") && t.getAttribute("data-tab") === which;
      if (on) done = true;
      t.classList.toggle("active", on);
    }
  }

  function badges(byGroup) {
    var heads = list.querySelectorAll(".pn-group");
    for (var i = 0; i < heads.length; i++) {
      var g = heads[i].getAttribute("data-nav-group");
      var n = byGroup && typeof byGroup === "object" ? Math.max(0, Math.floor(Number(byGroup[g]) || 0)) : 0;
      var b = heads[i].querySelector(".pn-badge");
      if (b) b.textContent = n > 0 ? (n > 99 ? "99+" : String(n)) : "";
    }
  }

  function entries() {
    var out = [];
    SPEC.NAV.forEach(function (g) {
      g.items.forEach(function (i) { out.push({ group: g.group, label: i.label, key: keyOf(i) }); });
      if (g.group === "buy") Object.keys(SPEC.ALSO_CURRENT).forEach(function (p) { out.push({ group: g.group, label: p, key: "path:" + p, also: true }); });
    });
    return out;
  }

  build();
  root.ShopperPhoneNavList = Object.freeze({ build: build, setActive: setActive, badges: badges, PHONE_TABS: PHONE_TABS, entries: entries });
})(self);
