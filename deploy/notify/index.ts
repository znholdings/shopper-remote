// Shopper Remote - push sender (P-15 / P-32, v2.94). Supabase edge function.
//
// Web push REQUIRES a server to sign the request with the VAPID private
// key; there is no way to do it from the extension or from the page. This
// is that server, and it is deliberately the smallest thing that works:
// it drains push_outbox and sends each row to every stored subscription.
//
// ⚠ It NEVER touches the commands table. A notification is a
// notification - nothing here can answer a prompt or start a run.
//
// Deploy:   Supabase dashboard -> Edge Functions -> notify (or
//           "supabase functions deploy notify --no-verify-jwt").
// Secrets:  VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_TOKEN.
//           ⚠ Those exact names. v2.92's README example said
//           VAPID_PRIVATE_KEY, which this code has never read.
// Invoked:  by a Postgres trigger on push_outbox insert (instant) AND by
//           a cron every minute (safety net). Both send PUSH_TOKEN.
//
// ---------------------------------------------------------------------
// v2.94 fixed four things in the v2.92 original, three of which were the
// codebase's own recurring silent-failure shape:
//
//   1. A row was marked sent_at even when EVERY send threw. The per-sub
//      catch swallowed the error and the update ran unconditionally, so a
//      notification that reached nobody was recorded as delivered and
//      never retried. Exactly P-28's shape: the failure was known and
//      thrown away. Now a row is only marked sent when at least one
//      subscription actually accepted it, and a total failure records the
//      reason and leaves the row to be retried.
//   2. A dead subscription was never removed. Web push answers 404/410
//      for an expired endpoint - permanent, not transient - and push_subs
//      would have accumulated them forever, wasting a request on each
//      every time. Those two codes now delete the row; every other error
//      is left alone, because a 500 from a push service is temporary and
//      deleting on it would unsubscribe him for good.
//   3. push_outbox was never pruned and grows without bound.
//   4. The endpoint had no auth at all (--no-verify-jwt with nothing in
//      its place), so anyone who learned the URL could flush the queue.
//      A shared secret is checked before any work happens.
// ---------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const OUTBOX_RETENTION_DAYS = 7;
const BATCH = 20;

Deno.serve(async (req) => {
  // Cheap constant-ish comparison before anything else happens.
  const expected = Deno.env.get("PUSH_TOKEN");
  if (!expected || req.headers.get("x-shopper-push-token") !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  // ⚠ TWO key formats again, the same split that made the extension's
  // service-role guard decorative. This project issues NEW-format keys, so
  // the dashboard lists SUPABASE_SERVICE_ROLE_KEY as DEPRECATED and offers
  // SUPABASE_SECRET_KEYS (a JSON dictionary) in its place. Reading only the
  // deprecated one would work today and silently stop working the day it is
  // withdrawn - and "stops working" here means notifications quietly cease.
  const key = serviceKey();
  if (!key) return new Response("no service key available to this function", { status: 500 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    // Service role is correct HERE and only here: this runs on Supabase's
    // servers, not in anyone's browser.
    key
  );

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC")!,
    Deno.env.get("VAPID_PRIVATE")!
  );

  const { data: pending, error: pendingErr } = await supabase
    .from("push_outbox")
    .select("*")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (pendingErr) return new Response("outbox read failed: " + pendingErr.message, { status: 500 });
  if (!pending?.length) {
    await prune(supabase);
    return new Response("nothing to send");
  }

  const { data: subs } = await supabase.from("push_subs").select("endpoint,subscription");

  let delivered = 0;
  let failed = 0;

  for (const row of pending) {
    const payload = JSON.stringify({ title: row.title, body: row.body, tag: row.tag });
    let anyAccepted = false;
    let lastError = "";

    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        anyAccepted = true;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        lastError = (String(status === undefined ? "?" : status) + " " + String((err as Error)?.message ?? err)).slice(0, 300);
        // 404/410 mean this endpoint is permanently gone. Anything else
        // (429, 500, a network blip) is transient and must NOT unsubscribe
        // him - losing the subscription is worse than a missed send.
        if (status === 404 || status === 410) {
          await supabase.from("push_subs").delete().eq("endpoint", s.endpoint);
        }
      }
    }

    if (anyAccepted) {
      await supabase
        .from("push_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      delivered++;
    } else {
      // Left unsent ON PURPOSE so the next pass retries it. The reason is
      // recorded rather than swallowed - a prompt nobody was told about
      // is a run sitting paused, which is the whole thing this prevents.
      await supabase
        .from("push_outbox")
        .update({
          attempts: (row.attempts ?? 0) + 1,
          last_error: (subs?.length ?? 0) === 0 ? "no push subscriptions registered" : lastError,
        })
        .eq("id", row.id);
      failed++;
    }
  }

  await prune(supabase);
  return new Response("delivered " + delivered + ", failed " + failed);
});


// Prefers the current SUPABASE_SECRET_KEYS dictionary, falls back to the
// deprecated single var, and returns "" if neither is present so the
// caller can fail loudly instead of constructing a client that silently
// cannot read anything.
function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const dict = JSON.parse(raw);
      for (const val of Object.values(dict)) {
        if (typeof val === "string" && val.length > 10) return val;
      }
    } catch (_e) {
      // Malformed dictionary - fall through to the legacy var rather than
      // throwing, since the legacy var may still be perfectly good.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

async function prune(supabase: ReturnType<typeof createClient>) {
  const cutoff = new Date(Date.now() - OUTBOX_RETENTION_DAYS * 86400000).toISOString();
  // Only SENT rows are pruned. An unsent row is either still being
  // retried or is evidence of a real delivery problem; deleting it would
  // destroy the only record that something never reached him.
  await supabase.from("push_outbox").delete().not("sent_at", "is", null).lt("created_at", cutoff);
}
