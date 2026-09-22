# CueDeck full review and test — 2026-09-22 (opusimprove)

**Author:** Claude Fable 5.1
**Tree reviewed:** working copy of `main` at `f63e06a` plus 30 modified and 19 untracked files (uncommitted)
**Scope:** every file under `cuedeck/src`, `cuedeck/test`, build and tool configuration, launcher scripts; the full check suite, the Electron E2E suite, and nine targeted reproductions written for this review.

---

## 1. Verdict

The app builds, every automated check passes, and the core flows (onboarding, demo, typed questions, real worklet capture with a faked Groq, cancel, history, profiles, diagnostics, eye-line placement) work end to end. The code is careful about security boundaries and the test suite is unusually good for a project this size.

Two things hold it back:

1. **None of the ten findings from the 2026-09-19 review have been fixed.** I re-traced all ten on the current tree and reproduced five of them (R1, R2, R3, R4, R7) with runnable scripts. The most important, R1 and R7, sit on the local-speech path and make first-answer latency *worse* on slow machines than if prewarming did not exist.
2. **The reviewed app exists only as an uncommitted working tree.** Nineteen source files (the whole `renderer/coach`, `renderer/preferences`, `probeCache`, `placement`, `windowState`, five test files) are untracked. A `git stash` or a bad `checkout` deletes the app that passed these tests.

I also found seven new issues, listed with the old ones in §3. The three I would fix first are the default Electron application menu shipping in the built app (Ctrl+R reload, Ctrl+Shift+I DevTools, F11), the microphone being reachable from the renderer without any grant, and the onboarding local path selecting Whisper Tiny while every label and default says Base.

---

## 2. What was run

All runs were on the current working tree, sequentially, on this machine (Windows 11, Node 22.16, Electron 43.1.0).

| Check                                   | Result                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `prettier --check`                      | Pass                                                                                    |
| `eslint src test *.ts`                  | Pass, no warnings                                                                       |
| `tsc --noEmit`                          | Pass                                                                                    |
| `vitest run test/unit`                  | **Pass**: 22 files, 281 tests, 30 s                                                      |
| `vitest run test/integration`           | **Pass**: 7 files, 103 tests, 17 s                                                       |
| `npm run build` (4 Vite builds)          | Pass                                                                                    |
| `playwright test` (Electron E2E)        | **Pass**: 32 of 32, 3.6 min, no cold-start flake this run                                |
| Review reproductions (vitest, 5 cases)  | All five reproduced the bug they target (§7)                                            |
| Review reproductions (Electron, 4 cases) | Menu present; microphone granted; R4 stale readiness; R4 cached "Check again" (§7)      |
| Real display capture                    | Armed `getDisplayMedia` on this machine returned audio + video tracks (baseline in §7.3) |
| Live cloud providers, real Whisper load | Not exercised; no keys and no model download in this review                             |

The unit and integration counts match the 2026-09-18 and 2026-09-19 reports exactly, so no tests were added for the September 19 findings.

---

## 3. Findings, prioritized

Format for each: evidence, what happens, status, fix, acceptance test. "Reproduced" means a script in §7 shows it on the real module.

### P0 — Commit the working tree

`git status` shows 30 modified and 19 untracked files, including every file in `src/renderer/coach/`, `src/renderer/preferences/`, `src/renderer/components/`, `src/renderer/profiles/`, `src/main/providers/probeCache.ts`, `src/main/windows/placement.ts`, `src/main/windows/windowState.ts`, and five unit and integration test files. Also untracked: `fabledocs/` and `Test CueDeck Locally.cmd`.

**Fix:** one commit of the reviewed tree before any of the work below. Every later finding should land as its own commit so the next review can diff it.

### F1 — P1 (R1): overlapping loads of the same speech model kill each other

**Evidence:** `src/main/workers/sttWorkerManager.ts:133-138`. `ensureModel()` returns early only when the model is fully `ready`; any other call, including one for the *same* model that is still loading, runs `this.stop()` and respawns. Callers: startup prewarm (`main.ts:231`), arm-time prewarm (`ipc/register.ts:267`), and `transcribe()` (`sttWorkerManager.ts:230`).

**What happens:** on a machine where the model load takes longer than the gap between app start and the first Listen press, the sequence is: startup prewarm starts loading → user presses Listen → arm prewarm kills it and restarts → user stops recording → transcribe kills it again and restarts. The first answer pays one full load *plus* two wasted partial loads. The two displaced callers reject with `MODEL_NOT_INSTALLED: model worker exited during load`; prewarm swallows it, so nothing is logged.

