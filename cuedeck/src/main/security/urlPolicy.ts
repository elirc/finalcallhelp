import { EXTERNAL_LINK_ALLOWLIST } from '../../shared/constants';

/** Pure URL policy shared by window security and tests (no Electron imports). */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return EXTERNAL_LINK_ALLOWLIST.some((allowed) => {
    const a = new URL(allowed);
    return url.hostname === a.hostname && url.pathname.startsWith(a.pathname);
  });
}

export interface TrustedAppUrlOptions {
  /** Path suffix of the packaged renderer entry, e.g. `/renderer/main_window/index.html`. */
  entryPathSuffix: string;
  /** Exact origin of the Vite dev server, when the app was started from it. */
  devOrigin?: string;
  /** Unpackaged builds without a known dev origin accept any loopback http page. */
  allowAnyLocalhost: boolean;
}

/**
 * Whether a URL is the app's own renderer: the exact entry file (any hash
 * route), or the exact dev-server origin. Any other `file:` document or
 * localhost port is untrusted.
 */
export function isTrustedAppUrlPure(rawUrl: string, opts: TrustedAppUrlOptions): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') {
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    return pathname.toLowerCase().endsWith(opts.entryPathSuffix.toLowerCase());
  }
  if (url.protocol === 'http:') {
    if (opts.devOrigin !== undefined && url.origin === opts.devOrigin) return true;
    return opts.allowAnyLocalhost && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  }
  return false;
}
