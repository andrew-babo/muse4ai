// B11 — single redaction module for logs, diagnostics and user-visible errors.

const secretSet = new Set<string>();

export function registerSecret(value: string | null | undefined): void {
  if (value && value.length >= 3) secretSet.add(value);
}

export function clearSecrets(): void {
  secretSet.clear();
}

export function redact(input: unknown): string {
  let s = typeof input === "string" ? input : input instanceof Error ? `${input.name}: ${input.message}` : safeJson(input);
  for (const v of secretSet) if (v) s = s.split(v).join("‹bí mật›");
  s = s.replace(/([a-z0-9+.-]+:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1‹bí mật›@");
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "‹email›");
  s = s.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (_m, a, b, _c, d) => `${a}.${b}.•••.•${String(d).slice(-1)}`);
  s = s.replace(/\b(password|pass|pwd|token|secret|authorization|cookie)(["'\s:=]+)[^\s"',;]+/gi, "$1$2‹bí mật›");
  return s;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
