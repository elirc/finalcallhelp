import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CLOUD_MODELS } from '../../src/shared/catalog';
import { setupPreset } from '../../src/shared/setup';
import {
  installGroqFixture,
  launchGroq,
  preferences,
  respond,
  syntheticAudio,
} from './groqFixture';
import { launchApp, READY_SETTINGS } from './helpers';

test('Groq onboarding recovers from an invalid key and completes the audio check', async () => {
  const { app } = await launchApp({
    seedSettings: { consentAcknowledgedAt: READY_SETTINGS.consentAcknowledgedAt },
  });
  try {
    await installGroqFixture(app);
    await app.evaluate(() => {
      globalThis.__groqFixture.status = 401;
    });
    const page = await app.firstWindow();
    await page.getByTestId('choose-cloud').click();
    await page.locator('input[type=password]').fill('synthetic_invalid_key');
    await page.getByRole('button', { name: 'Save and test', exact: true }).click();
    await expect(page.getByTestId('cloud-setup')).toContainText(/key|credential/i);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save and test', exact: true })).toBeEnabled();
    await app.evaluate(() => {
      globalThis.__groqFixture.status = 200;
    });
    await page.locator('input[type=password]').fill('synthetic_valid_key');
    await page.getByRole('button', { name: 'Save and test', exact: true }).click();
    await expect(page.getByText('Sample response received.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await syntheticAudio(page);
    await page.getByRole('button', { name: 'Run 5-second test' }).click();
    await expect(page.getByText('System audio is healthy.', { exact: false })).toBeVisible({
      timeout: 12000,
    });
    expect(await app.evaluate(() => globalThis.__groqFixture.audio.length)).toBe(0);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByTestId('finish-onboarding').click();
    await expect(page.getByTestId('listen-button')).toBeEnabled();
    await respond(page, 'How can I prepare for a support call?');
  } finally {
    await app.close();
  }
});

test('Listen encodes real worklet audio into WAV and sends the selected Groq models and language', async () => {
  const { app, page } = await launchGroq({ sttLanguage: 'en', autoStopOnSilence: false });
  try {
    await syntheticAudio(page);
    await page.getByTestId('listen-button').click();
    await expect(page.getByTestId('recording-indicator')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1400); // collect actual AudioWorklet frames
    await page.getByTestId('stop-button').click();
    await expect(page.getByTestId('phase-chip')).toContainText('Done');
    await expect(page.getByTestId('transcript-input')).toHaveValue(
      'Explain your approach to a difficult customer.',
    );
    const requests = await app.evaluate(() => globalThis.__groqFixture);
    expect(requests.audio).toHaveLength(1);
    expect(requests.audio[0]).toMatchObject({ model: CLOUD_MODELS.groqSttModel, language: 'en' });
    expect(requests.audio[0].bytes).toBeGreaterThan(16000);
    expect(requests.audio[0].header).toMatch(/^RIFF.{4}WAVE$/s);
    expect(requests.chats.at(-1)?.model).toBe(CLOUD_MODELS.groqLlmModel);
    expect(
      await page.evaluate(() =>
        window.__testAudio.stream.getTracks().every((t) => t.readyState === 'ended'),
      ),
    ).toBe(true);
    await page.getByTestId('copy-button').click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      'I would listen carefully and confirm the next step.',
    );
  } finally {
    await app.close();
  }
});

test('speech followed by silence triggers auto-response without pressing Stop', async () => {
  const { app, page } = await launchGroq({ autoStopOnSilence: true });
  try {
    await syntheticAudio(page);
    await page.getByTestId('listen-button').click();
    await expect(page.getByTestId('recording-indicator')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      window.__testAudio.gain.gain.value = 0;
    });
    await expect(page.getByTestId('phase-chip')).toContainText('Done', { timeout: 12000 });
    expect(await app.evaluate(() => globalThis.__groqFixture.audio.length)).toBe(1);
  } finally {
    await app.close();
  }
});

