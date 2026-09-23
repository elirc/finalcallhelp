import type { MenuItemConstructorOptions } from 'electron';

/**
 * Application menu template. Packaged builds get no menu at all: the default
 * Electron menu keeps Reload, Close, Toggle Full Screen and DevTools
 * accelerators live even with the menu bar hidden, and any of them mid-call
 * would drop the session or cover the meeting. Text fields keep native
 * cut/copy/paste without an Edit menu. Development builds keep a small menu
 * for reloading and DevTools.
 */
export function menuTemplate(isPackaged: boolean): MenuItemConstructorOptions[] | null {
  if (isPackaged) return null;
  return [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
    },
  ];
}
