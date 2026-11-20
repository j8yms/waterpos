"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Customer } from "@/lib/types";

export interface SelectedCustomer {
  location: string;
  phone: string;
  address: string;
}

export default function CustomerSearch({
  value,
  onChange,
}: {
  value: SelectedCustomer;
  onChange: (c: SelectedCustomer) => void;
}) {
  const [query, setQuery] = useState(value.location);
  const [all, setAll] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [balance, setBalance] = useState<number | null>(null);
  const [sharedName, setSharedName] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value.location);
  }, [value.location]);

  useEffect(() => {
    const cached = tryCache();
    if (cached) {
      setAll(cached);
    } else {
      api<{ customers: Customer[] }>("/api/pos/customers")
        .then((r) => setAll(r.customers))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    return all
      .filter((c) => terms.every((t) => c.location.toLowerCase().includes(t)))
      .slice(0, 7);
  }, [all, query]);

  function pick(c: Customer) {
    onChange({ location: c.location, phone: c.phone, address: c.address });
    setQuery(c.location);
    setOpen(false);
    // Fetch outstanding balance for this customer
    setBalance(null);
    setBalanceLoading(true);
    api<{ balance: number; sharedName: boolean }>(`/api/customers/${c.id}/balance`)
      .then((r) => { setBalance(r.balance); setSharedName(r.sharedName); })
      .catch(() => setBalance(null))
      .finally(() => setBalanceLoading(false));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && focusIndex >= 0) {
      e.preventDefault();
      pick(matches[focusIndex]);
    } else if (e.key === "Enter" && matches.length === 1) {
      e.preventDefault();
      pick(matches[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">
        Customer / Location
      </label>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setFocusIndex(-1);
          onChange({ ...value, location: e.target.value });
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Type location e.g. Marina…"
        className="w-full h-12 px-3 rounded-xl bg-slate-800 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base placeholder:text-slate-500"
      />

      {open && matches.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => pick(c)}
                onMouseEnter={() => setFocusIndex(i)}
                className={`w-full text-left px-3 py-2.5 hover:bg-slate-800 transition ${
                  i === focusIndex ? "bg-slate-800" : ""
                }`}
              >
                <div className="text-sm font-bold text-slate-100">{c.location}</div>
                <div className="text-xs text-slate-400 truncate">
                  {c.phone} · {c.address}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {value.location && matches.length === 0 && !open && (
        <div className="text-[11px] text-amber-300/80 mt-1">Using free text: {value.location}</div>
      )}
      {value.location && (
        <div className="text-[11px] text-slate-400 mt-1">
          {balanceLoading
            ? "Checking balance…"
            : balance !== null && balance > 0
              ? sharedName
                ? `Outstanding (shared name — may include other customers): Ksh ${balance.toFixed(2)}`
                : `Outstanding: Ksh ${balance.toFixed(2)}`
              : balance !== null
                ? "No outstanding"
                : ""}
        </div>
      )}
    </div>
  );
}

function tryCache(): Customer[] | null {
  try {
    const raw = localStorage.getItem("waterpos.customers");
    return raw ? (JSON.parse(raw) as Customer[]) : null;
  } catch {
    return null;
  }
}