**Reproduced:** §7.1 test "R1". Three `utilityProcess.fork` calls for one model; the first two callers rejected; only the third loaded.

**Fix:** single-flight loads with shared cancellation ownership.

```ts
// sttWorkerManager.ts (sketch)
private pending: { modelId: string; promise: Promise<void>; controller: AbortController; waiters: number } | null = null;

async ensureModel(modelId, onProgress, signal) {
  if (this.loadedModelId === modelId && this.status === 'ready') return;
  if (signal.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError');
  if (this.pending?.modelId !== modelId) {
    this.pending?.controller.abort();            // a different model replaces the load
    const controller = new AbortController();
    const load = { modelId, controller, waiters: 0, promise: this.loadInto(modelId, onProgress, controller.signal) };
    load.promise.finally(() => { if (this.pending === load) this.pending = null; });
    this.pending = load;
  }
  return this.join(this.pending, signal);         // same model: wait for the load in flight
}

private join(load, signal) {                      // the load is aborted only when its LAST waiter leaves
  load.waiters++;
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { if (--load.waiters === 0) load.controller.abort(); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    load.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
```

`loadInto` is today's spawn-and-wait body. `models:download` should also join rather than replace, and a warmup for model A must not kill a user-initiated download of model B (today it does: the manager has one worker and every load kills it).

**Acceptance test:** the §7.1 test with the assertions inverted: one fork, all three callers resolve, `getStatus()` ends `ready`. Add: warmup aborted by its timeout while a transcribe is waiting on the same load does not kill the load.

### F2 — P1 (R7): a local-speech timeout is reported as a user cancellation

**Evidence:** `src/main/workers/sttWorkerManager.ts:144, 239` reject with `new DOMException('aborted', 'AbortError')` for every abort, discarding `signal.reason`. `localWhisper.ts:64-65` merges `AbortSignal.timeout(TIMEOUTS.localStt)` into that signal. `shared/errors.ts:112` maps `AbortError` to `REQUEST_CANCELLED`; `sessionMachine.ts:168` turns that into a silent return to `ready`.

**What happens:** after 120 s of waiting for a long clip on a slow CPU, the coach goes back to "Ready" with no message. Diagnostics records `[REQUEST_CANCELLED] The request was cancelled.` for something the user never cancelled.

**Reproduced:** §7.1 test "R7": `AbortSignal.timeout` on `transcribe` rejects with `name === 'AbortError'` and `toPublicError()` returns `REQUEST_CANCELLED`.

**Fix:** pass the reason through in the three abort handlers, and in `abortableDelay` (`openAiCompatible.ts:252, 262`) which has the same pattern:

```ts
const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException('aborted', 'AbortError')); };
```

`AbortSignal.timeout()` sets a `TimeoutError` reason and `AbortSignal.any()` forwards it, so `toPublicError()` already maps it to `PROVIDER_TIMEOUT` with no further change.

**Acceptance test:** user abort → `REQUEST_CANCELLED`; timeout signal → `PROVIDER_TIMEOUT`; both run the same worker cleanup.

### F3 — P1 (R4): the coach does not notice successful setup, and "Check again" can repeat a cached failure

**Evidence:** `src/renderer/state/useReadiness.ts:13-21` re-probes only when its key changes; the key contains the credential *flag*, not a revision. `ipc/register.ts:148-152` sets the flag to `true` on every `secrets:set`, so replacing a rejected key leaves the key unchanged. `ipc/register.ts:240-243` invalidates the probe cache on download completion but broadcasts nothing the coach listens to. `SetupBanner.tsx:93` and `Onboarding.tsx:205-213, 356` call `probeProvider()` without `fresh`, and failures are cached for 5 s (`probeCache.ts:19`).

**Reproduced in Electron:** §7.2. With the Groq fixture returning 401, a saved key shows "API key rejected". After switching the fixture to 200 and saving a *new* key, the coach still showed "API key rejected" and Listen stayed disabled 3 s later; only a manual "Check again" recovered it. Separately, after a 500 followed by recovery, the first "Check again" repeated the cached failure and the second click, 6.7 s later, succeeded.

**Fix (three small parts):**

1. `refresh()` in `useReadiness` and the onboarding "Check again" pass `fresh: true`.
2. Main broadcasts a new `readiness:changed` event (no payload) from `secrets:set`, `secrets:remove`, download completion, and `models:cancelDownload`; preload exposes `onReadinessChanged`; `useReadiness` subscribes and bumps `revision`. This also fixes the download-from-Preferences case without touching settings.
3. Keep passive probes de-duplicated as they are today.

