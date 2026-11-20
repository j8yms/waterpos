"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, clearAuth, currentUser } from "@/lib/client";
import { money } from "@/lib/pricing";
import { BigButton } from "@/components/ui";
import { useRouter } from "next/navigation";

const DEFAULTS = {
  businessName: "MIST WATER AND GAS DISTRIBUTORS",
  businessTagline: "Bulk Water Supply",
  phone: "",
  address: "",
  footerText: "Thank you for your business!",
  width: "80",
  fontSize: "12",
  showQty: true,
  showPrices: true,
  showDiscounts: true,
  showDelivery: true,
  showPaymentMethod: true,
  showMpesaRef: true,
  showOutstanding: true,
  logoDataUrl: "",
};

export default function ReceiptSettings() {
  const router = useRouter();
  const me = currentUser();
  const [settings, setSettings] = useState<any>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ settings: any }>("/api/receipt-settings");
      setSettings({ ...DEFAULTS, ...(res.settings ?? {}) });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load settings.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function patch(p: any) { setSettings((s: any) => ({ ...s, ...p })); }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/receipt-settings", { method: "POST", body: { settings } });
      setMsg("Receipt settings saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => patch({ logoDataUrl: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  }

  const widthChars = settings.width === "58" ? 32 : 42;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">Receipt Settings</h1>
        <Link href="/pos" className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold">Back to POS</Link>
      </div>

      {msg && <div className="px-3 py-2 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-300 text-sm font-bold">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black">Business details</h2>
          <label className="block">
            <span className="text-[11px] text-slate-500 font-bold mb-1 block">Business name</span>
            <input value={settings.businessName} onChange={(e) => patch({ businessName: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500 font-bold mb-1 block">Tagline</span>
            <input value={settings.businessTagline} onChange={(e) => patch({ businessTagline: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500 font-bold mb-1 block">Phone</span>
            <input value={settings.phone} onChange={(e) => patch({ phone: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500 font-bold mb-1 block">Address</span>
            <input value={settings.address} onChange={(e) => patch({ address: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500 font-bold mb-1 block">Footer text</span>
            <input value={settings.footerText} onChange={(e) => patch({ footerText: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500 font-bold mb-1 block">Logo</span>
            <input type="file" accept="image/*" onChange={onLogo} className="w-full text-sm text-slate-300" />
            {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="logo" className="mt-2 h-12" />}
          </label>

          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black pt-2">Layout</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-500 font-bold mb-1 block">Width</span>
              <select value={settings.width} onChange={(e) => patch({ width: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100">
                <option value="58">58mm</option>
                <option value="80">80mm</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500 font-bold mb-1 block">Font size</span>
              <select value={settings.fontSize} onChange={(e) => patch({ fontSize: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100">
                <option value="10">Small</option>
                <option value="12">Normal</option>
                <option value="14">Large</option>
              </select>
            </label>
          </div>

          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black pt-2">Fields</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              ["showQty", "Quantities"],
              ["showPrices", "Prices"],
              ["showDiscounts", "Discounts"],
              ["showDelivery", "Delivery charges"],
              ["showPaymentMethod", "Payment method"],
              ["showMpesaRef", "M-Pesa reference"],
              ["showOutstanding", "Outstanding balance"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={!!settings[key]} onChange={(e) => patch({ [key]: e.target.checked })} />
                <span className="text-slate-200">{label}</span>
              </label>
            ))}
          </div>

          <BigButton onClick={save} disabled={busy} className="w-full bg-gradient-to-r from-sky-500 to-emerald-500 text-white">
            {busy ? "Saving..." : "Save settings"}
          </BigButton>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-white text-black p-4">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-black mb-2">Live preview</h2>
          <div style={{ width: settings.width === "58" ? "58mm" : "80mm", margin: "0 auto", fontFamily: "monospace", fontSize: settings.fontSize + "px" }}>
            {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="logo" style={{ maxHeight: 40, display: "block", margin: "0 auto" }} />}
            <div style={{ textAlign: "center", fontWeight: "bold" }}>{settings.businessName}</div>
            {settings.businessTagline && <div style={{ textAlign: "center" }}>{settings.businessTagline}</div>}
            <div>{"-".repeat(widthChars)}</div>
            <div>ORDER 12345</div>
            <div>2026-11-19 10:00</div>
            <div>{"-".repeat(widthChars)}</div>
            <div>CUST: Walk-in</div>
            {settings.phone && <div>TEL: {settings.phone}</div>}
            {settings.address && <div>ADD: {settings.address}</div>}
            <div>{"-".repeat(widthChars)}</div>
            <div>20L Jerry</div>
            {settings.showQty && <div>1 x 500.00          500.00</div>}
            <div>{"-".repeat(widthChars)}</div>
            <div style={{ fontWeight: "bold" }}>TOTAL          500.00</div>
            {settings.showPaymentMethod && <div>METHOD CASH</div>}
            {settings.showMpesaRef && <div>REF: ABC123</div>}
            <div>{"-".repeat(widthChars)}</div>
            <div style={{ textAlign: "center" }}>{settings.footerText}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
