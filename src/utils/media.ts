const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)(\?.*)?$/i;

export function isVideoUri(uri?: string | null): boolean {
  if (!uri) {
    return false;
  }

  const normalized = uri.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (VIDEO_EXT_RE.test(normalized)) {
    return true;
  }

  if (/^content:\/\//.test(normalized) && /\/video\//.test(normalized)) {
    return true;
  }

  if (/\/video\//.test(normalized)) {
    return true;
  }

  return false;
}

export function getFirstImageUri(uris: string[]): string | undefined {
  return uris.find((uri) => !isVideoUri(uri));
}

export function getListingCoverUri(uris: string[], fallback: string): string {
  return getFirstImageUri(uris) ?? uris[0] ?? fallback;
}

export function filterImageUris(uris: string[], limit?: number): string[] {
  const imageUris = uris.filter((uri) => !isVideoUri(uri));
  if (typeof limit === 'number') {
    return imageUris.slice(0, Math.max(0, limit));
  }

  return imageUris;
}
