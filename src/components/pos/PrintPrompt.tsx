"use client";

import { money } from "@/lib/pricing";
import type { DispatchOrder } from "@/lib/types";

export default function PrintPrompt({
  order,
  onPrint,
  onClose,
}: {
  order: DispatchOrder;
  onPrint: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-3xl">
            ✅
          </div>
          <h2 className="mt-3 text-lg font-black text-emerald-300">DISPATCH SAVED</h2>
          <p className="text-sm text-slate-400 mt-1">Order {order.id}</p>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-950 border border-slate-800 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Customer</span>
            <span className="font-bold text-slate-100 truncate ml-3">{order.customer}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Item</span>
            <span className="font-bold text-slate-100 truncate ml-3">{order.product}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Payment</span>
            <span
              className={`font-black ${
                order.pay_status === "PAID" ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {order.pay_status}
            </span>
          </div>
          <div className="flex justify-between border-t border-slate-800 pt-1.5 text-base">
            <span className="font-black">Total</span>
            <span className="font-black text-sky-300">{money(order.total)}</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onPrint}
            className="h-16 rounded-2xl bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-black text-base shadow-lg shadow-sky-900/40 transition active:scale-[0.97]"
          >
            🖨️ PRINT RECEIPT
          </button>
          <button
            onClick={onClose}
            className="h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-base transition active:scale-[0.97]"
          >
            ❌ SKIP PRINTING
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-3">
          M-Pesa reference will auto-print at the top when matched.
        </p>
      </div>
    </div>
  );
}