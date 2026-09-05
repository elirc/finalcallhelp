import { PROVIDERS } from '../../../shared/catalog';
import type { AnswerDelta, ModelSummary, ProviderProbe } from '../../../shared/domain';
import type { AnswerRequest, LlmProvider } from '../contracts';
import { abortableDelay } from './openAiCompatible';

/** Deliberately fixed sample: exercises streaming/cancel/copy without network or credentials. */
export class DemoLlmProvider implements LlmProvider {
  readonly meta = PROVIDERS.demo;

  async listModels(): Promise<ModelSummary[]> {
    return [
      {
        id: 'sample-response',
        displayName: 'Sample response (not AI generated)',
        providerId: 'demo',
      },
    ];
  }

  async probe(): Promise<ProviderProbe> {
    return { providerId: 'demo', status: 'ready', models: await this.listModels() };
  }

  async *generate(input: AnswerRequest): AsyncIterable<AnswerDelta> {
    const sample =
      'Demo sample — this is a fixed example, not an AI answer to your question.\n\n' +
      'Start with your main point. Add one specific example from your own experience, describe what you did, and finish with the result or what you learned.\n\n' +
      'You can test streaming, Cancel, Copy, and history here. Choose “Set up real AI” to connect a free cloud account and get responses based on your question and profile.';
    let sequence = 0;
    for (const text of sample.match(/\S+\s*/g) ?? []) {
      await abortableDelay(25, input.signal);
      yield { text, sequence: sequence++ };
    }
  }
}
