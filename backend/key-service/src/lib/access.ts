export function resolveHeaderToken(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim() ?? null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

export function ensureHeaderToken(
  headerValue: string | string[] | undefined,
  expectedToken: string,
  label: 'service token' | 'admin token'
): void {
  const token = resolveHeaderToken(headerValue);
  if (!token || token !== expectedToken) {
    throw new Error(`Missing or invalid ${label}`);
  }
}