"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/pricing";
import { BigButton, Toggle } from "@/components/ui";

const QUICK_TILES = [200, 500, 1000, 2000];

export interface CheckoutPayload {
  paymentMethod: "CASH" | "MPESA" | "CREDIT";
  tendered: number;
  change: number;
  mpesaCode: string;
  customerName: string;
  phone: string;
  location: string;
  print: boolean;
}

export default function CheckoutModal({
  open,
  onClose,
  onRegister,
  charging,
  total,
  driver,
  initialCustomerName = "",
  initialPhone = "",
  initialLocation = "",
  glovo,
  setGlovo,
  initialMethod = null,
}: {
  open: boolean;
  onClose: () => void;
  onRegister: (payload: CheckoutPayload) => void;
  charging: boolean;
  total: number;
  driver: string;
  initialCustomerName?: string;
  initialPhone?: string;
  initialLocation?: string;
  glovo: boolean;
  setGlovo: (v: boolean) => void;
  initialMethod?: "CASH" | "MPESA" | "CREDIT" | null;
}) {
  const [method, setMethod] = useState<"CASH" | "MPESA" | "CREDIT" | null>(null);
  const [tendered, setTendered] = useState("");
  const [mpesaCode, setMpesaCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => {
    if (open) {
      setMethod(initialMethod);
      setTendered("");
      setMpesaCode("");
      setCustomerName(initialCustomerName);
      setPhone(initialPhone);
      setLocation(initialLocation);
    }
  }, [open, initialMethod, initialCustomerName, initialPhone, initialLocation]);

  if (!open) return null;

  const isDispatch = driver.trim().length > 0 && driver.trim().toUpperCase() !== "WALK-IN";
  const tenderedNum = Number(tendered) || 0;
  const change = method === "CASH" ? Math.max(0, tenderedNum - total) : 0;
  const insufficient = method === "CASH" && tenderedNum > 0 && tenderedNum < total;
  const creditNeedsName = method === "CREDIT" && customerName.trim().length === 0;
  const registerReady =
    !!method &&
    !charging &&
    !creditNeedsName &&
    !(total > 0 && method === "CASH" && tenderedNum < total);

  function select(next: "CASH" | "MPESA" | "CREDIT") {
    setMethod(next);
  }

  function payload(print: boolean): CheckoutPayload {
    return {
      paymentMethod: method ?? "CASH",
      tendered: method === "CASH" ? tenderedNum : 0,
      change,
      mpesaCode: mpesaCode.trim(),
      customerName: customerName.trim(),
      phone: phone.trim(),
      location: location.trim(),
      print,
    };
  }

  function register() {
    if (!method || !registerReady) return;
    onRegister(payload(true));
  }

  function completeWithoutPrint() {
    if (!method || !registerReady) return;
    onRegister(payload(false));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-4 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-100">Checkout</h2>
            <p className="text-xs text-slate-500">
              {isDispatch ? `Dispatch · ${driver}` : "Walk-in customer"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-100 font-black"
            aria-label="Close checkout"
          >
            ✕
          </button>
        </div>

        {/* Payment method tiles: CASH, M-PESA and CREDIT */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => select("CASH")}
            className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition active:scale-[0.97] ${
              method === "CASH"
                ? "border-emerald-400 bg-emerald-500/15 text-emerald-300"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-600"
            }`}
          >
            <span className="text-2xl">💵</span>
            <span className="text-sm font-black">CASH</span>
          </button>
          <button
            onClick={() => select("MPESA")}
            className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition active:scale-[0.97] ${
              method === "MPESA"
                ? "border-emerald-400 bg-emerald-500/15 text-emerald-300"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-600"
            }`}
          >
            <span className="text-2xl">📱</span>
            <span className="text-sm font-black">M-PESA</span>
          </button>
          <button
            onClick={() => select("CREDIT")}
            className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition active:scale-[0.97] ${
              method === "CREDIT"
                ? "border-amber-400 bg-amber-500/15 text-amber-300"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-600"
            }`}
          >
            <span className="text-2xl">📒</span>
            <span className="text-sm font-black">CREDIT</span>
          </button>
        </div>

        {/* CREDIT payer capture — customer name + phone (madeni pay-later) */}
        {method === "CREDIT" && (
          <div className="rounded-2xl border border-amber-600/40 bg-slate-900 p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-amber-400/90 font-black">
              Credit customer (pay later)
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Customer Name *
              </span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. B. Otieno"
                autoFocus
                className="w-full h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-500 outline-none text-slate-100 text-base"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Phone (optional)
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
                placeholder="e.g. 07XX XXX XXX"
                inputMode="tel"
                className="w-full h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-500 outline-none text-slate-100 text-base"
              />
            </label>
          </div>
        )}

        {/* Dispatch location — only when a real rider is assigned (≠ WALK-IN) */}
        {isDispatch && (
          <div className="rounded-2xl border border-sky-700/50 bg-slate-900 p-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Delivery Location / House
              </span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Marina Bay, House 12"
                className="w-full h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
              />
            </label>
          </div>
        )}

        {/* Cash change dialog */}
        {method === "CASH" && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-500 font-black">
                Total Amount Due
              </span>
              <span className="text-xl font-black text-emerald-400">{money(total)}</span>
            </div>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Amount Tendered / Received
              </span>
              <input
                value={tendered}
                onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 focus:border-emerald-500 outline-none text-slate-100 text-lg font-black"
              />
            </label>

            <div className="grid grid-cols-4 gap-2">
              {QUICK_TILES.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setTendered(String(amt))}
                  className="h-11 rounded-xl bg-slate-800 text-slate-200 font-black text-sm hover:bg-slate-700 active:scale-95 transition"
                >
                  {amt.toLocaleString()}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTendered(String(total))}
                className="h-11 rounded-xl bg-sky-500/15 text-sky-300 font-black text-sm hover:bg-sky-500/25 active:scale-95 transition"
              >
                EXACT ({total.toLocaleString()})
              </button>
              <button
                onClick={() => setTendered("")}
                className="h-11 rounded-xl bg-slate-800 text-slate-400 font-black text-sm hover:bg-slate-700 active:scale-95 transition"
              >
                CLEAR
              </button>
            </div>

            <div className="flex items-baseline justify-between border-t border-slate-800 pt-2">
              <span className="text-xs uppercase tracking-wider text-slate-500 font-black">
                Change Owed to Customer
              </span>
              <span
                className={`text-xl font-black ${
                  insufficient ? "text-rose-400" : "text-sky-400"
                }`}
              >
                {tenderedNum === 0 ? money(0) : insufficient ? "INSUFFICIENT" : money(change)}
              </span>
            </div>
          </div>
        )}

        {/* M-PESA reference */}
        {method === "MPESA" && (
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">
              M-PESA confirmation code (manual fallback)
            </span>
            <div className="text-[10px] text-slate-600 mb-1">
              Optional. The SMS webhook auto-matches your transactions — type a code here
              only when auto-matching hasn't run. M-PESA orders stay PENDING until matched.
            </div>
            <input
              value={mpesaCode}
              onChange={(e) => setMpesaCode(e.target.value.toUpperCase())}
              placeholder="e.g. S9XK2L3Q4R"
              maxLength={12}
              autoComplete="off"
              className="w-full h-12 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none text-slate-100 text-base"
            />
          </label>
        )}

        {/* Sales channel toggle — not a payment method */}
        <Toggle checked={glovo} onChange={setGlovo} label="Glovo Order (20% commission deducted)" accent="amber" />


        {/* Action nodes */}
        <div className="pt-1 space-y-2">
          <BigButton
            onClick={register}
            disabled={!registerReady || !method}
            className={`w-full ${
              registerReady && method
                ? "bg-gradient-to-r from-emerald-500 to-sky-500 text-white shadow-lg shadow-emerald-900/30"
                : "bg-slate-800 text-slate-500"
            }`}
          >
            {charging ? "Saving…" : "REGISTER TRANSACTION & PRINT"}
          </BigButton>
          <button
            onClick={completeWithoutPrint}
            disabled={!registerReady || !method || charging}
            className="w-full h-14 rounded-2xl bg-slate-800/60 text-slate-300 font-black hover:bg-slate-800 active:scale-[0.98] transition"
          >
            [ COMPLETE TRANSACTION WITHOUT PRINTING ]
          </button>
        </div>
      </div>
    </div>
  );
}