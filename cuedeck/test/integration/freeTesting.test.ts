import { describe, expect, it } from 'vitest';
import { DemoLlmProvider } from '../../src/main/providers/llm/demo';
import { OpenRouterProvider } from '../../src/main/providers/llm/openRouter';
import { GroqLlmProvider } from '../../src/main/providers/llm/groq';
import { allowlistedFetch } from '../../src/main/security/http';
import { collect, startFakeServer } from '../helpers/fakeServer';

describe('free test providers', () => {
  it('streams a clearly labeled demo without any credentials and supports cancellation', async () => {
    const provider = new DemoLlmProvider();
    expect((await provider.probe()).status).toBe('ready');
    const controller = new AbortController();
    const stream = provider
      .generate({
        modelId: 'sample-response',
        system: '',
        user: 'question',
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    expect((await stream.next()).value?.text).toBe('Demo ');
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('checks OpenRouter credentials using /key rather than the public model list', async () => {
    const server = await startFakeServer((req, res) => {
      if (req.url === '/key') res.writeHead(401).end('{}');
      else res.end(JSON.stringify({ data: [] }));
    });
    try {
      const provider = new OpenRouterProvider(async () => 'invalid-test-key', server.baseUrl);
      expect((await provider.probe(new AbortController().signal)).status).toBe(
        'missing-credential',
      );
      expect(server.requests[0].url).toBe('/key');
    } finally {
      await server.close();
    }
  });
  it('surfaces provider errors inside HTTP-success streams', async () => {
    const server = await startFakeServer(
      (_req, res) => void res.end('data: {"error":{"message":"unavailable"}}\n\n'),
    );
    try {
      await expect(
        collect(
          new GroqLlmProvider(async () => 'test', server.baseUrl).generate({
            modelId: 'test',
            system: '',
            user: '',
            signal: new AbortController().signal,
          }),
        ),
      ).rejects.toThrow('PROVIDER_UNAVAILABLE');
    } finally {
      await server.close();
    }
  });
  it('does not follow redirects carrying private request bodies beyond the allowlist', async () => {
    const server = await startFakeServer(
      (_req, res) => void res.writeHead(307, { location: 'https://example.com/private' }).end(),
    );
    try {
      await expect(
        allowlistedFetch(server.baseUrl, { method: 'POST', body: 'private prompt' }),
      ).rejects.toThrow();
    } finally {
      await server.close();
    }
  });
});
