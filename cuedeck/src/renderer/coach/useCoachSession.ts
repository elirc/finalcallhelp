import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  AnswerMode,
  PublicError,
  PublicSettings,
  SessionEvent,
  TargetSeconds,
} from '../../shared/domain';
import { SilenceEndpointer } from '../../shared/endpointing';
import { publicError } from '../../shared/errors';
import { ClipRecorder } from '../audio/recorder';
import { resolveShortcut } from '../state/shortcuts';
import { coachReducer, initialCoachState, isActivePhase } from '../state/sessionMachine';
import { useReadiness } from '../state/useReadiness';

export type FollowUp = Partial<{ answerMode: AnswerMode; targetSeconds: TargetSeconds }>;

/**
 * Everything stateful about one coach window: the session reducer, the
 * recorder, provider readiness, keyboard shortcuts, and the main-process
 * event subscription. Components stay presentational.
 */
export function useCoachSession(settings: PublicSettings) {
  const [state, dispatch] = useReducer(coachReducer, initialCoachState);
  const readiness = useReadiness(settings);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [notes, setNotes] = useState('');
  const notesRef = useRef('');
  const [responseTargetSeconds, setResponseTargetSeconds] = useState(settings.targetSeconds);
  const optionsRef = useRef<{ answerMode: AnswerMode; targetSeconds: TargetSeconds }>({
    answerMode: settings.answerMode,
    targetSeconds: settings.targetSeconds,
  });

  useEffect(() => {
    optionsRef.current = { answerMode: settings.answerMode, targetSeconds: settings.targetSeconds };
  }, [settings.answerMode, settings.targetSeconds]);

  useEffect(() => {
    // Ref mirror so callbacks captured at record start see current notes.
    notesRef.current = notes;
  }, [notes]);

  const sessionNotesOption = () => {
    const trimmed = notesRef.current.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  useEffect(() => {
    dispatch({ type: 'configured', ready: settings.onboardingComplete });
  }, [settings.onboardingComplete]);

  useEffect(() => {
    // Streaming providers deliver dozens of deltas per second, each as its
    // own IPC message. Coalescing them per animation frame keeps the reducer
    // semantics (every delta still passes the sequence check) while React
    // renders the card once per frame instead of once per token.
    let queue: SessionEvent[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = queue;
      queue = [];
      for (const event of batch) {
        dispatch({ type: 'session-event', event });
        if (event.type === 'answer-complete') setLiveMessage('Response ready.');
        else if (event.type === 'error') setLiveMessage(event.error.message);
      }
    };
    const unsubscribe = window.cuedeck.onSessionEvent((event) => {
      queue.push(event);
      if (document.visibilityState === 'hidden') {
        // rAF pauses in hidden windows; do not let events pile up unseen.
        if (frame) window.cancelAnimationFrame(frame);
        flush();
      } else if (!frame) {
        frame = window.requestAnimationFrame(flush);
      }
    });
    return () => {
      unsubscribe();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) void recorder.abort();
      if (sessionRef.current) void window.cuedeck.cancelSession(sessionRef.current);
    },
    [],
  );

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    const sessionId = sessionRef.current;
    if (!recorder || !sessionId) return;
    recorderRef.current = null;
    dispatch({ type: 'stop-requested' });
    try {
      const clip = await recorder.stop();
      if (sessionRef.current !== sessionId) return;
      setResponseTargetSeconds(optionsRef.current.targetSeconds);
      await window.cuedeck.submitSession(
        sessionId,
        clip.wav,
        {
          ...optionsRef.current,
          language: settings.sttLanguage,
          sessionNotes: sessionNotesOption(),
        },
        clip.encodeMs,
      );
      dispatch({ type: 'submitted', sessionId });
    } catch (err) {
      if (sessionRef.current !== sessionId) return;
      dispatch({ type: 'capture-failed', error: asPublicError(err) });
    }
  }, [settings.sttLanguage]);

  const startRecording = useCallback(async () => {
    if (!readiness.canListen || recorderRef.current) return;
    const sessionId = crypto.randomUUID();
    sessionRef.current = sessionId;
    dispatch({ type: 'arm', sessionId });
    const endpointer = settings.autoStopOnSilence ? new SilenceEndpointer() : null;
    const recorder = new ClipRecorder(settings.maxClipSeconds, {
      onLevel: (rms, peak, elapsedMs) => {
        dispatch({ type: 'meter', rms, peak, elapsedMs });
        if (endpointer?.push(rms, elapsedMs)) {
          setLiveMessage('Pause detected — responding.');
          void stopRecording();
        }
      },
      onAutoStop: () => void stopRecording(),
    });
    recorderRef.current = recorder;
    try {
      await window.cuedeck.armCapture(sessionId);
      await recorder.start();
      dispatch({ type: 'capture-started' });
      setLiveMessage('Recording started.');
    } catch (err) {
      if (recorderRef.current === recorder) recorderRef.current = null;
      await recorder.abort();
      if (sessionRef.current !== sessionId) return;
      dispatch({ type: 'capture-failed', error: asCaptureError(err) });
    }
  }, [settings.maxClipSeconds, settings.autoStopOnSilence, stopRecording, readiness.canListen]);

  const cancel = useCallback(async () => {
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    dispatch({ type: 'cancel-requested' });
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) await recorder.abort();
    if (sessionId) {
      await window.cuedeck.cancelSession(sessionId).catch(() => undefined);
      dispatch({ type: 'cancel-confirmed', sessionId });
    }
    setLiveMessage('Cancelled.');
  }, []);

  const regenerate = useCallback(
    async (overrides: FollowUp = {}) => {
      if (!state.transcript.trim() || !readiness.canRespond) return;
      const sessionId = crypto.randomUUID();
      sessionRef.current = sessionId;
      const options = { ...optionsRef.current, ...overrides, sessionNotes: sessionNotesOption() };
      setResponseTargetSeconds(options.targetSeconds);
      dispatch({ type: 'regenerate', sessionId, transcript: state.transcript });
      await window.cuedeck.regenerate(sessionId, state.transcript, options).catch((err) => {
        dispatch({ type: 'capture-failed', error: asPublicError(err) });
      });
    },
    [state.transcript, readiness.canRespond],
  );

  const copyAnswer = useCallback(async () => {
    await navigator.clipboard.writeText(state.answer);
    setCopied(true);
    setLiveMessage('Response copied to clipboard.');
    window.setTimeout(() => setCopied(false), 2000);
  }, [state.answer]);

  useEffect(() => {
    // Ctrl+L listen/stop, Esc cancel, Ctrl+Shift+C copy (see shortcuts.ts).
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, state.phase);
      if (!action) return;
      event.preventDefault();
      if (action === 'start-listening') void startRecording();
      else if (action === 'stop-listening') void stopRecording();
      else if (action === 'cancel') void cancel();
      else if (action === 'copy-answer' && state.answer) void copyAnswer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.phase, state.answer, startRecording, stopRecording, cancel, copyAnswer]);

  const setTranscript = useCallback(
    (text: string) => dispatch({ type: 'edit-transcript', text }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return {
    state,
    readiness,
    copied,
    liveMessage,
    setLiveMessage,
    notes,
    setNotes,
    responseTargetSeconds,
    isRecording: state.phase === 'recording',
    busy: isActivePhase(state.phase) || state.phase === 'cancelling',
    startRecording,
    stopRecording,
    cancel,
    regenerate,
    copyAnswer,
    setTranscript,
    reset,
  };
}

export type CoachSession = ReturnType<typeof useCoachSession>;

function asPublicError(err: unknown): PublicError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as PublicError;
  }
  return publicError('UNKNOWN', err instanceof Error ? err.message : undefined);
}

function asCaptureError(err: unknown): PublicError {
  if (err instanceof Error) {
    if (err.message === 'CAPTURE_NO_AUDIO') return publicError('CAPTURE_NO_AUDIO');
    if (err.name === 'NotAllowedError' || err.name === 'AbortError')
      return publicError('CAPTURE_DENIED');
  }
  return asPublicError(err);
}
