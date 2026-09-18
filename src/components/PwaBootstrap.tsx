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

function playDispatchSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    oscillator.frequency.setValueAtTime(1108, audioCtx.currentTime + 0.15); // C#6
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime + 0.3); // A5
    oscillator.frequency.setValueAtTime(660, audioCtx.currentTime + 0.45); // E5
    
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);
    
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 1.2);
  } catch {
    // Fallback: try to play a simple beep using Audio element
    try {
      const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch {}
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

    // Listen for push notification sound trigger from service worker
    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "PLAY_DISPATCH_SOUND") {
          playDispatchSound();
        }
      };
      navigator.serviceWorker.addEventListener("message", handleMessage);
      return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
    }, []);

    // A rider may log in after this shell already mounted (layout persists
    // across SPA navigation), so re-capture on every fresh authentication.
    window.addEventListener("waterpos:auth", sync);
    return () => window.removeEventListener("waterpos:auth", sync);
  }, []);

  return <>{ready ? null : null}</>;
}