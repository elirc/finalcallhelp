import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type * as Electron from 'electron';
import { launchApp, READY_SETTINGS, startFakeOllama } from './helpers';

/**
 * Behaviour added in the 2026-09 improvement round: eye-line placement and
 * window memory, the reused preferences window with section deep links,
 * call-type profiles switched from the coach, two-step destructive buttons,
 * and onboarding progress. Screenshots saved here feed the user guide.
 */

const eyeLineState = ({
  BrowserWindow,
  screen,
}: {
  BrowserWindow: typeof Electron.BrowserWindow;
  screen: typeof Electron.screen;
}) => {
  const win = BrowserWindow.getAllWindows()[0];
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    top: Math.abs(bounds.y - area.y) <= 2,
    centred: Math.abs(bounds.x + bounds.width / 2 - (area.x + area.width / 2)) <= 2,
  };
};

test('opens at eye line, remembers a moved window across restarts, and ignores off-screen memory', async () => {
  const first = await launchApp({ seedSettings: READY_SETTINGS });
  const userData = first.userData;
  try {
    const page = await first.app.firstWindow();
    await expect(page.getByTestId('listen-button')).toBeVisible();
    expect(await first.app.evaluate(eyeLineState)).toEqual({ top: true, centred: true });
    await first.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 140, width: 820, height: 560 }),
    );
    // The memory is debounced (400 ms) before it is written.
    await page.waitForTimeout(1_000);
  } finally {
    await first.app.close();
  }

  const second = await launchApp({ userData });
  try {
    const page = await second.app.firstWindow();
    await expect(page.getByTestId('listen-button')).toBeVisible();
    const bounds = await second.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    expect(bounds).toMatchObject({ x: 120, y: 140, width: 820, height: 560 });
  } finally {
    await second.app.close();
  }

  // A position left behind on an unplugged monitor must not be restored.
  writeFileSync(
    path.join(userData, 'window-state.json'),
    JSON.stringify({ version: 1, coach: { x: -9000, y: -9000, width: 820, height: 560 } }),
  );
  const third = await launchApp({ userData });
  try {
    const page = await third.app.firstWindow();
    await expect(page.getByTestId('listen-button')).toBeVisible();
    expect(await third.app.evaluate(eyeLineState)).toEqual({ top: true, centred: true });
  } finally {
    await third.app.close();
  }
});

test('error banners deep-link to the right section and the preferences window is reused', async () => {
  // No server on this port: the local provider is unreachable.
  const { app } = await launchApp({
    seedSettings: { ...READY_SETTINGS, ollamaBaseUrl: 'http://127.0.0.1:59999' },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTestId('transcript-input').fill('Anything.');
    await page.getByTestId('regenerate-button').click();
    await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 15_000 });
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      page.getByTestId('error-banner').getByRole('button', { name: 'Open settings' }).click(),
    ]);
    // An unreachable local provider is a diagnostics problem, not a key problem.
    await expect(prefs.getByTestId('nav-diagnostics')).toHaveAttribute('aria-current', 'true');
    expect(app.windows().length).toBe(2);

    const prefsVisibility = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((w) => w.webContents.getURL().includes('preferences'))
          .map((w) => w.isVisible()),
      );
    // Closing hides the window instead of destroying it…
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('preferences'))
        ?.close(),
    );
    await expect.poll(prefsVisibility).toEqual([false]);
    expect(app.windows().length).toBe(2);
    // …so the next open is the same window, shown again on the requested section.
    await page.getByTestId('error-banner').getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('button', { name: 'Open provider settings' }).click();
    await expect.poll(prefsVisibility).toEqual([true]);
    await expect(prefs.getByTestId('nav-providers')).toHaveAttribute('aria-current', 'true');
    expect(app.windows().length).toBe(2);
  } finally {
    await app.close();
  }
});

