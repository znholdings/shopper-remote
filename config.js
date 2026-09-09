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
  vapidPublicKey: "BF8jyuKLO6BNnbdZ9RuwrnRNpnSNfTtdF7B1NMwZoABO9L3zY4HAJY-1BMXT-oyXc5lWkZqJF4Q6sX4aR3zM__E",
};
