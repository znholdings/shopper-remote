// B-2068 (v2.0.158): phone header = title + one status word; tap the line for the full status. Nothing is stored.
(function () {
  "use strict";
  var bar = document.getElementById("topBar"); if (!bar) return;
  var line = bar.querySelector(".s-tb-line"); if (!line) return;
  var lb = document.getElementById("liveBanner");
  var det = document.createElement("div"); det.id = "tbDetail"; det.className = "s-tb-detail"; det.hidden = true;
  line.parentNode.insertBefore(det, line.nextSibling);
  var btn = document.createElement("button");
  btn.type = "button"; btn.className = "s-tb-more s-plain-btn"; btn.textContent = "▾";
  btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "tbDetail"); btn.setAttribute("aria-label", "Show status details");
  line.appendChild(btn);
  function fill() { var full = lb && !lb.hidden ? (lb.dataset.full || "") : ""; det.textContent = full; det.hidden = !full || !bar.classList.contains("tb-open"); }
  function toggle(open) {
    var on = typeof open === "boolean" ? open : !bar.classList.contains("tb-open");
    bar.classList.toggle("tb-open", on); btn.setAttribute("aria-expanded", on ? "true" : "false"); fill();
  }
  line.addEventListener("click", function () { toggle(); });
  if (lb && self.MutationObserver) new MutationObserver(fill).observe(lb, { attributes: true, childList: true, characterData: true, subtree: true });
  fill();
  self.ShopperShell = Object.freeze({ toggle: toggle, isOpen: function () { return bar.classList.contains("tb-open"); } });
})();
