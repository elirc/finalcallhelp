# CueDeck project review — 2026-09-19

**Scope:** review of the current working tree, with particular attention to `fabledocs/`. This is a report-only review; no application fixes are included.

**Assessment:** CueDeck has a sound foundation for a Windows conversation coach. Its process separation, typed provider contracts, explicit recording flow, editable transcript, local defaults, and substantial automated coverage are worth preserving. The September 18 work materially improves the structure and usability. The next round should concentrate on lifecycle correctness, readiness recovery, privacy behavior, and evidence from real hardware before adding more features or making stronger reliability claims.

The most useful immediate changes would be to coordinate overlapping local-model loads, honor history opt-out during an active answer, make readiness refresh reliably after setup changes, and correct the practice-category reset. Four targeted checks in this review reproduced those underlying defects; details appear below.

## 1. Review basis and limits

Reviewed areas include:

- All three existing Markdown documents in `fabledocs/` and its three guide screenshots.
- Main-process startup, windows, IPC, security helpers, settings, secrets, profiles, history, diagnostics, session coordination, provider adapters, and the local speech worker.
- Renderer routes, coach and Preferences components, hooks, recording/worklet code, shared schemas, prompt construction, audio helpers, stream parsers, practice questions, and styling.
- Build/packaging configuration, startup and checksum scripts, test configuration, test coverage and representative test implementations, privacy/security documentation, the root product specification, and previous reviews.

The repository was already dirty when this review began. The reviewed implementation includes modified and untracked files that are not represented by HEAD `f63e06a192bd235c1cd152f25c4b0dbd25c3eb35`. Historical reports describe earlier verification; their passing results are not counted as fresh results from this review.

A SHA-256 comparison of all 166 pre-existing, non-ignored repository files found no changes from the review baseline. This report is the only added repository file. The reviewed `cuedeck/package-lock.json` SHA-256 is `2D0828BBA122371D39590605EF4186D93AEDCBBD0CF69087F74D5FE1B03CE01A`.

The review used source inspection, the existing guide images, the standard quality-check command, and small in-memory reproductions loading the actual TypeScript modules. Those reproductions used fake worker/provider objects or a minimal hook harness, not installed Whisper models or a real React browser session. No cloud credentials, live calls, model downloads, installer changes, or application-data changes were used to investigate the findings.

Priority labels:

- **P1:** resolve before relying on the relevant behavior in a wider pilot.
- **P2:** fix in the next reliability/usability round.
- **P3:** planned improvement or maintenance work.

These are project priorities, not CVSS scores or claims of a demonstrated security exploit. “Reproduced” and “source-confirmed” are distinguished throughout.

## 2. What is working well

| Area | Assessment |
| --- | --- |
| Architecture | Renderer, fixed preload API, privileged main process, and speech utility process have clear responsibilities. Dependency injection makes the coordinator and adapters independently testable. A rewrite or a new state-management framework is unnecessary. |
| Core workflow | Listen → transcript → streamed answer is understandable. Typed questions and practice reuse the response path; follow-ups avoid retranscription. Demo mode explicitly identifies its fixed sample. |
| Session isolation | Session IDs, abort propagation, monotonic delta checks, and retirement of old sessions provide a strong base for preventing obsolete answers from replacing newer work. |
| Security defaults | Sandboxing, context isolation, disabled Node integration, named IPC functions, schema checks, packaging fuses, and redirect rejection in the provider HTTP wrapper are present. There are narrower trust-boundary improvements below. |
| Data handling | Credentials are encrypted through `safeStorage` and not returned by the preload API. History is initially disabled. Raw audio is not deliberately written to a history file. Most store mutations serialize and use atomic replacement. |
| Prompt design | Call types select fixed instructions; profile, stack, notes, and transcript are treated as reference text. Delimiter escaping and explicit grounding instructions are useful defenses. They do not prove a model will never invent a fact or obey malicious text. |
| September 18 changes | Eye-line placement, remembered bounds, profile selection, component extraction, cached probes, prewarming, reusable Preferences, and frame-batched event delivery are present in the source. These are real improvements, although some interactions need correction. |
| Test design | There is meaningful coverage of audio parsing, stream boundaries, provider HTTP errors, cancellation, prompt inputs, secret separation, and Electron workflows. The key gaps concern overlapping operations and changes occurring during an operation. |

## 3. Prioritized findings

### R1 — P1: overlapping speech-model loads restart each other

**Evidence:** `cuedeck/src/main/workers/sttWorkerManager.ts:128`, especially the unconditional `this.stop()` at line 136; startup prewarm in `src/main/main.ts:231`; arm-time prewarm in `src/main/ipc/register.ts:267`; transcription also calls `ensureModel()`.

`ensureModel()` returns early only after the requested model is fully ready. A second request for the same model while it is loading kills the first worker and starts another. The newly added startup warmup, Listen warmup, and first transcription can therefore compete for the same model. This can erase the expected cold-start saving. Other overlapping worker operations can fail the displaced operation.

**Reproduced:** two overlapping `ensureModel('same-model')` calls against the real manager with a fake utility process created two workers. The first call rejected with `MODEL_NOT_INSTALLED: model worker exited during load`; the second eventually became ready.

**Recommended change:** share one pending load per model and serialize changes to the worker. Define cancellation ownership so cancellation of a background warmup does not kill a worker that foreground transcription now needs. A different-model request should have an explicit policy rather than implicitly interrupting all current work.

**Acceptance test:** startup warmup, arm-time warmup, and transcription overlapping for one model produce one load; no spurious model error; cancellation and replacement leave the manager in the correct state. Existing `prewarm.test.ts` stubs out the manager and does not establish this property.

### R2 — P1: disabling history during generation does not prevent the pending save

**Evidence:** `cuedeck/src/main/sessions/coordinator.ts:224` and `:350`; `src/renderer/preferences/HistorySection.tsx`; `src/main/storage/historyStore.ts`.

