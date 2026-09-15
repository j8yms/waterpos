"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Toggle({
  checked,
  onChange,
  label,
  accent = "sky",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  accent?: "sky" | "emerald" | "amber" | "rose";
}) {
  const on =
    accent === "emerald"
      ? "bg-emerald-500"
      : accent === "amber"
        ? "bg-amber-500"
        : accent === "rose"
          ? "bg-rose-500"
          : "bg-sky-500";
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.99] transition"
    >
      <span className="text-sm font-bold text-slate-200">{label}</span>
      <span className={`w-12 h-7 rounded-full transition-colors relative ${checked ? on : "bg-slate-600"}`}>
        <span
          className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

export function BigButton({
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...rest}
      className={`h-16 rounded-2xl font-black text-lg tracking-wide transition active:scale-[0.97] select-none ${className}`}
    >
      {children}
    </button>
  );
}

export function StatCard({
  label,
  value,
  accent = "text-slate-100",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 flex-1 min-w-[120px]">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`text-xl font-black mt-1 ${accent}`}>{value}</div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
    />
  );
}