// remote/pack-rank-view.js - B-1137 (v2.0.60): the Walmart pack-rank pop-up on
// the phone. The laptop sends the question with the prompt (lib/remote-protocol.js
// phoneRankQuestion); this draws the same editor as the Buy Queue page - drag
// (a pointer drag on the grip) or up / down, pieces per pack, "never", and
// Zach's own link with its pieces - and answers through approveOrder with
// choice = the rank as JSON. The laptop checks it against the very question
// (lib/walmart-pack-rank-ask.js packRankAnswerCheck) and refuses anything else.
// ⚠ It never answers on its own and never times anything out.
(function () {
  "use strict";
  const MAX_DEN = 12;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const money = (n) => (Number(n) > 0 ? "$" + Number(n).toFixed(2) : "");
  function parsePieces(input) {
    const t = String(input == null ? "" : input).trim().replace(/\s+/g, "");
    let m = t.match(/^(\d{1,4})\/(\d{1,3})$/);
    if (m) {
      let n = Number(m[1]);
      let d = Number(m[2]);
      if (!(n > 0 && d > 0)) return null;
      let a = n;
      let b = d;
      while (b) [a, b] = [b, a % b];
      n /= a;
      d /= a;
      return d <= MAX_DEN ? { n, d } : null;
    }
    m = t.match(/^(\d{1,4})(?:\.(\d{1,4}))?$|^\.(\d{1,4})$/);
    if (!m) return null;
    const v = Number(t);
    if (!(v > 0)) return null;
    for (let d = 1; d <= MAX_DEN; d++) {
      const n = Math.round(v * d);
      if (n > 0 && Math.abs(n / d - v) <= 0.005 + 1e-9) return { n, d };
    }
    return null;
  }
  function canonicalLink(u) {
    let url;
    try {
      url = new URL(String(u || "").trim());
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !/^(www\.|business\.)?walmart\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const ip = parts.indexOf("ip");
    if (ip < 0) return null;
    const id = parts.slice(ip + 1).reverse().find((s) => /^\d{5,15}$/.test(s));
    return id ? "https://business.walmart.com/ip/" + id : null; // B-1437
  }

  // Is the editor for THIS question already drawn? (kept while Zach works on it)
  function isOpen(container, q) {
    return !!(container && q && container.dataset.packRankAsk === String(q.askedAt) && container.querySelector(".prp-list"));
  }

  /** container: the prompt's fields box; q: prompt.packRank; answer(choiceJson) sends approveOrder. */
  function render(container, q, answer) {
    if (!container || !q) return;
    container.dataset.packRankAsk = String(q.askedAt);
    const vars = new Map((q.variations || []).map((v) => [v.key, v]));
    const wrap = el("div", "prp");
    if (q.amazonTitle) wrap.appendChild(el("p", "prp-product", "Amazon: " + q.amazonTitle));
    if (q.walmartTitle) wrap.appendChild(el("p", "prp-product", "Walmart: " + q.walmartTitle));
    if (q.titleDoubt) wrap.appendChild(el("p", "prp-doubt", q.titleDoubt));
    if (q.landedNote) wrap.appendChild(el("p", "prp-doubt", q.landedNote));
    wrap.appendChild(el("p", "prp-help", "Drag (or ▲▼) into buying order. Pieces = Amazon units in ONE Walmart checkout unit (4/3 is fine). One pack per Walmart order."));
    const list = el("ol", "prp-list");
    wrap.appendChild(list);
    const renumber = () => {
      let i = 0;
      for (const r of list.children) r.querySelector(".prp-pos").textContent = r.querySelector(".prp-never-box").checked ? "-" : ++i + ".";
    };
    function row(entry) {
      const isUrl = !!entry.url || String(entry.key || "").startsWith("url:");
      const v = vars.get(entry.key) || null;
      const li = el("li", "prp-row");
      li.dataset.key = entry.key;
      if (isUrl) li.dataset.url = entry.url || String(entry.key).slice(4);
      const grip = el("span", "prp-grip", "⡇");
      grip.setAttribute("aria-hidden", "true");
      li.appendChild(grip);
      li.appendChild(el("span", "prp-pos", ""));
      const label = isUrl ? "Your link " + li.dataset.url : v ? v.label : entry.key;
      const name = el("span", "prp-name", label);
      const tags = [];
      if (v && v.price) tags.push(money(v.price));
      if (v && v.inStock === false) tags.push("out of stock now");
      if (entry.isNew) tags.push("NEW");
      if (tags.length) name.appendChild(el("small", "prp-tags", " " + tags.join(" · ")));
      li.appendChild(name);
      const pieces = el("input", "prp-pieces");
      pieces.type = "text";
      pieces.inputMode = "decimal";
      pieces.value = entry.pieces || (v && v.suggested) || "1";
      pieces.setAttribute("aria-label", "pieces for " + label);
      pieces.addEventListener("input", () => pieces.classList.toggle("prp-bad", !parsePieces(pieces.value)));
      li.appendChild(pieces);
      const nl = el("label", "prp-never");
      const never = el("input", "prp-never-box");
      never.type = "checkbox";
      never.checked = !!entry.never;
      never.addEventListener("change", renumber);
      nl.appendChild(never);
      nl.appendChild(el("span", "", "never"));
      li.appendChild(nl);
      const up = el("button", "prp-move", "▲");
      up.type = "button";
      up.addEventListener("click", () => {
        if (li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
        renumber();
      });
      const down = el("button", "prp-move", "▼");
      down.type = "button";
      down.addEventListener("click", () => {
        if (li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
        renumber();
      });
      li.appendChild(up);
      li.appendChild(down);
      if (isUrl) {
        const rm = el("button", "prp-move", "✕");
        rm.type = "button";
        rm.addEventListener("click", () => {
          li.remove();
          renumber();
        });
        li.appendChild(rm);
      }
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        li.classList.add("prp-dragging");
        const move = (ev) => {
          let before = null;
          for (const r of Array.from(list.children)) {
            if (r === li) continue;
            const b = r.getBoundingClientRect();
            if (ev.clientY < b.top + b.height / 2) {
              before = r;
              break;
            }
          }
          if (before) list.insertBefore(li, before);
          else list.appendChild(li);
          renumber();
        };
        // on the document: moving the row in the list drops a pointer capture
        const done = () => {
          li.classList.remove("prp-dragging");
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", done);
          document.removeEventListener("pointercancel", done);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", done);
        document.addEventListener("pointercancel", done);
      });
      return li;
    }
    for (const e of q.entries || []) list.appendChild(row(e));
    renumber();
    const add = el("div", "prp-add");
    const url = el("input", "prp-url");
    url.type = "url";
    url.placeholder = "Your link: https://business.walmart.com/ip/...";
    const pcs = el("input", "prp-pieces");
    pcs.type = "text";
    pcs.placeholder = "pieces";
    const addBtn = el("button", "secondary-btn", "Add link");
    addBtn.type = "button";
    add.appendChild(url);
    add.appendChild(pcs);
    add.appendChild(addBtn);
    wrap.appendChild(add);
    const err = el("p", "prp-error");
    err.hidden = true;
    wrap.appendChild(err);
    const say = (t) => {
      err.textContent = t || "";
      err.hidden = !t;
    };
    addBtn.addEventListener("click", () => {
      const c = canonicalLink(url.value);
      if (!c) return say("That is not a Walmart item link.");
      if (!parsePieces(pcs.value)) return say("Give the link its pieces, e.g. 2 or 4/3.");
      if (Array.from(list.children).some((r) => r.dataset.url === c)) return say("That link is already in the rank.");
      list.appendChild(row({ key: "url:" + c, url: c, pieces: pcs.value.trim(), never: false }));
      url.value = "";
      pcs.value = "";
      say("");
      renumber();
    });
    const save = el("button", "primary-btn", "Save rank and buy");
    save.type = "button";
    save.addEventListener("click", () => {
      const entries = Array.from(list.children).map((r) => ({
        key: r.dataset.key,
        ...(r.dataset.url ? { url: r.dataset.url } : {}),
        pieces: r.querySelector(".prp-pieces").value.trim(),
        never: !!r.querySelector(".prp-never-box").checked,
      }));
      const bad = entries.find((e) => !parsePieces(e.pieces));
      if (bad) return say('"' + (bad.pieces || "(blank)") + '" is not a pieces number - use a whole number or a fraction like 4/3.');
      say("");
      save.disabled = true;
      answer(JSON.stringify({ askedAt: q.askedAt, entries }));
      save.textContent = "Sent - waiting for the laptop...";
      // A refused answer (the laptop says why in the command result) can be fixed and sent again.
      setTimeout(() => {
        save.disabled = false;
        save.textContent = "Save rank and buy";
      }, 20000);
    });
    wrap.appendChild(save);
    container.appendChild(wrap);
  }

  window.ShopperPackRankPhone = { render, isOpen, parsePieces, canonicalLink };
})();
