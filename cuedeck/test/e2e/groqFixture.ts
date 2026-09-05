import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, READY_SETTINGS } from './helpers';
import { setupPreset } from '../../src/shared/setup';

interface GroqFixtureState {
  status: number;
  chatStatus: number;
  audioStatus: number;
  delayMs: number;
  chats: Array<{ model: string; messages: Array<{ role: string; content: string }> }>;
  audio: Array<{ model: string | null; language: string | null; bytes: number; header: string }>;
}

declare global {
  var __groqFixture: GroqFixtureState;
  var __downloadState: string;
  interface Window {
    __testAudio: { context: AudioContext; gain: GainNode; stream: MediaStream };
  }
}

/** No real keys, network inference, microphone, or system audio in these tests. */
export async function installGroqFixture(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    globalThis.__groqFixture = {
      status: 200,
      chatStatus: 200,
      audioStatus: 200,
      delayMs: 0,
      chats: [],
      audio: [],
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://api.groq.com') throw new Error('Network blocked by test');
      const fixture = globalThis.__groqFixture;
      const isChat = url.pathname.endsWith('/chat/completions');
      const isAudio = url.pathname.endsWith('/audio/transcriptions');
      const status =
        fixture.status !== 200
          ? fixture.status
          : isChat
            ? fixture.chatStatus
            : isAudio
              ? fixture.audioStatus
              : 200;
      if (status !== 200)
        return new Response(JSON.stringify({ error: { message: 'Synthetic provider failure' } }), {
          status,
        });
      if (isAudio) {
        const form = init?.body as FormData;
        const bytes = new Uint8Array(await (form.get('file') as File).arrayBuffer());
        fixture.audio.push({
          model: form.get('model') as string | null,
          language: form.get('language') as string | null,
          bytes: bytes.length,
          header: new TextDecoder().decode(bytes.slice(0, 12)),
        });
        return Response.json({
          text: 'Explain your approach to a difficult customer.',
          language: 'english',
        });
      }
      if (isChat) {
        fixture.chats.push(JSON.parse(String(init?.body)));
        const delayMs = fixture.delayMs;
        if (delayMs)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delayMs);
            init?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(init.signal?.reason);
              },
              { once: true },
            );
          });
        return new Response(
          'data: {"choices":[{"delta":{"content":"I would listen carefully and confirm the next step."}}]}\n\ndata: [DONE]\n\n',
        );
      }
      if (url.pathname.endsWith('/models')) return Response.json({ data: [] });
      throw new Error(`Unexpected Groq route: ${url.pathname}`);
    };
  });
}

export async function launchGroq(settings: Record<string, unknown> = {}) {
  const launched = await launchApp({
    seedSettings: { ...READY_SETTINGS, ...setupPreset('groq'), ...settings },
  });
  await installGroqFixture(launched.app);
  const page = await launched.app.firstWindow();
  await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_e2e_only'));
  await expect(page.getByTestId('listen-button')).toBeEnabled();
  return { ...launched, page };
}

export async function syntheticAudio(page: Page, silent = false): Promise<void> {
  await page.evaluate((silent) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      gain.gain.value = silent ? 0 : 0.1;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await context.resume();
      window.__testAudio = { context, gain, stream: destination.stream };
      return destination.stream;
    };
  }, silent);
}

export async function preferences(app: ElectronApplication, page: Page): Promise<Page> {
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('open-preferences').click(),
  ]);
  await expect(prefs.getByTestId('nav-general')).toBeVisible();
  return prefs;
}

export async function respond(page: Page, question: string): Promise<void> {
  await page.getByTestId('transcript-input').fill(question);
  await page.getByTestId('regenerate-button').click();
  await expect(page.getByTestId('phase-chip')).toContainText('Done');
  await expect(page.getByTestId('answer-text')).toContainText('I would listen carefully');
}
