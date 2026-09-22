# CueDeck improvement report — 2026-09-18

Scope: the whole `cuedeck/` desktop app (Electron 43, React 19, TypeScript strict). Reviewed every
source file under `src/`, the three test tiers, the build configs, and the two earlier reviews
(`cuedeck/gpt/APP_REVIEW.md`, `cuedeck/docs/APP_REVIEW_2026-09-04.md`). Then made the changes
listed in section 8 and re-ran the verification in section 9.

The four asks and where each is answered:

| Ask                                                               | Section |
| ----------------------------------------------------------------- | ------- |
| Answers at the centre-top of the screen, at eye/camera level      | 3       |
| Separate profiles per tech stack / call type: does it make sense? | 4       |
| Faster loading and lower latency                                  | 5       |
| Usability, refactor, reliability                                  | 6, 7    |

## 1. Summary

CueDeck was already a well-engineered, trustworthy MVP: sandboxed renderer, validated IPC,
encrypted keys, honest readiness probes, and a real test suite. The gaps were in how it feels
during an actual call and in how much it re-does on every screen change.

What changed, in one paragraph: the coach window now opens (and can be re-docked with one click)
top-centre of the display, under the webcam, with the response card first and a compact
"eye-line" layout that shows only the controls and the answer in larger text. Profiles gained a
call type and a tech stack, which shape the prompt differently for a technical interview, a sales
call, a support call, and so on, and the active profile can be switched from the coach's title
bar. Readiness probes are cached and de-duplicated, the local speech model is pre-loaded at
startup and when recording starts, the Preferences window is reused instead of rebuilt, the two
setup routes are code-split out of the coach window's bundle, and streamed answer tokens are
rendered once per frame instead of once per token. The 640-line coach screen and the 920-line
preferences screen were split into a session hook plus small components. Destructive actions now
confirm, errors deep-link to the right settings section, onboarding shows its step count.

Verification: format, lint, strict typecheck, unit (273), integration (98), build, and the
Electron end-to-end suite (27) all pass; see section 9 for details and for what could not be
verified on this machine.

## 2. Review findings

### What was strong and is unchanged

- Security boundary: `sandbox`, `contextIsolation`, sender + Zod validation on every IPC method,
  CSP from `default-src 'none'`, outbound host allowlist, fuses at package time.
- Session model: one active session, session IDs on every event, monotonic delta sequence, cancel
  that retires the session without an error, timeouts per stage.
- Honesty features: visible recording indicator, no `setContentProtection`, history off by
  default, provider disclosures at the point of choice.
- Latency work already present: LLM warm-up on arm and during transcription, silence
  endpointing, Ollama `keep_alive`, Gemini thinking budget 0.

### Pain points found

**Placement and reading position.** The window opened at Electron's default position with the
response card fifth in the layout, below the setup banner, capture controls, practice deck, error
banner, and transcript. On a call the user had to look away from the camera and scroll. Compact
mode hid cards but still put the capture card above the response.

**Repeated readiness probes.** `useReadiness` re-probes both providers whenever any of five
settings change, and the Preferences window runs its own probes. The local Whisper probe stats
every file of every catalog model on every call; the Ollama probe is an HTTP round trip; the
cloud probes are HTTPS round trips (0.5–2 s). Opening Preferences and toggling one switch could
trigger four probes and a "Checking…" banner on the coach.

**Cold starts on the first clip.** The response model was pre-warmed, but the local Whisper model
was loaded only when the first clip arrived, so the first transcription paid a multi-second load
inside the pipeline. Short clips also ran the long-form chunked, timestamped decode path even
when the audio fit in one 30-second Whisper window.

**Preferences window rebuild.** Each open created a new `BrowserWindow`, re-parsed the whole
renderer bundle (about 260 KB of JS containing the coach, onboarding, and preferences), and
re-ran every section's initial IPC calls.

**Per-token re-rendering.** Every `answer-delta` arrived as its own IPC message and dispatched
its own reducer update, so a fast cloud provider (50–100 tokens/s) re-rendered the whole coach
tree that many times per second.

**Effect churn in Preferences.** `LocalModelPicker` received a new `onLoad` function on every
render, and its effect depended on it, so the local model list was requested repeatedly until the
first response arrived. `App.refresh` was also recreated on every render.