The coordinator snapshots settings at the start of the request and uses that same `historyEnabled` and retention value at completion. The user can turn history off in Preferences while an answer streams, yet the answer and transcript can still be saved afterwards.

**Reproduced:** start a gated generation with history enabled, replace current settings with `historyEnabled: false`, then let the answer finish. The actual coordinator called `saveHistory` once with history disabled at completion.

**Recommended change:** make the latest privacy preference authoritative at persistence time. Account for writes already queued and for a history-clear action during an active request. State clearly whether disabling history preserves previously saved entries; currently the UI hides them but does not clear the existing file.

**Acceptance test:** opt-out before completion prevents persistence; reducing retention during generation uses the new retention; explicit deletion is not unexpectedly undone by an old queued write.

### R3 — P2: invalidated or older probes can overwrite a newer readiness result

**Evidence:** `cuedeck/src/main/providers/probeCache.ts:24–48`; key-change invalidation in `src/main/ipc/register.ts:148` and `:159`.

`invalidate()` clears completed entries but leaves in-flight requests usable. Every completion unconditionally stores its value, including a request started before invalidation or before a newer `fresh` request. Replacing an API key does not necessarily change the cache key because the key contains a configured flag, not a credential revision.

**Reproduced:** start an old probe, invalidate, complete a new fresh probe as ready, then complete the old probe as missing-credential. The next cached read returns the obsolete missing-credential result.

**Recommended change:** attach a generation/revision to cache entries and requests; only the current generation may populate the cache. Invalidating should detach obsolete pending work. Explicit refreshes should have deterministic ordering. Do not put actual credentials into cache keys or diagnostics.

**Acceptance test:** an old completion cannot overwrite the result of a newer probe, and a caller after invalidation cannot inherit the invalidated request.

### R4 — P2: successful setup changes do not consistently refresh the coach

**Evidence:** `cuedeck/src/renderer/state/useReadiness.ts`; `src/main/ipc/register.ts:241`; `src/renderer/preferences/LocalModelPicker.tsx`; `src/renderer/routes/Onboarding.tsx` (`probeAll`).

This is separate from the cache race. The coach hook refreshes only when its dependency key or manual revision changes. It does not subscribe to model-download completion. Downloading the currently selected missing model changes neither the settings key nor the already-held result, so Listen can remain disabled after setup succeeds. Replacing an already-configured rejected key has a similar problem: the credential flag remains `true`, so the dependency key stays unchanged. A successful test in Preferences does not push readiness to the coach.

Also, the coach’s **Check again** and local onboarding’s **Check again** call `probeProvider` without `fresh: true`. They can immediately return the same cached failure. TTL expiry alone does not rerun a React effect.

**Status:** source-confirmed; no live two-window reproduction performed in this review.

**Recommended change:** publish a safe provider/model revision or readiness-change event; refresh on completion and relevant credential changes; make explicit retry controls request fresh results. Preserve de-duplication for routine passive checks.

**Acceptance test:** download the selected model or replace a rejected key from Preferences and observe the coach enable Listen without changing providers, restarting, or manually expanding the compact view.

### R5 — P2: changing practice category after drawing a question resets the selection

**Evidence:** `cuedeck/src/renderer/coach/PracticeCard.tsx:18–30`.

`changeCategory()` sets the chosen category and resets `dealtCount` to zero. The effect watching `dealtCount` then assigns the profile’s suggested category whenever that count is zero. After at least one draw, a manual selection can be immediately replaced.

**Reproduced:** an in-memory harness executed the actual component’s hooks and handlers: suggested category Technical → draw once → choose Behavioral. The resulting select value was Technical.

**Recommended change:** distinguish a user-selected category from a profile-derived default. Apply a changed profile suggestion only while the category is still following that default, and reset the deck independently from the choice.

**Acceptance test:** switch category before the first draw, after a draw, and after a reshuffle; manually selected categories persist and subsequent questions belong to the selected category. Retain a browser test for the real user interaction.

### R6 — P2: local model loading does not enforce the documented download/network boundary

**Evidence:** `cuedeck/src/main/workers/sttWorker.ts:42–55`; `src/main/workers/sttWorkerManager.ts:128`; `src/main/providers/stt/localWhisper.ts`; installed Transformers.js `src/env.js` and `src/utils/hub.js`.

The worker sets `allowLocalModels = true` but does not disable remote loading or pass `local_files_only` for warmup/inference. It uses the same load path for explicit installation and ordinary model use. The installed library defaults remote access to enabled and fetches through its own transport, outside CueDeck’s `allowlistedFetch` wrapper.

The manifest and installation cache reduce unnecessary loads but are not an enforcement boundary: a stale cache or a missing required file can still reach a remote-capable loader. Similarly, the provider-wrapper allowlist does not govern the library’s model-download requests and redirects.

**Status:** confirmed in source and the installed library; no real download or private-content transmission was attempted. This is not evidence that local audio is uploaded. It is a mismatch between guarantees and enforcement.

