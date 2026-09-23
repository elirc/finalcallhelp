import { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../../shared/catalog';
import type { ProviderProbe, PublicSettings } from '../../shared/domain';
import { errorMessage, responseReady } from '../../shared/setup';

export function useReadiness(settings: PublicSettings) {
  const [revision, setRevision] = useState(0);
  // Set by an explicit re-check (the "Check again" button or a main-process
  // readiness push) so the next probe bypasses the main-process probe cache;
  // passive re-renders keep using cached results.
  const freshRef = useRef(false);
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
  useEffect(
    () =>
      window.cuedeck.onReadinessChanged(() => {
        freshRef.current = true;
        setRevision((v) => v + 1);
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    const fresh = freshRef.current;
    freshRef.current = false;
    const probe = async (providerId: string): Promise<ProviderProbe> => {
      try {
        return await window.cuedeck.probeProvider(providerId, fresh);
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
    refresh: () => {
      freshRef.current = true;
      setRevision((v) => v + 1);
    },
  };
}
