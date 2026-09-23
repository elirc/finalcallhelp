import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, READY_SETTINGS, startFakeOllama } from './helpers';
import { CLOUD_MODELS } from '../../src/shared/catalog';

test('first-run demo works without keys, model downloads, or audio capture', async () => {
  const { app } = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.getByTestId('consent-checkbox').check();
    await page.getByTestId('consent-continue').click();
    await page.getByTestId('choose-demo').click();
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('listen-button')).toBeDisabled();
    await page.getByTestId('practice-draw').click();
    await page.getByTestId('regenerate-button').click();
    await expect(page.getByTestId('answer-text')).toContainText('fixed example');
    await expect(page.getByTestId('phase-chip')).toContainText('Done');
    await page.getByTestId('copy-button').click();
    await expect(page.getByTestId('copy-button')).toContainText('Copied');
    await page.screenshot({ path: 'test-results/demo-coach.png', fullPage: true });
    await page.getByRole('button', { name: 'Set up real AI' }).click();
    await page.getByTestId('choose-cloud').click();
    await expect(page.getByRole('button', { name: 'Get Groq API key' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/cloud-setup.png', fullPage: true });
  } finally {
    await app.close();
  }
});

test('settings from Preferences update the Coach without restarting', async () => {
  const { app } = await launchApp({
    seedSettings: { ...READY_SETTINGS, llmProviderId: 'demo', llmModelId: 'sample-response' },
  });
  try {
    const page = await app.firstWindow();
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      page.getByTestId('open-preferences').click(),
    ]);
    await prefs.getByLabel('Compact coach layout', { exact: false }).check();
    await expect(page.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();
    await prefs.getByTestId('nav-providers').click();
    await expect(prefs.getByTestId('cloud-setup')).toBeVisible();
    await prefs.getByRole('button', { name: 'Switch everything to local-only' }).click();
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByTestId('phase-chip')).toContainText('Setup needed');
  } finally {
    await app.close();
  }
});

test('typed questions work with Ollama while speech model setup is incomplete', async () => {
  const server = await startFakeOllama({ deltas: ['A real provider response.'] });
  const { app } = await launchApp({
    seedSettings: { ...READY_SETTINGS, ollamaBaseUrl: server.baseUrl },
  });
  try {
    const page = await app.firstWindow();
    const banner = page.getByTestId('readiness-banner');
    await expect(banner).toContainText(/Listen is off/);
    await expect(page.getByTestId('listen-button')).toBeDisabled();
    await page.getByTestId('transcript-input').fill('How would you approach this?');
    await page.getByTestId('regenerate-button').click();
    await expect(page.getByTestId('answer-text')).toContainText('A real provider response.');
    // The answer keeps the top of the window; the notice sits under it.
    await expect(banner).toBeVisible();
    const top = async (testId: string) =>
      (await page.getByTestId(testId).boundingBox())?.y ?? Number.NaN;
    const answerTop = await top('answer-text');
    const bannerTop = await top('readiness-banner');
    const transcriptTop = await top('transcript-input');
    expect(answerTop).toBeLessThan(bannerTop);
    expect(bannerTop).toBeLessThan(transcriptTop);
  } finally {
    await app.close();
    await server.close();
  }
});

test('cloud setup tests inference, selects both Groq models, and clears the key field', async () => {
  const { app } = await launchApp({
    seedSettings: { consentAcknowledgedAt: READY_SETTINGS.consentAcknowledgedAt },
  });
  try {
    // Keep the entire E2E suite free and offline. Only the provider HTTP boundary is faked.
    await app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith('https://api.groq.com/')) {
          if (init?.method === 'POST')
            return new Response(
              'data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n',
            );
          return new Response('{"data":[]}');
        }
        return original(input, init);
      };
    });
    const page = await app.firstWindow();
    await page.getByTestId('choose-cloud').click();
    await page.locator('input[type="password"]').fill('test-key-for-offline-e2e');
    await page.getByRole('button', { name: 'Save and test' }).click();
    await expect(page.getByText('Sample response received.', { exact: false })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveValue('');
    const settings = await page.evaluate(() => window.cuedeck.getPublicSettings());
    expect(settings.sttModelId).toBe(CLOUD_MODELS.groqSttModel);
    expect(settings.llmModelId).toBe(CLOUD_MODELS.groqLlmModel);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    await page.getByLabel('Cloud provider', { exact: true }).selectOption('openrouter');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('Preferences removes a downloaded local speech model after a confirm step', async () => {
  const modelId = 'onnx-community/whisper-base';
  const userData = mkdtempSync(path.join(os.tmpdir(), 'cuedeck-e2e-'));
  const modelsDir = path.join(userData, 'models');
  const fileName = 'onnx-community/whisper-base/onnx/dummy.onnx';
  const dummy = path.join(modelsDir, ...fileName.split('/'));
  mkdirSync(path.dirname(dummy), { recursive: true });
  writeFileSync(dummy, Buffer.alloc(64, 1));
  writeFileSync(
    path.join(modelsDir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      models: [
        {
          modelId,
          installedAt: '2026-09-22T00:00:00.000Z',
          files: [{ name: fileName, bytes: 64 }],
        },
      ],
    }),
  );
  const { app } = await launchApp({
    userData,
    seedSettings: {
      ...READY_SETTINGS,
      sttProviderId: 'local-whisper',
      sttModelId: modelId,
      llmProviderId: 'demo',
      llmModelId: 'sample-response',
    },
  });
  try {
    const page = await app.firstWindow();
    const [prefs] = await Promise.all([
      app.waitForEvent('window'),
      page.getByTestId('open-preferences').click(),
    ]);
    await prefs.getByTestId('nav-providers').click();
    const option = prefs.locator('option', { hasText: 'Whisper Base' });
    await expect(option).toContainText('installed');
    const remove = prefs.getByTestId('remove-model-button');
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(remove).toHaveText('Confirm remove');
    await remove.click();
    await expect(prefs.getByText('about 200 MB freed')).toBeVisible();
    await expect(option).not.toContainText('installed');
    await expect(remove).toBeDisabled();
    expect(existsSync(dummy)).toBe(false);
  } finally {
    await app.close();
  }
});
