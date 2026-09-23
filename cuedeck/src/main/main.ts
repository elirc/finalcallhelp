import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  safeStorage,
  session,
  webContents,
} from 'electron';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type {
  OperationEvent,
  PreferencesSection,
  PublicSettings,
  ReadinessChange,
  SessionEvent,
} from '../shared/domain';
import { Diagnostics } from './diagnostics';
import { registerIpc, type AppServices } from './ipc/register';
import { ProviderRegistry } from './providers/registry';
import { CerebrasLlmProvider } from './providers/llm/cerebras';
import { DemoLlmProvider } from './providers/llm/demo';
import { GeminiLlmProvider } from './providers/llm/gemini';
import { GroqLlmProvider } from './providers/llm/groq';
import { OllamaProvider } from './providers/llm/ollama';
import { OpenRouterProvider } from './providers/llm/openRouter';
import { GeminiAudioProvider } from './providers/stt/geminiAudio';
import { GroqWhisperProvider } from './providers/stt/groqWhisper';
import { LocalWhisperProvider } from './providers/stt/localWhisper';
import { CaptureGrant } from './security/captureGrant';
import { hardenSession, isTrustedAppUrl } from './security/windowSecurity';
import { PublicSettingsStore } from './settings/publicStore';
import { SecretVault } from './settings/secretVault';
import { SessionCoordinator } from './sessions/coordinator';
import { HistoryStore } from './storage/historyStore';
import { ProfileStore } from './storage/profileStore';
import {
  createCoachWindow,
  createPreferencesWindow,
  eyeLineBoundsFor,
  initialCoachBounds,
} from './windows/windows';
import { menuTemplate } from './windows/menu';
import { WindowStateStore } from './windows/windowState';
import { SttWorkerManager } from './workers/sttWorkerManager';

if (started) {
  app.quit();
}

// E2E-test hook: isolate user data (settings, secrets, history) per run.
// Harmless in production, where the variable is unset.
if (process.env.CUEDECK_USER_DATA) {
  app.setPath('userData', process.env.CUEDECK_USER_DATA);
}

let coachWindow: BrowserWindow | null = null;
let preferencesWindow: BrowserWindow | null = null;
/** Set once the app or the coach window is going away, so the preferences
 *  window really closes instead of hiding for reuse. */
let shuttingDown = false;