test('cancel and silent audio leave no uploads and allow another session', async () => {
  const { app, page } = await launchGroq();
  try {
    await syntheticAudio(page);
    await page.getByTestId('listen-button').click();
    await expect(page.getByTestId('recording-indicator')).toBeVisible();
    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('listen-button')).toBeEnabled();
    expect(await app.evaluate(() => globalThis.__groqFixture.audio.length)).toBe(0);
    expect(
      await page.evaluate(() =>
        window.__testAudio.stream.getTracks().every((t) => t.readyState === 'ended'),
      ),
    ).toBe(true);
    await syntheticAudio(page, true);
    await page.getByTestId('listen-button').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('stop-button').click();
    await expect(page.getByTestId('error-banner')).toContainText(/silence|silent/i);
    expect(await app.evaluate(() => globalThis.__groqFixture.audio.length)).toBe(0);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await respond(page, 'Continue with a typed question.');
  } finally {
    await app.close();
  }
});

test('Groq quota errors and cancelled generation recover without saving failed answers', async () => {
  const { app, page } = await launchGroq({ historyEnabled: true });
  try {
    await app.evaluate(() => {
      globalThis.__groqFixture.chatStatus = 429;
    });
    await page.getByTestId('transcript-input').fill('A synthetic quota test');
    await page.getByTestId('regenerate-button').click();
    await expect(page.getByTestId('error-banner')).toContainText(/limit|quota/i);
    expect(await page.evaluate(() => window.cuedeck.listHistory())).toEqual([]);
    await app.evaluate(() => {
      globalThis.__groqFixture.chatStatus = 200;
      globalThis.__groqFixture.delayMs = 3000;
    });
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByTestId('transcript-input').fill('Cancel this response');
    await page.getByTestId('regenerate-button').click();
    await expect.poll(() => app.evaluate(() => globalThis.__groqFixture.chats.length)).toBe(1);
    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('listen-button')).toBeEnabled();
    await app.evaluate(() => {
      globalThis.__groqFixture.delayMs = 0;
    });
    await respond(page, 'A successful recovery');
    await expect
      .poll(() => page.evaluate(() => window.cuedeck.listHistory().then((items) => items.length)))
      .toBe(1);
    expect((await page.evaluate(() => window.cuedeck.listHistory()))[0].transcript).toBe(
      'A successful recovery',
    );
  } finally {
    await app.close();
  }
});

test('profiles, notes, answer modes, and follow-ups reach Groq; deleting the active profile clears it', async () => {
  const { app, page } = await launchGroq();
  try {
    const prefs = await preferences(app, page);
    await prefs.getByTestId('nav-profiles').click();
    await prefs.getByRole('button', { name: 'New profile' }).click();
    await prefs.getByLabel('Name', { exact: true }).fill('Synthetic support profile');
    await prefs
      .getByLabel('Background / resume summary')
      .fill('I organize customer support tickets.');
    await prefs.getByLabel('Role / call context').fill('Practice for a support role.');
    await prefs.getByLabel('Things to emphasize').fill('Patient communication.');
    await prefs.getByLabel('Call type').selectOption('customer-support');
    await prefs
      .getByLabel('Tech stack and domain', { exact: false })
      .fill('Zendesk, SLA reporting');
    await prefs.getByRole('button', { name: 'Save profile' }).click();
    const card = prefs.locator('.card.row').filter({ hasText: 'Synthetic support profile' });
    await expect(card).toContainText('Customer support');
    await card.getByRole('button', { name: 'Make active' }).click();
    await expect(card).toContainText('active');
    // The coach shows the active profile and lets the user switch without Preferences.
    await expect(page.getByTestId('status-profile')).toContainText('Customer support');
    await expect(page.getByTestId('profile-switcher')).toHaveValue(/.+/);
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await prefs
      .getByLabel('Background / resume summary')
      .fill('I resolve customer support tickets.');
    await prefs.getByRole('button', { name: 'Save profile' }).click();
    await page.getByTestId('session-notes-input').fill('Mention the next step.');
    await page
      .getByRole('group', { name: 'answer mode', exact: true })
      .getByRole('button', { name: 'Clarify' })
      .click();
    await respond(page, 'How do you handle an unclear request?');
    let sent = await app.evaluate(() => globalThis.__groqFixture.chats.at(-1));
    expect(sent?.messages[1].content).toContain('I resolve customer support tickets.');
    expect(sent?.messages[1].content).toContain('Mention the next step.');
    expect(sent?.messages[1].content).toContain('Requested mode: clarify');
    expect(sent?.messages[1].content).toContain(
      '<tech_stack>\nZendesk, SLA reporting\n</tech_stack>',
    );
    expect(sent?.messages[0].content).toContain('customer support conversation');
    await page
      .getByRole('group', { name: 'response follow-ups' })
      .getByRole('button', { name: 'Shorter', exact: true })
      .click();
    await expect(page.getByTestId('phase-chip')).toContainText('Done');
    sent = await app.evaluate(() => globalThis.__groqFixture.chats.at(-1));
    expect(sent?.messages[1].content).toContain('Target speaking time: 15 seconds');
    await expect(page.getByTestId('answer-stats')).toContainText('15 s target');
    expect((await page.evaluate(() => window.cuedeck.getPublicSettings())).targetSeconds).toBe(30);
    // Destructive actions are two-step: arm, then confirm.
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await card.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.cuedeck.getPublicSettings())).activeProfileId,
    ).toBeUndefined();
    await page.getByTestId('notes-clear').click();
    await respond(page, 'Now without personal context.');
    expect(
      (await app.evaluate(() => globalThis.__groqFixture.chats.at(-1)))?.messages[1].content,
    ).not.toContain('<profile_data>');
  } finally {
    await app.close();
  }
});

