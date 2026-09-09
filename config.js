// Deployed configuration for the Shopper Remote PWA.
//
// Publishable (anon) key ONLY. Supabase's current key format is
// `sb_publishable_...` / `sb_secret_...`; the secret one bypasses every
// row-level policy and must never appear in a page anyone can open.
window.SHOPPER_REMOTE_CONFIG = {
  url: "https://nzhykxggikqxfnuzcvrz.supabase.co",
  anonKey: "sb_publishable_Qn_ogiHExxNvXNBwAfy3Sw_Pr4GAUCD",
  // VAPID public half. Public by design - it identifies the sender to the
  // push service and is useless without the private half.
  //
  // ⚠ ROTATED 2026-09-09. The original pair's private key was pasted into
  // a chat and is permanently burned; this is its replacement. Rotating
  // the pair changes THIS value, which means the phone must re-subscribe -
  // it does that automatically on the next launch from the Home Screen.
  vapidPublicKey: "BBWNalSgya_weOX4-zb34ylUiqY1lsj6cyXyvTNRqWcI3VtmEDkwDvldUc83k27LYZIFYaawnL6LzBBuTbWNCd4",
};