**Acceptance test:** the §7.2 script with the waits removed: Listen enables within one probe round-trip of `setSecret` with a valid key, and within one round-trip of a download `complete` event.

### F4 — P2 (R2): history opt-out during generation is ignored

**Evidence:** `src/main/sessions/coordinator.ts:168, 224` snapshot settings at session start; `:350-371` use that snapshot to decide whether to save and for how long.

**Reproduced:** §7.1 test "R2": history turned off while the answer streams; `saveHistory` still called once.

**Fix:** re-read at persistence time.

```ts
const latest = await this.deps.getSettings().catch(() => settings);
if (latest.historyEnabled) { await this.deps.saveHistory({...}, latest.historyRetentionDays).catch(() => undefined); }
```

**Acceptance test:** opt-out before completion prevents the write; a retention change during generation uses the new value.

### F5 — P2 (R3): `invalidate()` leaves in-flight probes attached and their stale result is cached

**Evidence:** `src/main/providers/probeCache.ts:24-49`. `invalidate()` clears completed entries only; a caller arriving after invalidation joins the old in-flight promise (`:28-29`), and every completion stores its value unconditionally (`:32-36`).

**Reproduced:** §7.1 test "R3": after `invalidate()`, the next caller received the *old* key's `missing-credential`, its own fetcher never ran, and the stale result was then served for the failure TTL.

**Fix:** a generation counter.

```ts
private generation = 0;
get(key, fetcher, fresh = false) {
  const gen = this.generation; /* …existing hit/inflight checks… */
  const request = fetcher().then((value) => { if (gen === this.generation) this.entries.set(key, {...}); return value; })
    .finally(() => { if (this.inflight.get(key) === request) this.inflight.delete(key); });
  /* … */
}
invalidate(prefix = '') {
  this.generation++;
  for (const map of [this.entries, this.inflight]) for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
}
```

**Acceptance test:** the §7.1 "R3" case with inverted assertions (new fetcher runs; old completion never populates).

### F6 — P2 (R5): changing the practice category after a draw snaps back to the profile default

**Evidence:** `src/renderer/coach/PracticeCard.tsx:22-30`. `changeCategory()` resets `dealtCount` to 0, which re-runs the effect that adopts `suggestedCategory` whenever `dealtCount === 0`.

**Status:** source-confirmed; not re-executed (no DOM test runner installed). The September 19 harness reproduced it.

**Fix:** keep an `explicit` flag and follow the profile suggestion only while the choice is still implicit.

```ts
const [choice, setChoice] = useState({ category: suggestedCategory, explicit: false });
useEffect(() => { if (!choice.explicit) setChoice({ category: suggestedCategory, explicit: false }); }, [suggestedCategory]);
const changeCategory = (next) => { setChoice({ category: next, explicit: true }); deckRef.current = null; setDealtCount(0); };
```

**Acceptance test:** an E2E step in `eyeLine.spec.ts` "switching the active profile…": draw, choose Behavioral, draw again, assert the select still reads `behavioral` and the question is behavioral.

### F7 — P2 (new): the local preset picks Whisper Tiny while every label and default says Base

**Evidence:** `src/shared/catalog.ts:154-156` sets `DEFAULT_PROVIDER_MODELS['local-whisper']` to `LOCAL_STT_MODELS[0].id`, which is `onnx-community/whisper-tiny` (`:116`). `src/shared/constants.ts:87` sets `DEFAULT_SETTINGS.sttModelId` to `whisper-base`, whose catalog label is "Whisper Base (recommended, ~200 MB)" (`:124`), and `README.md:101` calls Base recommended. `setupPreset('local')` (`shared/setup.ts:13`) and the Providers STT select (`ProvidersSection.tsx:105-109`) both use the catalog default.

**What happens:** a user who chooses "Use local mode" in onboarding, or "Switch everything to local-only" in Preferences, or switches the STT provider away and back, gets Tiny selected. If they had Base installed, the coach now reports the model as missing and Listen turns off until they re-pick Base.

**Reproduced:** §7.1 test "N23" (constant comparison).

**Fix:** mark Base `recommended: true` in the catalog and derive the default from it, or simply reorder `LOCAL_STT_MODELS` so Base is first. In the Providers select, when switching back to `local-whisper`, prefer an installed model: `models['local-whisper']?.find((m) => m.installed)?.id ?? default`.

**Acceptance test:** `catalog.test.ts`: `DEFAULT_PROVIDER_MODELS['local-whisper'] === DEFAULT_SETTINGS.sttModelId`. E2E: switch STT provider to Groq and back with Base installed in a seeded manifest; Listen stays enabled.

