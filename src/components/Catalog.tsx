"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, cacheProducts, cachedProducts, clearAuth, currentUser } from "@/lib/client";
import { canManageStaff } from "@/lib/config";
import { money } from "@/lib/pricing";
import { BigButton } from "@/components/ui";
import type { Product } from "@/lib/types";

const PALETTE = ["#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#ec4899", "#f43f5e", "#eab308"];
const CATEGORIES = ["water", "gas", "other"];

interface Draft {
  name: string;
  selling_price: string;
  wholesale_cost: string;
  unit: string;
  stock: string;
}

interface EditDraft {
  name: string;
  category: string;
  selling_price: string;
  wholesale_cost: string;
  unit: string;
  stock: string;
  min_stock: string;
  description: string;
  color: string;
  is_active: boolean;
  adjustment_reason: string;
}

const EMPTY: Draft = { name: "", selling_price: "", wholesale_cost: "", unit: "", stock: "" };
const EMPTY_EDIT: EditDraft = {
  name: "",
  category: "other",
  selling_price: "",
  wholesale_cost: "",
  unit: "",
  stock: "",
  min_stock: "",
  description: "",
  color: "#475569",
  is_active: true,
  adjustment_reason: "",
};

export default function Catalog() {
  const router = useRouter();
  const me = currentUser();
  const canStaff = canManageStaff(me);

  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(EMPTY_EDIT);
  const [editBusy, setEditBusy] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  // --- SEARCH ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ products: Product[] }>("/api/pos/products");
      setProducts(res.products);
      cacheProducts(res.products);
      setMsg(null);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Product load failed." });
    }
  }, []);

  // Debounced search filter
  const applySearch = useCallback((query: string) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => {
      const lower = query.trim().toLowerCase();
      if (!lower) {
        // No search term - restore from cache (all products)
        const cached = cachedProducts();
        setProducts(cached ?? []);
        return;
      }
      // Filter products by name match against cached products
      const cached = cachedProducts() ?? [];
      const filtered = cached.filter((p: Product) => p.name.toLowerCase().includes(lower) && p.is_active);
      setProducts(filtered);
    }), 300);
  }, []);

  useEffect(() => {
    load();
  }, [load, searchQuery]);

  // Apply search filter on query change
  useEffect(() => {
    applySearch(searchQuery);
  }, [searchQuery, applySearch]);

  function logout() {
    clearAuth();
    router.replace("/");
  }

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchEdit(p: Partial<EditDraft>) {
    setEditDraft((d) => ({ ...d, ...p }));
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

  async function deleteProduct(p: Product) {
    setBusy(true);
    setMsg(null);
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

  function openEdit(p: Product) {
    setEditing(p);
    setEditDraft({
      name: p.name,
      category: p.category || "other",
      selling_price: String(p.selling_price),
      wholesale_cost: String(p.wholesale_cost),
      unit: p.unit,
      stock: String(p.stock),
      min_stock: p.min_stock === undefined ? "" : String(p.min_stock),
      description: p.description || "",
      color: p.color,
      is_active: p.is_active,
      adjustment_reason: "",
    });
    setConfirmSave(false);
  }

  function closeEdit() {
    setEditing(null);
    setEditDraft(EMPTY_EDIT);
    setConfirmSave(false);
  }

  const stockChanged =
    editing !== null && Number(editDraft.stock || 0) !== editing.stock;

  const canSaveEdit =
    editing !== null &&
    editDraft.name.trim().length > 0 &&
    Number(editDraft.selling_price || "0") >= 0 &&
    editDraft.unit.trim().length > 0 &&
    Number(editDraft.stock || "0") >= 0 &&
    (editDraft.min_stock === "" || Number(editDraft.min_stock) >= 0) &&
    (!stockChanged || editDraft.adjustment_reason.trim().length > 0);

  async function doSaveEdit() {
    if (!editing || !canSaveEdit) return;
    setEditBusy(true);
    setMsg(null);
    try {
      const body: Record<string, any> = {
        name: editDraft.name.trim(),
        category: editDraft.category,
        selling_price: Number(editDraft.selling_price || 0),
        wholesale_cost: Number(editDraft.wholesale_cost || 0),
        unit: editDraft.unit.trim(),
        stock: Number(editDraft.stock || 0),
        min_stock: editDraft.min_stock === "" ? null : Number(editDraft.min_stock),
        description: editDraft.description,
        color: editDraft.color,
        is_active: editDraft.is_active,
      };
      if (stockChanged) body.adjustment_reason = editDraft.adjustment_reason.trim();

      await api(`/api/pos/products/${editing.id}`, { method: "PATCH", body });
      setMsg({ kind: "ok", text: `"${editDraft.name.trim()}" updated.` });
      closeEdit();
      load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to update product." });
    } finally {
      setEditBusy(false);
      setConfirmSave(false);
    }
  }

  const field = (label: string, key: keyof Draft, opts: { inputMode?: "decimal"; type?: string } = {}) => (    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">{label}</span>
      <input
        value={draft[key]}
        onChange={(e) => patch({ [key]: e.target.value }) }
        inputMode={opts.inputMode}
        type={opts.type ?? "text"}
        placeholder={key === "unit" ? "e.g. Btl, Pkt, Jug" : key === "stock" ? "e.g. 120" : "0"}
        autoComplete="off"
        className="w-full h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-slate-100 text-base placeholder:text-slate-600"
      />
    </label>
  );

  const editField = (label: string, key: keyof EditDraft, opts: { inputMode?: "decimal"; type?: string } = {}) => (    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">{label}</span>
      <input
        value={String(editDraft[key])}
        onChange={(e) => patchEdit({ [key]: e.target.value }) }
        inputMode={opts.inputMode}
        type={opts.type ?? "text"}
        autoComplete="off"
        className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base placeholder:text-slate-600"
      />
    </label>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-600 flex items-center justify-center text-sm font-black text-white shrink-0">
            P
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black leading-tight truncate">Product Catalog</div>
            <div className="text-[11px] text-slate-400 leading-tight">Inventory master — add or edit items</div>
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
            {canStaff && (
              <Link href="/staff" className="px-3 py-1.5 rounded-lg hover:bg-slate-800 font-bold text-slate-300">
                Staff
              </Link>
            )}          </nav>
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
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold block">Search</span>
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                applySearch(e.target.value);
              }}
              placeholder="Filter products..."
              className="w-48 h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-slate-100 text-base placeholder:text-slate-500"
              autoComplete="off"
            />
          </div>
          <button
            onClick={() => (showForm ? close() : setShowForm(true))}
            className="h-11 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 text-white font-black text-sm shadow-lg shadow-emerald-900/30 hover:brightness-110 active:scale-[0.97] transition"
          >
            {showForm ? "Close" : "+ Add New Product"}
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
                {busy ? "Saving..." : "Save to Catalog"}
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

        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {products.map((p) => (
            <div
              key={p.id}
              style={{ backgroundColor: p.color }}
              onClick={() => openEdit(p)}
              className={`relative rounded-2xl p-3 text-left text-white shadow-lg min-h-[104px] flex flex-col justify-between select-none ${p.is_active ? "" : "opacity-60"}`}
            >
              <span
                className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/30 hover:bg-black/50 text-white text-xs font-black flex items-center justify-center"
                title="Edit product"
                aria-label="Edit product"
              >
                ✎
              </span>
              <div>
                <div className="text-sm font-black leading-tight drop-shadow">{p.name}</div>
                {!p.is_active && <div className="text-[10px] font-bold text-rose-200 drop-shadow">INACTIVE</div>}
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
            </div>
          ))}
          {products.length === 0 && (
            <div className="col-span-full text-center text-slate-600 py-10 text-sm">
              Catalog is empty — click "+ Add New Product" to create the first item.
            </div>
          )}
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeEdit} />
          <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-4 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-100">Edit Product</h2>
              <button
                onClick={closeEdit}
                className="w-9 h-9 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-100 font-black"
              >
                X
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Product Name *</span>
                <input
                  value={editDraft.name}
                  onChange={(e) => patchEdit({ name: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Category</span>
                <select
                  value={editDraft.category}
                  onChange={(e) => patchEdit({ category: e.target.value }) }
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Unit Size *</span>
                <input
                  value={editDraft.unit}
                  onChange={(e) => patchEdit({ unit: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Retail Price (Ksh)</span>
                <input
                  type="number"
                  value={editDraft.selling_price}
                  onChange={(e) => patchEdit({ selling_price: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Wholesale / Cost (Ksh)</span>
                <input
                  type="number"
                  value={editDraft.wholesale_cost}
                  onChange={(e) => patchEdit({ wholesale_cost: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Current Stock</span>
                <input
                  type="number"
                  value={editDraft.stock}
                  onChange={(e) => patchEdit({ stock: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Min / Reorder Level</span>
                <input
                  type="number"
                  value={editDraft.min_stock}
                  onChange={(e) => patchEdit({ min_stock: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">Description</span>
                <textarea
                  value={editDraft.description}
                  onChange={(e) => patchEdit({ description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={editDraft.is_active}
                  onChange={(e) => patchEdit({ is_active: e.target.checked })}
                />
                <span className="text-sm font-bold text-slate-200">Active (available for sale)</span>
              </label>
              {stockChanged && (
                <label className="block sm:col-span-2">
                  <span className="text-[11px] uppercase tracking-wider text-amber-400 font-bold mb-1 block">Stock Adjustment Reason *</span>
                  <input
                    value={editDraft.adjustment_reason}
                    onChange={(e) => patchEdit({ adjustment_reason: e.target.value })}
                    placeholder="e.g. Damaged goods, recount, restock"
                    className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-amber-600/50 focus:border-amber-500 outline-none text-slate-100 text-base"
                  />
                </label>
              )}
            </div>

            {!confirmSave ? (
              <button
                onClick={() => {
                  if (!canSaveEdit) return;
                  setConfirmSave(true);
                }}
                disabled={!canSaveEdit || editBusy}
                className={`w-full h-12 rounded-2xl font-black ${
                  canSaveEdit
                    ? "bg-gradient-to-r from-sky-500 to-emerald-500 text-white shadow-lg"
                    : "bg-slate-800 text-slate-500"
                }`}
              >
                Save Changes
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-amber-300 font-bold">
                  Confirm saving changes to "{editDraft.name.trim()}"?
                  {stockChanged ? " Stock quantity will be adjusted and recorded." : ""}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmSave(false)}
                    className="flex-1 h-12 rounded-2xl bg-slate-800 text-slate-300 font-black"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={doSaveEdit}
                    disabled={editBusy}
                    className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 text-white font-black"
                  >
                    {editBusy ? "Saving..." : "Confirm Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function tryCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}