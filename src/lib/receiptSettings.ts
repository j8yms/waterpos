"use client";

import { useEffect, useState } from "react";
import { api } from "./client";

let cached: any = null;
let pending: Promise<any> | null = null;

export function useReceiptSettings(): any {
  const [settings, setSettings] = useState<any>(cached ?? {});

  useEffect(() => {
    if (cached) {
      setSettings(cached);
      return;
    }
    if (!pending) {
      pending = api<{ settings: any }>("/api/receipt-settings")
        .then((res) => res?.settings ?? {})
        .catch(() => ({}));
    }
    pending.then((s) => {
      cached = s ?? {};
      setSettings(cached);
    });
  }, []);

  return settings;
}
