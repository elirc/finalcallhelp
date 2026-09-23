# CueDeck improvement run — final report (2026-09-22 to 2026-09-23)

**Scope:** every finding in `OPUSIMPROVE_2026-09-22.md` (F1–F19 plus the P0 commit).
**Method:** planning and review by Claude Fable 5.1 for batches 0–3, then by Claude Opus 5.5 for batch 4 onward at the user's request. Implementation by Claude Opus subagents, one per batch. Resume notes are in `HANDOFF_2026-09-22.md`.
**Result:** all 19 findings and the P0 are closed, in six commits, with the full suite green on the final tree.

## 1. Commits

| Commit | Batch | Findings closed |
| --- | --- | --- |
| `2d99e34` | 0 | P0: the reviewed working tree committed as a baseline |
| `39d1c6c` | 1 | F2 timeout reasons · F4 history opt-out at save · F3 readiness push and fresh Check again · F7 Base as default local model · F8 no menu in packaged builds · F12 microphone only while a capture grant is armed |
| `2058f19` | 2 | F1 single-flight speech-model loads · F9 warmup and transcription never download |
| `d010d34` | 3 | F5 generation-safe probe cache · F6 sticky practice category · F11 answer stays at the top |
| `d403cda` | 4 | F10 unreadable stores quarantined · F14 window position written on close · F15 single-instance guard · F13 exact app origin and grant ownership |
| `04c916e` | 5 | F16 throttled download progress · F17 16 kHz capture with batched worklet posts · F18 idle unload and "Remove downloaded model" · F19 warmup dedupe and debounced sliders · a running download is never replaced by a warmup · documentation refresh |

## 2. Verification on the final tree (`04c916e`)

| Check | Before the run | After |
| --- | --- | --- |
| Prettier, ESLint, TypeScript | pass | pass |
| Unit tests | 281 | **333 pass** |
| Integration tests | 103 | **106 pass** |
| Electron E2E | 32 | **37 pass** (run in two parts because of memory) |

Every batch was also verified with its targeted tests before it was committed. The five bugs the review reproduced (R1, R2, R3, R4, R7) now each have a regression test that asserts the fixed behaviour.

New tests worth knowing about:

- `test/unit/sttWorkerManager.test.ts` (new): timeout versus cancel, single-flight joins, last-waiter cancellation, model replacement, download protection, progress throttling, idle unload, and the download policy flag.
- `test/unit/menu.test.ts` (new): packaged builds have no menu.
- `test/unit/stores.test.ts`: quarantine of each store and read-only newer-version settings.
- `test/unit/urlPolicy.test.ts` and `security.test.ts`: exact app origin and grant ownership.
- E2E: microphone denied unless armed, replaced key refreshes readiness, first "Check again" bypasses the cache, practice category survives draws and profile switches, answer sits above the setup notice, and model removal from Preferences.

## 3. Behaviour changes a user will notice

- Replacing an API key or downloading a model enables Listen without pressing "Check again", and "Check again" no longer repeats a cached failure.
- A local transcription that runs out of time shows a timeout error instead of silently returning to Ready.
- Turning history off while an answer is streaming means that answer is not saved.
- Choosing local mode selects Whisper Base, the recommended model, and switching back to local speech keeps an installed model.
- The packaged app has no hidden menu, so Ctrl+R, Ctrl+W, F11 and Ctrl+Shift+I do nothing during a call.
- When typed questions work but speech does not, the answer stays at the top and a one-line notice sits under it.
- Preferences has a two-step "Remove downloaded model" button.
- A corrupt settings, history, profiles, secrets or manifest file is renamed to `*.corrupt-<time>.json` and listed in Diagnostics instead of being overwritten.

## 4. Known limits and suggested follow-ups

- Live providers, a real Whisper download and inference, and packaging (`electron-forge make`) were not exercised. The first real local-model run should confirm that the no-download policy (`allowRemoteModels = false`) still loads an installed model offline.
- The capture change (16 kHz context, 2048-frame blocks) passed the real-worklet E2E test with synthetic audio. It should also be checked once with real call audio for quality and meter responsiveness.
- Three documentation rows from the 2026-09-19 review were not applied, because they need new screenshots, a product change, or edits to historical reports: representative long-answer, recording and high-DPI screenshots; a directly reachable audio test outside onboarding; and release provenance records.
- The credential-flag cleanup at startup has no dedicated test. It is covered by `listProviderIds` tests and a code read.
- The test machine repeatedly ran short of memory. Future runs of the full E2E suite should split it by spec, as described in the handoff.
