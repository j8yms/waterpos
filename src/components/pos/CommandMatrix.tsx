"use client";

import { useEffect, useRef, useState } from "react";
import { Toggle } from "@/components/ui";

function MatrixTile({
  shortcut,
  label,
  tone,
  onClick,
  className = "",
  disabled = false,
  armed = false,
}: {
  shortcut: string;
  label: string;
  tone: "green" | "slate" | "blue" | "amber" | "red";
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  armed?: boolean;
}) {
  const toneClass =
    tone === "green"
      ? "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-900/40"
      : tone === "blue"
        ? "bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700"
        : tone === "amber"
          ? "bg-slate-800 hover:bg-amber-600/30 text-amber-300 border border-slate-700"
          : tone === "red"
            ? "bg-slate-800 hover:bg-rose-600/30 text-rose-300 border border-slate-700"
            : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative rounded-2xl flex flex-col items-center justify-center gap-1 select-none transition active:scale-[0.96] ${toneClass} ${className} ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      } ${armed ? "ring-2 ring-rose-400" : ""}`}
    >
      <span className="absolute top-1.5 left-2 text-[10px] font-black opacity-70">{shortcut}</span>
      <span className="text-sm font-black px-1 text-center leading-tight">{label}</span>
    </button>
  );
}

/**
 * Right 40% pane — tactile 4-column command tile matrix (Aronium-style):
 * F10 Payment launcher (double height green), Cash / M-PESA / GLOVO method
 * tiles, red Delete + Void Order, and the admin-only eTIMS sub-panel.
 */
export default function CommandMatrix({
  hasItems,
  selected,
  glovo,
  onToggleGlovo,
  onPayment,
  onCash,
  onMpesa,
  onDelete,
  onVoid,
  etimsOn,
  setEtimsOn,
  kraPin,
  setKraPin,
  showAdmin,
}: {
  hasItems: boolean;
  selected: string | null;
  glovo: boolean;
  onToggleGlovo: () => void;
  onPayment: () => void;
  onCash: () => void;
  onMpesa: () => void;
  onDelete: () => void;
  onVoid: () => void;
  etimsOn: boolean;
  setEtimsOn: (v: boolean) => void;
  kraPin: string;
  setKraPin: (v: string) => void;
  showAdmin: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function voidTap() {
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 2500);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onVoid();
  }

  return (
    <section className="flex flex-col min-h-0 h-full gap-3">
      <div className="grid grid-cols-4 grid-rows-[repeat(2,minmax(0,1fr))] auto-rows-[minmax(0,1fr)] gap-2 flex-1 min-h-[240px]">
        <MatrixTile
          shortcut="F10"
          label={hasItems ? "PAYMENT" : "PAYMENT"}
          tone="green"
          className="col-span-2 row-span-2 text-lg"
          onClick={onPayment}
          disabled={!hasItems}
        />
        <MatrixTile shortcut="F12" label="CASH" tone="blue" onClick={onCash} disabled={!hasItems} />
        <MatrixTile shortcut="F4" label="M-PESA" tone="slate" onClick={onMpesa} disabled={!hasItems} />
        <button
          onClick={onToggleGlovo}
          disabled={!hasItems}
          className={`relative rounded-2xl flex flex-col items-center justify-center gap-1 select-none transition active:scale-[0.96] ${
            glovo
              ? "bg-gradient-to-b from-amber-400 to-amber-500 text-white shadow-lg shadow-amber-900/40"
              : "bg-slate-800 hover:bg-amber-600/30 text-amber-300 border border-slate-700"
          } ${!hasItems ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          <span className="absolute top-1.5 left-2 text-[10px] font-black opacity-70">F5</span>
          <span className="text-sm font-black px-1 text-center leading-tight">
            {glovo ? "GLOVO ON" : "GLOVO"}
          </span>
          <span className={`text-[9px] font-bold ${glovo ? "text-white/80" : "text-amber-500/60"}`}>
            channel
          </span>
        </button>
        <MatrixTile
          shortcut="F8"
          label={selected ? "DELETE LINE" : "DELETE LAST"}
          tone="red"
          onClick={onDelete}
          disabled={!hasItems}
        />
        <MatrixTile
          shortcut="F9"
          label={armed ? "TAP AGAIN TO VOID" : "VOID ORDER"}
          tone="red"
          className="col-span-4 row-span-1"
          onClick={voidTap}
          disabled={!hasItems}
          armed={armed}
        />
      </div>

      {/* Administrative sub-panel: KRA eTIMS (management only) */}
      {showAdmin && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] uppercase tracking-wider text-slate-500 font-black">
              Admin · KRA eTIMS
            </h2>
            <span className="text-[10px] font-bold text-slate-600">Vinnie · Emma · Tracy</span>
          </div>
          <Toggle checked={glovo} onChange={onToggleGlovo} label="Glovo Order (20% commission)" accent="amber" />
          <Toggle checked={etimsOn} onChange={setEtimsOn} label="Generate KRA eTIMS" accent="sky" />
          {etimsOn && (
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Customer KRA PIN
              </span>
              <input
                value={kraPin}
                onChange={(e) => setKraPin(e.target.value.toUpperCase())}
                placeholder="e.g. A012345678P"
                maxLength={14}
                autoComplete="off"
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none text-slate-100 text-base"
              />
            </label>
          )}
        </div>
      )}
    </section>
  );
}