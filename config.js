// Deployed configuration for the Shopper Remote PWA.
//
// Publishable (anon) key ONLY. Supabase's current key format is
// `sb_publishable_...` / `sb_secret_...`; the secret one bypasses every
// row-level policy and must never appear in a page anyone can open.
window.SHOPPER_REMOTE_CONFIG = {
  url: "https://nzhykxggikqxfnuzcvrz.supabase.co",
  anonKey: "sb_publishable_Qn_ogiHExxNvXNBwAfy3Sw_Pr4GAUCD",
  // Filled in once the VAPID pair is generated - until then the app runs
  // fine and simply cannot send notifications.
  vapidPublicKey: "",
};
