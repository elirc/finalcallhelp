# CueDeck: complete Groq free-tier testing walkthrough

Use this guide to start CueDeck, connect one Groq key, test real responses and computer audio, and use every screen in the app. **Groq needs no Ollama installation or model downloads.**

Instructions match CueDeck 0.1.0. Groq documentation was checked on **September 4, 2026**. Automated tests use synthetic credentials and provider responses; the live steps below use your own account.

## Contents

- [1. Start the app](#1-start-the-app)
- [2. Create a free Groq account and key](#2-create-a-free-groq-account-and-key)
- [3. Connect Groq in CueDeck](#3-connect-groq-in-cuedeck)
- [4. Test a typed question first](#4-test-a-typed-question-first)
- [5. Test computer audio](#5-test-computer-audio)
- [6. Every Coach action](#6-every-coach-action)
- [7. Profiles and session notes](#7-profiles-and-session-notes)
- [8. Every Preferences action](#8-every-preferences-action)
- [9. Free-tier usage and limits](#9-free-tier-usage-and-limits)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Manual acceptance checklist](#11-manual-acceptance-checklist)
- [12. Run the automated tests](#12-run-the-automated-tests)
- [13. Data, shutdown, and resetting](#13-data-shutdown-and-resetting)

## 1. Start the app

You need Windows 10/11 x64, Node.js 22 or newer with npm, and an internet connection for installation and Groq. The project was tested here with Node 22.16.0. Dependencies include Electron; the initial install can take several minutes and uses disk space even if you choose cloud models.

**Easiest:** double-click **Start CueDeck.cmd** in the `finalcallhelp` folder. It installs dependencies if the Electron Forge command is missing, then launches CueDeck. Keep its terminal open while testing.

**From PowerShell**, starting in `finalcallhelp`:

```powershell
cd .\cuedeck
node --version
npm --version
npm ci
npm start
```

Run `npm ci` for the first installation, after a lockfile update, or to repair dependencies. For subsequent launches, just run `npm start` from `cuedeck`. If PowerShell blocks `npm.ps1`, use `npm.cmd ci` and `npm.cmd start`; changing your execution policy is unnecessary.

There is no web backend to start, database account to create, or separate Groq SDK to install. The application opens as a desktop window. The terminal is expected to remain running.

## 2. Create a free Groq account and key

1. Open [Groq Console: API keys](https://console.groq.com/keys) in your browser and sign up or sign in.
2. Check your organization/account plan. Use the **Free** plan for this walkthrough. Avoid upgrading to Developer or adding a payment method for this test. An existing paid account can incur charges even with the same models; CueDeck cannot inspect or change your billing plan. Groq describes the upgrade and payment requirements in its [billing FAQ](https://console.groq.com/docs/billing-faqs).
3. Create an API key and give it a recognizable name, such as `CueDeck testing`. Copy the generated key for the next step. Groq's [quickstart](https://console.groq.com/docs/quickstart) links to the key-management page.
4. Paste the key only into CueDeck's API key field. **CueDeck does not load `GROQ_API_KEY` from an environment variable or `.env` file.** Those instructions in general SDK examples are not this app's setup path.

This is a Groq API account/key, separate from ChatGPT subscriptions or keys for other providers. Review [Groq's data-use documentation](https://console.groq.com/docs/your-data): inference content is generally not retained by default, with stated exceptions including troubleshooting and abuse investigations; usage metadata is retained. Check the current policy and your organization's data controls before choosing what to submit.

## 3. Connect Groq in CueDeck

### First launch

1. Read and check the acknowledgement, then click **Continue**.
2. Choose **Use cloud free tier**.
3. In **Free cloud setup**, choose **Groq** from **Cloud provider**.
4. **Get Groq API key** opens the account's key page. **Data-use policy** opens the provider policy.
5. Paste your key into the password field and click **Save and test** once.
6. Wait for **Sample response received. Ready for typed questions.** and **Audio provider connected. Test system audio next.** The password field clears after saving; that is expected.
7. Click **Continue**. Run the optional **Run 5-second test** while audio is playing, or choose **Skip test** to test typed questions first.
8. Add your background, or leave the fields empty. Click **Finish setup**. An onboarding profile containing background or role text becomes active automatically.

Saving Groq selects both of these:

| Purpose                    | Provider in CueDeck | Model                    |
| -------------------------- | ------------------- | ------------------------ |
| Transcribe recorded speech | `groq-whisper`      | `whisper-large-v3-turbo` |
| Generate response cards    | `groq`              | `openai/gpt-oss-20b`     |

**Save and test** sends a small synthetic connection prompt, without your profile, notes, or audio. It also checks provider access. It does not perform speech recognition. The 5-second audio test measures capture and discards the clip; the first completed **Listen** turn verifies real transcription.

If a saved key exists, leave the password field empty and click **Save and test** to reuse it. Entering a new key replaces it. Saving again also reapplies the selected provider's default models.

### Already on the Coach or using the demo

- Open **Settings → Providers → Free cloud setup** and follow steps 3–6 above. Close Preferences to return to the Coach; provider changes apply immediately.
- In the demo or incomplete-setup card, **Set up real AI** reopens the setup flow. **Try demo instead**, when offered, selects the fixed sample provider.
- Demo answers are labeled samples. For real Groq testing, confirm the bottom status line shows `groq-whisper` and `openai/gpt-oss-20b via groq`.

## 4. Test a typed question first

This isolates your key and response model from audio-device setup.

1. In **Heard**, type: `How would you handle a customer whose request is unclear?`
2. Click **Respond to edited text**.
3. Expect **Generating…**, streaming text in **Response**, then **Done**. A brief answer may arrive too fast to visibly stream word by word.
4. Click **Copy**, then paste into a text editor. The pasted text should match the response.
5. Click **Shorter** under the response. A new answer is requested with a 15-second target; the estimate beneath it should also refer to **15 s target**.
6. Edit the question in **Heard**, then click **Respond to edited text** again.

Alternatively, choose a practice category and click **Draw a question**. Drawing only fills the text field and uses no AI quota. Generating the suggested response does use quota. AI wording varies; evaluate relevance and whether it stays within the background you supplied, rather than expecting an exact sentence.

## 5. Test computer audio

CueDeck records **audio the computer is playing through speakers or headphones**. Speaking directly into your microphone will not test this path unless another application plays that microphone audio through the output device. CueDeck does not join calls, record microphone input, read screen text, or speak the generated answer aloud.

### A repeatable first recording

1. Use a spoken question in a local recording or browser video. Confirm you can hear it through the currently selected Windows output device. Pause just before the question.
2. Turn **Auto-respond when the speaker pauses** off for the first test.
3. Click **Listen**, then resume the spoken audio.
4. Expect a visible recording indicator, an increasing timer, and a moving audio meter.
5. After a 5–15 second question, click **Stop & respond**.
6. Expect recording to stop, followed by **Encoding… → Transcribing… → Generating… → Done**. Fast stages may flash past.
7. Confirm **Heard** roughly matches the question and **Response** addresses it. Correct any transcription error in **Heard** and use **Respond to edited text** to retry without recording again.

An optional source of speech is Windows' installed text-to-speech voice. In **Windows PowerShell**, prepare this script, start **Listen** in CueDeck, then run it:

```powershell
Add-Type -AssemblyName System.Speech
$cueTestVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $cueTestVoice.Speak('Tell me how you would handle a difficult customer. How would you understand their concern and agree on the next step?')
}
finally {
    $cueTestVoice.Dispose()
}
```

This plays speech locally using an installed Windows voice. If the assembly/voice is unavailable, use a spoken audio file instead.

### Automatic pause detection

Turn **Auto-respond when the speaker pauses** on, click **Listen**, and play another question. After roughly 1.2 seconds of detected speech and then 1.6 seconds of silence, the app should submit automatically. Background music, notifications, and long pauses within a question affect detection. Use manual stop when that happens.

Each turn is one clip. After **Done**, press **Listen** again for the next question. It does not keep recording between turns. The maximum clip length defaults to 90 seconds and is configurable from 30 to 120 seconds; reaching it submits automatically.

### Cancellation and silence

- Start recording, then click **Cancel** or press **Esc** with the Coach focused. Recording stops and the unfinished clip is discarded.
- **Cancel** during transcription/generation stops local processing and aborts the request. Data already sent to Groq cannot be recalled, and the provider may have counted the request.
- For a silence test, stop all playback, record for a few seconds, then manually stop. Expect a silence error and no usable response. Very short clips can instead produce a too-short error. Click **Dismiss** and try again.

## 6. Every Coach action

| Control                                  | What it does / how to test it                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Listen**                               | Begins one computer-output recording when both providers are ready.                                                                                                  |
| **Stop & respond**                       | Ends the clip and starts transcription, followed by response generation.                                                                                             |
| **Cancel**                               | Discards an unfinished recording or aborts active processing. No completed history entry is created for a cancelled attempt.                                         |
| **Auto-respond when the speaker pauses** | Sets pause detection for the next recording; disable it for manual control.                                                                                          |
| Practice category                        | Choose All categories, Background, Behavioral, Motivation, Teamwork, or Curveballs. Changing category resets the deck.                                               |
| **Draw a question**                      | Replaces Heard with a built-in practice question. Questions shuffle after the deck is exhausted. Answer aloud yourself before comparing with a generated suggestion. |
| **Heard** text field                     | Type or edit a question/transcript, up to 40,000 characters. Keep tests much shorter to conserve free-tier quota. Editing alone does not send a request.             |
| **Respond to edited text**               | Sends the current Heard text, active profile, notes, mode, and target to the response provider. Audio is not resent.                                                 |
| **Copy**                                 | Copies the response as text; changes briefly to Copied.                                                                                                              |
| Response **Clear**                       | Clears the displayed transcript, answer, and session result. It does not delete saved history or session notes. Disabled while busy.                                 |
| **Shorter**                              | Requests a fresh response to the current question with a 15-second target.                                                                                           |
| **Bullets** under Response               | Requests a fresh response as short bullet points.                                                                                                                    |
| **STAR** under Response                  | Requests a fresh response using Situation, Task, Action, Result for an example question.                                                                             |
| **More concise**                         | Requests a fresh response in at most three short sentences.                                                                                                          |
| **Try again**                            | Generates again from the current transcript and current defaults. It does not record again.                                                                          |
| Session notes **Clear**                  | Clears only the temporary notes.                                                                                                                                     |
| Default mode buttons                     | Set the saved mode used for subsequent responses; clicking a mode alone does not regenerate.                                                                         |
| **Compact / Expand**                     | Toggle a smaller layout. Expand to see notes, practice, and default-mode controls. Recording remains visible.                                                        |
| **Settings**                             | Opens Preferences in a separate window. Close that window to return.                                                                                                 |
| **Check again** on the setup card        | Refreshes provider readiness after fixing a connection or setup issue.                                                                                               |
| Error **Dismiss**                        | Clears the error and displayed session text so you can start again. Copy text you want to preserve first.                                                            |

Follow-up buttons regenerate from the current question and context; they do not edit the previous answer in place or send a conversation history. Their overrides apply to that request. **Shorter → Bullets** therefore uses the default speaking target for the Bullets request. Use **Settings → General** to change the saved target.

### Default modes

| Mode    | Requested output                                                                            |
| ------- | ------------------------------------------------------------------------------------------- |
| Natural | One or two short spoken paragraphs.                                                         |
| Concise | At most three short sentences.                                                              |
| Bullets | Two to five short bullet points.                                                            |
| STAR    | An example structured as Situation, Task, Action, Result; other questions answered briefly. |
| Clarify | One short clarifying question, optionally with a brief bridge sentence.                     |

These are instructions to the model, not guaranteed formatting rules. The speaking estimate uses about 150 words per minute, not measured speech. The bottom status line identifies providers/models and shows available timing measurements after a response.

### Keyboard shortcuts

| Shortcut, with Coach focused | Action                                                |
| ---------------------------- | ----------------------------------------------------- |
| **Ctrl+L**                   | Start Listen, or Stop & respond if already recording. |
| **Esc**                      | Cancel the active recording or request.               |
| **Ctrl+Shift+C**             | Copy the response.                                    |

These are window shortcuts, not global shortcuts while another application is focused. Normal **Ctrl+C** still copies selected text.

## 7. Profiles and session notes

### Create, edit, activate, and delete a profile

1. Open **Settings → Profiles → New profile**.
2. Enter a **Name**. This is required to enable **Save profile**.
3. Add a short **Background / resume summary**, **Role / call context**, and **Things to emphasize**. Use true facts; start with a few sentences for free-tier tests.
4. Click **Save profile**. A profile created here is not automatically active: click **Make active** on its card and confirm the **active** label.
5. Return to the Coach and ask a question relevant to that background. Expect the response to use those facts without inventing credentials or results. Review the answer yourself.
6. Use **Edit → Save profile** to change it. **Discard** abandons unsaved edits.
7. Use **Make active** on another profile to switch context. **Delete** removes a profile immediately. Deleting the active profile clears the selection, so future responses use no saved profile until another is activated.

Example fixture to adapt only if accurate for you:

```text
Name: Support practice
Background: I organize support tickets and explain next steps to customers.
Role / call context: A mock interview for a customer support position.
Things to emphasize: Clear communication, patience, and checking understanding.
```

Profiles are saved locally. When you generate with Groq, the active profile's background, role context, and emphasis text are included in the request. Inactive profiles and saved conversation history are not included.

### Session notes

In the expanded Coach, add temporary context such as `Ask about the customer's deadline before suggesting a solution.` Notes accompany each response request, including follow-ups, and are limited to 4,000 characters. They stay until you clear them or leave/restart the Coach. They are not a saved profile and are not a history field; a generated answer may still repeat details from them.

## 8. Every Preferences action

### General

Changes save automatically and apply to the Coach without a restart.

| Setting                      | Options / effect                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the coach window on top | Keeps CueDeck above other application windows. Toggle off to restore normal stacking.                                                             |
| Compact coach layout         | Same saved setting as Compact / Expand.                                                                                                           |
| Text size                    | 90–160%, in 5% increments.                                                                                                                        |
| Maximum clip length          | 30–120 seconds, in 5-second increments. Set before starting a recording.                                                                          |
| Target speaking time         | 15, 30, or 60 seconds for subsequent responses.                                                                                                   |
| Transcription language       | Automatic detection, English, Spanish, French, German, Chinese, or Tagalog. Applies to transcription, not a guaranteed response-language setting. |

### Providers

| Section / action                    | Purpose                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free cloud setup                    | Guided key save, model configuration, and actual sample-response check. Use Groq for this walkthrough.                                                                                                 |
| Processing summary                  | Shows where transcription and response generation run.                                                                                                                                                 |
| Speech-to-text → Provider           | Select the transcription service. A cloud account must have a saved key.                                                                                                                               |
| **Test speech-to-text**             | Checks provider availability/credentials. For Groq it does not upload an audio test clip.                                                                                                              |
| Response model → Provider           | Select the response provider. Changing provider also picks a compatible default model.                                                                                                                 |
| **Check & list models**             | Checks access and loads the app's supported choices, or installed Ollama models. It does not itself generate a sample response.                                                                        |
| Model                               | Select a supported response model. Groq currently uses the model in section 3.                                                                                                                         |
| Cloud API keys → **Save / Replace** | Save a key for that account. Saving a key here alone does not switch the active providers.                                                                                                             |
| Cloud API keys → **Test**           | Checks account/provider access. Use guided Save and test to verify response generation.                                                                                                                |
| Cloud API keys → **Remove**         | Deletes that account's saved key from CueDeck. Removing Groq disables its recording and response path until configured again. It does not revoke the key at Groq; revoke it in the Console if desired. |
| **Switch everything to local-only** | Selects local Whisper and Ollama. Complete local model setup before expecting Listen to work. Existing cloud keys remain stored until removed.                                                         |

For the optional local path, install Ollama, download a response model, and use **Check & list models → Model** to select it. Choose a local speech model and click **Download / verify selected model**; **Cancel** stops a download. **Advanced: Ollama server address → Save server address** supports only this computer's loopback addresses, with `http://127.0.0.1:11434` as the default. The [main README](README.md#fully-local-option) explains local setup; none of it is needed for Groq.

### History

1. Open **Settings → History**. Turn on **Save transcripts and responses locally** if you want this feature; it is off by default and does not backfill previous answers.
2. Choose **Keep history for**: 1 day, 7 days, 30 days, or **Do not keep (session only)**. Session-only retains no history records on disk.
3. Generate a successful answer. Return to History, or press **Refresh history** if the page stayed open while generating.
4. **Search saved sessions** filters the displayed entries using words in the transcript or response. Clear the search to restore the table. The table shows the most recent 100 retained sessions and shortened text previews; there is no click-to-reopen session action.
5. **Export JSON** saves structured records as `cuedeck-history.json`. **Export Markdown** saves readable transcript/response pairs as `cuedeck-history.md`. Choose a destination in the Windows Save dialog. Exports include all retained entries, not just search matches or the visible 100.
6. **Delete** removes one row. **Delete all** removes all saved history, including entries hidden while history is off. These actions are immediate.

Turning saving off stops new records and hides/disables exports; it does not erase previous records. Use **Delete all** to erase them. Retention is applied when history is read, exported, or saved; expired records are removed from the history file during those operations. Increasing retention cannot restore deleted entries. Exported files are independent copies and must be deleted separately if no longer needed.

History contains transcripts, responses, provider/model IDs, and timings, with no raw audio. Profile records and session notes are not stored as separate history fields, although answers may contain their content.

### Diagnostics

Open **Settings → Diagnostics** to inspect app/Electron/OS versions, providers, local model status, and recent errors. **Copy diagnostics to clipboard** copies a text report; paste it into a text editor to inspect it.

By default, profile text and transcripts are excluded. **Include recent transcripts** adds up to 20 retained transcripts only when history is enabled. **Include active profile text** adds the active name, background, and role context. Saved API keys are never included. Reopen the section to refresh the displayed snapshot after another error.

### Privacy & consent

This page explains recording visibility, permitted use, and where data goes. Use CueDeck for rehearsal or permitted, disclosed assistance and obtain any needed participant consent. See [PRIVACY.md](PRIVACY.md) for the app's data details.

## 9. Free-tier usage and limits

Published Groq Free-plan limits checked September 4, 2026:

| Model                    | Requests/minute | Requests/day | Tokens/minute | Tokens/day | Audio seconds/hour | Audio seconds/day |
| ------------------------ | --------------: | -----------: | ------------: | ---------: | -----------------: | ----------------: |
| `openai/gpt-oss-20b`     |              30 |        1,000 |         8,000 |    200,000 |                  — |                 — |
| `whisper-large-v3-turbo` |              20 |        2,000 |             — |          — |              7,200 |            28,800 |

Limits are shared at the organization level, and whichever threshold is reached first applies. Check your account's actual limits; they can differ or change. Exceeding a limit produces HTTP 429. These figures come from [Groq's rate-limit documentation](https://console.groq.com/docs/rate-limits).

CueDeck's request behavior:

| Action                                                                        | Inference usage                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Draw/edit a question; edit profile/notes; copy/clear; change display settings | None.                                                                                                  |
| Guided **Save and test**                                                      | One small response request, plus access checks.                                                        |
| 5-second onboarding audio test                                                | No Groq inference; captured audio is discarded.                                                        |
| Respond to typed/edited text                                                  | One response request.                                                                                  |
| Stop & respond / pause-triggered submission                                   | One speech-to-text request, then one response request if transcription succeeds.                       |
| Each follow-up / Try again                                                    | Another response request; no new audio transcription.                                                  |
| Cancel before submitting audio                                                | No transcription or answer request for that recording; access/warmup checks may already have occurred. |

The app also performs metadata readiness/warmup requests. A response request may retry once when Groq supplies a short retry delay of up to 10 seconds. Keep test profiles short, use 5–15 second clips, generate one answer at a time, and avoid repeatedly clicking retries. A small number of requests can still hit token limits when profiles/transcripts are large. CueDeck has no live quota counter, paid fallback, or account-upgrade action.

## 10. Troubleshooting

| Symptom                                                          | What to do                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm` not found                                                  | Install Node.js with npm, reopen the terminal, and run `node --version` / `npm --version`.                                                                               |
| PowerShell says scripts are disabled                             | Use `npm.cmd` instead of `npm` or double-click the launcher.                                                                                                             |
| Missing Electron/module, blank launch, broken dependency install | Close CueDeck, run `npm ci` inside `cuedeck`, then `npm start`. Use the project's launcher, which clears inherited `ELECTRON_RUN_AS_NODE`.                               |
| Terminal starts but no new app window                            | Check for an existing CueDeck window; only one instance per app-data directory is allowed. Close the app normally before retrying.                                       |
| Save and test disabled                                           | Select Groq and paste a key, or reuse an already saved key. Wait if a test is running.                                                                                   |
| Key rejected / HTTP 401 or 403                                   | Create/check the key in the correct Groq organization, replace it in CueDeck, and Save and test again. Also check model permissions/access in your account.              |
| Setup says connected but the first Listen turn fails             | Setup checks access; the first recorded turn is the transcription test. Check its error, account quota/model access, and audio playback.                                 |
| HTTP 429 / quota-limited                                         | Wait for the affected limit to reset; inspect Groq's account limits. Shorten large profiles/transcripts. Creating more keys does not increase organization limits.       |
| Provider unavailable / HTTP 5xx / timeout                        | Check your internet connection and provider status; try a short typed question later. The app will not silently switch providers.                                        |
| Listen disabled                                                  | Read the readiness card. Both transcription and response providers must be ready. Confirm the Groq key and models, then use Check again. Demo disables recording.        |
| Typed response button disabled                                   | Enter nonblank Heard text, configure a response model/key, and wait for or cancel the current operation.                                                                 |
| Meter stays flat / silence error                                 | Ensure actual speech is playing through the active Windows output device and is not muted. Your microphone alone is not captured. Retry after changing an output device. |
| Capture denied / no audio track                                  | Close and restart the app, verify the Windows output device, then retry. Typed questions can still test Groq while you troubleshoot capture.                             |
| Auto-response fires too early or never fires                     | Turn auto-response off and use Stop & respond. Avoid music/notifications during the test; short blips do not arm pause detection.                                        |
| Wrong transcription language                                     | Set Transcription language in General and record again, or edit Heard and regenerate.                                                                                    |
| Answer uses an old background                                    | Check which profile is marked active and clear old session notes. Then generate again.                                                                                   |
| A STAR or Bullets answer ignores the format                      | Retry once with a short, suitable question. These are model instructions; check the actual answer rather than assuming compliance.                                       |
| No history entry                                                 | Enable saving before generating, choose a nonzero retention period, wait for Done, then Refresh history. Failed/cancelled answers are not saved.                         |
| Groq key field is empty after saving                             | Expected: the app stores the key encrypted and never displays its saved value. Look for the saved-key status.                                                            |
| Clipboard says Copied but an older value was pasted              | Copy again after the response finishes; paste into a plain text editor to verify.                                                                                        |

For a useful bug report, copy Diagnostics with personal-content options unchecked and note the action, expected result, actual result, and whether typed questions or recording failed. Do not attach your API key or `secrets.json`.

## 11. Manual acceptance checklist

Use this after entering your real key. Start with a synthetic question/profile so you can evaluate behavior without sensitive material.

| Check                        | Expected result                                                                              | Done |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| Account plan checked         | Groq Free plan selected; no paid upgrade for this test                                       | [ ]  |
| Save and test                | Sample received; both Groq models configured; password field cleared                         | [ ]  |
| Typed question               | A relevant real answer, ending in Done                                                       | [ ]  |
| Draw a question              | Heard fills without making a response request                                                | [ ]  |
| Copy                         | Text editor receives the displayed answer                                                    | [ ]  |
| Default modes                | Natural, Concise, Bullets, STAR, and Clarify tested on appropriate questions                 | [ ]  |
| Follow-ups                   | Each regenerates; Shorter displays a 15-second target                                        | [ ]  |
| Manual audio recording       | Meter/timer move; Heard contains the spoken question; answer appears                         | [ ]  |
| Pause detection              | Speech followed by silence submits without clicking Stop                                     | [ ]  |
| Cancel recording             | Indicator disappears; another Listen works                                                   | [ ]  |
| Cancel generation            | Processing stops; another typed question works                                               | [ ]  |
| Silence                      | Useful error; Dismiss allows a new session                                                   | [ ]  |
| Profile create/edit/activate | New answers use the selected, updated facts                                                  | [ ]  |
| Active profile deletion      | No profile remains active; new answers omit its context                                      | [ ]  |
| Notes and notes Clear        | Notes affect subsequent answers; cleared notes stop being sent                               | [ ]  |
| General settings             | Compact, font size, on-top, clip limit, target, and language work                            | [ ]  |
| History                      | Opt-in, refresh, search, JSON/Markdown exports, row delete, Delete all work                  | [ ]  |
| Diagnostics                  | Default copy excludes personal text; opted-in report includes selected content               | [ ]  |
| Restart                      | Saved key, settings, profiles, and unexpired enabled history persist; temporary notes do not | [ ]  |
| Remove/re-add key            | Groq becomes unavailable after removal and works after Save and test again                   | [ ]  |

Do not deliberately exhaust a real free account to test quota errors. The automated suite covers synthetic HTTP 429 and recovery.

## 12. Run the automated tests

**Verified September 4, 2026:** 248 unit tests, 98 integration tests, and 26 Electron workflow tests passed (**372 total**), along with formatting, lint, TypeScript, and the production build. The final full Electron run included the expanded Groq workflows below.

From the `cuedeck` folder, after `npm ci`:

```powershell
npm run check
npm run test:e2e
```

`check` runs formatting, ESLint, TypeScript, unit tests, and provider integration tests. `test:e2e` builds production bundles and launches actual Electron windows. Let it finish without clicking the test windows. Each app launch uses a fresh temporary user-data directory, leaving your normal saved setup separate.

For a focused Groq workflow run:

```powershell
npm run build
npx playwright test test/e2e/groqActions.spec.ts
```

For individual test layers:

```powershell
npm test
npm run test:integration
npm run typecheck
npm run lint
```

The expanded Groq suite checks invalid-key recovery, onboarding audio tests, AudioWorklet capture and WAV encoding, transcription settings, pause detection, cancellation, silence, quota errors, profile/notes prompts, follow-up targets, native history exports, retention, deletion, diagnostics, and key removal. Provider HTTP responses are mocked and recording uses a generated audio signal. It requires no Groq key and makes no paid inference calls.

**What passing automation establishes:** the app's UI, IPC, audio processing, provider request construction, error handling, and persistence cooperate on these fixtures. **What still needs manual verification:** your Groq account/model access and remaining quota, answer/transcription quality, actual Windows speaker/headphone loopback, and any installer/deployment workflow. Production bundles are tested; that is not an installer-signing or load test.

Failure details and traces are written under `test-results/`. To inspect a trace, use the exact path printed by Playwright:

```powershell
npx playwright show-trace .\test-results\<failed-test-folder>\trace.zip
```

## 13. Data, shutdown, and resetting

Normal app data is under `%APPDATA%\cuedeck\` on Windows; capitalization is not significant. `CUEDECK_USER_DATA`, if explicitly set, overrides this directory. The repository folder is separate from this data.

| Item                                       | Location / lifetime                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Settings and configured-key flags          | `settings.json`                                                                          |
| Saved keys                                 | `secrets.json`, encrypted using Windows account protection                               |
| Profiles                                   | `profiles.json`                                                                          |
| Optional retained history                  | `history.json`                                                                           |
| Optional local speech downloads            | `models\`                                                                                |
| Raw audio                                  | Memory for the current clip; discarded after use or cancellation, never saved as history |
| Session notes and recent diagnostic errors | Temporary app state                                                                      |
| Exported history                           | The separate destination you choose                                                      |

To finish testing, cancel any active session, close Preferences and the Coach, then stop the development terminal with **Ctrl+C** if it is still running. Restart with `npm start`.

For a fresh-onboarding test without deleting your normal data, first close the app, then run from `cuedeck`:

```powershell
$env:CUEDECK_USER_DATA = Join-Path $env:TEMP ('cuedeck-manual-' + [guid]::NewGuid().ToString())
npm start
```

This creates an isolated setup with no saved key or profiles. After closing it, run `Remove-Item Env:CUEDECK_USER_DATA` in that terminal before launching your normal setup again. It removes the environment override, not your files. Use the in-app **Remove**, profile **Delete**, and history **Delete all** actions for selective cleanup.