**Usability.** No confirmation on "Delete all" history or on profile deletion. Error banners
opened Preferences on the General tab, not on the section that fixes the error. The profile
could be changed only from Preferences. Onboarding had no progress indicator. The Preferences
sidebar had no narrow-window treatment. The Gemini key check was duplicated in two adapters. The
cancel-download IPC handler was the only one without a Zod schema.

**Code structure.** `Coach.tsx` (640 lines) mixed the recorder, session reducer, keyboard
shortcuts, event subscription, practice deck, and eight cards' markup. `Preferences.tsx` (920
lines) held six sections plus a model picker. The settings-patch-then-refresh pair was
hand-written in five places.

## 3. Answers at eye level (centre-top of the screen)

### Requirement

While on a video call, the response should appear where the user is already looking: the top
centre of the screen, directly under a laptop or monitor webcam, so reading it keeps their gaze
close to the lens instead of dropping to a corner or scrolling.

### Design

Three layers, each useful on its own:

1. **Window placement.** A pure placement function computes a wide, short rectangle (760×420,
   shrunk to fit small displays) horizontally centred at the very top of the display's work area.
   On first launch the coach opens there. Afterwards the window remembers where the user last put
   it (a separate `window-state.json`, not a public setting), and only falls back to eye line if
   the remembered position is no longer mostly on a connected display.
