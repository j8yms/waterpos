"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, clearAuth, currentUser, saveAuth } from "@/lib/client";
import { MASTER_PIN } from "@/lib/config";
import type { AuthSession, Role, StaffMember } from "@/lib/types";

const PIN_LENGTH = 4;

type Stage = "identity" | "pin" | "setup" | "confirm";

type LoginResponse = {
  token?: string;
  user?: AuthSession["user"];
  exp?: number;
  requiresSetup?: boolean;
  error?: string;
};

function isSession(data: LoginResponse | null | undefined): data is AuthSession {
  return !!data && !!data.token && !!data.user;
}

/** Synchronous safe staff initializer — runs before any render. */
function getInitialStaff(): StaffMember[] {
  try {
    if (typeof window === "undefined") return [];
    const cached = localStorage.getItem("waterpos.staff");
    if (!cached) return [];
    const parsed = JSON.parse(cached);
    // Strict structural schema check to ensure valid records
    if (!Array.isArray(parsed) || (parsed.length > 0 && !parsed[0]?.name)) {
      localStorage.removeItem("waterpos.staff");
      return [];
    }
    return parsed;
  } catch (e) {
    if (typeof window !== "undefined") localStorage.removeItem("waterpos.staff");
    return [];
  }
}

export default function PinLogin() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>(() => getInitialStaff());
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [stage, setStage] = useState<Stage>("identity");
  const [entry, setEntry] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const entryRef = useRef("");

  function setEntryValue(next: string) {
    entryRef.current = next;
    setEntry(next);
  }

  useEffect(() => {
    const user = currentUser();
    if (user) {
      router.replace(user.role === "rider" ? "/pos/rider" : "/pos");
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<{ staff: StaffMember[] }>("/api/auth/identities");
        if (active) setStaff(Array.isArray(data?.staff) ? data.staff : []);
      } catch {
        /* identity list is best-effort; master code still works */
        if (active) setStaff([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        press(e.key);
      } else if (e.key === "Backspace") {
        setEntryValue(entryRef.current.slice(0, -1));
      } else if (e.key === "Enter") {
        if (entryRef.current.length === PIN_LENGTH) complete(entryRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function routeFor(role: Role) {
    return role === "rider" ? "/pos/rider" : "/pos";
  }

  function press(d: string) {
    if (loading) return;
    setError(null);
    const cur = entryRef.current;
    if (cur.length >= PIN_LENGTH) return;
    const next = cur + d;
    setEntryValue(next);
    if (next.length === PIN_LENGTH) {
      const code = next;
      setTimeout(() => void complete(code), 140);
    }
  }

  function selectIdentity(s: StaffMember) {
    if (loading) return;
    setError(null);
    setSelected(s);
    setEntryValue("");
    setSetupPin("");
    setStage(s.is_reset_pending ? "setup" : "pin");
  }

  function changeUser() {
    if (loading) return;
    setSelected(null);
    setStage("identity");
    setSetupPin("");
    setEntryValue("");
    setError(null);
  }

  async function loginMaster() {
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: { pin: MASTER_PIN },
      });
      if (!isSession(data)) throw new Error(data?.error || "Master unlock failed.");
      saveAuth(data);
      router.replace("/pos");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Master unlock failed.");
      setEntryValue("");
    } finally {
      setLoading(false);
    }
  }

  async function loginWorker(worker: StaffMember, code: string) {
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: { name: worker.name, pin: code },
      });
      if (data?.requiresSetup) {
        setStage("setup");
        setSetupPin("");
        setEntryValue("");
        setError("Set a new PIN to continue.");
        return;
      }
      if (!isSession(data)) throw new Error(data?.error || "Login failed.");
      saveAuth(data);
      router.replace(routeFor(data.user.role));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Login failed.";
      if (/pin reset required/i.test(message)) {
        setStage("setup");
        setSetupPin("");
        setEntryValue("");
        setError("Set a new PIN to continue.");
      } else {
        setError(message);
        setEntryValue("");
      }
    } finally {
      setLoading(false);
    }
  }

  async function completeReset(worker: StaffMember, newPin: string, confirm: string) {
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/api/auth/reset-pin", {
        method: "POST",
        body: { name: worker.name, pin: newPin, confirm },
      });
      if (!isSession(data)) throw new Error(data?.error || "Could not set PIN.");
      saveAuth(data);
      router.replace(routeFor(data.user.role));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set PIN.");
      setStage("setup");
      setSetupPin("");
      setEntryValue("");
    } finally {
      setLoading(false);
    }
  }

  async function complete(code: string) {
    if (loading) return;

    // The master key is always listening on the keypad — in every stage.
    if (code === MASTER_PIN) {
      await loginMaster();
      return;
    }

    if (stage === "identity") {
      setError("Select your name above, then enter your PIN.");
      setEntryValue("");
      return;
    }

    if (stage === "pin") {
      if (!selected) {
        setError("Select your name above.");
        setEntryValue("");
        return;
      }
      await loginWorker(selected, code);
      return;
    }

    if (stage === "setup") {
      if (code === MASTER_PIN) {
        setError("That PIN is reserved. Choose another.");
        setEntryValue("");
        return;
      }
      setSetupPin(code);
      setEntryValue("");
      setError(null);
      setStage("confirm");
      return;
    }

    // stage === "confirm"
    if (code !== setupPin) {
      setError("PIN entries did not match. Start again.");
      setSetupPin("");
      setEntryValue("");
      setStage("setup");
      return;
    }
    if (!selected) {
      setError("Select your name above.");
      setEntryValue("");
      setStage("identity");
      return;
    }
    await completeReset(selected, setupPin, code);
  }

  function logoutStale() {
    clearAuth();
    window.location.reload();
  }

  const keys: (string | { label: string; action: () => void })[] = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    { label: "C", action: () => { setEntryValue(""); setError(null); } },
    "0",
    { label: "⌫", action: () => setEntryValue(entryRef.current.slice(0, -1)) },
  ];

  const prompt =
    stage === "identity"
      ? "Select your name above to continue"
      : stage === "setup"
        ? "Create Your New Preferred 4-Digit PIN"
        : stage === "confirm"
          ? "Re-enter your new PIN to confirm"
          : "Enter your 4-digit PIN";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-sky-900/40">
            W
          </div>
          <h1 className="mt-4 text-xl font-black tracking-wide">MIST WATER AND GAS DISTRIBUTORS</h1>
          <p className="text-sm text-slate-400 mt-1">Bulk Water POS · Local Terminal</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl">
          {stage === "identity" ? (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-2">
                Who&apos;s on shift?
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-0.5">
                {(staff ?? []).map((s) => {
                  const safe = {
                    id: s?.id ?? Math.random().toString(36).slice(2),
                    name: s?.name ?? "Unknown User",
                    role: s?.role ?? "rider",
                    pin: s?.pin ?? "",
                    is_reset_pending: s?.is_reset_pending ?? false,
                    isSuspended: s?.isSuspended ?? false,
                  };
                  return (
                    <button
                      key={safe.id}
                      onClick={() => selectIdentity(safe)}
                      className={`text-left px-3 py-2.5 rounded-xl border font-bold text-sm transition active:scale-[0.98] ${
                        safe.is_reset_pending
                          ? "bg-amber-950/40 border-amber-700/60 text-amber-200"
                          : "bg-slate-800 border-slate-700 text-slate-200 hover:border-sky-600"
                      }`}
                    >
                      <span className="block truncate">{safe.name || "Unknown User"}</span>
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {safe.role === "rider" ? "Rider" : "Management"}
                        {safe.is_reset_pending ? " · Reset" : ""}
                      </span>
                    </button>
                  );
                })}
                {!staff?.length && (
                  <div className="col-span-2 text-xs text-slate-500 py-3 text-center">
                    Loading staff…
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-black truncate">{selected?.name}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {selected?.role === "rider" ? "Rider" : "Management"}
                </div>
              </div>
              <button
                onClick={changeUser}
                className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 font-bold text-slate-300"
              >
                Change
              </button>
            </div>
          )}

          <div
            key={stage}
            className={`text-center text-sm min-h-[20px] mb-4 ${
              stage === "setup" || stage === "confirm"
                ? "text-sky-300 font-bold animate-slide-down"
                : "text-slate-400"
            } ${error ? "text-rose-400 font-normal" : ""}`}
          >
            {loading ? "Checking…" : error || prompt}
          </div>

          <div className="flex justify-center gap-3 mb-6">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span
                key={i}
                className={`w-4 h-4 rounded-full transition-all ${
                  i < entry.length ? "bg-sky-400 scale-110" : "bg-slate-700"
                }`}
              />
            ))}
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
            onClick={() => complete(entryRef.current)}
            disabled={entry.length !== PIN_LENGTH || loading}
            className={`mt-4 w-full h-14 rounded-xl font-black text-lg transition active:scale-[0.98] ${
              entry.length === PIN_LENGTH && !loading
                ? "bg-gradient-to-r from-sky-500 to-emerald-500 text-white hover:opacity-90"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            {stage === "setup" || stage === "confirm" ? "SAVE PIN" : "UNLOCK"}
          </button>

          <button onClick={logoutStale} className="mt-3 w-full text-xs text-slate-500 hover:text-slate-300">
            Reset session
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Authorised staff only · 4-digit PIN required
        </p>
      </div>
    </main>
  );
}