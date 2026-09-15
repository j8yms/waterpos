"use client";

import { useState } from "react";

import { money } from "@/lib/pricing";
import type { DispatchOrder, EtimsItem } from "@/lib/types";

export interface PrintPromptProps {
  order: DispatchOrder;
  items?: EtimsItem[];
  onEtimsRegister?: (kraPin: string) => Promise<DispatchOrder>;
  onPrint: (order: DispatchOrder) => void;
  onClose: () => void;
}

/**
 * Pre-print confirmation. When the order has not yet been entered in KRA
 * eTIMS, the operator can flip the fiscal toggle on, type the customer's KRA
 * PINlint, and we register the invoice first — then print the receipt with the
 * fiscal footer + verification QR. Busy/error are explicit; nothing is silent.
 */
export default function PrintPrompt({
  order,
  items,
  onEtimsRegister,
  onPrint,
  onClose,
}: PrintPromptProps) {
  const [etimsOn, setEtimsOn] = useState(false);
  const [kraPin, setKraPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const wantsEtims = etimsOn && !order.etims_num && !!onEtimsRegister;
  const hasItems = !!items && items.length > 0;
  const alreadyRegistered = !!order.etims_num;
  const canGo = busy ? false : alreadyRegistered ? true : wantsEtims ? hasItems && !!kraPin.trim() : true;

  async function doPrint() {
    setErr("");
    if (busy) return;
    if (order.etims_num) {
      onPrint(order);
      return;
    }
    if (!wantsEtims) {
      onPrint(order);
      return;
    }
    setBusy(true);
    try {
      const updated = await onEtimsRegister(kraPin.trim());
      onPrint(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "eTIMS registration failed");
      setBusy(false);
    }
  }

  const statusText = order.etims_num
    ? `eTIMS INV #${order.etims_num}`
    : "Not yet eTIMS registered";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="chip" data-state={order.etims_num ? "ok" : "warn"}>
          {statusText}
        </span>
        <h2>Print receipt</h2>
        <p className="muted">
          Order <strong>#{order.id}</strong> — {order.customer}
        </p>

        {!order.etims_num && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={etimsOn}
              onChange={(e) => setEtimsOn(e.target.checked)}
            />
            <span>KRA eTIMS fiscal receipt (VAT 16%)</span>
          </label>
        )}

        {wantsEtims && !hasItems && (
          <p className="warn">
            No line items found — KRA requires a per-item breakdown. Add items
            before registering.
          </p>
        )}

        {wantsEtims && (
          <label className="field">
            <span>Customer KRA PIN</span>
            <input
              value={kraPin}
              onChange={(e) => setKraPin(e.target.value.toUpperCase())}
              placeholder="e.g. A012345678P"
              maxLength={14}
              autoFocus
            />
          </label>
        )}

        {err && <p className="error">{err}</p>}

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={doPrint}
            disabled={!canGo}
          >
            {busy
              ? "Registering…"
              : wantsEtims
                ? "Register & print"
                : "Print receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}