### F8 — P2 (new): the default Electron application menu ships in the built app

**Evidence:** no `Menu` import anywhere in `src/main`; `main.ts` never calls `Menu.setApplicationMenu`. `autoHideMenuBar: true` (`windows.ts:61, 86`) hides the bar but leaves the accelerators live.

**Confirmed in Electron:** §7.3. `Menu.getApplicationMenu()` on the built app returned File/Edit/View/Window with `Reload [CmdOrCtrl+R]`, `Force Reload`, `Toggle Developer Tools [Ctrl+Shift+I]`, `Toggle Full Screen [F11]`, `Zoom In/Out`, `Close [Ctrl+W]`. A synthetic Ctrl+R from Playwright did *not* reload, but synthetic key events bypass native accelerators, so that check is inconclusive; the menu itself is not.

**What happens:** on a call, Ctrl+R or F5-style habits reload the coach and drop the current answer and session; Ctrl+W closes the coach (and therefore quits); F11 goes full screen over the meeting; Ctrl+Shift+I opens DevTools on a window that holds transcripts.

**Fix:** in `bootstrap()`, `if (app.isPackaged) Menu.setApplicationMenu(null);` (keep the default menu in development for DevTools). Windows text fields keep native cut/copy/paste without an Edit menu. If Ctrl+W should still close, add a minimal menu with only that role.

**Acceptance test:** E2E asserts `Menu.getApplicationMenu()` has no `Reload` or `Toggle Developer Tools` item when `app.isPackaged` is simulated, or a unit test on a `buildMenu(isPackaged)` helper.

### F9 — P2 (R6): local model loading never enforces "never downloads"

**Evidence:** `src/main/workers/sttWorker.ts:44-45` sets `allowLocalModels = true` and nothing else; Transformers.js 3.8.1 defaults `allowRemoteModels` to `true` (`node_modules/@huggingface/transformers/src/env.js:141`). The same load path serves explicit downloads, warmups, and transcription. The worker's fetches do not go through `allowlistedFetch`.

**Status:** source-confirmed; no download attempted.

**Fix:** the `load` message carries `allowDownload: boolean`; the worker sets `transformers.env.allowRemoteModels = allowDownload` before `pipeline()`. Only `models:download` passes `true`. A cache miss during warmup or transcription then fails fast with `MODEL_NOT_INSTALLED` and the existing "download-model" action instead of silently fetching.

**Acceptance test:** integration test with a fake worker asserting the `load` message flag; a manual test with networking blocked and an installed model still transcribes.

### F10 — P2 (R8): unreadable store files become silent data loss, with a misleading message

**Evidence:** `src/main/storage/jsonFile.ts:6-14` throws `STORAGE_FAILED` on a parse error; `publicStore.ts:25-26`, `historyStore.ts:28`, `profileStore.ts:23` all `.catch(() => null)` and continue with empty data, so the next save overwrites the original. `secretVault.ts:34-40` does *not* catch, so a corrupt `secrets.json` makes every cloud call fail with the `STORAGE_FAILED` template "Saving data to disk failed." (`errors.ts:73-77`) for what is a read failure. `migrations.ts:29-32` also silently replaces newer-version settings with defaults.

**Fix:** in `readJsonFile`, on a parse error rename the file to `<name>.corrupt-<timestamp>.json`, record a diagnostics error naming the file, and return `null`. Split the template into "reading" and "saving" variants. Do not overwrite a newer-version settings file; show a message instead.

**Acceptance test:** corrupt each of the four stores, launch, make one edit; the original is still on disk under the quarantine name and the diagnostics report names it.

### F11 — P2 (R10): the setup card still sits above the answer in the full layout

**Evidence:** `src/renderer/routes/Coach.tsx:144-151` renders `SetupBanner` before `ResponseCard` (`:174`). When responses work but speech does not (`readiness.llmReady && !sttReady`), the full-height "Ready for typed questions" card occupies the top of the window. `fabledocs/images/guide-coach-full.png` shows it.

**Fix:** when `readiness.llmReady`, render the one-line `setup-slim` variant (already used in compact mode) *below* the response card; keep the full card only when nothing works.

**Acceptance test:** E2E: with Ollama ready and no speech model, `answer-text` top is above `readiness-banner` top at the default window size.

### F12 — P3 (new): the microphone is reachable from the renderer without any grant

**Evidence:** `src/main/security/windowSecurity.ts:54-61` allows the `media` permission for every trusted frame, always.