function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function broadcast(
  channel: 'session:event' | 'operation:event' | 'settings:changed' | 'readiness:changed',
  payload: SessionEvent | OperationEvent | PublicSettings | ReadinessChange,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const modelsDir = path.join(userData, 'models');

  // Created first so the stores can report quarantined files. Its
  // settings and worker lookups are closures that only run later.
  const diagnostics = new Diagnostics(
    app.getVersion(),
    async () => {
      const s = await settings.get();
      return { stt: s.sttProviderId, llm: s.llmProviderId };
    },
    () => {
      const status = sttWorkers.getStatus();
      return status.modelId ? `${status.state} (${status.modelId})` : status.state;
    },
  );
  const reportCorrupt = (file: string, q: string) =>
    diagnostics.recordError('STORAGE_FAILED', `quarantined ${file} as ${path.basename(q)}`);

  const settings = new PublicSettingsStore(userData, reportCorrupt);
  const secrets = new SecretVault(userData, safeStorage, reportCorrupt);
  const history = new HistoryStore(userData, reportCorrupt);
  const profiles = new ProfileStore(userData, reportCorrupt);
  const windowState = new WindowStateStore(userData, reportCorrupt);
  const captureGrant = new CaptureGrant();
  const sttWorkers = new SttWorkerManager(
    path.join(__dirname, 'sttWorker.js'),
    modelsDir,
    reportCorrupt,
  );

  await settings.get();
  if (settings.readOnlyReason === 'newer-version') {
    diagnostics.recordError(
      'STORAGE_FAILED',
      'settings.json was written by a newer CueDeck; changes will not be saved',
    );
  }
  // A quarantined (or missing) vault leaves `configured` flags pointing at
  // keys that are gone; clear them once so the UI asks for the key again.
  try {
    const stored = new Set(await secrets.listProviderIds());
    for (const [id, flag] of Object.entries((await settings.get()).credentials)) {
      if (flag.configured && !stored.has(id)) await settings.setCredentialFlag(id, false);
    }
  } catch {
    // The vault could not be read at all; leave the flags for the next run.
  }

  const registry = new ProviderRegistry();
  const keyFor = (providerId: string) => () => secrets.getForAdapter(providerId);
  registry.registerStt(
    new LocalWhisperProvider(sttWorkers, async () => (await settings.get()).sttModelId),
  );
  registry.registerStt(new GroqWhisperProvider(keyFor('groq')));
  registry.registerStt(new GeminiAudioProvider(keyFor('gemini')));
  registry.registerLlm(new OllamaProvider(async () => (await settings.get()).ollamaBaseUrl));
  registry.registerLlm(new GroqLlmProvider(keyFor('groq')));
  registry.registerLlm(new CerebrasLlmProvider(keyFor('cerebras')));
  registry.registerLlm(new GeminiLlmProvider(keyFor('gemini')));
  registry.registerLlm(new OpenRouterProvider(keyFor('openrouter')));
  registry.registerLlm(new DemoLlmProvider());

  const coordinator = new SessionCoordinator({
    registry,
    getSettings: () => settings.get(),
    getProfile: (id) => profiles.get(id),
    saveHistory: (item, retentionDays) => history.add(item, retentionDays),
    emit: (event) => broadcast('session:event', event),
    recordError: (code, message) => diagnostics.recordError(code, message),
  });

  const openPreferencesWindow = (section?: PreferencesSection) => {
    if (preferencesWindow && !preferencesWindow.isDestroyed()) {
      // Reused rather than re-created: a hidden window re-shows instantly,
      // where a fresh one re-parses the whole renderer bundle.
      if (section) preferencesWindow.webContents.send('preferences:navigate', { section });
      preferencesWindow.show();
      preferencesWindow.focus();
      return;
    }
    preferencesWindow = createPreferencesWindow(preloadPath(), coachWindow ?? undefined, section);
    preferencesWindow.on('close', (event) => {
      if (shuttingDown || !coachWindow || coachWindow.isDestroyed()) return;
      event.preventDefault();
      preferencesWindow?.hide();
    });
    preferencesWindow.on('closed', () => {
      preferencesWindow = null;
    });
  };

  const services: AppServices = {
    settings,
    secrets,
    history,
    profiles,
    registry,
    coordinator,
    captureGrant,
    diagnostics,
    sttWorkers,
    capabilities: () => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      osVersion: os.release(),
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    }),
    broadcast,
    openPreferencesWindow,
    dockEyeLine: async () => {
      const win = coachWindow;
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      win.setBounds(eyeLineBoundsFor(win.getBounds()), true);
      // Eye line only helps if the window stays above the call; persist it
      // through the normal settings path so the Preferences switch agrees.
      const updated = await settings.patch({ alwaysOnTop: true });
      win.setAlwaysOnTop(true);
      broadcast('settings:changed', updated);
      win.focus();
    },
    applyWindowSettings: async () => {
      const s = await settings.get();
      if (coachWindow && !coachWindow.isDestroyed()) {
        coachWindow.setAlwaysOnTop(s.alwaysOnTop);
      }
    },
  };

  hardenSession(captureGrant);

  // No default application menu in packaged builds (its Reload, Close, Full
  // Screen and DevTools accelerators stay live with the bar hidden).
  const template = menuTemplate(app.isPackaged);
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);

  // Armed, one-use display-media grant (spec §5.2-E). Every request that
  // does not follow an explicit `capture:arm` from a trusted frame within
  // the TTL is denied.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const frameUrl = request.frame?.url ?? '';
    // Only the WebContents that armed the grant may use it.
    const requesterId = request.frame ? webContents.fromFrame(request.frame)?.id : undefined;
    if (!isTrustedAppUrl(frameUrl) || !captureGrant.consume(requesterId)) {
      callback({});
      return;
    }
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }
        // The smallest disposable video source Electron requires on
        // Windows, plus system loopback audio. The renderer stops the
        // video track immediately; only audio is processed.
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  });

  registerIpc(services);

  const [initial, remembered] = await Promise.all([settings.get(), windowState.loadCoachBounds()]);
  const win = createCoachWindow(preloadPath(), {
    alwaysOnTop: initial.alwaysOnTop,
    bounds: initialCoachBounds(remembered),
  });
  coachWindow = win;
  const remember = () => {
    if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized())
      windowState.rememberCoachBounds(win.getBounds());
  };
  win.on('move', remember);
  win.on('resize', remember);
  win.on('close', () => {
    shuttingDown = true;
    // Synchronous: window-all-closed quits without waiting for async work.
    windowState.flushSync();
  });
  win.on('closed', () => {
    coachWindow = null;
    if (preferencesWindow && !preferencesWindow.isDestroyed()) preferencesWindow.destroy();
  });
  win.once('ready-to-show', () => {
    // Load the selected models while the user is reading the screen, not
    // while they are waiting for the first answer. Never downloads.
    if (initial.onboardingComplete) void coordinator.prewarm();
  });
}

if (!app.requestSingleInstanceLock()) {
  // Another CueDeck is running; it focuses its window on 'second-instance'.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (coachWindow && !coachWindow.isDestroyed()) {
      if (coachWindow.isMinimized()) coachWindow.restore();
      coachWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on('before-quit', () => {
    shuttingDown = true;
  });

  // The app quits when its last window closes on every platform, so there
  // is no macOS-style 'activate' re-open: re-running bootstrap() would
  // re-register every IPC handler and throw.
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
