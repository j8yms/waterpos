"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cacheProducts, clearAuth, currentUser } from "@/lib/client";
import { money } from "@/lib/pricing";
import { BigButton } from "@/components/ui";
import type { Product } from "@/lib/types";

const PALETTE = ["#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#ec4899", "#f43f5e", "#eab308"];

interface Draft {
  name: string;
  selling_price: string;
  wholesale_cost: string;
  unit: string;
  stock: string;
}

const EMPTY: Draft = { name: "", selling_price: "", wholesale_cost: "", unit: "", stock: "" };

export default function Catalog() {
  const router = useRouter();
  const me = currentUser();

  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ products: Product[] }>("/api/pos/products");
      setProducts(res.products);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to load catalog." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function logout() {
    clearAuth();
    router.replace("/");
  }

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  const canSave =
    draft.name.trim().length > 0 &&
    Number(draft.selling_price || "0") >= 0 &&
    draft.unit.trim().length > 0 &&
    Number(draft.stock || "0") >= 0;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setMsg(null);
    try {
      const color = PALETTE[products.length % PALETTE.length];
      await api("/api/pos/products", {
        method: "POST",
        body: {
          name: draft.name.trim(),
          selling_price: Number(draft.selling_price || 0),
          wholesale_cost: Number(draft.wholesale_cost || 0),
          unit: draft.unit.trim(),
          stock: Number(draft.stock || 0),
          color,
        },
      });
      setMsg({ kind: "ok", text: `"${draft.name.trim()}" added to the catalog.` });
      setDraft(EMPTY);
      setShowForm(false);
      load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to add product." });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setShowForm(false);
    setDraft(EMPTY);
  }

  // --- Admin delete (long-press / right-click arms the trash overlay) ---
  function disarm() {
    setArmedId(null);
    if (armedTimer.current) clearTimeout(armedTimer.current);
  }

  function arm(id: string) {
    setArmedId(id);
    if (armedTimer.current) clearTimeout(armedTimer.current);
    armedTimer.current = setTimeout(disarm, 4000);
  }

  function onTilePointerDown(id: string) {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => arm(id), 600);
  }

  function onTilePointerUp() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (armedTimer.current) clearTimeout(armedTimer.current);
    };
  }, []);

  async function deleteProduct(p: Product) {
    if (armedId !== p.id) return;
    setBusy(true);
    setMsg(null);
    disarm();
    try {
      await api(`/api/pos/products/${p.id}`, { method: "DELETE" });
      const remaining = products.filter((x) => x.id !== p.id);
      setProducts(remaining);
      cacheProducts(remaining);
      setMsg({ kind: "ok", text: `"${p.name}" purged from the catalog.` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to delete product." });
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof Draft, opts: { inputMode?: "decimal"; type?: string } = {}) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">{label}</span>
      <input
        value={draft[key]}
        onChange={(e) => patch({ [key]: e.target.value })}
        inputMode={opts.inputMode}
        type={opts.type ?? "text"}
        placeholder={key === "unit" ? "e.g. Btl, Pkt, Jug" : key === "stock" ? "e.g. 120" : "0"}
        autoComplete="off"
        className="w-full h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-slate-100 text-base placeholder:text-slate-600"
      />
    </label>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-sm font-black text-white shrink-0">
            P
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">Product Catalog</div>
            <div className="text-[11px] text-slate-400 leading-tight">Inventory master · add new items</div>
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
            <Link href="/catalog" className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 font-bold">
              Products
            </Link>
            <Link href="/reports" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
              Reports
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

      <div className="flex-1 w-full max-w-5xl mx-auto p-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-300">
            Master Catalog <span className="text-slate-500 font-bold">({products.length})</span>
          </h2>
          <button
            onClick={() => (showForm ? close() : setShowForm(true))}
            className="h-11 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 text-white font-black text-sm shadow-lg shadow-emerald-900/30 hover:brightness-110 active:scale-[0.97] transition"
          >
            {showForm ? "✕ Close" : "+ Add New Product"}
          </button>
        </div>

        {msg && (
          <div
            className={`px-3 py-2 rounded-xl border text-sm font-bold ${
              msg.kind === "ok"
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                : "bg-rose-500/10 border-rose-500/40 text-rose-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Add New Product form */}
        {showForm && (
          <section className="rounded-2xl border border-emerald-500/30 bg-slate-950 p-4 space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-emerald-300 font-black">
              + Add New Product
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field("Product Name *", "name")}
              {field("Retail Price (Ksh)", "selling_price", { inputMode: "decimal" })}
              {field("Wholesale / Base Cost (Ksh)", "wholesale_cost", { inputMode: "decimal" })}
              {field("Unit Size *", "unit")}
              {field("Initial Stock Level", "stock", { inputMode: "decimal" })}
            </div>
            <div className="flex gap-2 pt-1">
              <BigButton
                onClick={save}
                disabled={!canSave || busy}
                className={`flex-1 ${
                  canSave && !busy
                    ? "bg-gradient-to-r from-emerald-500 to-sky-500 text-white shadow-lg shadow-emerald-900/30"
                    : "bg-slate-800 text-slate-500"
                }`}
              >
                {busy ? "Saving…" : "Save to Catalog"}
              </BigButton>
              <button
                onClick={close}
                className="h-16 px-5 rounded-2xl bg-slate-800 text-slate-300 font-black hover:bg-slate-700 active:scale-[0.97] transition"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        {/* Catalog grid */}
        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {products.map((p) => (
            <div
              key={p.id}
              style={{ backgroundColor: p.color }}
              onContextMenu={(e) => {
                e.preventDefault();
                arm(p.id);
              }}
              onPointerDown={() => onTilePointerDown(p.id)}
              onPointerUp={onTilePointerUp}
              onPointerLeave={onTilePointerUp}
              className="relative rounded-2xl p-3 text-left text-white shadow-lg min-h-[104px] flex flex-col justify-between select-none"
            >
              <div>
                <div className="text-sm font-black leading-tight drop-shadow">{p.name}</div>
              </div>
              <div>
                <div className="text-xl font-black drop-shadow">{money(p.selling_price)}</div>
                <div className="text-[11px] font-black mt-0.5 text-white/80 drop-shadow">
                  {p.stock} {p.unit} in stock
                </div>
                <div className="text-[10px] font-bold text-white/70 drop-shadow">
                  cost {money(p.wholesale_cost)} / unit
                </div>
              </div>

              {/* Admin delete overlay — long-press or right-click to arm */}
              {armedId === p.id && (
                <div className="absolute inset-0 rounded-2xl bg-rose-950/85 backdrop-blur-sm flex items-center justify-center gap-2 p-2">
                  <button
                    onClick={() => deleteProduct(p)}
                    disabled={busy}
                    className="h-11 px-3 flex-1 rounded-xl bg-rose-500 text-white font-black text-xs hover:bg-rose-400 active:scale-95 transition"
                  >
                    {busy ? "…" : "🗑 DELETE"}
                  </button>
                  <button
                    onClick={disarm}
                    disabled={busy}
                    className="h-11 px-3 rounded-xl bg-slate-700 text-white font-black text-xs hover:bg-slate-600 active:scale-95 transition"
                  >
                    Keep
                  </button>
                </div>
              )}
            </div>
          ))}
          {products.length === 0 && (
            <div className="col-span-full text-center text-slate-600 py-10 text-sm">
              Catalog is empty — click “+ Add New Product” to create the first item.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}