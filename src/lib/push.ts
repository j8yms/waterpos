import webpush from "web-push";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appendRow, deleteRow, readTab, updateRow } from "./sheets";
import type { DispatchOrder } from "./types";

const VAPID_SUBJECT_DEFAULT = "mailto:pos@mistwater.co.ke";

interface StoredKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedKeys: StoredKeys | null = null;
let vapidConfigured = false;

function loadKeysFromEnv(): StoredKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    return {
      publicKey,
      privateKey,
      subject: process.env.VAPID_SUBJECT || VAPID_SUBJECT_DEFAULT,
    };
  }
  return null;
}

function loadKeysFromFile(): StoredKeys | null {
  try {
    const p = join(process.cwd(), ".local", "vapid.json");
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as StoredKeys;
    if (raw.publicKey && raw.privateKey) return raw;
  } catch {
    /* corrupt / absent — fall through */
  }
  return null;
}

function persistKeys(keys: StoredKeys): void {
  try {
    const dir = join(process.cwd(), ".local");
    if (!existsSync(dir)) mkdirSync(dir);
    writeFileSync(join(dir, "vapid.json"), JSON.stringify(keys, null, 2), "utf8");
  } catch {
    /* read-only fs (e.g. serverless) — keys stay in-memory for this process */
  }
}

/** Stable VAPID identity for this deployment. Prefers env vars, then a
 *  gitignored local file, then generates once per process (best-effort). */
function getKeys(): StoredKeys {
  if (cachedKeys) return cachedKeys;
  cachedKeys = loadKeysFromEnv() ?? loadKeysFromFile() ?? null;
  if (!cachedKeys) {
    const generated = webpush.generateVAPIDKeys();
    cachedKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      subject: process.env.VAPID_SUBJECT || VAPID_SUBJECT_DEFAULT,
    };
    console.warn(
      "[push] No VAPID keys configured — generated ephemeral keys. Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT env vars for stable push across restarts."
    );
    persistKeys(cachedKeys);
  }
  if (!vapidConfigured || vapidSubjectOverride() !== cachedKeys.subject) {
    webpush.setVapidDetails(cachedKeys.subject, cachedKeys.publicKey, cachedKeys.privateKey);
    vapidConfigured = true;
  }
  return cachedKeys;
}

function vapidSubjectOverride(): string {
  return process.env.VAPID_SUBJECT || VAPID_SUBJECT_DEFAULT;
}

export function getVapidPublicKey(): string {
  return getKeys().publicKey;
}

export interface PushSubscriptionLike {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

interface StoredSubscription {
  rowNumber: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Resolves a rider identity to the list of stored device subscriptions. */
export async function listSubscriptions(rider: string): Promise<StoredSubscription[]> {
  const target = String(rider ?? "").trim().toLowerCase();
  if (!target) return [];
  try {
    const read = await readTab("SUBSCRIPTIONS");
    return read.rows
      .map((r, i) => ({
        rowNumber: read.rowNumbers[i],
        rider: String(r.rider ?? "").trim(),
        endpoint: String(r.endpoint ?? "").trim(),
        p256dh: String(r.p256dh ?? "").trim(),
        auth: String(r.auth ?? "").trim(),
      }))
      .filter((r) => r.endpoint && r.rider.toLowerCase() === target);
  } catch {
    return [];
  }
}

/** Upsert a device subscription (keyed by endpoint) for a rider. */
export async function saveSubscription(
  rider: string,
  subscription: PushSubscriptionLike
): Promise<void> {
  if (!subscription || !subscription.endpoint) throw new Error("Invalid subscription object.");
  const row = {
    rider: String(rider ?? "").trim(),
    endpoint: String(subscription.endpoint ?? "").trim(),
    p256dh: String(subscription.keys?.p256dh ?? "").trim(),
    auth: String(subscription.keys?.auth ?? "").trim(),
    created_at: new Date().toISOString(),
  };
  const read = await readTab("SUBSCRIPTIONS");
  const idx = read.rows.findIndex(
    (r) => String(r.endpoint ?? "").trim() === row.endpoint
  );
  if (idx >= 0) {
    await updateRow("SUBSCRIPTIONS", read.rowNumbers[idx], row);
  } else {
    await appendRow("SUBSCRIPTIONS", row);
  }
}

/** Remove a device subscription by endpoint (e.g. on logout / 404 from the push service). */
export async function removeSubscription(endpoint: string): Promise<void> {
  if (!endpoint) return;
  const read = await readTab("SUBSCRIPTIONS");
  const idx = read.rows.findIndex((r) => String(r.endpoint ?? "").trim() === endpoint);
  if (idx >= 0) await deleteRow("SUBSCRIPTIONS", read.rowNumbers[idx]);
}

export interface PushSubscriptionLike {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

interface StoredSubscription {
  rowNumber: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const NOTIFICATION_ICON = "/icons/notification-icon.png";

/** Fire a NEW DISPATCH push to every device registered to the assigned rider.
 *  Non-blocking: never throws — callers fire-and-forget. */
export async function notifyRiderOfDispatch(order: DispatchOrder): Promise<void> {
  const rider = String(order.driver ?? "").trim();
  if (rider === "" || rider.toUpperCase() === "WALK-IN") return;

  getKeys();
  const subs = await listSubscriptions(rider);
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: "New Dispatch Assigned",
    body: `${order.customer} · ${order.time} · ${order.product} — ${order.total} KSh`,
    icon: NOTIFICATION_ICON,
    url: "/pos/rider",
    vibrate: [200, 100, 200, 100, 200, 300, 500, 200, 300],
  });

  await Promise.allSettled(
    subs.map((sub) => {
      const pushSub: webpush.PushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return webpush
        .sendNotification(pushSub, payload, { TTL: 600 })
        .catch((err: unknown) => {
          const status = (err as { statusCode?: number })?.statusCode;
          // 404/410 = the endpoint is gone — drop the dead subscription.
          if (status === 404 || status === 410) {
            void removeSubscription(sub.endpoint);
          } else if (status === 401 || status === 403) {
            console.warn(`[push] Subscription for ${rider} rejected (${status}).`);
          } else {
            console.warn(`[push] sendNotification failed for ${rider}: ${String(err)}`);
          }
        });
    })
  );
}