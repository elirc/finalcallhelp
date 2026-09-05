import { useEffect, useState } from 'react';
import { PROVIDERS } from '../../shared/catalog';
import type { ProviderProbe, PublicSettings } from '../../shared/domain';
import { errorMessage, responseReady } from '../../shared/setup';

export function useReadiness(settings: PublicSettings) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    stt: ProviderProbe;
    llm: ProviderProbe;
  } | null>(null);
  const key = JSON.stringify([
    settings.sttProviderId,
    settings.sttModelId,
    settings.llmProviderId,
    settings.llmModelId,
    settings.ollamaBaseUrl,
    settings.credentials,
    revision,
  ]);
  useEffect(() => {
    let active = true;
    const probe = async (providerId: string): Promise<ProviderProbe> => {
      try {
        return await window.cuedeck.probeProvider(providerId);
      } catch (err) {
        return { providerId, status: 'unknown-failure', detail: errorMessage(err) };
      }
    };
    void Promise.all([probe(settings.sttProviderId), probe(settings.llmProviderId)]).then(
      ([stt, llm]) => {
        if (active) setResult({ key, stt, llm });
      },
    );
    return () => {
      active = false;
    };
  }, [key]);
  const current = result?.key === key ? result : null;
  const demo = settings.llmProviderId === 'demo';
  const llmReady = responseReady(settings, current?.llm ?? null);
  const sttReady = current?.stt.status === 'ready';
  const llm = PROVIDERS[settings.llmProviderId];
  const canRespond =
    !!settings.llmModelId &&
    !!llm &&
    (llm.location === 'local' || !!settings.credentials[llm.credentialId ?? llm.id]?.configured);
  return {
    demo,
    checking: !current,
    llmReady,
    sttReady,
    canRespond,
    canListen: !demo && sttReady && llmReady,
    stt: current?.stt,
    llm: current?.llm,
    refresh: () => setRevision((v) => v + 1),
  };
}
