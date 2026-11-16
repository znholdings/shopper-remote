// B-2085 (v2.0.161): ShopperWhy - the phone twin of lib/info-tip.js wrapWhy(). A "Why ▾" disclosure for long reasoning text.
// Same arguments, same markup and class names as the laptop. Nodes are MOVED (never cloned). Open state is in memory only - nothing is stored.
(function (root) {
  "use strict";
  var seq = 0, BY_ID = {};
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function wrap(nodes, opts) {
    opts = opts || {};
    var list = (Array.isArray(nodes) ? nodes : [nodes]).filter(function (n) { return n && n.nodeType === 1; });
    if (!list.length) return null;
    var id = opts.id ? String(opts.id) : "";
    if (id && BY_ID[id] && BY_ID[id].root.isConnected) return BY_ID[id];
    var bodyId = "s-why-" + (++seq);
    var rootEl = mk("div", "s-why"); rootEl.dataset.open = "0";
    var line = mk("div", "s-why-line");
    if (opts.headline) line.appendChild(typeof opts.headline === "string" ? mk("span", "s-why-headline", opts.headline) : opts.headline);
    var button = mk("button", "s-why-btn"); button.type = "button";
    button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-controls", bodyId);
    var caret = mk("span", "s-why-caret", "▾"); caret.setAttribute("aria-hidden", "true");
    button.append(mk("span", "s-why-label", opts.label || "Why"), caret);
    line.appendChild(button);
    var body = mk("div", "s-why-body"); body.id = bodyId; body.hidden = true;
    list[0].before(rootEl);
    rootEl.append(line, body);
    list.forEach(function (n) { body.appendChild(n); });
    function open(on) { on = !!on; body.hidden = !on; rootEl.dataset.open = on ? "1" : "0"; button.setAttribute("aria-expanded", on ? "true" : "false"); }
    button.addEventListener("click", function (e) { e.preventDefault(); open(body.hidden); });
    open(!!opts.open);
    var h = { root: rootEl, button: button, body: body, open: open, isOpen: function () { return !body.hidden; } };
    if (id) BY_ID[id] = h;
    return h;
  }
  root.ShopperWhy = Object.freeze({ wrap: wrap });
})(self);
