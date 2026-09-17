"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cacheCustomers, clearAuth, currentUser } from "@/lib/client";
import type { Customer } from "@/lib/types";

const EMPTY = { location: "", phone: "", address: "", notes: "" };

export default function Customers() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async (query = "") => {
    try {
      const url = query ? `/api/pos/customers?q=${encodeURIComponent(query)}` : "/api/pos/customers";
      const res = await api<{ customers: Customer[] }>(url);
      setCustomers(res.customers);
      if (!query && typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("waterpos.customers", JSON.stringify(res.customers));
          cacheCustomers(res.customers);
        } catch {
          /* noop */
        }
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to load customers." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.location.trim()) return;
    setBusy("new");
    setMsg(null);
    try {
      await api("/api/pos/customers", { method: "POST", body: draft });
      setDraft(EMPTY);
      setAdding(false);
      setMsg({ kind: "ok", text: "Customer added." });
      load(q);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(c: Customer) {
    setBusy(c.id);
    try {
      await api("/api/pos/customers", {
        method: "PATCH",
        body: { id: c.id, is_active: !c.is_active },
      });
      load(q);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Update failed." });
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setMsg(null);
    try {
      await api("/api/pos/customers", {
        method: "POST",
        body: { action: "deleteCustomer", id: deleteTarget.id },
      });
      setMsg({ kind: "ok", text: `"${deleteTarget.location}" was permanently removed.` });
      setDeleteTarget(null);
      load(q);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Delete failed." });
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  function logout() {
    clearAuth();
    router.replace("/");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link href="/pos" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 font-black text-slate-200">
            ← Back
          </Link>
          <h1 className="font-black flex-1">CUSTOMERS</h1>
          <button
            onClick={logout}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 font-bold"
          >
            Lock
          </button>
        </div>
      </header>

      <section className="px-3 py-3 max-w-4xl mx-auto">
        {msg && (
          <div
            className={`mb-3 px-3 py-2 rounded-xl text-sm font-bold ${
              msg.kind === "ok"
                ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                : "bg-rose-500/15 border border-rose-500/40 text-rose-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              load(e.target.value);
            }}
            placeholder="Search location, phone, address…"
            className="flex-1 h-12 px-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-sky-500 outline-none"
          />
          <button
            onClick={() => setAdding((v) => !v)}
            className="px-4 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 font-black text-white active:scale-[0.98] transition"
          >
            + ADD
          </button>
        </div>

        {adding && (
          <form
            onSubmit={saveCustomer}
            className="mb-4 rounded-2xl border border-slate-700 bg-slate-900 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            <input
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Location * (e.g. MARINA BAY (Regular))"
              className="h-11 px-3 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-sky-500 col-span-full"
              required
            />
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="Phone (07…)"
              className="h-11 px-3 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-sky-500"
            />
            <input
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              placeholder="Address / delivery notes"
              className="h-11 px-3 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={busy === "new"}
              className="h-12 rounded-xl bg-emerald-600 text-white font-black col-span-full active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "new" ? "Saving…" : "SAVE CUSTOMER"}
            </button>
          </form>
        )}

        <ul className="space-y-2">
          {customers.map((c) => (
            <li
              key={c.id}
              className={`rounded-2xl border p-3 flex items-center gap-3 ${
                c.is_active ? "bg-slate-900 border-slate-800" : "bg-slate-900/40 border-slate-800 opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-black truncate">{c.location}</div>
                <div className="text-xs text-slate-400 truncate">
                  {c.phone} · {c.address}
                </div>
                {c.notes && <div className="text-xs text-slate-500 truncate">{c.notes}</div>}
              </div>
              <button
                onClick={() => toggleActive(c)}
                disabled={busy === c.id}
                className={`shrink-0 text-xs font-black px-3 py-1.5 rounded-lg transition ${
                  c.is_active
                    ? "bg-slate-800 text-slate-300 hover:bg-rose-500/20 hover:text-rose-300"
                    : "bg-emerald-600 text-white"
                }`}
              >
                {c.is_active ? "DEACTIVATE" : "REACTIVATE"}
              </button>
              <button
                onClick={() => setDeleteTarget(c)}
                disabled={busy === c.id}
                className="shrink-0 w-9 h-9 rounded-lg bg-slate-800 text-rose-400 hover:bg-rose-600 hover:text-white text-base transition active:scale-95"
                title="Delete customer permanently"
                aria-label="Delete customer"
              >
                🗑
              </button>
            </li>
          ))}
          {customers.length === 0 && (
            <li className="text-center text-slate-600 py-10 text-sm">No customers match.</li>
          )}
        </ul>
      </section>

      {/* Security double-check delete modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl">
            <div className="text-lg font-black text-rose-400 mb-1">⚠️ Delete Customer</div>
            <p className="text-sm text-slate-300 mb-2">
              You are about to <span className="font-black text-rose-300">permanently delete</span>{" "}
              <span className="font-black text-slate-100">{deleteTarget.location}</span> from the
              CUSTOMERS sheet.
            </p>
            <p className="text-xs text-slate-500 mb-4">
              This action removes the full row and cannot be undone. Historical ledger records are
              left untouched.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
                className="flex-1 h-12 rounded-xl bg-slate-700 text-white font-black active:scale-[0.98] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="flex-1 h-12 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black active:scale-[0.98] disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "DELETE PERMANENTLY"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}