**Confirmed in Electron:** §7.3. `navigator.mediaDevices.getUserMedia({ audio: true })` from the coach resolved with a live audio track. Denying `media` entirely broke armed display capture (`NotAllowedError`), so the permission is needed; it just does not need to be permanent.

**What happens:** the app never calls `getUserMedia`, so this is not hidden recording. It is a wider permission than the privacy text promises: any renderer bug becomes microphone access.

**Fix:** pass `captureGrant` into `hardenSession` and add a non-consuming `isArmed()`; allow `media` only while a grant is armed (the 8 s Listen window). Electron checks the `media` permission before it calls the display-media handler that consumes the grant, so Listen keeps working; the acceptance test below guards that ordering.

**Acceptance test:** E2E: `getUserMedia({audio:true})` without arming → `NotAllowedError`; armed `getDisplayMedia` still returns audio (the §7.3 baseline).

### F13 — P3 (R9): sender and navigation trust is broader than the app

Unchanged from September 19: `isTrustedAppUrl()` (`windowSecurity.ts:12-27`) accepts every `file:` URL and, in development, any localhost port; `CaptureGrant.consume()` is not tied to the requesting frame. Fix as previously recommended: compare against the exact renderer entry path and the exact Vite origin, and store the arming `WebContents` id in the grant. Low severity; no route to a foreign document was found.

### F14 — P3 (new): the last window position can be lost on close

**Evidence:** `src/main/main.ts:220-223` runs `void windowState.flush()` on `close`; `window-all-closed` then calls `app.quit()` without waiting. `flush()` cancels the 400 ms debounce and starts the write, but the write is still pending when quit begins, so a move followed by an immediate close can lose the new position.

**Fix:** make `flush()` synchronous (`writeFileSync` + `renameSync`) for the close path, or handle `before-quit` with `preventDefault`, await the flush, then quit.

### F15 — P3 (new): second-instance and re-activate paths are not guarded

**Evidence:** `main.ts:49-51` calls `app.quit()` when the single-instance lock fails but still falls through to `app.whenReady().then(bootstrap)` (`:242`), which can briefly create a second window. `main.ts:252-257` re-runs `bootstrap()` on `activate`, which would re-register every `ipcMain.handle` channel and throw; unreachable today because `window-all-closed` quits, and the makers are Windows-only, but it is a trap for the next platform.

**Fix:** wrap the bootstrap in `else` of the lock check; drop the `activate` handler or make `bootstrap` idempotent.

### F16 — P3 (new): download progress is forwarded per chunk to every window

**Evidence:** `sttWorker.ts:48-64` posts a message for every Transformers.js progress callback; `register.ts:227-239` broadcasts each one to all windows; `Onboarding.tsx:219-235` and `LocalModelPicker.tsx:23-37` set state on each.

**Fix:** throttle in the manager to about 10 Hz per file, or send only when the integer percentage changes.

### F17 — P3 (new, quality): capture path resamples with a box filter and floods the main thread

**Evidence:** `recorder.ts:56` creates `new AudioContext()` at the device rate (48 kHz) and `:102` resamples with the box-average `resample()` (`shared/audio.ts:20-39`, no low-pass, aliasing above 8 kHz). The worklet (`public/audio-capture-worklet.js:27`) posts one message per 128-frame quantum, about 375 messages per second.

**Fix:** `new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })` lets Chromium resample the capture stream with a proper filter and removes `resample()` from the recording path entirely. In the worklet, accumulate 2048 or 4096 frames per post.

**Acceptance test:** the existing E2E "Listen encodes real worklet audio into WAV" still passes; `recorder.test.ts` asserts the context sample rate.

### F18 — P3 (new): the speech worker never unloads, and models cannot be removed

**Evidence:** `SttWorkerManager` has no idle timer; the startup prewarm (`main.ts:231`) loads the model into memory even if the user never records. `removeModel()` (`sttWorkerManager.ts:83`) has no caller: a 600 MB Small download cannot be deleted from inside the app.

**Fix:** stop the worker after N minutes idle (say 15) and let the next arm-time prewarm reload it; add "Remove downloaded model" to `LocalModelPicker` wired to a `models:remove` handler with the usual schema and two-step confirm.

### F19 — P3 (new): duplicate warmups and per-tick settings writes

- `capture:arm` prewarms the LLM (`register.ts:267`) and `submit()` warms it again seconds later (`coordinator.ts:184`). For cloud providers that is two extra authenticated `/models` requests per Listen against free-tier request limits. Skip the submit-time warmup when a prewarm completed within the last minute.
- The text-size and clip-length sliders (`GeneralSection.tsx:62, 76`) write `settings.json` atomically and broadcast to both windows on every tick. Debounce 150 ms, or commit on `change` rather than `input`.
- `useSettingsUpdate` fetches settings after every patch although the `settings:changed` broadcast already delivered them. Harmless; one IPC round trip per change.

