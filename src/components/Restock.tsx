"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearAuth } from "@/lib/client";
import { money } from "@/lib/pricing";
import { BigButton, StatCard } from "@/components/ui";
import type { Product } from "@/lib/types";

interface RestockDraft {
  productId: string;
  addedUnits: number;
  newCost: string;
  newPrice: string;
}

export default function Restock() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RestockDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ products: Product[] }>("/api/pos/products");
      setProducts(res.products);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to load products." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function draftFor(p: Product): RestockDraft {
    return drafts[p.id] ?? { productId: p.id, addedUnits: 0, newCost: "", newPrice: "" };
  }

  function setDraft(p: Product, patch: Partial<RestockDraft>) {
    setDrafts((d) => ({ ...d, [p.id]: { ...draftFor(p), ...patch } }));
  }

  async function submitRestock(p: Product) {
    const d = draftFor(p);
    if (d.addedUnits <= 0) return;
    setBusy(p.id);
    setMsg(null);
    try {
      await api("/api/restock", {
        method: "POST",
        body: {
          productId: p.id,
          addedUnits: d.addedUnits,
          wholesale_cost: d.newCost ? Number(d.newCost) : undefined,
          selling_price: d.newPrice ? Number(d.newPrice) : undefined,
        },
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      setMsg({ kind: "ok", text: `${p.name} stocked.` });
      load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Restock failed." });
    } finally {
      setBusy(null);
    }
  }

  function logout() {
    clearAuth();
    router.replace("/");
  }

  const lowStock = products.filter((p) => p.stock <= 10).length;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link href="/pos" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 font-black text-slate-200">
            ← Back
          </Link>
          <h1 className="font-black flex-1">RESTOCK</h1>
          <button
            onClick={logout}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 font-bold"
          >
            Lock
          </button>
        </div>
      </header>

      <section className="px-3 py-3">
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

        <div className="flex gap-2 overflow-x-auto mb-4">
          <StatCard label="Total SKUs" value={String(products.length)} />
          <StatCard label="Low stock" value={String(lowStock)} accent={lowStock ? "text-rose-400" : "text-emerald-400"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {products.map((p) => {
            const d = draftFor(p);
            const low = p.stock <= 10;
            return (
              <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-black truncate">{p.name}</div>
                    <div className="text-xs text-slate-400">
                      {p.stock} {p.unit}s · Sell {money(p.selling_price)} · Cost {money(p.wholesale_cost)}
                    </div>
                    {low && (
                      <span className="text-[11px] font-black text-rose-400">LOW STOCK — reorder now</span>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Add units</span>
                    <input
                      type="number"
                      min={0}
                      value={d.addedUnits}
                      onChange={(e) => setDraft(p, { addedUnits: Math.max(0, Number(e.target.value)) })}
                      className="mt-1 w-full h-11 px-2 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-sky-500 text-slate-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">New cost</span>
                    <input
                      type="number"
                      step="0.5"
                      placeholder={String(p.wholesale_cost)}
                      value={d.newCost}
                      onChange={(e) => setDraft(p, { newCost: e.target.value })}
                      className="mt-1 w-full h-11 px-2 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-sky-500 text-slate-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">New price</span>
                    <input
                      type="number"
                      step="0.5"
                      placeholder={String(p.selling_price)}
                      value={d.newPrice}
                      onChange={(e) => setDraft(p, { newPrice: e.target.value })}
                      className="mt-1 w-full h-11 px-2 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-sky-500 text-slate-100"
                    />
                  </label>
                </div>

                <BigButton
                  onClick={() => submitRestock(p)}
                  disabled={busy === p.id || d.addedUnits <= 0}
                  className={`mt-3 w-full ${
                    busy === p.id || d.addedUnits <= 0 ? "bg-slate-800 text-slate-500" : "bg-emerald-600 text-white"
                  }`}
                >
                  {busy === p.id ? "Saving…" : "STOCK IN"}
                </BigButton>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}