import { app, shell, session, type BrowserWindow, type WebContents } from 'electron';
import { isAllowedExternalUrl, isTrustedAppUrlPure } from './urlPolicy';

export { isAllowedExternalUrl } from './urlPolicy';

/**
 * Window/session hardening (spec §17). Navigation away from the app is
 * denied, window creation is denied, permissions are denied by default,
 * and openExternal only accepts parsed HTTPS URLs from a fixed allowlist.
 */

declare const MAIN_WINDOW_VITE_NAME: string | undefined;

/** Folder name of the renderer bundle (Forge's Vite plugin sets it at build time). */
export function rendererName(): string {
  return typeof MAIN_WINDOW_VITE_NAME !== 'undefined' ? MAIN_WINDOW_VITE_NAME : 'main_window';
}

/** Path suffix of the packaged renderer entry file; windows.ts loads the same file. */
export function rendererEntrySuffix(): string {
  return `/renderer/${rendererName()}/index.html`;
}

let trustedDevOrigin: string | undefined;

/** Called by windows.ts with the exact Vite dev-server origin when there is one. */
export function setTrustedDevOrigin(origin: string | undefined): void {
  trustedDevOrigin = origin;
}

export function isTrustedAppUrl(rawUrl: string): boolean {
  return isTrustedAppUrlPure(rawUrl, {
    entryPathSuffix: rendererEntrySuffix(),
    devOrigin: trustedDevOrigin,
    // Unpackaged runs without a known dev server (e.g. tests of a built
    // bundle) keep the old loopback allowance; packaged builds never do.
    allowAnyLocalhost: !app.isPackaged && trustedDevOrigin === undefined,
  });
}

export function isTrustedSender(contents: WebContents | undefined | null): boolean {
  if (!contents || contents.isDestroyed()) return false;
  return isTrustedAppUrl(contents.getURL());
}

export async function openExternalChecked(rawUrl: string): Promise<boolean> {
  if (!isAllowedExternalUrl(rawUrl)) return false;
  await shell.openExternal(new URL(rawUrl).toString());
  return true;
}

export function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

export function hardenSession(captureGrant: { isArmed(): boolean }): void {
  const ses = session.defaultSession;

  // Deny every permission the app does not use, and everything for untrusted
  // frames. Sanitized clipboard *writes* (the Copy button) are always allowed.
  // Media is needed by the armed display-media flow (Electron checks it before
  // the display-media handler consumes the grant), so it is allowed only while
  // a capture grant is armed; otherwise getUserMedia would reach the
  // microphone at any time.
  const permitted = (contents: WebContents | null, permission: string): boolean => {
    if (!isTrustedSender(contents)) return false;
    if (permission === 'clipboard-sanitized-write') return true;
    if (permission === 'media') return captureGrant.isArmed();
    return false;
  };
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permitted(webContents, permission));
  });
  ses.setPermissionCheckHandler((webContents, permission) =>
    permitted(webContents ?? null, permission),
  );

  // CSP header on every response we serve. Dev needs the Vite client
  // (inline bootstrap + websocket); packaged builds get the strict policy.
  const policy = app.isPackaged ? CSP_POLICY : DEV_CSP_POLICY;
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('devtools:') || details.url.startsWith('chrome-extension:')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

export const DEV_CSP_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

export const CSP_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');
