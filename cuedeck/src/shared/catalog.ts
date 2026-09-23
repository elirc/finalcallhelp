import type { ProviderMeta } from './domain';

/**
 * Typed provider catalog. Cloud model IDs live here — never inline in
 * adapters — so a provider-side rename is a one-line release change.
 * Verified against provider documentation on 2026-09-04.
 */

export const PROVIDERS: Record<string, ProviderMeta> = {
  demo: {
    id: 'demo',
    displayName: 'Demo (sample responses, no AI)',
    location: 'local',
    freePolicy: 'always-free-local',
    supportsAbort: true,
    kind: 'llm',
  },
  'local-whisper': {
    id: 'local-whisper',
    displayName: 'Local Whisper (Transformers.js)',
    location: 'local',
    freePolicy: 'always-free-local',
    supportsAbort: true,
    kind: 'stt',
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama (local)',
    location: 'local',
    freePolicy: 'always-free-local',
    supportsAbort: true,
    kind: 'llm',
  },
  'groq-whisper': {
    id: 'groq-whisper',
    displayName: 'Groq Whisper',
    location: 'cloud',
    freePolicy: 'provider-free-tier',
    supportsAbort: true,
    kind: 'stt',
    credentialId: 'groq',
    dataUseUrl: 'https://groq.com/privacy-policy',
    disclosure:
      'Audio clips are sent to Groq for transcription. Free-tier quotas apply and may change.',
  },
  groq: {
    id: 'groq',
    displayName: 'Groq',
    location: 'cloud',
    freePolicy: 'provider-free-tier',
    supportsAbort: true,
    kind: 'llm',
    dataUseUrl: 'https://groq.com/privacy-policy',
    disclosure:
      'Transcripts, your profile, and session notes are sent to Groq. Free-tier quotas apply and may change.',
  },
  'gemini-audio': {
    id: 'gemini-audio',
    displayName: 'Gemini (audio)',
    location: 'cloud',
    freePolicy: 'provider-free-tier',
    supportsAbort: true,
    kind: 'stt',
    credentialId: 'gemini',
    dataUseUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    disclosure:
      'Audio clips are sent to Google. Content submitted on the Gemini API free tier may be used to improve Google products.',
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    location: 'cloud',
    freePolicy: 'provider-free-tier',
    supportsAbort: true,
    kind: 'llm',
    dataUseUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    disclosure:
      'Transcripts, your profile, and session notes are sent to Google. Content submitted on the Gemini API free tier may be used to improve Google products.',
  },
  cerebras: {
    id: 'cerebras',
    displayName: 'Cerebras (free trial)',
    location: 'cloud',
    freePolicy: 'provider-free-tier',
    supportsAbort: true,
    kind: 'llm',
    dataUseUrl: 'https://www.cerebras.ai/privacy',
    disclosure:
      'Transcripts, your profile, and session notes are sent to Cerebras. Free-trial quotas and model availability may change.',
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter (free models)',
    location: 'cloud',
    freePolicy: 'provider-free-tier',
    supportsAbort: true,
    kind: 'llm',
    dataUseUrl: 'https://openrouter.ai/privacy',
    disclosure:
      'Transcripts, your profile, and session notes are routed to third-party model hosts chosen by OpenRouter. Free models have low daily quotas and variable availability.',
  },
};

export interface CatalogModel {
  id: string;
  displayName: string;
  providerId: string;
  /** Approximate download size for local models. */
  sizeBytes?: number;
  license?: string;
  /** The model new local setups pick; exactly one local model sets it. */
  recommended?: boolean;
}

/** Local Whisper-compatible ONNX models runnable by Transformers.js. */
export const LOCAL_STT_MODELS: CatalogModel[] = [
  {
    id: 'onnx-community/whisper-tiny',
    displayName: 'Whisper Tiny (fastest, ~120 MB)',
    providerId: 'local-whisper',
    sizeBytes: 120_000_000,
    license: 'MIT (OpenAI Whisper weights, ONNX conversion)',
  },
  {
    id: 'onnx-community/whisper-base',
    displayName: 'Whisper Base (recommended, ~200 MB)',
    providerId: 'local-whisper',
    sizeBytes: 200_000_000,
    license: 'MIT (OpenAI Whisper weights, ONNX conversion)',
    recommended: true,
  },
  {
    id: 'onnx-community/whisper-small',
    displayName: 'Whisper Small (best quality, ~600 MB)',
    providerId: 'local-whisper',
    sizeBytes: 600_000_000,
    license: 'MIT (OpenAI Whisper weights, ONNX conversion)',
  },
];

/** Cloud model IDs, isolated per spec §12. */
export const CLOUD_MODELS = {
  groqSttModel: 'whisper-large-v3-turbo',
  groqLlmModel: 'openai/gpt-oss-20b',
  geminiModel: 'gemini-2.5-flash',
  cerebrasModel: 'gpt-oss-120b',
  openRouterDefaultModel: 'openrouter/free',
} as const;

export const PROVIDER_KEY_URLS: Record<string, string> = {
  groq: 'https://console.groq.com/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  cerebras: 'https://cloud.cerebras.ai',
};

export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  'local-whisper': (LOCAL_STT_MODELS.find((model) => model.recommended) ?? LOCAL_STT_MODELS[0]).id,
  'groq-whisper': CLOUD_MODELS.groqSttModel,
  'gemini-audio': CLOUD_MODELS.geminiModel,
  ollama: '',
  demo: 'sample-response',
  groq: CLOUD_MODELS.groqLlmModel,
  gemini: CLOUD_MODELS.geminiModel,
  cerebras: CLOUD_MODELS.cerebrasModel,
  openrouter: CLOUD_MODELS.openRouterDefaultModel,
};

/** Small instruct models suggested in the UI when Ollama has none installed. */
export const RECOMMENDED_OLLAMA_MODELS = [
  'qwen2.5:3b-instruct',
  'llama3.2:3b',
  'phi3.5:3.8b',
] as const;
