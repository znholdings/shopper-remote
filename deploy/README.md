# Shopper Remote — deployment

**This was completed on 2026-09-09. It is kept as the record of how the live
setup is wired, not as a to-do list.** Live values are in the project doc
`claude/backlog.md` under "Deployment".

## What is where

| Piece | Where it lives |
|---|---|
| Relay (Postgres + auth) | Supabase project `shopper-remote`, ref `nzhykxggikqxfnuzcvrz` |
| Phone app (PWA) | **GitHub Pages** — `https://znholdings.github.io/shopper-remote/` |
| Push sender | Supabase Edge Function `notify` |

⚠ **The PWA is NOT hosted on Supabase Storage, and cannot be.** Supabase
deliberately serves user-uploaded HTML as `text/plain` on `*.supabase.co`
so its domain cannot host phishing pages. JS, CSS, icons and the manifest
serve with correct types; HTML never will. This was tried, including
rewriting `storage.objects.metadata`'s mimetype, which changed the
dashboard's display and not the served header. Do not retry it.

⚠ **The extension folder and the Pages site are two copies.** After any
change under `remote/`, sync `~/Downloads/shopper-remote-pwa` and upload to
`znholdings/shopper-remote`. The phone runs the GitHub copy.

## Database

`schema.sql` creates five tables. Two things the original script did not do,
both applied live and both stronger than it asked for:

- Every policy is pinned to **the owner's literal uid**, not to
  `authenticated`. Supabase creates an account for anyone who signs in with
  any Google account; `authenticated` would have handed all of them the
  ability to start a buy run.
- **New signups are disabled** at the project level, so no second account
  can be created at all.

v2.94 added two columns the push sender needs:

```sql
alter table push_outbox add column if not exists attempts int not null default 0;
alter table push_outbox add column if not exists last_error text;
create index if not exists push_outbox_unsent_idx on push_outbox (sent_at, created_at);
```

## Push

`notify/index.ts` is the sender. Web push must be signed by a server; there
is no way to do it from the extension or the page.

**Secrets** (Edge Functions → Secrets). ⚠ These exact names — an earlier
draft of this README said `VAPID_PRIVATE_KEY`, which the code has never
read, and that wrong name was repeated in the backlog for a while:

| Name | Value |
|---|---|
| `VAPID_PUBLIC` | the public half, same string as `remote/config.js` |
| `VAPID_PRIVATE` | the private half — **only** in `~/Downloads/VAPID-KEYS-v2.txt` |
| `VAPID_SUBJECT` | `mailto:zsilverm@gmail.com` |
| `PUSH_TOKEN` | shared secret gating the endpoint |

⚠ `PUSH_TOKEN` and `VAPID_PRIVATE` **must be different values.** They were
briefly set to the same string on 2026-09-09; the pair was rotated because
of it. Reusing a signing key as a bearer token sends that key as a plaintext
header on every invocation.

**Vault**: a secret named `push_token`, same value as `PUSH_TOKEN`. The SQL
reads it by name, so the token never appears in a query, in the cron job
definition, or in a chat.

**Invocation** — both, deliberately:

- a trigger on `push_outbox` insert, for instant delivery;
- `cron.schedule('shopper-push-drain', '* * * * *', ...)` as the safety net.

There is no double-send risk: the function only selects rows where
`sent_at` is null, and marks a row sent only once a subscription accepted
it. **Verify JWT is left ON**; the caller sends the legacy anon key (public
by design) *and* the push token, so there are two gates rather than none.

## Acceptance test

1. Extension → Phone Remote reads Configured / Signed in / Live.
2. The phone lists the laptop as online.
3. **Refresh preview** arrives.
4. A run started from the phone moves.
5. A real approval prompt appears on the phone **and notifies**.

⚠ Step 5 only works from the **Home Screen icon**. `setupPush()` returns
early unless `display-mode: standalone`, because Safari refuses web push in
a normal tab. Rotating the VAPID pair also forces a re-subscribe, which
happens automatically on the next launch from that icon.