---

## 4. What is working well

Worth keeping exactly as it is: the fixed preload surface with no generic `invoke`; Zod validation on every IPC payload and `strict()` on the settings patch; `redirect: 'error'` plus the host allowlist on every outbound request; the armed one-use capture grant; session IDs on every event with monotonic delta sequences and the reducer that drops retired sessions; serialized read-modify-write on every store; per-frame coalescing of answer deltas; the E2E suite faking only the provider HTTP boundary while exercising the real worklet, real IPC, real downloads, and real window placement.

---

## 5. Recommended order of work

| Batch | Items                                                   | Size | Why this order                                                     |
| ----- | ------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| 0     | Commit the tree                                         | S    | Everything else must be diffable                                   |
| 1     | F2 (R7), F4 (R2), F3 (R4), F7, F8, F12                  | S    | Six one-day fixes; three of them close user-visible traps          |
| 2     | F1 (R1), F9 (R6)                                        | M    | Same file; single-flight and local-only loading share the worker protocol |
| 3     | F5 (R3), F6 (R5), F11 (R10)                             | S    | Small, isolated, each with a clear acceptance test                 |
| 4     | F10 (R8), F14, F15, F13 (R9)                            | M    | Robustness and defence in depth                                    |
| 5     | F17, F16, F18, F19, §4 doc corrections from the 09-19 report | M | Quality and cost; measure first-answer latency before and after F17 |

---

## 6. Verification of this report

| Claim                                | How verified                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| All source read                      | Every file under `src/` and `test/` plus configs and launchers, on the current tree    |
| Line numbers                         | Taken from the current working copy on 2026-09-22                                     |
| R1, R7, R2, R3, F7                   | Reproduced with the vitest file in §7.1 (all five cases green = bug present)           |
| F3 (R4) both halves, F8, F12         | Reproduced with the Electron spec in §7.2 and §7.3 on the built app                    |
| R5, R6, R8, R9, R10                  | Source-confirmed only; not re-executed                                                 |
| Full suites                          | Ran once each, sequentially, after reading the code; counts in §2                      |
| Scratch files                        | Deleted after the runs; `git status` shows none                                        |

Not done: live Groq/Gemini/OpenRouter/Cerebras calls, a real Whisper download or inference, packaging (`electron-forge make`), and the §4 documentation rows from the September 19 report.

---

## 7. Reproduction scripts

Run from `cuedeck/`. Each was executed for this report and then deleted; every assertion encodes the *buggy* behaviour, so green means reproduced.

### 7.1 Unit-level (save as `test/unit/_repro.test.ts`, run `npx vitest run test/unit/_repro.test.ts`)

