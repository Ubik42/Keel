import { extensionForRemoteContentType } from './remote-media-validation';
import { isIP } from 'node:net';
import { default as path } from 'node:path';

/**
 * Limits and checks for downloading web media: content types, file names, private addresses, redacted URLs.
 */
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export const DOWNLOAD_TIMEOUT_MS = 30_000;

export const MAX_DOWNLOAD_REDIRECTS = 30;

export function extensionForContentType(contentType: string): string | undefined {
  return extensionForRemoteContentType(contentType.toLowerCase());
}

export function cleanFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f<>:"/\\|?*\x7f]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim() || 'download';
}

export function prohibitedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

export function prohibitedIpAddress(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(address);
  if (family === 4) return prohibitedIpv4(address);
  if (family !== 6) return true;

  let normalized = address;
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (dottedTail) {
    const octets = dottedTail.split('.').map(Number);
    normalized = normalized.slice(0, -dottedTail.length) +
      `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const [leftText, rightText = ''] = normalized.split('::');
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
    .map((group) => Number.parseInt(group || '0', 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group))) return true;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  const first = groups[0]!;
  if ((first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      (first & 0xff00) === 0xff00 ||
      (first === 0x2001 && groups[1] === 0x0db8)) return true;
  const embeddedV4 = groups.slice(0, 5).every((group) => group === 0) &&
    (groups[5] === 0 || groups[5] === 0xffff);
  if (embeddedV4) {
    const ipv4 = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
    return prohibitedIpv4(ipv4);
  }
  return false;
}

export function parseContentDispositionFilename(header: string): string | undefined {
  const utf8Match = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim());
  }
  const match = header.match(/filename="?([^";\n]+)"?/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return undefined;
}

export function filenameFromUrl(urlString: string, contentType?: string): string {
  try {
    const url = new URL(urlString);
    const name = path.posix.basename(url.pathname);
    if (name && name !== '/') return cleanFilename(name);
  } catch {
    // Invalid URL; fall through to default.
  }
  const ext = contentType ? (extensionForContentType(contentType) ?? '') : '';
  return `download${ext}`;
}

export function sanitizedUrlForDiagnostic(urlString: string): string {
  try {
    const url = new URL(urlString);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

export function sanitizedUrlDiagnosticText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/giu, (candidate) =>
    sanitizedUrlForDiagnostic(candidate));
}

export function sanitizedUrlDiagnosticError(error: unknown, depth = 0): Error {
  if (depth > 5) return new Error('URL import error chain truncated.');
  if (!(error instanceof Error)) {
    return new Error(sanitizedUrlDiagnosticText(String(error)));
  }
  const sanitized = new Error(sanitizedUrlDiagnosticText(error.message));
  sanitized.name = error.name;
  if (error.stack) sanitized.stack = sanitizedUrlDiagnosticText(error.stack);
  const original = error as Error & { code?: unknown; reason?: unknown };
  const copy = sanitized as Error & { code?: string; reason?: string; cause?: unknown };
  if (typeof original.code === 'string') copy.code = original.code;
  if (typeof original.reason === 'string') copy.reason = original.reason;
  if (error.cause !== undefined) {
    copy.cause = sanitizedUrlDiagnosticError(error.cause, depth + 1);
  }
  return sanitized;
}
