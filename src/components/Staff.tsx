"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, clearAuth, currentUser } from "@/lib/client";
import { canManageStaff } from "@/lib/config";
import type { StaffMember } from "@/lib/types";
import { Spinner } from "@/components/ui";

type Feedback = { kind: "ok" | "err"; text: string } | null;

type NewStaffForm = { name: string; role: "rider" | "management"; pin: string };

export default function Staff() {
  const router = useRouter();
  const me = currentUser();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const authorized = canManageStaff(me);
  const canSuspend = me?.role === "master" || (me?.role === "management" && me.name?.toLowerCase() === "vinnie");
  const [showCreate, setShowCreate] = useState(false);
  const [newStaff, setNewStaff] = useState<NewStaffForm>({ name: "", role: "rider", pin: "" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authorized) router.replace("/pos");
  }, [authorized, router]);

  const load = useCallback(async () => {
    try {
      const data = await api<{ staff: StaffMember[] }>("/api/staff");
      setStaff(data.staff ?? []);
    } catch (e) {
      setFeedback({ kind: "err", text: e instanceof Error ? e.message : "Failed to load staff." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function logout() {
    clearAuth();
    router.replace("/");
  }

  async function resetPin(member: StaffMember) {
    setBusyId(member.id);
    setFeedback(null);
    try {
      await api("/api/staff", { method: "POST", body: { action: "resetPin", id: member.id } });
      setStaff((list) =>
        list.map((s) => (s.id === member.id ? { ...s, is_reset_pending: true } : s))
      );
      setFeedback({
        kind: "ok",
        text: `${member.name}'s PIN was cleared. They will set a new one at next login.`,
      });
    } catch (e) {
      setFeedback({ kind: "err", text: e instanceof Error ? e.message : "Reset failed." });
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  async function toggleSuspend(member: StaffMember) {
    setBusyId(member.id);
    setFeedback(null);
    const newSuspended = !member.isSuspended;
    try {
      await api("/api/staff", {
        method: "POST",
        body: { action: "toggleSuspend", id: member.id, isSuspended: newSuspended },
      });
      setStaff((list) =>
        list.map((s) => (s.id === member.id ? { ...s, isSuspended: newSuspended } : s))
      );
      setFeedback({
        kind: "ok",
        text: `${member.name} has been ${newSuspended ? "suspended" : "unsuspended"}.`,
      });
    } catch (e) {
      setFeedback({ kind: "err", text: e instanceof Error ? e.message : "Suspend toggle failed." });
    } finally {
      setBusyId(null);
    }
  }

  async function createStaff() {
    if (!newStaff.name.trim() || !/^\d{4}$/.test(newStaff.pin)) {
      setFeedback({ kind: "err", text: "Name required and PIN must be 4 digits." });
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      await api("/api/staff", {
        method: "POST",
        body: { action: "create", ...newStaff },
      });
      await load();
      setNewStaff({ name: "", role: "rider", pin: "" });
      setShowCreate(false);
      setFeedback({ kind: "ok", text: `${newStaff.name} added as ${newStaff.role}.` });
    } catch (e) {
      setFeedback({ kind: "err", text: e instanceof Error ? e.message : "Create failed." });
    } finally {
      setCreating(false);
    }
  }

  const roleBadge = (role: StaffMember["role"]) =>
    role === "rider"
      ? "bg-sky-500/15 text-sky-300"
      : "bg-emerald-500/15 text-emerald-300";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-sm font-black text-white shrink-0">
            S
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">MIST Staff</div>
            <div className="text-[11px] text-slate-400 leading-tight">
              Directory · credential reset
            </div>
          </div>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <Link href="/pos" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Sell
            </Link>
            <Link href="/restock" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Restock
            </Link>
            <Link href="/customers" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Customers
            </Link>
            <Link href="/catalog" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Products
            </Link>
            <Link href="/reports" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Reports
            </Link>
            <Link href="/staff" className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 font-bold">
              Staff
            </Link>
          </nav>
          {me && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:block text-xs text-slate-400 truncate max-w-[90px]">{me.name}</span>
              <button
                onClick={logout}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 font-bold"
              >
                Lock
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 p-3 sm:p-5 max-w-3xl w-full mx-auto">
        <div className="mb-4">
          <h1 className="text-xl font-black">Staff Management</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Reset a worker&apos;s PIN to clear their credential. They choose a new 4-digit PIN at
            their next login.
          </p>
        </div>

        {feedback && (
          <div
            className={`mb-3 rounded-xl px-3 py-2.5 text-sm font-bold border ${
              feedback.kind === "ok"
                ? "bg-emerald-950/40 border-emerald-700/50 text-emerald-300"
                : "bg-rose-950/40 border-rose-700/50 text-rose-300"
            }`}
          >
            {feedback.text}
          </div>
        )}

        {canSuspend && (
          <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-black text-slate-100">+ Add New Staff</h2>
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-500/20 text-slate-200 hover:text-sky-300 font-black border border-slate-700"
              >
                {showCreate ? "Cancel" : "Open Form"}
              </button>
            </div>
            {showCreate && (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Full name (e.g., John Doe)"
                  value={newStaff.name}
                  onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <select
                  value={newStaff.role}
                  onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as "rider" | "management" })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="rider">Rider</option>
                  <option value="management">Management</option>
                </select>
                <input
                  type="password"
                  placeholder="4-digit PIN"
                  value={newStaff.pin}
                  onChange={(e) => setNewStaff({ ...newStaff, pin: e.target.value })}
                  maxLength={4}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  onClick={createStaff}
                  disabled={creating}
                  className="w-full px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-black disabled:opacity-50"
                >
                  {creating ? "Adding…" : "Create Staff"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
          {loading ? (
            <div className="p-6 flex items-center justify-center text-slate-500">
              <Spinner />
              <span className="ml-3 text-sm">Loading staff…</span>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {staff.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black truncate">{s.name}</span>
                      <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md ${roleBadge(s.role)}`}>
                        {s.role === "rider" ? "Rider" : "Management"}
                      </span>
                      {s.is_reset_pending && (
                        <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300">
                          Reset pending
                        </span>
                      )}
                      {s.isSuspended && (
                        <span className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300">
                          Suspended
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {confirmId === s.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => resetPin(s)}
                          disabled={busyId === s.id}
                          className="text-xs px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-black disabled:opacity-50"
                        >
                          {busyId === s.id ? "…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          disabled={busyId === s.id}
                          className="text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setConfirmId(s.id);
                          setFeedback(null);
                        }}
                        className="shrink-0 text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-amber-500/20 text-slate-200 hover:text-amber-300 font-black border border-slate-700"
                      >
                        Reset PIN
                      </button>
                    )}
                    {canSuspend && (
                      <button
                        onClick={() => toggleSuspend(s)}
                        disabled={busyId === s.id}
                        className={`shrink-0 text-xs px-3 py-2 rounded-lg font-black border ${
                          s.isSuspended
                            ? "bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-700/50"
                            : "bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border-rose-700/50"
                        } disabled:opacity-50`}
                      >
                        {busyId === s.id ? "…" : s.isSuspended ? "UNSUSPEND" : "SUSPEND"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {!staff.length && (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  No staff records found.
                </li>
              )}
            </ul>
          )}
        </div>

        <p className="text-xs text-slate-600 mt-4">
          Clearing a PIN logs the worker out of PIN access until they register a new code on the
          login screen.
        </p>
      </div>
    </main>
  );
}