test('switching the active profile from the coach changes the prompt and the practice category', async () => {
  const ollama = await startFakeOllama({ deltas: ['I would start with the constraints.'] });
  const { app } = await launchApp({
    seedSettings: { ...READY_SETTINGS, ollamaBaseUrl: ollama.baseUrl },
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      await window.cuedeck.saveProfile({
        name: 'Backend interviews',
        summary: 'Go engineer, 5 years.',
        roleContext: '',
        emphasisNotes: '',
        callType: 'technical-interview',
        techStack: 'Go, Postgres, Kafka',
      });
      await window.cuedeck.saveProfile({
        name: 'Sales demos',
        summary: 'Account executive.',
        roleContext: '',
        emphasisNotes: '',
        callType: 'sales-call',
        techStack: '',
      });
      // The coach refreshes its profile list when the window regains focus.
      window.dispatchEvent(new Event('focus'));
    });
    const switcher = page.getByTestId('profile-switcher');
    await expect(switcher.locator('option')).toHaveCount(3);
    const backend = await switcher
      .locator('option', { hasText: 'Backend interviews' })
      .getAttribute('value');
    await switcher.selectOption(backend as string);
    await expect(page.getByTestId('status-profile')).toContainText('Technical interview');
    await expect(page.getByTestId('practice-category')).toHaveValue('technical');

    await page.getByTestId('transcript-input').fill('How would you scale this service?');
    await page.getByTestId('regenerate-button').click();
    await expect(page.getByTestId('answer-text')).toContainText('constraints', {
      timeout: 15_000,
    });
    let sent = JSON.parse(ollama.chatBodies().at(-1) ?? '{}') as {
      messages: Array<{ content: string }>;
    };
    expect(sent.messages[0].content).toContain('technical interview');
    expect(sent.messages[1].content).toContain('<tech_stack>\nGo, Postgres, Kafka\n</tech_stack>');
    await page.evaluate(() => document.querySelector('.coach-body')?.scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/guide-coach-full.png' });

    const sales = await switcher
      .locator('option', { hasText: 'Sales demos' })
      .getAttribute('value');
    await switcher.selectOption(sales as string);
    await expect(page.getByTestId('status-profile')).toContainText('Sales');
    await page.getByTestId('regenerate-button').click();
    await expect(page.getByTestId('phase-chip')).toContainText('Done', { timeout: 15_000 });
    sent = JSON.parse(ollama.chatBodies().at(-1) ?? '{}');
    expect(sent.messages[0].content).toContain('sales or discovery call');
    expect(sent.messages[0].content).not.toContain('technical interview');
    expect(sent.messages[1].content).not.toContain('<tech_stack>');

    // Eye-line layout for the guide: controls plus the response only.
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await expect(page.getByTestId('transcript-input')).toHaveCount(0);
    await expect(page.getByTestId('answer-text')).toContainText('constraints');
    await page.evaluate(() => document.querySelector('.coach-body')?.scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/guide-coach-eyeline.png' });
  } finally {
    await app.close();
    await ollama.close();
  }
});

test('destructive buttons disarm on their own when not confirmed', async () => {
  const { app } = await launchApp({ seedSettings: READY_SETTINGS });
  try {
    const page = await app.firstWindow();
    await page.evaluate(() =>
      window.cuedeck.saveProfile({
        name: 'Keep me',
        summary: 'Still here.',
        roleContext: '',
        emphasisNotes: '',
        callType: 'behavioral-interview',
        techStack: '',
      }),
    );
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      page.getByTestId('open-preferences').click(),
    ]);
    await prefs.getByTestId('nav-profiles').click();
    const card = prefs.locator('.card.row').filter({ hasText: 'Keep me' });
    await expect(card).toContainText('Behavioral interview');
    await prefs.screenshot({ path: 'test-results/guide-preferences-profiles.png' });
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Confirm delete', exact: true })).toBeVisible();
    await prefs.waitForTimeout(4_500);
    await expect(card.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(card).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('onboarding shows its progress', async () => {
  const { app } = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('onboarding-step')).toHaveText('Step 1 of 5');
    await page.getByTestId('consent-checkbox').check();
    await page.getByTestId('consent-continue').click();
    await expect(page.getByTestId('onboarding-step')).toHaveText('Step 2 of 5');
    await page.getByTestId('choose-local').click();
    await expect(page.getByTestId('onboarding-step')).toHaveText('Step 3 of 5');
  } finally {
    await app.close();
  }
});
