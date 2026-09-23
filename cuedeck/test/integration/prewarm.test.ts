import { describe, expect, it } from 'vitest';
import type { AnswerRequest, LlmProvider, SttProvider } from '../../src/main/providers/contracts';
import { ProviderRegistry } from '../../src/main/providers/registry';
import { LocalWhisperProvider } from '../../src/main/providers/stt/localWhisper';
import { SessionCoordinator, type CoordinatorDeps } from '../../src/main/sessions/coordinator';
import type { SttWorkerManager } from '../../src/main/workers/sttWorkerManager';
import { PROVIDERS } from '../../src/shared/catalog';
import type { AnswerDelta, SessionEvent } from '../../src/shared/domain';

/**
 * Pre-warming both models (speech and response) outside any session. The
 * pipeline tests cover LLM warm-up during a session; these pin the startup /
 * arm-time path added in the 2026-09 round, which must warm both providers
 * at once, never emit to the renderer, and never fail.
 */

function makeHarness(overrides: {
  sttWarmup?: (modelId: string, signal: AbortSignal) => Promise<void>;
  llmWarmup?: (modelId: string, signal: AbortSignal) => Promise<void>;
}) {
  const registry = new ProviderRegistry();
  const stt: SttProvider = {
    meta: { ...PROVIDERS['local-whisper'] },
    probe: async () => ({ providerId: 'local-whisper', status: 'ready' }),
    listModels: async () => [],
    transcribe: async () => ({ text: 'unused' }),
    warmup: overrides.sttWarmup,
  };
  async function* generate(_input: AnswerRequest): AsyncIterable<AnswerDelta> {
    yield { text: 'unused', sequence: 0 };
  }
  const llm: LlmProvider = {
    meta: { ...PROVIDERS.ollama },
    probe: async () => ({ providerId: 'ollama', status: 'ready' }),
    listModels: async () => [],
    generate,
    warmup: overrides.llmWarmup,
  };
  registry.registerStt(stt);
  registry.registerLlm(llm);
  const events: SessionEvent[] = [];
  const deps: CoordinatorDeps = {
    registry,
    getSettings: async () => ({
      sttProviderId: 'local-whisper',
      sttModelId: 'onnx-community/whisper-base',
      sttLanguage: 'auto',
      llmProviderId: 'ollama',
      llmModelId: 'qwen2.5:3b-instruct',
      historyEnabled: false,
      historyRetentionDays: 7,
      maxClipSeconds: 90,
      activeProfileId: undefined,
    }),
    getProfile: async () => null,
    saveHistory: async () => undefined,
    emit: (event) => events.push(event),
    recordError: () => undefined,
  };
  return { coordinator: new SessionCoordinator(deps), events };
}

describe('SessionCoordinator.prewarm', () => {
  it('warms the speech model and the response model concurrently with their configured ids', async () => {
    const started: string[] = [];
    let releaseAll!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const note = (name: string) => {
      started.push(name);
      if (started.length === 2) releaseAll();
    };
    const warmed: Record<string, string> = {};
    const { coordinator, events } = makeHarness({
      // Each warm-up waits for the other to have started; a sequential
      // implementation would deadlock here and hit the test timeout.
      sttWarmup: async (modelId) => {
        warmed.stt = modelId;
        note('stt');
        await bothStarted;
      },
      llmWarmup: async (modelId) => {
        warmed.llm = modelId;
        note('llm');
        await bothStarted;
      },
    });
    await coordinator.prewarm();
    expect(started.sort()).toEqual(['llm', 'stt']);
    expect(warmed).toEqual({ stt: 'onnx-community/whisper-base', llm: 'qwen2.5:3b-instruct' });
    expect(events).toHaveLength(0);
  });

  it('still warms the response model when the speech warm-up throws', async () => {
    let llmWarmed = false;
    const { coordinator, events } = makeHarness({
      sttWarmup: async () => {
        throw new Error('model files vanished');
      },
      llmWarmup: async () => {
        llmWarmed = true;
      },
    });
    await expect(coordinator.prewarm()).resolves.toBeUndefined();
    expect(llmWarmed).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('is a no-op when neither provider supports warm-up', async () => {
    const { coordinator, events } = makeHarness({});
    await expect(coordinator.prewarm()).resolves.toBeUndefined();
    expect(events).toHaveLength(0);
  });
});

describe('LocalWhisperProvider.warmup', () => {
  function makeProvider(installed: string[]) {
    const loaded: string[] = [];
    const fakeManager = {
      isInstalled: async (modelId: string) => installed.includes(modelId),
      ensureModel: async (
        modelId: string,
        _onProgress: unknown,
        _signal: AbortSignal,
        options?: { allowDownload?: boolean },
      ) => {
        // Warmup must never let the worker fetch model files.
        expect(options?.allowDownload).not.toBe(true);
        loaded.push(modelId);
      },
    } as unknown as SttWorkerManager;
    const provider = new LocalWhisperProvider(fakeManager, async () => installed[0] ?? 'none');
    return { provider, loaded };
  }

  it('loads an installed model into the worker', async () => {
    const { provider, loaded } = makeProvider(['onnx-community/whisper-base']);
    await provider.warmup('onnx-community/whisper-base', AbortSignal.timeout(1_000));
    expect(loaded).toEqual(['onnx-community/whisper-base']);
  });

  it('never triggers a download for a model that is not installed', async () => {
    const { provider, loaded } = makeProvider([]);
    await provider.warmup('onnx-community/whisper-base', AbortSignal.timeout(1_000));
    expect(loaded).toEqual([]);
  });
});
