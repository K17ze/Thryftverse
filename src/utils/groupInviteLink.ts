function decodeToken(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractGroupInviteToken(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const queryTokenMatch = trimmed.match(/[?&]token=([^&#\s]+)/i);
  if (queryTokenMatch?.[1]) {
    return decodeToken(queryTokenMatch[1]);
  }

  const pathTokenMatch = trimmed.match(/group-invite\/([A-Za-z0-9._~-]+)/i);
  if (pathTokenMatch?.[1]) {
    return decodeToken(pathTokenMatch[1]);
  }

  // Allow raw token input for manual join field usage.
  if (/^[A-Za-z0-9._~-]{8,260}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
