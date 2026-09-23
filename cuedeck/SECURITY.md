# CueDeck security model

## Reporting

Open a GitHub issue marked `security` (or contact the maintainer privately if the repository
lists a contact). Please do not include credentials or personal transcripts in reports.

## Terms used below

- **Renderer / main process**: an Electron app runs a privileged Node.js "main" process and
  one browser-like "renderer" process per window. CueDeck treats the renderer as untrusted.
- **Sandbox / context isolation / Node integration**: Chromium's sandbox restricts what the
  renderer process can do; context isolation keeps the page's JavaScript world separate from
  the preload script's; Node integration (disabled here) would let page code call Node.js APIs.
- **Preload / IPC**: the preload script is the only bridge between renderer and main. It
  exposes a fixed, typed API; IPC (inter-process communication) messages behind it are the
  only way the page can ask the main process to do anything.
- **CSP (Content Security Policy)**: an HTTP header that tells Chromium which sources of
  scripts, styles, images, and connections a page may use. CueDeck's starts from
  `default-src 'none'` — deny everything, then allow only what the app itself bundles.
- **DPAPI**: Windows' per-user Data Protection API, used via Electron `safeStorage` to
  encrypt stored API keys so they are unreadable outside the current OS user account.
- **Electron fuses**: build-time switches burned into the packaged binary that permanently
  disable Electron/Node escape hatches (they cannot be re-enabled by flags or environment
  variables at run time).

## Controls (release gates, tested where software-controllable)

| Control                                                                                                                                                                                                                                                                                 | Where                                                       | Verified by                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Renderer sandbox, context isolation, no Node integration, no `<webview>` tag                                                                                                                                                                                                            | `src/main/windows/windows.ts`                               | E2E: no `require`/`process`/raw IPC in page |
| Fixed, typed preload API (no channel names, no event objects reach the page)                                                                                                                                                                                                            | `src/preload/preload.ts`                                    | E2E surface check                           |
| IPC sender-frame validation + Zod payload validation on every method                                                                                                                                                                                                                    | `src/main/ipc/register.ts`, `src/shared/schemas.ts`         | unit + integration                          |
| One-use capture grant, expiring after 8 s; unarmed `getDisplayMedia` denied                                                                                                                                                                                                             | `src/main/security/captureGrant.ts`, `main.ts`              | unit + E2E                                  |
| No `setContentProtection`, no capture exclusion, no hidden recording                                                                                                                                                                                                                    | absent by design; persistent recording indicator            | E2E + code review                           |
| CSP from `default-src 'none'`, applied centrally to every response (strict when packaged; dev adds Vite allowances)                                                                                                                                                                     | `src/main/security/windowSecurity.ts`                       | code + manual                               |
| Navigation denial, window-creation denial, webview denial                                                                                                                                                                                                                               | same                                                        | E2E                                         |
| All permission requests denied except sanitized clipboard writes and `media` (only while a capture grant is armed), and only for trusted app frames                                                                                                                                     | `src/main/security/windowSecurity.ts`                       | code review                                 |
| `shell.openExternal` restricted to a hardcoded HTTPS allowlist (provider key/docs/privacy pages, Ollama, Hugging Face)                                                                                                                                                                  | `src/main/security/urlPolicy.ts`, `src/shared/constants.ts` | unit                                        |
| Outbound HTTP host allowlist in the privileged process — only `api.groq.com`, `api.cerebras.ai`, `generativelanguage.googleapis.com`, `openrouter.ai`, the Hugging Face hosts, and loopback; everything else refused before a socket opens; redirects are refused (`redirect: 'error'`) | `src/main/security/http.ts`, `src/shared/constants.ts`      | unit + integration                          |
| Credentials encrypted with `safeStorage` (DPAPI), write-only from the UI                                                                                                                                                                                                                | `src/main/settings/secretVault.ts`                          | unit + E2E                                  |
| Secret redaction in diagnostics/logs                                                                                                                                                                                                                                                    | `src/shared/redact.ts`, `src/main/diagnostics.ts`           | unit                                        |
| Electron fuses: RunAsNode off, `NODE_OPTIONS` off, Node CLI inspect arguments off, cookie encryption on, ASAR integrity validation on, only-load-app-from-ASAR on                                                                                                                       | `forge.config.ts`                                           | packaged build                              |
| Structured public errors; no stack traces or provider response bodies reach the UI                                                                                                                                                                                                      | `src/shared/errors.ts`                                      | integration                                 |

## App origin, capture grants, and unreadable data

**Exact app origin.** A page counts as the app (for IPC, navigation and permissions) only when it
is the renderer entry file itself (`…/renderer/main_window/index.html`, any `#/` route) or, in
development, the exact Vite dev-server origin. Other `file:` documents and other localhost ports
are untrusted. Unpackaged builds started without a dev server still accept loopback pages so the
E2E suite can run; packaged builds never do (`src/main/security/urlPolicy.ts`).

**Grant ownership.** `capture:arm` records the id of the WebContents that armed the grant, and the
display-media handler consumes it only for a request from that same WebContents. A request from
any other WebContents is denied and clears the grant (`src/main/security/captureGrant.ts`).

**Quarantine.** A settings, secrets, history, profiles, window-state or model-manifest file that
is not valid JSON is renamed to `<name>.corrupt-<time>.json` next to the original, recorded in
diagnostics, and the app starts from empty data. The original bytes are never overwritten. A
settings file written by a newer CueDeck is used read-only for that run instead of being replaced.

## Provider HTTP versus the model loader

- **Provider HTTP** (Groq, Cerebras, Gemini, OpenRouter, Ollama, including readiness probes and
  warmups) goes through `allowlistedFetch` in the main process: host allowlist plus loopback,
  timeouts, and `redirect: 'error'`, so a redirect is never followed to an unchecked host.
- **The local speech-model loader** is Transformers.js inside the STT utility process
  (`src/main/workers/sttWorker.ts`). It does not use `allowlistedFetch`; it contacts Hugging Face
  only when the user explicitly starts a download (`models:download` sets `allowDownload`).
  Warmups and transcriptions load from disk with remote models disabled and fail with
  `MODEL_NOT_INSTALLED` instead of downloading. Downloaded models can be deleted from
  Preferences (`models:remove`).

## Dependency policy

- Pin via `package-lock.json`; use currently supported stable Electron.
- `npm audit` reviewed each release; high/critical runtime or packaging advisories block release
  unless an explicit, expiring exception is documented.
- Renderer loads no remote code; all assets are bundled.

## Known limitations

- Release artifacts are unsigned (no funded signing certificate); SHA-256 checksums are
  published instead and SmartScreen warnings are expected.
- `safeStorage` on Windows protects secrets per OS user account; any process running as the
  same user could decrypt them. Do not store keys on shared accounts.
- Model downloads (explicit, user-started) use Transformers.js's own networking in the STT
  utility process, not the main-process allowlist; they are limited to Hugging Face model
  repositories selected from the built-in catalog.