```ts
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const forks = vi.hoisted(() => [] as Array<{ killed: boolean }>);
const hang = vi.hoisted(() => ({ transcribe: false }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWorker extends EventEmitter {
    killed = false;
    postMessage(msg: { type: string; modelId?: string; id?: number }) {
      if (msg.type === 'load')
        setTimeout(() => { if (!this.killed) this.emit('message', { data: { type: 'loaded', modelId: msg.modelId } }); }, 150);
      else if (msg.type === 'transcribe' && !hang.transcribe)
        setTimeout(() => { if (!this.killed) this.emit('message', { data: { type: 'transcript', id: msg.id, text: 'hello' } }); }, 20);
    }
    kill() { this.killed = true; setTimeout(() => this.emit('exit', 0), 0); return true; }
  }
  return { utilityProcess: { fork: () => { const w = new FakeWorker(); forks.push(w); return w; } } };
});

import { SttWorkerManager } from '../../src/main/workers/sttWorkerManager';
import { ProbeCache } from '../../src/main/providers/probeCache';
import { ProviderRegistry } from '../../src/main/providers/registry';
import { SessionCoordinator, type CoordinatorDeps } from '../../src/main/sessions/coordinator';
import type { AnswerDelta, AnswerRequest, LlmProvider } from '../../src/main/providers/contracts';
import { toPublicError } from '../../src/shared/errors';
import { DEFAULT_PROVIDER_MODELS, LOCAL_STT_MODELS, PROVIDERS } from '../../src/shared/catalog';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noop = () => undefined;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'cuedeck-repro-'));
const MODEL = 'onnx-community/whisper-base';

describe('R1 BUG: overlapping loads of the same model restart each other', () => {
  it('startup prewarm + arm prewarm + transcribe spawn three workers and fail the first two', async () => {
    forks.length = 0;
    const m = new SttWorkerManager('worker.js', tmp());
    const sig = () => new AbortController().signal;
    const p1 = m.ensureModel(MODEL, noop, sig()); await sleep(30);
    const p2 = m.ensureModel(MODEL, noop, sig()); await sleep(30);
    const p3 = m.transcribe({ audio: new Float32Array(16_000), modelId: MODEL, signal: sig(), onProgress: noop });
    const r1 = await p1.then(() => 'ok', (e: Error) => e.message);
    const r2 = await p2.then(() => 'ok', (e: Error) => e.message);
    const r3 = await p3.then((t) => t.text, (e: Error) => e.message);
    expect(forks.length).toBe(3);
    expect(r1).toContain('model worker exited during load');
    expect(r2).toContain('model worker exited during load');
    expect(r3).toBe('hello');
    expect(forks.map((f) => f.killed)).toEqual([true, true, false]);
  });
});

describe('R7 BUG: a stage timeout on the local worker is reported as a user cancellation', () => {
  it('AbortSignal.timeout on transcribe surfaces as AbortError -> REQUEST_CANCELLED', async () => {
    forks.length = 0; hang.transcribe = true;
    const m = new SttWorkerManager('worker.js', tmp());
    await m.ensureModel(MODEL, noop, new AbortController().signal);
    const err = await m.transcribe({ audio: new Float32Array(16_000), modelId: MODEL, signal: AbortSignal.timeout(40), onProgress: noop })
      .then(() => null, (e: Error) => e);
    hang.transcribe = false;
    expect(err?.name).toBe('AbortError');
    expect(toPublicError(err).code).toBe('REQUEST_CANCELLED');
  });
});

describe('R2 BUG: history opt-out during generation is ignored', () => {
  it('turning history off while the answer streams still saves the answer', async () => {
    let historyEnabled = true; const saved: unknown[] = [];
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    async function* generate(_i: AnswerRequest): AsyncIterable<AnswerDelta> { yield { text: 'a', sequence: 0 }; await gate; yield { text: 'b', sequence: 1 }; }
    const llm: LlmProvider = { meta: { ...PROVIDERS.demo }, probe: async () => ({ providerId: 'demo', status: 'ready' }), listModels: async () => [], generate };
    const registry = new ProviderRegistry(); registry.registerLlm(llm);
    const deps: CoordinatorDeps = {
      registry,
      getSettings: async () => ({ sttProviderId: 'local-whisper', sttModelId: 'x', sttLanguage: 'auto', llmProviderId: 'demo', llmModelId: 'sample-response', historyEnabled, historyRetentionDays: 7, maxClipSeconds: 90 }),
      getProfile: async () => null, saveHistory: async (item) => { saved.push(item); }, emit: noop, recordError: noop,
    };
    const run = new SessionCoordinator(deps).regenerate('11111111-1111-4111-8111-111111111111', 'q', { answerMode: 'natural', targetSeconds: 30 });
    await sleep(20); historyEnabled = false; release(); await run;
    expect(saved).toHaveLength(1);
  });
});

describe('R3 BUG: invalidate() does not detach in-flight probes', () => {
  it('a caller after invalidation inherits the old request and its stale result is cached', async () => {
    const cache = new ProbeCache<{ status: string }>();
    let resolveOld!: (v: { status: string }) => void;
    const old = cache.get('groq|m|url|true', () => new Promise((r) => (resolveOld = r)));
    cache.invalidate();
    let fetched = false;
    const next = cache.get('groq|m|url|true', async () => { fetched = true; return { status: 'ready' }; });
    resolveOld({ status: 'missing-credential' });
    expect(await old).toEqual({ status: 'missing-credential' });
    expect(await next).toEqual({ status: 'missing-credential' });
    expect(fetched).toBe(false);
    expect(await cache.get('groq|m|url|true', async () => ({ status: 'ready' }))).toEqual({ status: 'missing-credential' });
  });
});

describe('F7 BUG: local preset picks Whisper Tiny while Base is the documented default', () => {
  it('DEFAULT_PROVIDER_MODELS disagrees with DEFAULT_SETTINGS and the catalog label', () => {
    expect(DEFAULT_SETTINGS.sttModelId).toBe('onnx-community/whisper-base');
    expect(LOCAL_STT_MODELS.find((m) => m.id === DEFAULT_SETTINGS.sttModelId)?.displayName).toMatch(/recommended/i);
    expect(DEFAULT_PROVIDER_MODELS['local-whisper']).toBe('onnx-community/whisper-tiny');
  });
});
```