**Recommended change:** separate explicit installation from loading for inference. Use local-files-only loading for warmup/transcription; fail with a repair/download action when necessary. Pin model revisions, validate required files, and define the model-download transport policy explicitly. Validate that policy in the utility process, where the actual network call happens. The relevant library controls are documented in the [Transformers.js 3.8.1 environment reference](https://huggingface.co/docs/transformers.js/v3.8.1/api/env).

**Acceptance test:** a warmup/inference cache miss performs zero external requests; an explicit download uses the intended hosts; an already-installed setup works with external networking blocked.

### R7 — P2: local-worker timeouts lose their error meaning

**Evidence:** abort handlers in `cuedeck/src/main/workers/sttWorkerManager.ts:142` and `:235`; `src/shared/errors.ts` (`toPublicError`); `src/renderer/state/sessionMachine.ts` (`REQUEST_CANCELLED`).

The worker manager converts any aborted signal into a new `AbortError`, including a signal whose reason is a timeout. `toPublicError()` then maps it to `REQUEST_CANCELLED`, and the renderer returns to Ready without a timeout error. The code carefully distinguishes `TimeoutError` elsewhere, but this path discards that distinction before it reaches the mapper.

**Status:** source-confirmed; a real two-minute inference timeout was not run.

**Recommended change:** preserve `signal.reason` or translate timeout reasons explicitly. A user cancellation should remain quiet; an inference deadline should produce a recoverable timeout with model/hardware guidance.

**Acceptance test:** user abort and stage timeout exercise the same worker cleanup but produce different public outcomes.

### R8 — P2: recoverable storage problems can become silent data loss

**Evidence:** `cuedeck/src/main/storage/profileStore.ts` (`list`/`save`), `src/main/storage/historyStore.ts` (`read`/`add`), `src/main/settings/publicStore.ts` (`load`), and `src/main/settings/migrations.ts`.

Several read paths turn parsing/read errors into empty/default state. A later successful save can replace the original file with that fallback plus only the new data. Invalid profile/history records are dropped on reads, and can disappear permanently on the next rewrite. Newer-version settings also fall back to defaults, which a subsequent edit can overwrite.

**Recommended change:** distinguish missing files from unreadable/corrupt/unsupported-version files. Preserve or quarantine the original, show a recovery message, and avoid silently overwriting it. Continue using serialized atomic writes. Reconcile credential flags with vault state after interrupted multi-file updates.

**Acceptance test:** corrupt one store, launch, and attempt an edit; the original remains recoverable and the user receives a useful message. A normal first run still works without warnings.

### R9 — P2: sender and navigation trust is broader than the intended app origin

**Evidence:** `cuedeck/src/main/security/windowSecurity.ts:12–23`, `src/main/ipc/register.ts:77–85`, and the display-media handler in `src/main/main.ts`.

`isTrustedAppUrl()` accepts every `file:` URL and, in development, any HTTP localhost/127.0.0.1 port/path. `hardenWebContents()` reuses that predicate for navigation, so this is not an exact allowlist of the bundled renderer or the known Vite origin. IPC rejects subframes, which is good, but the URL policy itself remains broad. Capture grants store a session ID yet consumption checks only whether some unexpired grant exists; it is not tied to the requesting window/frame.

**Recommended change:** trust only the known application document/protocol and exact configured development origin. Tie privileged IPC and capture to approved WebContents/frame identities and enforce the capture owner. Keep this narrowly scoped; it does not require changing the UI framework. [Electron’s security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md) recommends validating IPC senders and limiting navigation.

**Status:** defense-in-depth gap confirmed in source, not a demonstrated remote exploit. No attack chain into an arbitrary local document was established.

### R10 — P2: the full-layout setup banner can hide the answer in the primary reading area

**Evidence:** `cuedeck/src/renderer/routes/Coach.tsx` renders `SetupBanner` before `ResponseCard`; `src/renderer/coach/SetupBanner.tsx`; [existing full-layout screenshot](images/guide-coach-full.png).

The guide screenshot itself shows the problem: responses are ready for typed questions, but the large speech-setup card fills the visible body and the answer is below the fold. This is a supported operating mode, not merely an error screen. Moving Response above Heard does not guarantee that Response is visible at eye level.

**Recommended change:** use a concise setup notice when typed responses work, keep the active answer visible first, and move detailed setup below or behind an explicit control. In compact mode, keep the answer’s reading space usable at large text sizes while preserving recording/cancel controls.

**Acceptance test:** visible answer text at the default window size with missing STT, provider errors, long profile names, and 160% app font size. Check mixed-DPI monitors and long answers rather than only relative DOM order.

## 4. Focused review of `fabledocs/`

### What to keep

The three documents have useful, different purposes:

- [APP_IMPROVEMENT_REPORT_2026-09-18.md](APP_IMPROVEMENT_REPORT_2026-09-18.md) records design decisions, implementation scope, verification, and deferred work.
- [FINAL_REPORT_2026-09-18.md](FINAL_REPORT_2026-09-18.md) records the later verification pass and packaging evidence.
- [SETUP_DEPLOY_USER_GUIDE.md](SETUP_DEPLOY_USER_GUIDE.md) gives users and developers an actionable walkthrough with images.

Keep the dated reports as historical records. Maintain the user guide as current documentation. The rise from 273 to 281 unit tests and from 98 to 103 integration tests is explained by the later round; those numbers are not inherently contradictory.

### Corrections and clarifications to make in a future documentation pass

| Topic | Current problem | Suggested correction |
| --- | --- | --- |
| Entry point | The root README directs readers to the Groq walkthrough and does not surface the broader `fabledocs` guide/review sequence. | Add a concise documentation index with current guide, latest assessment, architecture, and dated change reports. Avoid copying the same setup instructions into more files. |
| Verification claims | The final report says everything below was run on the final source tree, but its table distinguishes an earlier full E2E run from seven tests rerun after final UI edits. | State exactly which build each suite exercised. A union of runs across builds is different from a complete suite on the final artifact. Attach commit, lockfile hash, environment, command, result, and artifact checksum to future verification. |
| Performance wording | Prewarming, “instant” reopening, and skipping cold starts are described more definitively than the measurement evidence supports. The report correctly admits live latency was not measured. | Label these as expected effects until measured; publish cold/warm timings and memory alongside hardware/provider details. Include overlapping-warmup coverage from R1. |
| Prompt assurances | The guide says stack data is fenced “without being able to change” instructions; README wording includes “nothing invented.” | Describe these as prompting defenses and intended behavior, not a guaranteed property of model output. Add an evaluation set for invented experience and instruction-following attacks. |
| Cloud authentication | Section 9 of the guide ends its never-sent list with “keys.” Provider adapters necessarily send the selected account’s API key in authentication headers. | Say keys are not returned to the renderer or included in prompt content; the selected provider receives its key for authentication. |
| Local networking | The guide says “in local mode, nothing” leaves the computer, without the model-download distinction explained elsewhere. | Distinguish local audio/prompt processing from explicit model downloads, then align the implementation with R6. |
| Outside-session requests | `cuedeck/PRIVACY.md` says nothing is sent outside an active session. Startup/readiness checks and cloud warmups contact services without a session. | Explain what metadata/authentication requests occur and when. Be precise that they do not contain a call transcript/profile. The improvement report already acknowledges startup cloud warmups. |
| Security policy | `cuedeck/SECURITY.md` says redirects are followed; `allowlistedFetch` now uses `redirect: 'error'`, and there is an integration test for that. It also omits Cerebras from its host list. | Remove the stale redirect limitation, add current provider coverage, and distinguish provider HTTP from the separate model loader. |
| Architecture/development guides | Architecture describes per-probe model file checks without the newer cache; Development says there are exactly two broadcast channels, although `settings:changed` also exists. | Refresh these implementation descriptions and link to the abbreviated specification already present in `docs/ALTERNATIVE_APP_SPEC.md`, while noting that longer historical section numbers may still refer to the original brief. |
| Troubleshooting | The guide describes Ollama as only `127.0.0.1:11434`, although validated loopback alternatives/ports are supported. Monitor-recovery wording implies a live hot-unplug recovery that is implemented primarily at startup/redock. | Describe the actual address and recovery behavior. Put the audio test in a directly reachable place instead of requiring a return through onboarding. |
| Screenshot evidence | Full view shows a hidden answer; compact view uses `fake-model`, a six-word fixture, and zero-like timings. | Keep these as fixture screenshots, clearly identified. Add representative long-answer, recording, missing-STT, and narrow/high-DPI images after layout validation. |
| Release artifacts | The final report lists installers/checksums, but the reviewed features are still partly uncommitted. | Record the exact source revision used for a release. Do not present the current HEAD alone as reproducing the documented build. |

A future `fabledocs` index should also maintain a short open-issues table linking finding IDs to status and verification. That is more useful than repeatedly appending overlapping “final” reports without a current status page.

## 5. Additional product and engineering improvements

### Product flow and usability

1. **Make readiness meaningful.** Distinguish a configured key, authenticated endpoint, available model, loaded local model, and completed inference check. The ordinary **Test speech-to-text** action currently probes metadata/authentication; it does not transcribe a sample. Name it accordingly or provide an explicit sample test.
2. **Keep profiles simple.** Call type plus stack is a useful design. Add profile duplication and optional shared background data before introducing a separate persona system. Offer one explicit action to apply both suggested style and suggested speaking time; currently the coach suggestion changes mode only.
3. **Improve saved-session access.** History loads 100 items by default, and search filters only those loaded items. Show that limit or add pagination/search across retained history. Allow opening a full transcript/answer and provide undo or confirmation for individual deletion.
4. **Refresh reused windows.** Diagnostics loads on mount only. A hidden/reopened Preferences window can retain an outdated error list until the section remounts. Refresh on focus/open and provide an explicit refresh control. Also preserve or warn about unsaved profile drafts when switching sections.
5. **Make operations visible across windows.** Model-download state is component-local; changing sections can lose its progress/cancel controls while the main-process operation continues. Expose active operation status for reattachment. Disable repeated Save actions while a profile write is pending.
6. **Clarify mid-recording controls.** The auto-stop endpointer is created when recording starts. Toggling auto-respond while recording changes the saved checkbox but not the current recorder’s endpointer. Either update the active behavior or label/disable it as applying to the next clip.

### Audio, performance, and resilience

- Add an independent maximum-duration/watchdog timer and track-ended handling. The current recorder checks duration only when worklet messages arrive; a stalled capture source can otherwise leave the UI waiting. Include output-device changes, disconnects, suspend/resume, and zero-message capture in tests.
- Measure cold and warm Stop-to-transcript, Stop-to-first-word, completion time, CPU, and memory. Separate encoding from STT and generation in the definitions: current coordinator timing starts after renderer encoding, even though `encodeMs` is separately recorded. Report p50/p95 over repeatable clips, not only a best result.
- Keep prewarming, but coordinate it and establish an idle memory policy. STT stays loaded until stopped; Ollama requests a 15-minute residency. Account for low-memory systems and switching providers. This machine had roughly 524 MiB free during review, so local-model performance was not meaningfully benchmarked.
- Batch audio worklet messages if profiling shows pressure. At 48 kHz and 128-frame quanta, it can send roughly 375 messages per second, even though displayed level updates are throttled. Accumulating a short block before posting is a more targeted optimization than broad React memoization.
- Bound incomplete SSE/NDJSON buffers and truncate before emitting a delta that crosses `ANSWER_CHAR_CAP`. The final answer is capped, but the current loop can emit an oversized final chunk before applying that cap.
- Pin model revisions and offer a model remove/repair UI with disk-space feedback. A manifest of file sizes is useful for accidental deletion, but is not cryptographic integrity checking.
- Preserve error context safely. Diagnostics currently receives canonical error messages from the coordinator, losing much of the useful provider/stage detail; many IPC/storage failures do not enter its error ring. Add redacted structured stage/provider details without raw prompts or keys.
- Save window bounds through a serialized flush and an orderly shutdown path. The close handler calls `void windowState.flush()`, then normal application exit proceeds; immediate move-and-quit deserves a dedicated check. Current E2E restoration waits a second before closing, so it does not prove the shutdown flush completes.

### Prompt quality and release maintenance

- Build a small evaluation set for each call type: missing background, ambiguous questions, false premises, prompt-injection text, unsupported technology claims, and concise answers. Template tests establish prompt construction, not generated-answer quality.
- Make context size actionable. The profile editor warns on large inputs, but the combined profile/transcript/notes allowance can still exceed a small local model’s useful context. Budget per provider/model and show any omission explicitly.
- Preserve the offline/default-local path and avoid silent provider fallback. More adapters would add maintenance before solving the present reliability gaps.
- Put the reproducible checks in Windows CI; no repository CI workflow was found. Add `engines`/package-manager guidance consistent with the lockfile and document how to obtain a fresh security-audit result.
- Complete release provenance: coherent commit, clean checkout, lockfile, build/test results, dependency inventory, artifact hashes, and a fresh-machine installation test. Add an actual project `LICENSE` file; the package/docs declare MIT, but no first-party license file was found in the reviewed inventory.
- Plan code signing and a verifiable update/rollback path before broad distribution. Checksums detect a mismatch against a trusted reference; they do not themselves establish publisher identity. This review did not rebuild or install the previously reported artifacts.

## 6. Validation performed for this report

Environment: Windows, Node `v22.16.0`, npm `10.9.2`. The machine was under substantial memory pressure. Results below distinguish fresh review checks from the September 18 report.

| Check | Result from this review |
| --- | --- |
| Existing `fabledocs` documents and three screenshots | Reviewed against current source. |
| `npm run check` — formatting | Passed: all matched files use Prettier style. |
| Remaining standard check stages | The review-owned check was stopped after approximately 14 minutes while ESLint was still running, without a result. Lint is incomplete; TypeScript, unit, and integration stages were not reached. No pass or application-code failure is claimed for these stages. |
| Probe-cache invalidation reproduction | Confirmed obsolete missing-credential result overwrites a newer ready result. |
| Worker-load concurrency reproduction | Confirmed two workers for the same overlapping load; first request rejected. |
| History opt-out reproduction | Confirmed one save after settings changed to history disabled during generation. |
| Practice-category reproduction | Confirmed Behavioral selection reverted to Technical after a draw. |
| `npm audit --json` | Failed to obtain an advisory result: registry quick-audit endpoint returned HTTP 400, including a retirement notice and an invalid-package-tree message. This does not establish that the lockfile is corrupt or that dependencies are safe. |
| Direct bulk-advisory fallback using lockfile package versions | Registry returned HTTP 503 maintenance. Dependency vulnerability status remains unverified. No dependency installation/update was performed. |
| Fresh Electron E2E / build / package / installer verification | Not performed in this review. The prior results remain historical evidence. |
| Real system-loopback device matrix, downloaded Whisper inference, real Ollama/cloud latency, model-output quality | Not performed. No live-provider or hardware performance claims are made. |
| Report validation and scope check | All four local Markdown links resolve; UTF-8 content checked; 166 pre-existing repository files unchanged. |

The September 18 final report records 281 unit tests, 103 integration tests, and 32 E2E tests in the final suite inventory. Its detailed table distinguishes full earlier E2E runs from focused reruns after the last edits. Those counts should remain attributed to that report unless freshly rerun on a named build.

## 7. Recommended order of work

| Sequence | Work | Completion evidence |
| --- | --- | --- |
| 1 — reliability and privacy | R1 worker ownership; R2 history opt-out; R3/R4 readiness invalidation and refresh; R7 timeout semantics. | Regression tests covering changes during active operations, not just separate success/failure cases. |
| 2 — visible workflow fixes | R5 practice category; R10 answer visibility; active operation reattachment; accurate test labels. | Electron checks of actual interactions, including two windows and high text/DPI settings. |
| 3 — data and boundary hardening | R6 local-only loading policy; R8 recoverable storage; R9 exact sender/capture ownership. | Fault-injection, offline-network, corrupt-file, and negative-origin tests. |
| 4 — prove the release | Run all tiers on one committed tree, obtain dependency advisories, build once, test the resulting installer on a separate Windows machine, and capture real cold/warm latency. | A release record tying source, lockfile, results, hardware, and checksums together. |
| 5 — product polish | Profile duplication/shared background, full history access, optional preset application, model management, improved practice content. | Focused user testing showing fewer setup steps and useful answers across the supported call types. |

This review recommends continuing the existing architecture. The largest gains now come from making its current features agree under concurrency, recovery, and real operating conditions. No recommended application change was applied as part of this review.

---

## 8. Response and feedback — Claude (Fable 5.1), 2026-09-19

Sections 1–7 above are Astra's review, left unedited. This section is a second reviewer's response: an independent check of each finding against the same working tree, where I agree and differ, what the review missed, and feedback on the report itself. No application code was changed while writing it.

### 8.1 Verdict

The review is accurate and well calibrated. I checked all ten findings against the source and **none is wrong on the facts**; every `file:line` reference I followed landed on the code it described. The six §4 documentation rows I spot-checked (of twelve) are also correct. My disagreements are about priority, scope, and sequencing, not substance. The report's main weaknesses are that its reproductions were not preserved, its verification gap is larger than it reads, and it gives no sense of fix size — several of the ten findings are under ten lines.

### 8.2 Finding-by-finding response

"Verified" means I read the cited code on the current working tree and traced the described path myself. Size is a rough estimate of the fix plus its test.

| ID  | Verified                   | Astra | Mine | Size | Response                                                                                            |
| --- | -------------------------- | ----- | ---- | ---- | --------------------------------------------------------------------------------------------------- |
| R1  | Yes (source)               | P1    | P1   | M    | Agree. Restarts can chain (startup → arm → transcribe). Do together with R6 and R7 — same function. |
| R2  | Yes (source)               | P1    | P1   | S    | Agree on the defect; trim the scope. Fix is a settings re-read before the save.                     |
| R3  | Yes (**reproduced**, §8.7) | P2    | P2   | S    | Agree. Bounded by the 5 s / 30 s TTLs on its own; R4 is what makes a stale result stick.            |
| R4  | Yes (source)               | P2    | P2+  | S–M  | Agree, and rank it above R3. One sub-claim needs a nuance; compact mode is worse than described.    |
| R5  | Yes (source)               | P2    | P2   | S    | Agree. Five-line fix; belongs in the first batch, not sequence 2.                                   |
| R6  | Yes (source, lib 3.8.1)    | P2    | P2   | M    | Agree. The gap is concrete: `transcribe()` has no installed check. Do with R1.                      |
| R7  | Yes (source)               | P2    | P2   | S    | Agree. Fix is smaller than implied (`signal.reason`). Two extra consequences below.                 |
| R8  | Yes (source)               | P2    | P2   | M    | Agree. Half the fix already exists in `jsonFile.ts`. The realistic trigger is schema evolution.     |
| R9  | Yes (source)               | P2    | P3   | S    | Agree on the facts. I looked for a route in and found none, so I would lower the priority.          |
| R10 | Yes (source + screenshot)  | P2    | P2   | S    | Agree. There is also a layout jump at the worst moment — see below.                                 |

**R1.** Confirmed at `sttWorkerManager.ts:133–136`: the early return requires `status === 'ready'`, so a same-model call during `'loading'` reaches the unconditional `stop()`. The impact statement is right, and the restarts can chain: startup warmup → arm-time warmup → transcribe can each displace the previous load. A user who presses Listen soon after launch and records a short clip gets a load that effectively begins at Stop, so the prewarm saving is gone and the earlier partial loads were wasted work. The displaced calls' errors are swallowed by `prewarm()`'s `.catch(() => {})`, which is why this is invisible in normal use. Two implementation notes for the fix:

- Register the shared in-flight promise **synchronously, before the first `await`**. Today `await this.isInstalled()` at line 139 sits between `spawn()` and listener attachment (lines 177–180). With a single-flight map populated after that await, two callers can still both pass the check.
- The same gap has a narrow hang window (source-derived, not reproduced): if a displaced worker's `exit` fires during that await, the first caller attaches `onExit` to an already-dead process and never settles until its signal aborts. `models:download` passes a signal with no timeout (`register.ts:225`), so in that path `downloadOperations` would never clear and every later download would fail with "already running". Single-flight removes the window; I mention it so the fix does not reintroduce it.

**R2.** Confirmed: `settings` is captured at `coordinator.ts:168`/`:224` and consulted at `:350`. The fix is to call `this.deps.getSettings()` again immediately before `saveHistory` and use that snapshot's `historyEnabled` and `historyRetentionDays`. I would **not** take on the "history-clear during an active request" sub-scope: with history still enabled, saving the in-flight answer after a clear is correct behaviour, and `HistoryStore.enqueue` (`historyStore.ts:21`) already orders `clear` and `add` so nothing deleted is resurrected. Keep the change to the re-read and its test.

**R3.** Independently reproduced against the real module (output in §8.7), including the second half of the claim: a caller arriving _after_ `invalidate()` inherits the invalidated in-flight request and never runs its own fetcher. Suggested fix, about ten lines: a generation counter bumped by `invalidate()`, which also drops matching `inflight` entries; a completion writes to `entries` only if its generation is current **and** it is still the registered in-flight request for its key (that second condition handles fresh-versus-older ordering).

**R4.** Confirmed, including that `setCredentialFlag` writes a bare `{ configured: true }` (`publicStore.ts:73`), so replacing a key leaves the hook's dependency key byte-identical. `fresh` is passed by exactly one caller, `ProvidersSection.tsx:34`; the comments at `preload.ts:69` and `schemas.ts:114` both say it exists for "Check again", and neither Check again button uses it. One nuance: in the two scenarios the finding leads with, the main process has already invalidated the cache (`register.ts:148`, `:241`), so pressing Check again _does_ return a fresh result. A stale cached failure on Check again only happens for external changes (for example starting Ollama) inside the 5-second failure TTL. The real defect is the missing automatic refresh, and it is worse than described in the primary layout: the compact banner (`SetupBanner.tsx:28–42`) has no Check again button at all, so at eye line there is no recovery path short of expanding. Cheapest complete fix: broadcast a small readiness-invalidated event from the three `probeCache.invalidate` call sites and bump `revision` on it; add the window-focus refresh `useProfiles.ts:23` already uses; pass `true` from both Check again buttons.

**R5.** Confirmed by reading: `setDealtCount(0)` in `changeCategory` re-fires the effect at lines 22–24, which re-applies `suggestedCategory`. Before the first draw the count is already 0, so the state update is a no-op and the bug hides. The only existing coverage (`eyeLine.spec.ts:150`) asserts that the profile's suggestion is adopted and never changes category by hand, so nothing catches it. One product decision to make explicitly while fixing it: whether switching profile after a manual pick re-adopts the new profile's suggestion. Either is defensible; pick one and test it.

**R6.** Confirmed; `allowRemoteModels` appears nowhere in `src/`, and installed Transformers.js is 3.8.1. The concrete form of the gap: only `warmup()` checks `isInstalled` first (`localWhisper.ts:54`). `transcribe()` goes straight to `ensureModel()`, so the promise that nothing downloads unasked is enforced solely by the renderer's Listen gate. One scoping note for the fix: both download buttons always pass the currently selected model (`LocalModelPicker.tsx:79`, `Onboarding.tsx:242`), so install and load target the same model today. The split is about _network permission_ — which calls may reach the hub — not about juggling two models in one worker.

**R7.** Confirmed. The fix is smaller than the recommendation suggests: reject with `signal.reason` at the five abort sites (`sttWorkerManager.ts:135`, `:144`, `:174`, `:239`, `:268`). `AbortSignal.timeout` supplies a `TimeoutError`, `AbortSignal.any` propagates it, and `toPublicError` already maps it (`errors.ts:111`). Two consequences not listed: because `context.controller.signal.aborted` is false on a timeout, `fail()` writes it to the diagnostics ring as `REQUEST_CANCELLED` — so the support trail is wrong as well as the UI; and there are two stacked `TIMEOUTS.localStt` timers (`coordinator.ts:193`, `localWhisper.ts:64`), one of which can go. What the user sees today is two minutes of "Transcribing…" followed by a silent return to Ready.

**R8.** Confirmed. `readJsonFile` already separates `ENOENT` from every other failure (`jsonFile.ts:11–12`); it is the callers' `.catch(() => null)` that erases the difference (`profileStore.ts:23`, `historyStore.ts:28`, `publicStore.ts:26`, `sttWorkerManager.ts:49`). So the work is mostly reworking four catches plus a quarantine rename. I would reframe the risk: disk corruption is rare, but **schema evolution is certain**. Records failing `safeParse` are dropped on read and the drop is persisted on the next save, so any future tightening of `profileSchema` silently deletes users' profiles. The defaults at `schemas.ts:60–62` show the authors know this; a test that loads a previous-version fixture file would turn the habit into a guard.

**R9.** Confirmed as written (`windowSecurity.ts:15`, `:43`; `captureGrant.ts:31–36`), and I agree with the review's own caveat that no route in was established. I went looking for one and did not find it. File-drop navigation, the usual way into an arbitrary local document, is off by default in the installed Electron 43.1.0 (`navigateOnDragDrop` defaults to `false` and the app never sets it). Window creation is denied, and `src/` contains no `dangerouslySetInnerHTML` and no `href` other than `"#"` (`ProvidersSection.tsx:219`), so model output cannot produce a clickable `file:` link. With no route in, I would lower this to **P3**: the exact-URL allowlist and the capture-owner check are cheap and worth doing, but they should not compete with the reliability work. (My first draft of this paragraph proposed the file-drop chain; checking the Electron default ruled it out. It stays listed as A5 so nobody re-investigates it.)

**R10.** Confirmed from the screenshot (chip reads DONE, answer below the fold). Additional detail: the banner returns `null` while `busy` (`SetupBanner.tsx:58`), and `busy` excludes `complete` (`useCoachSession.ts:223`). So the card vanishes during generation and **reappears the moment the answer completes**, pushing the text down exactly when the user starts reading. Add that to the acceptance test. The simplest fix is to reuse the one-line compact variant in the full layout whenever `llmReady` is true.

### 8.3 Where I would change the order of work

0. **Commit first.** The tree has 30 modified files and 18 untracked paths (several of them whole directories) on top of `f63e06a`. Every verification claim in all three reports refers to a state that exists only on this disk. The review notes this in the last row of its docs table; it should be step zero. Without it the fixes cannot be diffed against the reviewed state and the SHA-256 baseline in §1 identifies nothing recoverable.
1. **Quick wins in one sitting:** R2 (re-read), R5, R7 (`signal.reason`), and R4's `fresh` flag. Each is under ~10 lines with an obvious test. None should queue behind R1's design.
2. **Group by file, not theme.** R1, R6 and R7 all rewrite `ensureModel` and the abort handlers in `sttWorkerManager.ts` / `sttWorker.ts`. The review places R6 two sequences after R1, which means designing that function twice. One change set: single-flight load, an `allowDownload` option that sets `env.allowRemoteModels` in the worker, and reason-preserving aborts. A priority rule for competing requests falls out naturally: foreground transcription > explicit download > background warmup.
3. **R3 + R4 together, R4 leading** — R4 is the one users hit.
4. R10, R8, R9, then the review's sequences 4–5 unchanged.

### 8.4 Feedback on the report itself

**What it does well**

- Accuracy. I found no incorrect reference or mischaracterised code path in R1–R10 or in the §4 rows I checked (`SECURITY.md:59–60` still says `redirect: 'follow'` while `http.ts:51` uses `'error'`; `PRIVACY.md:52–53`; guide lines 275–278; `DEVELOPMENT.md:99`; `FINAL_REPORT:6–7`; no `LICENSE`, no `.github/`).
- Evidence discipline: "reproduced" versus "source-confirmed", an explicit not-performed list, refusal to inherit the September 18 pass counts, and "not a demonstrated exploit" on R6 and R9.
- An acceptance test per finding, phrased as observable behaviour.
- Restraint: no rewrite, no new framework, no new providers.

**What would make it better**

1. **The reproductions were not preserved.** Four findings are marked reproduced, but no script, harness, or test was saved or appended, so none can be re-run and the next person re-derives them. They should land as failing tests (`it.fails` in Vitest) — at which point they _are_ the acceptance tests. Re-creating R3 took 25 lines (§8.7).
2. **The verification gap is larger than it reads.** ESLint stalled, so typecheck, unit, and integration never ran: the report contains no evidence that the reviewed tree compiles. `npm run check` chains five stages in one process tree, which this machine cannot sustain under memory pressure; running the stages one at a time is the known workaround. Results from doing that are in §8.6.
3. **No fix sizes.** Ten findings and 20 further bullets in §5, with no signal as to which are five-line changes and which are multi-day. The table in §8.2 adds rough sizes.
4. **§5 mixes verified defects with ideas.** Three of its bullets are real, confirmed bugs that deserve R-numbers: the auto-respond toggle not reaching the live endpointer (`useCoachSession.ts:131`), the oversized final delta (`coordinator.ts:308–309`), and the unawaited `windowState.flush()` on close (`main.ts:222`). They sit beside speculative items ("if profiling shows pressure", code signing) with no way to tell them apart.
5. **Priority calibration.** P1 is defined as "before a wider pilot". By that definition R4 is more likely to bite a pilot user than R2, which needs a Preferences checkbox toggled during a few seconds of streaming. I keep R2 first only because it is a privacy promise and the fix is trivial.
6. **Follow your own advice on status tracking.** §4 recommends an open-issues table instead of another prose report; §7 then restates §3 in prose. §8.5 below is that table.

**Additional observations** (source-derived unless noted)

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **"Do not keep (session only)" keeps nothing, even for the session.** Retention 0 empties the file on every `add` and `list` (`historyStore.ts:76`); that part is deliberate and tested (`stores.test.ts:190`). But the renderer has no in-memory session list, so with history on and this option chosen nothing is ever visible, and merely opening the History section erases earlier entries. The option is indistinguishable from "history off, plus erase". Add an in-memory session list or relabel it (for example "Do not keep — erase saved history"). |
| A2  | Setup banner reappears on completion and shifts the answer (detail under R10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A3  | **Checked and ruled out:** a download evicting a _different_ loaded model. Both download buttons pass `settings.sttModelId`, so the only cross-model case reachable from the UI is switching model and downloading during an active transcription, which R1 already covers.                                                                                                                                                                                                                                                                                      |
| A4  | `fresh` is documented for "Check again" but unused there; no Check again exists in compact mode (detail under R4).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A5  | **Checked and ruled out:** file-drop navigation as a route into R9's `file:` trust breadth. Electron 43.1.0 defaults `navigateOnDragDrop` to `false` and the app does not enable it (detail under R9).                                                                                                                                                                                                                                                                                                                                                           |
| A6  | Local STT timeouts are logged to diagnostics as cancellations (detail under R7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A7  | Narrow pending-forever window in `ensureModel` that can wedge `downloadOperations` (detail under R1; not reproduced).                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 8.5 Open-issues table

Proposed as the seed for the `fabledocs` status page the review recommends. Update the status column in place rather than writing another report.

| ID                 | Summary                                          | Priority | Size | Batch | Status |
| ------------------ | ------------------------------------------------ | -------- | ---- | ----- | ------ |
| —                  | Commit the reviewed working tree                 | P0       | S    | 0     | Open   |
| R2                 | History opt-out honoured at save time            | P1       | S    | 1     | Open   |
| R5                 | Practice category sticks after a draw            | P2       | S    | 1     | Open   |
| R7 / A6            | Timeouts keep their meaning (UI and diagnostics) | P2       | S    | 1     | Open   |
| R4 (part) / A4     | Check again passes `fresh`                       | P2       | S    | 1     | Open   |
| R1 / A7            | Single-flight model load, cancellation ownership | P1       | M    | 2     | Open   |
| R6                 | Install separated from load; local-only loading  | P2       | M    | 2     | Open   |
| R4 / R3            | Readiness auto-refresh; generation-safe cache    | P2       | M    | 3     | Open   |
| R10 / A2           | Answer stays visible; no banner jump             | P2       | S    | 4     | Open   |
| A1                 | Retention 0 label versus behaviour               | P3       | S    | 4     | Open   |
| R8                 | Quarantine unreadable stores; vN-1 fixture test  | P2       | M    | 5     | Open   |
| R9                 | Exact app URL allowlist; capture owner check     | P3       | S    | 6     | Open   |
| §5 (three bullets) | Endpointer toggle, final-delta cap, close flush  | P3       | S    | 6     | Open   |
| §4                 | Documentation corrections (12 rows)              | P3       | M    | 6     | Open   |

### 8.6 What this response verified, and what it did not

| Check                                                    | Result                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| R1–R10 cited code paths                                  | Read and traced on the current working tree; all ten confirmed.                                               |
| R3 reproduction                                          | Reproduced against the real `probeCache.ts` (§8.7).                                                           |
| §4 documentation rows                                    | Six spot-checked against the named files; all correct. `LICENSE` and `.github/` confirmed absent.             |
| `npm run typecheck`                                      | **Passed** (exit 0, about 2.5 min), run on its own on the current working tree.                               |
| `npm run test` (unit)                                    | **Passed**: 22 files, 281 tests, 154 s. The count matches the September 18 final report.                      |
| `npm run test:integration`                               | **Passed**: 7 files, 103 tests, 67 s. Also matches the September 18 count.                                    |
| ESLint, Electron E2E, build, packaging                   | Not run.                                                                                                      |
| R1, R2, R5 reproductions                                 | Not re-run; the source reading is unambiguous for each. Astra's harnesses were not available to re-execute.   |
| R9 route-in search (A5)                                  | `navigateOnDragDrop` default confirmed `false` in the installed Electron 43.1.0 typings; never set in `src/`. |
| A7 hang window                                           | Not reproduced; labelled as such above.                                                                       |
| Live providers, real Whisper inference, hardware latency | Not performed.                                                                                                |

Remaining §5 bullets not named in §8.4 were not independently checked.

### 8.7 R3 reproduction

Run from anywhere with Node 22 (`node --experimental-transform-types r3-repro.mts`); it imports the real module and uses the same cache key shape as `probeKey()`.

```ts
import { ProbeCache } from 'file:///C:/Users/Owner/Desktop/finalcallhelp/cuedeck/src/main/providers/probeCache.ts';

type P = { status: string };
const cache = new ProbeCache<P>();
let resolveOld!: (v: P) => void;
let secondFetcherRan = false;

// 1. A probe starts with the old (bad) key.
const old = cache.get('groq|m|url|true', () => new Promise<P>((r) => (resolveOld = r)));
// 2. The user replaces the key -> secrets:set invalidates the cache.
cache.invalidate();
// 3. A passive caller (the coach's useReadiness) probes after invalidation.
const afterInvalidate = cache.get('groq|m|url|true', async () => {
  secondFetcherRan = true;
  return { status: 'ready' };
});
// 4. Preferences runs an explicit fresh probe with the new key.
const fresh = await cache.get('groq|m|url|true', async () => ({ status: 'ready' }), true);
// 5. The old probe finally completes with the old key's verdict.
resolveOld({ status: 'missing-credential' });
await old;

console.log(fresh.status, secondFetcherRan, (await afterInvalidate).status);
console.log((await cache.get('groq|m|url|true', async () => ({ status: 'FETCHER-RAN' }))).status);
```

Output on this tree:

```text
ready false missing-credential
missing-credential
```

The fresh probe saw `ready`; the post-invalidation caller never ran its own fetcher and received the old verdict; and the cache now serves `missing-credential` for the new key.
