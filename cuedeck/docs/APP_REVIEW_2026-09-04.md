# CueDeck review and free-testing improvements

Reviewed September 4, 2026: startup and build tooling, onboarding, provider adapters, model
selection, audio capture and cancellation, session processing, settings and credential storage,
profiles and history, renderer controls, IPC/security policy, documentation, and automated tests.

## Main finding

The app had the provider adapters needed for free testing, but setup could complete with no usable
response model. Provider switching retained incompatible model IDs, Preferences changes did not
reach the Coach, and the dependency installation was incomplete. These made a nominally configured
app difficult to test.

## Changes

| Area                 | Problem                                                                                                 | Improvement                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Startup              | Missing tools in the existing dependency installation; editor environment could launch Electron as Node | Installed lockfile dependencies; added a clean launch script and parent-folder Windows launcher                             |
| Free cloud setup     | No direct key links; connectivity did not prove response generation worked                              | Shared guided setup in onboarding and Preferences, direct key links, encrypted key storage, and a real sample-response test |
| Provider defaults    | Groq/Cerebras defaults were outdated; switching modes could retain incompatible model IDs               | Refreshed model IDs from provider documentation, centralized presets, and migration of stale cloud selections               |
| Immediate testing    | Every path required model installation or an account                                                    | Explicit demo provider streams a fixed sample without network, credentials, or audio capture                                |
| Readiness            | Onboarding completion was displayed as readiness                                                        | Check the selected providers and exact Ollama model; explain incomplete audio setup and allow typed questions independently |
| Preferences          | Settings and credentials changed in one window were stale in the other                                  | Broadcast public settings and update both windows without restart                                                           |
| Settings storage     | Concurrent patches could overwrite each other                                                           | Serialize read/modify/write and update the cache only after successful persistence                                          |
| Validation           | Arbitrary models could be selected or downloaded; remote Ollama UI conflicted with networking policy    | Validate supported provider/model pairs and local model downloads; make localhost-only Ollama policy explicit               |
| Stream failures      | Empty answers and provider error frames could look successful                                           | Surface errors instead of completing and saving empty responses; bound cloud output tokens                                  |
| OpenRouter           | The public model listing could accept an invalid key during probing                                     | Check credentials through the authenticated `/key` endpoint                                                                 |
| Capture cancellation | Audio arriving after cancellation could escape cleanup; encoding could submit after cancel              | Stop late streams, resume the AudioContext, ignore retired capture work, and clean up on unmount                            |
| Local speech worker  | An old worker's exit could clear its replacement; empty manifests looked installed                      | Check worker identity and require recorded model files                                                                      |
| Downloads            | Fast completion could arrive before the UI knew its operation ID                                        | Assign operation IDs before invoking download; show invocation failures and prevent overlapping downloads                   |
| Coach controls       | Clear could reset the UI while generation was still active                                              | Disable Clear during active work and provide settings actions for provider errors                                           |
| Network policy       | Redirects could bypass the outbound allowlist                                                           | Reject redirects on fixed provider API endpoints                                                                            |
| Testing and guidance | Free setup was hard to reproduce                                                                        | Added targeted unit, integration, and Electron workflow regressions plus a free-testing guide                               |

## Free service verification

The recommended path is one free Groq account for `whisper-large-v3-turbo` audio and
`openai/gpt-oss-20b` responses. Alternatives are Gemini 2.5 Flash, OpenRouter's free router,
Cerebras's current free trial, and fully local models. Official sources and setup instructions
are linked in [FREE_TESTING.md](FREE_TESTING.md).

The app restricts supported model selections but cannot infer whether a cloud account has billing
enabled. The interface and documentation now state this rather than promising that a model ID alone
guarantees zero charges. There is no automatic provider fallback.

## Verification boundaries

### Additional Groq workflow testing

Added nine Electron workflow tests using synthetic Groq responses and generated WebAudio input,
plus two storage regressions. They exercise onboarding recovery, the real capture worklet/WAV
encoder, selected transcription language/models, pause detection, cancellation, silent audio,
quota recovery, profile and note prompts, follow-up targets, native JSON/Markdown file downloads,
history search/retention/deletion, diagnostics opt-ins, and key removal across windows.

The additional review fixed:

- Concurrent credential writes could lose another account's key. Vault changes now serialize.
- A Shorter response used a 15-second prompt but displayed the default target. The estimate now
  uses the target of the actual request.
- Deleting the active profile left a stale selection. Deletion now clears and broadcasts it.
- History exports bypassed retention and the enabled setting. They now use the same retained
  records as history reads; expired records are also removed from disk on those reads.
- Changing retention did not refresh the History table. It now refreshes automatically, has a
  manual Refresh history action for new sessions, and allows Delete all while saving is off.

The detailed user walkthrough is [README_GROQ_TESTING.md](../README_GROQ_TESTING.md), also linked
from both project entrypoint READMEs. It covers the free-account setup and every app action.

### Validation results

Verified on this Windows computer:

- `npm run check`: formatting, lint, TypeScript, **248 unit tests**, and **98 integration tests** passed.
- `npm run build` followed by `npx playwright test`: production bundles and **26 Electron workflow tests** passed (**372 tests total**, including 11 added in the second testing pass).
- The final full Electron run passed after correcting an assertion to await the asynchronous native window-setting update. The focused Groq workflow run also passed all nine tests.
- Verified the documented Windows speech-synthesis example with its output discarded; actual speaker/headphone loopback remains a manual device check.
- Visually reviewed the demo response and free cloud setup screenshots.
- `npm start`: launched the normal CueDeck desktop window and confirmed it was responding; left it open for setup.

Cloud automated tests use local servers or simulated HTTP responses; they do not use account keys.
A live response and live speech-to-text request require the user to enter a working key in the app.
The demo exercises interface behavior and is not a test of AI answer quality. Actual speaker/headphone
loopback capture must be checked on the target audio device using the in-app test. Local Whisper
downloads and Ollama inference require the optional local setup. This review does not establish
installer signing, production load readiness, or provider quota guarantees.
