/** Pure, dependency-free numeric helpers (safe to import from client code). */
export function toNumber(v: any): number {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : 0;
}