test('history search, real file exports, retention changes, and deletion stay consistent', async () => {
  const { app, page, userData } = await launchGroq({ historyEnabled: true });
  try {
    await respond(page, 'Current support session');
    await expect
      .poll(() => page.evaluate(() => window.cuedeck.listHistory().then((items) => items.length)))
      .toBe(1);
    const current = (await page.evaluate(() => window.cuedeck.listHistory()))[0];
    await writeFile(
      path.join(userData, 'history.json'),
      JSON.stringify([
        current,
        {
          ...current,
          id: 'older-fixture',
          transcript: 'Older retained session',
          createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
      ]),
    );
    const prefs = await preferences(app, page);
    await prefs.getByTestId('nav-history').click();
    await expect(prefs.locator('table.history tr')).toHaveCount(2);
    await prefs.getByTestId('history-search').fill('CURRENT');
    await expect(prefs.locator('table.history tr')).toHaveCount(1);
    for (const format of ['JSON', 'Markdown']) {
      const destination = path.join(userData, `export-${format.toLowerCase()}.txt`);
      // Electron owns downloads and the native Save dialog; exercise the real
      // download while replacing only the human's destination selection.
      await app.evaluate(({ session }, destination) => {
        globalThis.__downloadState = 'waiting';
        session.defaultSession.once('will-download', (_event, item) => {
          globalThis.__downloadState = 'started';
          item.setSavePath(destination);
          item.once('done', (_event, state) => {
            globalThis.__downloadState = state;
          });
        });
      }, destination);
      await prefs.getByRole('button', { name: `Export ${format}`, exact: true }).click();
      await expect.poll(() => app.evaluate(() => globalThis.__downloadState)).toBe('completed');
      const contents = await readFile(destination, 'utf8');
      expect(contents).toContain('Current support session');
      expect(contents).toContain('Older retained session'); // search only filters the table
      if (format === 'JSON') expect(JSON.parse(contents)).toHaveLength(2);
    }
    await prefs.getByTestId('history-search').fill('');
    await prefs.getByLabel('Keep history for').selectOption('1');
    await expect(prefs.locator('table.history tr')).toHaveCount(1);
    expect(await page.evaluate(() => window.cuedeck.exportHistory())).toHaveLength(1);
    await prefs.getByTestId('history-toggle').click();
    await expect(prefs.getByTestId('history-toggle')).not.toBeChecked();
    expect(await page.evaluate(() => window.cuedeck.exportHistory())).toEqual([]);
    await prefs.getByRole('button', { name: 'Delete all', exact: true }).click();
    await prefs.getByRole('button', { name: 'Confirm delete all', exact: true }).click();
    await prefs.getByTestId('history-toggle').click();
    await expect(prefs.locator('table.history tr')).toHaveCount(0);
    await respond(page, 'Delete this individual row');
    await prefs.getByRole('button', { name: 'Refresh history' }).click();
    await expect(prefs.locator('table.history tr')).toHaveCount(1);
    await prefs
      .locator('table.history tr')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(prefs.locator('table.history tr')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('diagnostics exclude personal content by default and never expose the saved key', async () => {
  const { app, page } = await launchGroq({ historyEnabled: true });
  try {
    await page.evaluate(async () => {
      const p = await window.cuedeck.saveProfile({
        name: 'Private fixture',
        summary: 'Personal profile fixture',
        roleContext: 'Private role',
        emphasisNotes: '',
      });
      await window.cuedeck.updatePublicSettings({ activeProfileId: p.id });
    });
    await respond(page, 'Private transcript fixture');
    await expect
      .poll(() => page.evaluate(() => window.cuedeck.listHistory().then((items) => items.length)))
      .toBe(1);
    const prefs = await preferences(app, page);
    await prefs.getByTestId('nav-diagnostics').click();
    await prefs.getByRole('button', { name: 'Copy diagnostics to clipboard' }).click();
    await expect(prefs.getByRole('button', { name: /Copied/ })).toBeVisible();
    const basic = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(basic).not.toContain('Personal profile fixture');
    expect(basic).not.toContain('Private transcript fixture');
    expect(basic).not.toContain('gsk_synthetic_e2e_only');
    await prefs.getByLabel('Include recent transcripts', { exact: false }).check();
    await prefs.getByLabel('Include active profile text', { exact: false }).check();
    await prefs.getByRole('button', { name: /Copy diagnostics|Copied/ }).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('Personal profile fixture');
    const expanded = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(expanded).toContain('Private transcript fixture');
    expect(expanded).not.toContain('gsk_synthetic_e2e_only');
  } finally {
    await app.close();
  }
});

test('removing a Groq key updates readiness in the coach immediately', async () => {
  const { app, page } = await launchGroq();
  try {
    const prefs = await preferences(app, page);
    await prefs.getByLabel('Keep the coach window on top', { exact: false }).check();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().includes('preferences'))
            ?.isAlwaysOnTop(),
        ),
      )
      .toBe(true);
    await prefs.getByLabel('Target speaking time').selectOption('15');
    await prefs.getByLabel('Transcription language').selectOption('es');
    await prefs.getByTestId('nav-providers').click();
    const keyRow = prefs
      .locator('.field')
      .filter({ has: prefs.locator('strong', { hasText: 'Groq' }) });
    await keyRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByTestId('listen-button')).toBeDisabled();
    await page.getByTestId('transcript-input').fill('Key required');
    await expect(page.getByTestId('regenerate-button')).toBeDisabled();
    const saved = await page.evaluate(() => window.cuedeck.getPublicSettings());
    expect(saved.credentials.groq).toBeUndefined();
    expect(saved.targetSeconds).toBe(15);
    expect(saved.sttLanguage).toBe('es');
  } finally {
    await app.close();
  }
});

test('replacing a rejected Groq key refreshes coach readiness without Check again', async () => {
  const { app } = await launchApp({ seedSettings: { ...READY_SETTINGS, ...setupPreset('groq') } });
  try {
    await installGroqFixture(app);
    await app.evaluate(() => {
      globalThis.__groqFixture.status = 401;
    });
    const page = await app.firstWindow();
    await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_bad_key'));
    await expect(page.getByTestId('readiness-banner')).toContainText(/rejected/i, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('listen-button')).toBeDisabled();
    await app.evaluate(() => {
      globalThis.__groqFixture.status = 200;
    });
    // The credential flag is already true, so only the readiness push can
    // tell the coach that the replacement key needs a fresh probe.
    await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_good_key'));
    await expect(page.getByTestId('listen-button')).toBeEnabled({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('the first Check again after a provider recovers bypasses the cached failure', async () => {
  const { app } = await launchApp({ seedSettings: { ...READY_SETTINGS, ...setupPreset('groq') } });
  try {
    await installGroqFixture(app);
    await app.evaluate(() => {
      globalThis.__groqFixture.status = 500;
    });
    const page = await app.firstWindow();
    await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_key'));
    await expect(page.getByTestId('readiness-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('listen-button')).toBeDisabled();
    await app.evaluate(() => {
      globalThis.__groqFixture.status = 200;
    });
    // Inside the 5 s failure TTL: a cached probe would repeat the 500.
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('listen-button')).toBeEnabled({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});
