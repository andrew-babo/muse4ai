/** "1" → one, anything else → other; accepts numbers already formatted in either language ("1.234", "1,234"). */
export function plural(n: string | number, one: string, other: string): string {
  const v = typeof n === "number" ? n : Number(String(n).replace(/[.,\s\u00a0]/g, ""));
  return v === 1 ? one : other;
}