Result on 2026-09-22: 5 passed (one `PromiseRejectionHandledWarning` from the R1 case, expected).

### 7.2 Electron: stale readiness (save as `test/e2e/_repro.spec.ts`, run `npx playwright test test/e2e/_repro.spec.ts`)

```ts
import { expect, test } from '@playwright/test';
import { installGroqFixture } from './groqFixture';
import { launchApp, READY_SETTINGS } from './helpers';
import { setupPreset } from '../../src/shared/setup';

test('R4: replacing a rejected key does not refresh coach readiness', async () => {
  const { app } = await launchApp({ seedSettings: { ...READY_SETTINGS, ...setupPreset('groq') } });
  try {
    await installGroqFixture(app);
    await app.evaluate(() => { globalThis.__groqFixture.status = 401; });
    const page = await app.firstWindow();
    await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_bad_key'));
    await expect(page.getByTestId('readiness-banner')).toContainText(/rejected/i, { timeout: 10_000 });
    await app.evaluate(() => { globalThis.__groqFixture.status = 200; });
    await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_good_key'));
    await page.waitForTimeout(3_000);
    console.log('listen still disabled after a valid replacement key:', await page.getByTestId('listen-button').isDisabled()); // true
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('listen-button')).toBeEnabled({ timeout: 10_000 });
  } finally { await app.close(); }
});

test('R4b: Check again inside the 5 s failure TTL repeats the cached failure', async () => {
  const { app } = await launchApp({ seedSettings: { ...READY_SETTINGS, ...setupPreset('groq') } });
  try {
    await installGroqFixture(app);
    await app.evaluate(() => { globalThis.__groqFixture.status = 500; });
    const page = await app.firstWindow();
    await page.evaluate(() => window.cuedeck.setSecret('groq', 'gsk_synthetic_key'));
    await expect(page.getByTestId('listen-button')).toBeDisabled();
    await app.evaluate(() => { globalThis.__groqFixture.status = 200; });
    await page.getByRole('button', { name: 'Check again' }).click();
    await page.waitForTimeout(1_500);
    console.log('still disabled after first Check again:', await page.getByTestId('listen-button').isDisabled()); // true
    await page.waitForTimeout(4_500);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('listen-button')).toBeEnabled({ timeout: 10_000 }); // recovered ~6.7 s after the first click
  } finally { await app.close(); }
});
```

Observed: `listen still disabled after a valid replacement key: true` with the banner still reading "API key rejected"; `still disabled after first Check again: true`, enabled 6.7 s later on the second click.

### 7.3 Electron: menu and permission surface

```ts
test('default application menu and permission surface', async () => {
  const { app } = await launchApp({ seedSettings: READY_SETTINGS });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('listen-button')).toBeVisible();
    console.log(await app.evaluate(({ Menu }) => {
      const out: string[] = [];
      const walk = (items: Electron.MenuItem[]) => items.forEach((i) => { out.push(`${i.label || i.role}${i.accelerator ? ` [${i.accelerator}]` : ''}`); if (i.submenu) walk(i.submenu.items); });
      walk(Menu.getApplicationMenu()?.items ?? []);
      return out;
    }));
    const mic = await page.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return 'granted'; } catch (e) { return (e as Error).name; } });
    const capture = () => page.evaluate(async () => { await window.cuedeck.armCapture(crypto.randomUUID()); try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); const k = s.getTracks().map((t) => t.kind).join(','); s.getTracks().forEach((t) => t.stop()); return 'granted: ' + k; } catch (e) { return (e as Error).name; } });
    const baseline = await capture();
    await app.evaluate(({ session }) => { session.defaultSession.setPermissionRequestHandler((_w, p, cb) => cb(p === 'clipboard-sanitized-write')); session.defaultSession.setPermissionCheckHandler((_w, p) => p === 'clipboard-sanitized-write'); });
    console.log({ mic, baseline, captureWithoutMediaPermission: await capture() });
  } finally { await app.close(); }
});
```

Observed: menu items `Reload [CmdOrCtrl+R]`, `Force Reload [Shift+CmdOrCtrl+R]`, `Toggle Developer Tools [Ctrl+Shift+I]`, `Toggle Full Screen [F11]`, `Close [CommandOrControl+W]` among others; `mic: 'granted'`; `baseline: 'granted: audio,video'`; `captureWithoutMediaPermission: 'NotAllowedError'`.
