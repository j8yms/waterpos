/** Pure, dependency-free numeric helpers (safe to import from client code). */
export function toNumber(v: any): number {
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return NaN;
    // Only accept well-formed numeric strings; reject timestamps, text, etc.
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return NaN;
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}