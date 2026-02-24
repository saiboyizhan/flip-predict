/**
 * SSRF protection utilities for URL validation.
 * Rejects URLs pointing to private/internal network addresses.
 */

export function isPrivateUrl(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '[::1]') return true;
  // IPv4 private ranges
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  // Unspecified address
  if (lower === '0.0.0.0') return true;
  // IPv6 loopback
  if (lower === '::1') return true;
  return false;
}

/**
 * Normalize an optional HTTP(S) URL with SSRF protection.
 * Returns null if the value is not a valid http/https URL or points to a private address.
 */
export function normalizeOptionalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // SSRF protection: reject private IP ranges
    if (isPrivateUrl(url.hostname)) return null;
    return trimmed;
  } catch {
    return null;
  }
}
