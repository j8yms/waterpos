"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/types";
import { money } from "@/lib/pricing";

/**
 * Aronium-style top-banner product search: type to filter, arrow keys to
 * select, Enter / tap adds straight to the active ticket.
 */
export default function ProductSearch({
  products,
  onAdd,
}: {
  products: Product[];
  onAdd: (p: Product) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

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
    return products
      .filter((p) => p.is_active && p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [products, query]);

  function add(p: Product) {
    onAdd(p);
    setQuery("");
    setOpen(false);
    setFocusIndex(-1);
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
      add(matches[focusIndex]);
    } else if (e.key === "Enter" && matches.length === 1) {
      e.preventDefault();
      add(matches[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setFocusIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search product & tap / Enter to add…"
          className="w-full h-12 pl-9 pr-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-slate-100 text-base placeholder:text-slate-500"
        />
      </div>

      {open && matches.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                onClick={() => add(p)}
                onMouseEnter={() => setFocusIndex(i)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-slate-800 transition ${
                  i === focusIndex ? "bg-slate-800" : ""
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-100 truncate">{p.name}</span>
                  <span
                    className={`text-xs font-bold ${
                      p.stock <= 0
                        ? "text-rose-400"
                        : p.stock <= 10
                          ? "text-amber-300"
                          : "text-slate-500"
                    }`}
                  >
                    {p.stock <= 0 ? "OUT OF STOCK" : `${p.stock} ${p.unit} left`}
                  </span>
                </span>
                <span className="text-sm font-black text-emerald-400">
                  {Number.isFinite(p.selling_price) ? money(p.selling_price) : "Invalid price"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}