2. **One-click re-dock.** An **Eye line** button in the coach title bar (and "Dock at eye level
   now" in Preferences → General) moves the window to eye line on whichever display it is on,
   restores it if minimised, and turns on "Keep on top" through the normal settings path so the
   Preferences checkbox agrees. Without always-on-top the response would sit behind the meeting
   window, so docking implies pinning.
3. **Layout order.** Title bar, then a fixed capture strip (Listen / Stop / Cancel, timer, meter,
   auto-respond toggle), then the scrolling area starting with the **Response** card. The
   transcript, practice deck, notes, and default-style cards follow and are hidden in compact
   mode. Compact mode is now an eye-line layout: the response card fills the window, the answer
   renders at 1.35× size in a 72-character measure, and the top of the answer stays put while it
   streams (the card scrolls internally). A− / A+ buttons on the card adjust text size without
   opening Preferences.

### Files

`src/main/windows/placement.ts` (pure math, unit-tested), `src/main/windows/windowState.ts`,
`src/main/windows/windows.ts`, `src/main/main.ts` (`dockEyeLine` service, move/resize memory),
`src/main/ipc/register.ts` (`app:dockEyeLine`), `src/preload/preload.ts`,
`src/renderer/routes/Coach.tsx`, `src/renderer/coach/CaptureBar.tsx`,
`src/renderer/coach/ResponseCard.tsx`, `src/renderer/styles.css`.

### Not done, on purpose

No per-display camera detection: there is no reliable API for where a webcam is, and top-centre
is correct for every built-in laptop camera and almost every monitor-mounted one. No transparent
or frameless overlay: the app's stated policy is a visible, normal window with a recording
indicator, and a frameless overlay would push toward concealment.

## 4. Separate profiles per tech stack or call type: does it make sense?

### Short answer

Yes for the _purpose_, no for the _mechanism_ as literally stated. Separate user profiles per
tech stack would duplicate the person's background across profiles and still leave the model
answering in the same voice for a sales call and a systems-design interview. What actually
changes the quality of the output is (a) telling the model what kind of conversation this is,
which belongs in the instruction side of the prompt, and (b) telling it which technologies it may
claim hands-on experience with, which belongs in the fenced reference data. Both were added to
the existing profile object rather than as a new profile type.

### Analysis

The prompt has two halves with different trust levels. The system prompt is instruction text the
app authors. The user prompt is fenced, untrusted reference data (`<profile_data>`,
`<role_context>`, `<session_notes>`, `<heard_transcript>`), and the system prompt tells the model
never to treat it as instructions. A "React interview" profile that only adds more reference text
cannot change _how_ the model answers; at best it changes what facts are available.

Options considered:

| Option                                              | Verdict                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| One profile per tech stack, free text only          | Already possible today; does not change answer style; duplicates background across profiles.               |
| A separate "persona" object independent of profiles | Another thing to select on every call; the pairing (background + call type) is what the user actually has. |
| **Call type + tech stack fields on each profile**   | **Chosen.** One selection per call; call type drives fixed instructions, tech stack is fenced data.        |
| Per-profile answer mode and target length           | Deferred: presets _suggest_ a style instead, so a user's explicit default is never silently overridden.    |
| Automatic call-type detection from the transcript   | Rejected: adds a model call before every answer and guesses wrong on the first question of a call.         |

### What was implemented

- `src/shared/callTypes.ts`: six presets (general, technical interview, behavioral interview,
  sales or discovery call, customer support, team meeting). Each has fixed rule sentences, a
  suggested answer mode and target length, and the practice-deck category it maps to. Rules are
  plain strings authored in code; a unit test asserts they contain no block delimiters and that
  changing the call type changes only the system prompt, never the fenced user data.
- `Profile` gained `callType` (defaults to `general`) and `techStack` (max 4,000 characters). The
  Zod schema defaults both, so existing `profiles.json` files load unchanged.
- `buildSystemPrompt` appends the call-type rules after the mode rule and before the
  untrusted-data notice. `buildUserPrompt` adds a `<tech_stack>` block (escaped like the others).
- Coach: an active-profile picker in the title bar showing "name — call type", disabled while a
  session runs; the status rail shows the active profile; the default-style card suggests the
  preset's mode with a one-click link; the practice deck adopts the preset's category until the
  user deals a card.
- Preferences → Profiles and the onboarding profile step both use the same `CallTypeFields`
  component (call type select with description and suggestion, tech stack textarea).
- Practice deck: a **Technical** category with seven stack-agnostic engineering questions (the
  tech stack supplies the specifics).
- The technical-interview rules explicitly forbid claiming hands-on experience with anything not
  in the profile or tech stack, and steer coding/system-design questions toward a spoken outline
  rather than dictated code.

### Suggested use

Make one profile per kind of call you actually take: "Backend interviews" (technical interview,
stack: Go, Postgres, Kafka, AWS), "Frontend interviews" (technical interview, stack: TypeScript,
React, Next.js), "Sales demos" (sales or discovery call, stack: the product and integrations).
The background text can be pasted into each; the call type and stack are what differ.

## 5. Loading time and latency improvements

| Change                                    | Mechanism                                                                                                                                                                                                                                     | Expected effect                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Probe cache with in-flight de-duplication | `src/main/providers/probeCache.ts`; keyed by provider + speech model + Ollama URL + credential flag. Ready results cached 30 s, failures 5 s. Invalidated on key set/remove and after a model download. Explicit "Test" buttons pass `fresh`. | Returning from Preferences no longer shows "Checking…"; both windows share one probe; local Whisper stops stat-ing every model file on every settings change. |
| Installed-model check memo                | `SttWorkerManager.isInstalled` caches per model for 10 s; cleared on install and removal.                                                                                                                                                     | Removes repeated manifest reads and file stats from every probe.                                                                                              |
| Speech model pre-load                     | `SttProvider.warmup` (local Whisper only, never downloads). `SessionCoordinator.prewarm` now warms STT and LLM in parallel, at app start (after the window shows, only when onboarding is complete) and when capture is armed.                | The first clip no longer pays the Whisper model load (typically several seconds for Base) inside the pipeline.                                                |
| Short-clip decode path                    | `sttWorker.ts` uses `return_timestamps: false` and no chunking when the clip fits one 30 s window; long-form path unchanged.                                                                                                                  | Less decoding work for the common 5–30 s question; segment timestamps were never shown.                                                                       |
| Preferences window reuse                  | Close hides the window; reopen shows it and deep-links the requested section. Destroyed with the coach window and on quit so `window-all-closed` still fires.                                                                                 | Second and later opens are instant instead of re-parsing the bundle.                                                                                          |
| Route code-splitting                      | `App.tsx` lazy-loads `Onboarding` and `Preferences`; Vite emits separate chunks.                                                                                                                                                              | Coach window parses only coach code after first run; preferences window parses only its chunk.                                                                |
| Frame-batched answer deltas               | `useCoachSession` queues session events and dispatches them once per animation frame (synchronously when the document is hidden, since rAF pauses there).                                                                                     | Renders capped at display refresh rate instead of one per token; reducer semantics unchanged.                                                                 |
| Stable callbacks                          | `App.refresh` and `ProvidersSection.loadModels` are memoized.                                                                                                                                                                                 | Ends the repeated model-list IPC calls while the list was loading.                                                                                            |

None of these change what is sent to any provider. Measured numbers are not claimed here: the
machine used for this work has no local Whisper model or Ollama installed, and the cloud
adapters were exercised only against the offline fixtures. Section 10 lists how to measure.

## 6. Usability improvements

- **Confirm before destroying.** "Delete all" history and profile "Delete" are two-step inline
  buttons (`ConfirmButton`): first click arms and relabels to "Confirm delete…", second click
  within four seconds fires, otherwise it disarms. No modal dialogs.
- **Errors open the right settings section.** Credential, model, and provider errors open
  Preferences → Providers; unknown and capture errors open Diagnostics. The readiness banner has
  a direct "Open provider settings" button.
- **Profile switching from the coach**, with call type visible, plus an Edit/Add shortcut into
  Preferences → Profiles.
- **Eye line** button and A−/A+ text-size buttons on the coach; "Dock at eye level now" in
  Preferences → General with a plain-language explanation.
- **Onboarding progress** ("Step 2 of 5").
- **Keyboard shortcut hints** in the status rail (hidden in compact mode).
- **Response placeholder text** that says what will happen ("Listening… the response appears
  here as soon as the speaker pauses").
- **Preferences on narrow windows**: the sidebar becomes a top row under 560 px, and the window's
  minimum width was lowered to 480 px.
- **About** shows the app, Electron, and OS versions.
- Capture card copy shortened so the auto-respond toggle fits on one line next to the meter.

## 7. Refactor

| Before                                      | After                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/Coach.tsx` (640 lines, everything)  | `routes/Coach.tsx` (composition + title bar), `coach/useCoachSession.ts` (reducer, recorder, shortcuts, batched events), `coach/CaptureBar.tsx`, `ResponseCard.tsx`, `TranscriptCard.tsx`, `PracticeCard.tsx`, `NotesCard.tsx`, `ModeCard.tsx`, `SetupBanner.tsx`, `StatusRail.tsx`, `ProfileSwitcher.tsx` |
| `routes/Preferences.tsx` (920 lines)        | `routes/Preferences.tsx` (shell, deep links), `preferences/GeneralSection.tsx`, `ProvidersSection.tsx`, `LocalModelPicker.tsx`, `ProfilesSection.tsx`, `HistorySection.tsx`, `DiagnosticsSection.tsx`, `AboutSection.tsx`, `types.ts`                                                                      |
| Patch-then-refresh written five times       | `state/useSettingsUpdate.ts`                                                                                                                                                                                                                                                                               |
| Profile list fetched ad hoc                 | `state/useProfiles.ts` (refresh on mount, on active-profile change, on window focus)                                                                                                                                                                                                                       |
| Call-type fields would be duplicated        | `profiles/ProfileFields.tsx` shared by onboarding and Preferences                                                                                                                                                                                                                                          |
| Gemini key check duplicated in two adapters | `probeGemini()` exported from `llm/gemini.ts`, used by `stt/geminiAudio.ts`                                                                                                                                                                                                                                |
| `models:cancelDownload` parsed by hand      | `modelsCancelDownloadSchema` (Zod, UUID)                                                                                                                                                                                                                                                                   |
| `app:openPreferences` took no arguments     | `openPreferencesSchema` with an optional section; new `preferences:navigate` push channel                                                                                                                                                                                                                  |

All `data-testid` hooks, ARIA group names, button labels, and form labels used by the E2E suite
were preserved, except where the behaviour intentionally changed (two-step delete), and those
tests were updated.

## 8. Complete change list

### New files

| File                                             | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `src/shared/callTypes.ts`                        | Call-type presets, ids, lookup                              |
| `src/main/windows/placement.ts`                  | Eye-line placement math, visibility check, rect sanitizer   |
| `src/main/windows/windowState.ts`                | Debounced persistence of the coach window bounds            |
| `src/main/providers/probeCache.ts`               | TTL + in-flight cache for provider probes                   |
| `src/renderer/coach/useCoachSession.ts`          | Session hook (reducer, recorder, shortcuts, batched events) |
| `src/renderer/coach/CaptureBar.tsx`              | Fixed capture strip                                         |
| `src/renderer/coach/ResponseCard.tsx`            | Response card with follow-ups and text-size buttons         |
| `src/renderer/coach/TranscriptCard.tsx`          | Editable transcript                                         |
| `src/renderer/coach/PracticeCard.tsx`            | Practice deck (owns the deck)                               |
| `src/renderer/coach/NotesCard.tsx`               | Session notes                                               |
| `src/renderer/coach/ModeCard.tsx`                | Default style with preset suggestion                        |
| `src/renderer/coach/SetupBanner.tsx`             | Demo / readiness banners with deep links                    |
| `src/renderer/coach/StatusRail.tsx`              | Footer with provider, profile, timings, shortcuts           |
| `src/renderer/coach/ProfileSwitcher.tsx`         | Title-bar profile picker                                    |
| `src/renderer/preferences/*.tsx`, `types.ts`     | Preferences sections                                        |
| `src/renderer/profiles/ProfileFields.tsx`        | Shared call type + tech stack fields                        |
| `src/renderer/components/ConfirmButton.tsx`      | Two-step destructive button                                 |
| `src/renderer/state/useSettingsUpdate.ts`        | Patch + refresh hook                                        |
| `src/renderer/state/useProfiles.ts`              | Profile list hook                                           |
| `test/unit/callTypes.test.ts`                    | 5 tests                                                     |
| `test/unit/placement.test.ts`                    | 9 tests                                                     |
| `test/unit/probeCache.test.ts`                   | 6 tests                                                     |
| `fabledocs/APP_IMPROVEMENT_REPORT_2026-09-18.md` | This report                                                 |

### Modified files

| File                                          | Change                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/shared/domain.ts`                        | `Profile.callType`, `Profile.techStack`, `PreferencesSection`                                                  |
| `src/shared/schemas.ts`                       | Profile defaults, `providersProbeSchema.fresh`, `modelsCancelDownloadSchema`, `openPreferencesSchema`          |
| `src/shared/prompt.ts`                        | Call-type rules in the system prompt, `<tech_stack>` block, escape list                                        |
| `src/shared/practice.ts`                      | Technical category, seven questions                                                                            |
| `src/main/providers/contracts.ts`             | `SttProvider.warmup?`                                                                                          |
| `src/main/providers/stt/localWhisper.ts`      | `warmup` (installed models only)                                                                               |
| `src/main/providers/stt/geminiAudio.ts`       | Uses shared `probeGemini`                                                                                      |
| `src/main/providers/llm/gemini.ts`            | Exports `probeGemini`                                                                                          |
| `src/main/workers/sttWorkerManager.ts`        | Installed-check memo                                                                                           |
| `src/main/workers/sttWorker.ts`               | Short-clip decode options                                                                                      |
| `src/main/sessions/coordinator.ts`            | `prewarm` warms STT and LLM in parallel                                                                        |
| `src/main/windows/windows.ts`                 | Bounds-based coach creation, eye-line helpers, preferences section hash, lower min width                       |
| `src/main/main.ts`                            | Window-state memory, eye-line default, `dockEyeLine`, preferences reuse, startup pre-warm                      |
| `src/main/ipc/register.ts`                    | Probe cache, `app:dockEyeLine`, section-aware `app:openPreferences`, cancel-download schema, invalidation      |
| `src/preload/preload.ts`                      | `dockEyeLine`, `openPreferences(section)`, `probeProvider(id, fresh)`, `onPreferencesNavigate`, profile fields |
| `src/renderer/App.tsx`                        | Lazy routes, stable `refresh`, section from route                                                              |
| `src/renderer/routes/Coach.tsx`               | Rewritten as composition                                                                                       |
| `src/renderer/routes/Preferences.tsx`         | Shell with deep links                                                                                          |
| `src/renderer/routes/Onboarding.tsx`          | Step indicator, call-type fields in the profile step                                                           |
| `src/renderer/styles.css`                     | Capture bar, eye-line layout, profile switcher, confirm/link buttons, responsive preferences nav               |
| `test/unit/prompt.test.ts`                    | Tech stack and call-type cases                                                                                 |
| `test/unit/schemas.test.ts`                   | Profile defaults and call-type validation                                                                      |
| `test/e2e/app.spec.ts`                        | Compact layout assertions; new response-order + eye-line docking test                                          |
| `test/e2e/groqActions.spec.ts`                | Two-step deletes; call type and tech stack reach the provider; coach shows the active profile                  |
| `cuedeck/README.md`, `README_GROQ_TESTING.md` | Eye line, call-type profiles, compact layout, new buttons                                                      |
| `cuedeck/docs/TESTING.md`                     | New unit test files                                                                                            |

### Settings and data compatibility

No public-settings schema bump: `compactMode` and `alwaysOnTop` keep their meaning and defaults.
Profiles saved by earlier versions load with `callType: 'general'` and an empty tech stack. The
new `window-state.json` is created on first move/resize and ignored if malformed.

## 9. Verification

Run on this Windows 11 machine on 2026-09-18, after all changes, one suite at a time (the
machine had under 1 GB of RAM free during the run because of other desktop applications, which
matters for the Electron tier below).

| Gate                                                      | Result                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prettier --check` (same globs as `npm run format:check`) | pass                                                                                                                                                   |
| `eslint src test *.ts`                                    | pass, 0 problems                                                                                                                                       |
| `tsc --noEmit` (strict)                                   | pass                                                                                                                                                   |
| `npm test` (unit, Vitest)                                 | **273 / 273** in 20 files (was 248; +20 new tests, +5 added to existing files)                                                                         |
| `npm run test:integration`                                | **98 / 98** in 6 files                                                                                                                                 |
| `npm run build`                                           | pass; renderer now emits `index` 236.5 KB + `Preferences` 20.9 KB + `Onboarding` 11.6 KB + `CloudSetup` 4.4 KB chunks (previously one 259.6 KB bundle) |
| `npx playwright test` (Electron E2E, 27 tests)            | **27 / 27** across three runs, see below                                                                                                               |

E2E, first full run: 7 passed (first-run consent, the four renderer-security tests, "preferences
opens as a separate window", "transcript edit streams a response"), then Electron itself failed
to launch for the eighth test with exit code `0xC0000142` (a Windows DLL-initialisation failure
seen under memory exhaustion) and the Playwright worker died, so 16 tests did not run. No CueDeck
or Electron process was left behind; the free RAM at that moment was ~400 MB. The remaining
tests were rerun with launch retries; the outcome is recorded in the line below.

E2E rerun result: the 20 tests without a verdict were run in the foreground in two batches with
`--retries=1`, logging to a file. First batch (the 7 tests that exercise the new behaviour:
session notes, compact layout, response order + eye-line docking, Preferences-to-coach updates,
profiles with call type and tech stack reaching the provider, history two-step delete): **7 / 7**
in 1.5 min. Second batch (the remaining 13: cancel, provider failure, Escape, demo first run,
Ollama typed questions, cloud setup, Groq onboarding, real worklet capture, silence
auto-response, cancel and silent audio, quota recovery, diagnostics, key removal): **13 / 13** in
3.0 min. No test needed its retry. Together with the 7 from the first run, every E2E test passed
against the final build; the only failures seen were Electron launch failures caused by the
machine's memory state, which is worth knowing before running `npm run test:e2e` here with
other applications open.

Not verified on this machine (no local Whisper model or Ollama installed, no live cloud keys):
real transcription latency with the pre-loaded model, real answer latency, and the exact
before/after probe timings. Section 10 lists how to measure them.

## 10. Not done and next steps

- **Live latency numbers.** Measure with a real Whisper Base install and a real Ollama model:
  time from Stop to transcript before/after (STT warm-up), and time from app start to first
  "Ready" chip after toggling a Preferences switch (probe cache). The status rail already prints
  transcribe / first-token / total times per session.
- **Playwright E2E** was updated for the new behaviour but see section 9 for whether it could be
  run here; it launches the real Electron app.
- **Per-profile default style** (mode + target) is suggested, not applied. If users want it
  applied automatically, add `defaultAnswerMode`/`defaultTargetSeconds` to `Profile` and have the
  profile switcher patch settings.
- **Practice questions per stack.** The technical deck is stack-agnostic by design; a small
  per-stack bank (React, Go, SQL) would be a natural follow-up once the call-type flow is used.
- **Undo for single history rows** rather than immediate delete.
- **Startup pre-warm of cloud providers** opens a TLS connection on launch; the readiness probe
  did that already, but if that is unwanted, gate `prewarm()` on `sttProviderId === 'local-whisper'`.

## 11. How to try it

1. `Start CueDeck.cmd` (or `npm start` in `cuedeck/`). The coach opens top-centre.
2. Preferences → Profiles → New profile: pick **Technical interview**, list your stack, paste
   your background, save, **Make active**.
3. Back on the coach: the title bar shows the profile; the practice deck now defaults to
   **Technical**; draw a question and **Respond to edited text**.
4. Press **Compact** for the eye-line layout and **Eye line** if you moved the window. Join the
   call; the response streams at the top of the window under your camera.
