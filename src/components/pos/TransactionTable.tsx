"use client";

import type { CartItem } from "@/lib/types";
import { computeTicket, money, splitVat } from "@/lib/pricing";

/**
 * Left 60% pane — the active transaction table (Aronium-style):
 * Product Name | Qty | Price | Amount, with a pinned total calculation
 * block: Subtotal (net), 16% VAT split, and a large white Total.
 */
export default function TransactionTable({
  items,
  setItems,
  selected,
  onSelect,
}: {
  items: CartItem[];
  setItems: (u: (items: CartItem[]) => CartItem[]) => void;
  selected: string | null;
  onSelect: (productId: string | null) => void;
}) {
  const ticket = computeTicket(items, false);
  const split = splitVat(ticket.subtotal);

  function changeQty(productId: string, delta: number) {
    setItems((list) =>
      list
        .map((it) => (it.productId === productId ? { ...it, qty: it.qty + delta } : it))
        .filter((it) => it.qty > 0)
    );
  }

  return (
    <section className="flex flex-col min-h-0 h-full rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_64px_72px_84px] gap-2 px-3 pt-3 pb-2 text-[10px] uppercase tracking-wider text-slate-500 font-black border-b border-slate-800">
        <span>Product Name</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/70">
        {items.length === 0 && (
          <div className="h-full min-h-[180px] flex items-center justify-center text-slate-600 text-sm text-center px-4">
            Search a product in the top bar
            <br />& tap it to start the ticket
          </div>
        )}
        {items.map((it) => (
          <button
            key={it.productId}
            onClick={() => onSelect(selected === it.productId ? null : it.productId)}
            className={`w-full text-left grid grid-cols-[1fr_64px_72px_84px] gap-2 items-center px-3 py-2 transition ${
              selected === it.productId
                ? "bg-emerald-500/10"
                : "hover:bg-slate-900"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 self-stretch rounded-full shrink-0" style={{ backgroundColor: it.color }} />
              <span className="text-sm font-bold text-slate-100 truncate leading-tight">{it.name}</span>
            </span>
            <span className="flex items-center justify-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeQty(it.productId, -1);
                }}
                className="w-6 h-6 rounded-md bg-slate-800 text-slate-200 font-black hover:bg-rose-500/80 hover:text-white active:scale-90 transition text-sm"
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-black text-slate-100">{it.qty}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  changeQty(it.productId, 1);
                }}
                className="w-6 h-6 rounded-md bg-slate-800 text-slate-200 font-black hover:bg-emerald-500/80 hover:text-white active:scale-90 transition text-sm"
              >
                +
              </button>
            </span>
            <span className="text-right text-sm text-slate-300 tabular-nums">{money(it.unitPrice)}</span>
            <span className="text-right text-sm font-black text-slate-100 tabular-nums">
              {money(it.unitPrice * it.qty)}
            </span>
          </button>
        ))}
      </div>

      {/* Pinned calculation block */}
      <div className="border-t border-slate-800 bg-slate-950 px-3 py-2.5 space-y-1 text-sm">
        <div className="flex justify-between items-baseline">
          <span className="text-slate-400">Subtotal (net)</span>
          <span className="font-bold text-slate-200 tabular-nums">{money(split.net)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-slate-400">Tax · VAT 16%</span>
          <span className="font-bold text-sky-400 tabular-nums">{money(split.vat)}</span>
        </div>
        <div className="flex justify-between items-baseline border-t border-slate-800 pt-1.5">
          <span className="text-xs uppercase tracking-wider text-slate-400 font-black">Total</span>
          <span className="text-2xl font-black text-white tabular-nums">{money(split.gross)}</span>
        </div>
      </div>
    </section>
  );
}