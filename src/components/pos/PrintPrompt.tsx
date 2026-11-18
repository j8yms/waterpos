"use client";

import { money } from "@/lib/pricing";
import type { DispatchOrder } from "@/lib/types";

export interface PrintPromptProps {
  order: DispatchOrder;
  items?: unknown[];
  onPrint: (order: DispatchOrder) => void;
  onClose: () => void;
}

/**
 * Pre-print confirmation. The operator can print the receipt or skip printing.
 * KRA eTIMS registration is handled directly on the official KRA portal.
 */
export default function PrintPrompt({
  order,
  onPrint,
  onClose,
}: PrintPromptProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ zIndex: 30 }}>
        <h2>Print receipt</h2>
        <p className="muted">
          Order <strong>#{order.id}</strong> — {order.customer}
        </p>
        <p className="muted">Total {money(order.total)}</p>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onPrint(order)}>
            Print receipt
          </button>
        </div>
      </div>
    </div>
  );
}
