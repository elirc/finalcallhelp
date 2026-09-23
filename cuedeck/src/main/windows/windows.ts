import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { PreferencesSection } from '../../shared/domain';
import { hardenWebContents, rendererName, setTrustedDevOrigin } from '../security/windowSecurity';
import { COACH_MIN_SIZE, eyeLinePlacement, isMostlyVisible, type Rect } from './placement';

/**
 * Window factory. Both windows use the same sandboxed renderer bundle;
 * the preferences window navigates straight to the #/preferences route.
 * There is deliberately no `setContentProtection` call anywhere: the app
 * never hides itself from capture (spec §0.8, §17.18).
 */

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
function rendererEntry(): { devUrl?: string; file?: string } {
  const devUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;
  if (devUrl) {
    // Trust exactly this origin, not every localhost port.
    setTrustedDevOrigin(new URL(devUrl).origin);
    return { devUrl };
  }
  // Must match rendererEntrySuffix() in windowSecurity.ts.
  return { file: path.join(__dirname, `../renderer/${rendererName()}/index.html`) };
}

const SECURE_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  spellcheck: false,
} as const;

/** Eye-line bounds on the display that currently contains `reference` (or the primary one). */
export function eyeLineBoundsFor(reference?: Rect): Rect {
  const display = reference ? screen.getDisplayMatching(reference) : screen.getPrimaryDisplay();
  return eyeLinePlacement(display.workArea);
}

/**
 * Where the coach window opens: the remembered position when it is still on
 * a connected display, otherwise top-centre of the primary display (eye line).
 */
export function initialCoachBounds(remembered: Rect | null): Rect {
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  if (remembered && isMostlyVisible(remembered, displays)) return remembered;
  return eyeLineBoundsFor();
}

export function createCoachWindow(
  preloadPath: string,
  options: { alwaysOnTop: boolean; bounds: Rect },
): BrowserWindow {
  const win = new BrowserWindow({
    ...options.bounds,
    minWidth: COACH_MIN_SIZE.width,
    minHeight: COACH_MIN_SIZE.height,
    alwaysOnTop: options.alwaysOnTop,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    title: 'CueDeck',
    webPreferences: { ...SECURE_PREFERENCES, preload: preloadPath },
  });
  hardenWebContents(win);
  const entry = rendererEntry();
  if (entry.devUrl) void win.loadURL(`${entry.devUrl}#/`);
  else void win.loadFile(entry.file as string);
  win.once('ready-to-show', () => win.show());
  return win;
}

export function createPreferencesWindow(
  preloadPath: string,
  parent?: BrowserWindow,
  section: PreferencesSection = 'general',
): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 480,
    minHeight: 480,
    parent,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    title: 'CueDeck Preferences',
    webPreferences: { ...SECURE_PREFERENCES, preload: preloadPath },
  });
  hardenWebContents(win);
  const entry = rendererEntry();
  const hash = `/preferences/${section}`;
  if (entry.devUrl) void win.loadURL(`${entry.devUrl}#${hash}`);
  else void win.loadFile(entry.file as string, { hash });
  win.once('ready-to-show', () => win.show());
  return win;
}
