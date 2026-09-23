import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { menuTemplate } from '../../src/main/windows/menu';

function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role.toLowerCase()] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ]);
}

describe('application menu', () => {
  it('has no menu in packaged builds, so no reload/close/devtools accelerators', () => {
    expect(menuTemplate(true)).toBeNull();
  });

  it('keeps reload and DevTools in development, without full screen or close', () => {
    const template = menuTemplate(false);
    expect(template).not.toBeNull();
    const all = roles(template ?? []);
    expect(all).toContain('reload');
    expect(all).toContain('toggledevtools');
    expect(all).toContain('copy');
    expect(all).toContain('paste');
    expect(all).not.toContain('togglefullscreen');
    expect(all).not.toContain('close');
    expect(all).not.toContain('quit');
  });
});
