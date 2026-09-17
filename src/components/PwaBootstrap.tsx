"use client";

import { useEffect, useRef, useState } from "react";
import { api, currentUser } from "@/lib/client";

interface PushSubscriptionLike {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

async function getVapidPublicKey(): Promise<string> {
  try {
    const data = await api<{ publicKey?: string }>("/api/notifications/public-key");
    return data.publicKey || "";
  } catch {
    return "";
  }
}

async function registerPush(riderName: string): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "denied") return;

  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return;

  let subscription: PushSubscription | null = null;
  try {
    subscription = await reg.pushManager.getSubscription();
  } catch {
    /* push not supported — quietly bail */
    return;
  }

  // Permission first: only try to subscribe if the user grants it.
  if (Notification.permission !== "granted") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return;
  }

  try {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: await getVapidPublicKey(),
    });
  } catch {
    /* Already-subscribed / invalid key — continue with existing if present */
  }
  if (!subscription) return;

  const sub: PushSubscriptionLike = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.getKey("p256dh") ? bytesToBase64(subscription.getKey("p256dh")!) : "",
      auth: subscription.getKey("auth") ? bytesToBase64(subscription.getKey("auth")!) : "",
    },
  };

  try {
    await api("/api/notifications", {
      method: "POST",
      body: { rider: riderName, subscription: sub },
    });
  } catch {
    /* offline — subscription sync retried on next login */
  }
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export default function PwaBootstrap() {
  const [ready, setReady] = useState(false);
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    const sync = () => {
      const user = currentUser();
      if (user && user.role === "rider") {
        // Wait a beat so the SW activation control loop settles before subscribing.
        setTimeout(() => {
          void registerPush(user.name).catch(() => {
            /* non-blocking */
          });
        }, 1500);
      }
    };

    const scope = (async () => {
      if (!("serviceWorker" in navigator)) return;
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        if (reg.active) sync();
      } catch {
        /* sw registration failure is non-fatal */
      }
    })();

    void scope.then(() => setReady(true));

    // A rider may log in after this shell already mounted (layout persists
    // across SPA navigation), so re-capture on every fresh authentication.
    window.addEventListener("waterpos:auth", sync);
    return () => window.removeEventListener("waterpos:auth", sync);
  }, []);

  return <>{ready ? null : null}</>;
}