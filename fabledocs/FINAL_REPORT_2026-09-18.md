# CueDeck final report — 2026-09-18

This closes the improvement round documented in detail in
[APP_IMPROVEMENT_REPORT_2026-09-18.md](APP_IMPROVEMENT_REPORT_2026-09-18.md). It adds the second
testing pass, the packaged installer, and points to the new
[setup, deployment, and user guide](SETUP_DEPLOY_USER_GUIDE.md). Everything below was run on the
final source tree.

## 1. What was delivered

| Ask                                                   | Delivered                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answers at the centre-top of the screen, at eye level | Coach opens top-centre under the webcam and remembers where it is moved; **Eye line** re-docks and pins it; response card is first; compact mode is a teleprompter layout (controls + response, larger text, one-line notice if Listen is off). |
| Profiles per tech stack / call type                   | Each profile has a call type (6 presets that add fixed answering rules) and a tech stack (fenced reference data); switch from the coach title bar; practice deck follows the call type; technical question bank added.                          |
| Faster loading and lower latency                      | Probe cache + de-duplication, speech-model pre-load at start and on Listen, single-window decode for short clips, reused Preferences window, code-split routes, frame-batched streaming, stable callbacks.                                      |
| Usability, refactor, reliability                      | Two-step deletes, error deep links, profile picker, step counter, shortcut hints, narrow-window Preferences, coach and Preferences split into hooks and components, shared Gemini probe, schema on every IPC handler.                           |
| Report in `fabledocs/`                                | Improvement report, this final report, the user guide, and three screenshots under `fabledocs/images/`.                                                                                                                                         |
| Deploy / setup / user guide                           | `SETUP_DEPLOY_USER_GUIDE.md`: user setup, on-call use, profiles, practice, settings, troubleshooting, developer setup, build and release checklist, data locations.                                                                             |

## 2. Second testing pass (this round)

New automated coverage, all passing:

| Tier        | File                               | Tests | What it pins                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit        | `test/unit/windowState.test.ts`    | 4     | Coach bounds round-trip through disk, debounce keeps the last value, malformed / old-version / too-small state loads as null, empty flush writes nothing.                                                                                                                                                                                                                                                                |
| Unit        | `test/unit/ipcSchemas.test.ts`     | 4     | `openPreferencesSchema` accepts only known sections; probe `fresh` flag is boolean; cancel-download requires a UUID.                                                                                                                                                                                                                                                                                                     |
| Integration | `test/integration/prewarm.test.ts` | 5     | `prewarm()` warms speech and response models concurrently with the configured ids, survives a failing speech warm-up, emits nothing; local Whisper warm-up never downloads.                                                                                                                                                                                                                                              |
| E2E         | `test/e2e/eyeLine.spec.ts`         | 5     | Eye-line placement on first launch; a moved window is restored after a restart into the same data dir; off-screen memory falls back; error banner deep-links (diagnostics vs providers); Preferences window hides on close and is re-shown on the next open; profile switch changes the system prompt, adds the `<tech_stack>` block, and sets the practice category; Delete disarms after 4 s; onboarding step counter. |

Two small UI fixes came out of reviewing the screenshots the new E2E test captures: at the
eye-line window width the title bar wrapped to two lines (the profile picker's Edit button and
width), and in compact mode the full readiness card pushed the response down. The picker now only
shows an **Add profile** button when there are no profiles, and compact mode shows a one-line
notice instead of the card.

Totals after this round:

| Suite                     | Before this work | Now                   |
| ------------------------- | ---------------- | --------------------- |
| Unit (Vitest)             | 248              | **281** (22 files)    |
| Integration (Vitest)      | 98               | **103** (7 files)     |
| E2E (Playwright/Electron) | 26               | **32** (4 spec files) |

## 3. Verification on the final tree

| Gate                                                       | Result                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` (format globs)                          | pass                                                                                                                                                                                                                                                           |
| `eslint src test *.ts`                                     | pass, 0 problems                                                                                                                                                                                                                                               |
| `tsc --noEmit` (strict)                                    | pass                                                                                                                                                                                                                                                           |
| New unit + integration files                               | 13 / 13                                                                                                                                                                                                                                                        |
| `npm run build`                                            | pass; renderer chunks `index` 237.0 KB, `Preferences` 20.9 KB, `Onboarding` 11.6 KB, `CloudSetup` 4.4 KB                                                                                                                                                       |
| E2E, full suite on the previous build                      | 27 / 27 (three batches, see the improvement report)                                                                                                                                                                                                            |
| E2E after the last UI edits                                | 7 / 7 (the five new tests plus the compact and eye-line-docking tests) on the rebuilt bundles                                                                                                                                                                  |
| `npm run make` (first pass, before last UI edits)          | pass: `CueDeck-Setup.exe`, `cuedeck-0.1.0-full.nupkg`, `RELEASES`, `CueDeck-win32-x64-0.1.0.zip`                                                                                                                                                               |
| `npm run make` + `node scripts/checksums.mjs` (final tree) | pass, run as `electron-forge package` then `make --skip-package` because of memory: `CueDeck-Setup.exe` 140.2 MB, `cuedeck-0.1.0-full.nupkg` 139.4 MB, `RELEASES`, `CueDeck-win32-x64-0.1.0.zip` 144.7 MB, `SHASUMS256.txt` (4 entries) in `cuedeck/out/make/` |
| `npm run check` (final tree)                               | pass: Prettier clean, ESLint 0 problems, strict `tsc` clean, unit **281 / 281** (22 files), integration **103 / 103** (7 files)                                                                                                                                |

Environment note: this machine had well under 1 GB of RAM free from other desktop applications
during the whole session. Electron launches failed twice with exit code `0xC0000142` for that
reason and the harness stopped two background test runs; every failure that was retried alone
passed. No test assertion failed at any point in this round.

Not verified here: real speech-to-text and answer latency with an installed Whisper model or
Ollama, and live cloud calls. Section 10 of the improvement report says how to measure them.

## 4. Files changed in this round (beyond the improvement report)

| File                                     | Change                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `src/renderer/coach/ProfileSwitcher.tsx` | Edit button only when there are no profiles             |
| `src/renderer/coach/SetupBanner.tsx`     | One-line compact variant                                |
| `src/renderer/routes/Coach.tsx`          | Passes `compact` to the banner                          |
| `src/renderer/styles.css`                | Narrower picker, slim notice, tighter title-bar buttons |
| `test/e2e/helpers.ts`                    | `launchApp({ userData })` for restart scenarios         |
| `test/e2e/eyeLine.spec.ts`               | New (5 tests, writes guide screenshots)                 |
| `test/integration/prewarm.test.ts`       | New (5 tests)                                           |
| `test/unit/windowState.test.ts`          | New (4 tests)                                           |
| `test/unit/ipcSchemas.test.ts`           | New (4 tests)                                           |
| `cuedeck/docs/TESTING.md`                | New test files documented                               |
| `fabledocs/SETUP_DEPLOY_USER_GUIDE.md`   | New                                                     |
| `fabledocs/images/*.png`                 | Three screenshots from the E2E run                      |
| `fabledocs/FINAL_REPORT_2026-09-18.md`   | This file                                               |

Nothing has been committed; `git status` at the repo root lists every change for review.

## 5. Recommended next steps

1. Install `out/make/squirrel.windows/x64/CueDeck-Setup.exe` on a second machine and run the
   guide's first-run flow with a real Groq key, then a real call, to get live latency numbers.
2. Decide whether a call type should _apply_ its suggested style (mode + target) automatically;
   today it only suggests.
3. Code signing before wider distribution (SmartScreen), and an update channel.
