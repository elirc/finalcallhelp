import { CLOUD_MODELS, PROVIDERS } from '../../../shared/catalog';
import { OpenAiCompatibleLlmProvider } from './openAiCompatible';

export const CEREBRAS_DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';

/**
 * Cerebras public inference; free-trial limits depend on the account.
 */
export class CerebrasLlmProvider extends OpenAiCompatibleLlmProvider {
  constructor(getApiKey: () => Promise<string | null>, baseUrl = CEREBRAS_DEFAULT_BASE_URL) {
    super(
      {
        meta: PROVIDERS.cerebras,
        baseUrl,
        providerName: 'Cerebras',
        extraBody: { reasoning_effort: 'low' },
        models: [
          {
            id: CLOUD_MODELS.cerebrasModel,
            displayName: `${CLOUD_MODELS.cerebrasModel} (free tier)`,
            providerId: PROVIDERS.cerebras.id,
          },
        ],
      },
      getApiKey,
    );
  }
}
