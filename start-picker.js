// remote/start-picker.js - B-1535: the phone's "Run on" picker for Start Buy Queue.
// Classic script (index.html loads it before app.js). Pure: no DOM, no network.
// The same rules as lib/buy-start-picker.js (the Buy Queue page), kept apart because the PWA
// ships on its own and cannot import ../lib.
//   The Main (the Optiplex) is preselected; an offline pick blocks Start (never a silent switch).
//   An explicit pick of ANOTHER computer while the paired Main is offline is sent straight to that
//   computer (it answers `start` only for itself - lib/remote-bridge.js).
(function (root) {
  "use strict";
  const STALE_MS = 5 * 60 * 1000;
  const mins = (ms) => Math.max(1, Math.round(Number(ms) / 60000));

  // shared "computer:" registry rows ({ payload: { value: { id, name, role, seenAt } } }) -> computers
  function fromRegistry(rows, now) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const v = r && r.payload && r.payload.value;
      if (!v || !v.id) continue;
      const seenAt = Number(v.seenAt) || 0;
      out.push({ id: String(v.id), name: String(v.name || "").trim() || "computer", role: v.role === "viewer" ? "viewer" : "main", seenAt, online: now - seenAt < STALE_MS });
    }
    return out;
  }

  // The Main's published list (payload.startTargets) is the fallback when the registry could not be read.
  //   -> { computers, defaultId } | null
  function pickList(registry, payloadTargets, pairedId, now) {
    let computers = Array.isArray(registry) && registry.length ? registry.slice() : null;
    let defaultId = payloadTargets && payloadTargets.defaultId ? String(payloadTargets.defaultId) : "";
    if (!computers && payloadTargets && Array.isArray(payloadTargets.computers)) {
      computers = payloadTargets.computers.map((c) => ({ id: String(c.id), name: String(c.name || "computer"), role: c.role === "viewer" ? "viewer" : "main", seenAt: Number(c.seenAt) || 0, online: now - (Number(c.seenAt) || 0) < STALE_MS }));
    }
    if (!computers || !computers.length) return null;
    const ids = computers.map((c) => c.id);
    if (!defaultId || !ids.includes(defaultId)) {
      const mains = computers.filter((c) => c.role !== "viewer").sort((a, b) => b.seenAt - a.seenAt);
      defaultId = ids.includes(String(pairedId)) && computers.find((c) => c.id === String(pairedId)).role !== "viewer" ? String(pairedId) : mains.length ? mains[0].id : ids[0];
    }
    return { computers, defaultId };
  }

  function optionText(c, now) {
    return `${c.name}${c.role === "viewer" ? "" : " (Main)"} - ${c.online ? "online" : "offline " + mins(now - c.seenAt) + " min"}`;
  }

  // -> { options:[{value,text,online}], value, online, note }
  function build(list, keep, now) {
    if (!list) return { options: [{ value: "", text: "Main computer (default)", online: true }], value: "", online: true, note: "" };
    const options = list.computers.map((c) => ({ value: c.id, text: optionText(c, now), online: c.online }));
    const ids = options.map((o) => o.value);
    const value = keep && ids.includes(keep) ? keep : list.defaultId;
    const picked = options.find((o) => o.value === value);
    const c = list.computers.find((x) => x.id === value);
    return { options, value, online: !!(picked && picked.online), note: picked && !picked.online ? `${c.name} is offline - choose another computer, or turn it on with Chrome open.` : "" };
  }

  // Which device the `start` command row is addressed to. Everything else keeps the paired device.
  function commandDevice(name, payload, list, pairedId) {
    const paired = String(pairedId || "");
    if (name !== "start" || !payload || !payload.targetId || !list) return paired;
    const t = list.computers.find((c) => c.id === String(payload.targetId));
    const main = list.computers.find((c) => c.id === paired);
    if (t && main && t.id !== main.id && !main.online && t.online) return t.id;
    return paired;
  }

  // The toast for a finished Start / Resume saved that ran (or is waiting) on the other computer.
  function handoverToast(result) {
    if (!result || typeof result !== "object") return "";
    if (result.handedTo) return `Started on the ${result.handedTo} computer - watch it there.`;
    if (result.pending && result.pendingOn) return `Start handed to the ${result.pendingOn} computer - it can take a minute.`;
    return "";
  }

  root.ShopperPhoneStartPicker = { fromRegistry, pickList, build, commandDevice, handoverToast, STALE_MS };
})(typeof globalThis !== "undefined" ? globalThis : this);
