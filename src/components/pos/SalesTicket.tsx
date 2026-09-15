"use client";

import type { CartItem } from "@/lib/types";
import { computeTicket, money } from "@/lib/pricing";
import CustomerSearch, { type SelectedCustomer } from "./CustomerSearch";
import { BigButton, Toggle } from "@/components/ui";

export default function SalesTicket({
  items,
  setItems,
  glovo,
  setGlovo,
  payStatus,
  setPayStatus,
  customer,
  setCustomer,
  driver,
  setDriver,
  drivers,
  onCharge,
  charging,
}: {
  items: CartItem[];
  setItems: (u: (items: CartItem[]) => CartItem[]) => void;
  glovo: boolean;
  setGlovo: (v: boolean) => void;
  payStatus: "PAID" | "PENDING";
  setPayStatus: (v: "PAID" | "PENDING") => void;
  customer: SelectedCustomer;
  setCustomer: (c: SelectedCustomer) => void;
  driver: string;
  setDriver: (v: string) => void;
  drivers: { id: string; name: string; role: string }[];
  onCharge: () => void;
  charging: boolean;
}) {
  const ticket = computeTicket(items, glovo);

  function changeQty(productId: string, delta: number) {
    setItems((list) =>
      list
        .map((it) => (it.productId === productId ? { ...it, qty: it.qty + delta } : it))
        .filter((it) => it.qty > 0)
    );
  }

  function remove(productId: string) {
    setItems((list) => list.filter((it) => it.productId !== productId));
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="space-y-3">
        <CustomerSearch value={customer} onChange={setCustomer} />

        <div className="grid grid-cols-2 gap-2">
          <Toggle checked={glovo} onChange={setGlovo} label="GLOVO Order" accent="amber" />
          <Toggle
            checked={payStatus === "PAID"}
            onChange={(v) => setPayStatus(v ? "PAID" : "PENDING")}
            label={payStatus === "PAID" ? "PAID" : "PENDING"}
            accent={payStatus === "PAID" ? "emerald" : "rose"}
          />
        </div>

        <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">
          Assign Rider
        </label>
        <select
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
          className="w-full h-12 px-3 rounded-xl bg-slate-800 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
        >
          <option value="">Select rider…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
          <option value="WALK-IN">WALK-IN (no rider)</option>
        </select>
      </div>

      <div className="mt-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black">Live Ticket</h2>
          {items.length > 0 && (
            <button
              onClick={() => setItems(() => [])}
              className="text-xs text-rose-400 hover:text-rose-300 font-bold"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto rounded-xl bg-slate-900 border border-slate-800 min-h-[140px]">
          {items.length === 0 ? (
            <div className="h-full min-h-[140px] flex items-center justify-center text-slate-600 text-sm text-center px-4">
              Tap product tiles on the right
              <br />
              to build the order
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {items.map((it) => (
                <li key={it.productId} className="px-2.5 py-2 flex items-center gap-2">
                  <span
                    className="w-1.5 self-stretch rounded-full shrink-0"
                    style={{ backgroundColor: it.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-100 truncate leading-tight">{it.name}</div>
                    <div className="text-xs text-slate-400">
                      {money(it.unitPrice)} · subtotal {money(it.unitPrice * it.qty)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => changeQty(it.productId, -1)}
                      className="w-9 h-9 rounded-lg bg-slate-800 text-slate-200 font-black text-xl hover:bg-rose-500/80 hover:text-white active:scale-90 transition"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-lg font-black text-slate-100">{it.qty}</span>
                    <button
                      onClick={() => changeQty(it.productId, 1)}
                      className="w-9 h-9 rounded-lg bg-slate-800 text-slate-200 font-black text-xl hover:bg-emerald-500/80 hover:text-white active:scale-90 transition"
                    >
                      +
                    </button>
                    <button
                      onClick={() => remove(it.productId)}
                      className="ml-0.5 w-8 h-8 rounded-lg text-slate-500 hover:text-rose-400 text-lg"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 rounded-2xl bg-slate-900 border border-slate-800 p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Subtotal</span>
            <span className="font-bold text-slate-100">{money(ticket.subtotal)}</span>
          </div>
          {glovo && (
            <div className="flex justify-between">
              <span className="text-slate-400">Glovo commission (20%)</span>
              <span className="font-bold text-amber-400">− {money(ticket.glovoFee)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-800 pt-1.5 text-base">
            <span className="font-black text-slate-200">Pay status</span>
            <span
              className={`font-black ${payStatus === "PAID" ? "text-emerald-400" : "text-rose-400"}`}
            >
              {payStatus}
            </span>
          </div>
        </div>

        <BigButton
          onClick={onCharge}
          disabled={charging || !items.length || !driver}
          className={`mt-3 w-full ${
            charging || !items.length || !driver
              ? "bg-slate-800 text-slate-500"
              : "bg-gradient-to-r from-sky-500 to-emerald-500 text-white shadow-lg shadow-sky-900/30"
          }`}
        >
          {charging ? "Saving…" : payStatus === "PAID" ? "SAVE & DISPATCH" : "DISPATCH · PENDING"}
        </BigButton>
      </div>
    </div>
  );
}