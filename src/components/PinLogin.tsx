"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearAuth, currentUser, saveAuth } from "@/lib/client";

const PIN_LENGTH = 4;

export default function PinLogin() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = currentUser();
    if (user) {
      router.replace(user.role === "rider" ? "/queue" : "/pos");
    }
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        press(e.key);
      } else if (e.key === "Backspace") {
        setPin((p) => p.slice(0, -1));
      } else if (e.key === "Enter") {
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function press(d: string) {
    if (loading) return;
    setError(null);
    setPin((p) => (p.length >= PIN_LENGTH ? p : p + d));
  }

  async function submit() {
    if (pin.length !== PIN_LENGTH || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { api } = await import("@/lib/client");
      const data = await api<import("@/lib/types").AuthSession>("/api/auth/login", {
        method: "POST",
        body: { pin },
      });
      if (!data || !data.user) {
        setError("Invalid PIN.");
        setPin("");
        setLoading(false);
        return;
      }
      saveAuth(data);
      router.replace(data.user.role === "rider" ? "/queue" : "/pos");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Login failed. Check server logs."
      );
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function logoutStale() {
    clearAuth();
    window.location.reload();
  }

  const keys: (string | { label: string; action: () => void })[] = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    { label: "C", action: () => { setPin(""); setError(null); } },
    "0",
    { label: "⌫", action: () => setPin((p) => p.slice(0, -1)) },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-sky-900/40">
            W
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-wide">QUENCHERS WATER</h1>
          <p className="text-sm text-slate-400 mt-1">Bulk Water POS · Local Terminal</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex justify-center gap-3 mb-6">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span
                key={i}
                className={`w-4 h-4 rounded-full transition-all ${
                  i < pin.length ? "bg-sky-400 scale-110" : "bg-slate-700"
                }`}
              />
            ))}
          </div>

          <div
            className={`text-center text-sm min-h-[20px] mb-4 ${error ? "text-rose-400" : "text-slate-400"}`}
          >
            {loading ? "Checking…" : error || (pin.length === PIN_LENGTH ? "" : "Enter your 4-digit PIN")}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {keys.map((k, i) =>
              typeof k === "string" ? (
                <button
                  key={i}
                  onClick={() => press(k)}
                  className="h-16 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-2xl font-bold text-slate-100 transition select-none"
                >
                  {k}
                </button>
              ) : (
                <button
                  key={i}
                  onClick={k.action}
                  className="h-16 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-lg font-bold text-slate-300 transition select-none"
                >
                  {k.label}
                </button>
              )
            )}
          </div>

          <button
            onClick={submit}
            disabled={pin.length !== PIN_LENGTH || loading}
            className={`mt-4 w-full h-14 rounded-xl font-black text-lg transition active:scale-[0.98] ${
              pin.length === PIN_LENGTH && !loading
                ? "bg-gradient-to-r from-sky-500 to-emerald-500 text-white hover:opacity-90"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            UNLOCK
          </button>

          <button onClick={logoutStale} className="mt-3 w-full text-xs text-slate-500 hover:text-slate-300">
            Reset session
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Management pins: Vinnie · Emma · Tracy — Riders: drivers&apos; queue
        </p>
      </div>
    </main>
  );
}