# Free testing guide

For the complete step-by-step Groq instructions and every app action, read
**[README_GROQ_TESTING.md](../README_GROQ_TESTING.md)**.

Provider documentation checked on September 4, 2026. Availability, quotas, and account eligibility
can change. Use the provider's free plan if you want to avoid charges; CueDeck does not
read your billing settings and never switches providers automatically.

| Option        | Setup                                             | What works                                                                   | Cost constraints                                                            |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Demo          | Choose “Try the demo”                             | Practice deck, fixed sample streaming, copy, cancel, optional history        | No account, network, downloads, or AI; audio disabled                       |
| Groq          | One API key                                       | Real typed responses and system-audio transcription                          | Free-plan quotas; use a free account                                        |
| Google Gemini | One API key                                       | Real typed responses and system-audio transcription                          | Free-tier eligibility/quotas; free-tier content may improve Google products |
| OpenRouter    | One API key, `openrouter/free`                    | Real typed responses                                                         | Free-model availability and daily quota; local Whisper needed for audio     |
| Cerebras      | One API key                                       | Real typed responses                                                         | Free trial with account-specific limits; local Whisper needed for audio     |
| Local         | Ollama plus downloaded Whisper and response model | Real typed responses and system-audio transcription, offline after downloads | No API fees; requires memory and disk space                                 |

## Recommended cloud path: Groq

1. Start CueDeck with `npm start` in `cuedeck`, or double-click `Start CueDeck.cmd` in the parent folder.
2. Complete the acknowledgement and choose **Use cloud free tier**.
3. Select Groq and use **Get Groq API key** to open [the key page](https://console.groq.com/keys).
4. Paste your key into the password field in CueDeck. **Save and test** stores it encrypted,
   selects both models, and requests a short sample answer. The field clears after saving.
5. Continue. You may skip the audio test and optional background profile to test typed questions first.
6. Draw a practice question and press **Respond to edited text**. Then play a spoken question on
   this computer and use **Listen** to test recording and transcription.

The configured models are `openai/gpt-oss-20b` for responses and `whisper-large-v3-turbo` for
transcription. These appear in Groq's current [supported models](https://console.groq.com/docs/models)
and [free-plan limits](https://console.groq.com/docs/rate-limits). Consult your account's actual
limits; every recorded turn uses an audio request and a response request. A successful setup test
verifies response generation and checks the audio endpoint's credentials; the audio test verifies
capture, and your first Listen turn verifies transcription.

Already past onboarding? Use **Settings → Providers → Free cloud setup**. Changes reach the Coach
immediately. If setup is incomplete, the Coach also offers **Set up real AI** and **Try demo instead**.

## Other providers

- **Gemini:** [API key](https://aistudio.google.com/apikey),
  [pricing and data-use terms](https://ai.google.dev/gemini-api/docs/pricing).
  Uses `gemini-2.5-flash`; submitted free-tier content may be used to improve Google products.
- **OpenRouter:** [API key](https://openrouter.ai/keys),
  [free router](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground),
  [free plan](https://openrouter.ai/pricing). The published free plan currently lists 50 requests/day.
  The app uses `openrouter/free` or selected `:free` variants. Audio uses local Whisper.
- **Cerebras:** [account and key](https://cloud.cerebras.ai),
  [current model catalog](https://inference-docs.cerebras.ai/models/overview).
  Uses `gpt-oss-120b`; the provider now describes access as a free trial. Audio uses local Whisper.
- **Local:** install [Ollama](https://ollama.com/download), run
  `ollama pull qwen2.5:3b-instruct`, select the installed model, and download Whisper from CueDeck.
  Tiny is the smallest initial speech download. Typed responses need only Ollama.

## If something fails

- **Key rejected:** replace the key in the app. Keys belong in CueDeck's password field, not `.env`.
- **Rate limited / unavailable:** wait for the provider quota to reset, or explicitly choose another
  free option. CueDeck does not upgrade accounts or make paid fallbacks.
- **Listen disabled:** the readiness card explains the missing response or speech configuration.
  Demo intentionally disables audio. A working response model still lets you test typed questions.
- **Silent audio:** play speech through the computer's current output device during the test.
  The app does not listen to your microphone.
- **App fails to start:** run `npm ci` inside `cuedeck` and retry. The launcher removes the
  `ELECTRON_RUN_AS_NODE` flag inherited from some editor terminals.
- **Local response model missing:** an Ollama server alone is insufficient; select an installed
  model in local setup or Settings → Providers.

## Automated verification without accounts

`npm run check` runs formatting, lint, TypeScript, unit tests, and provider integration tests.
`npm run test:e2e` builds the app and tests actual Electron windows. Cloud responses in automated
tests are simulated at the HTTP boundary; no credentials or paid calls are required.
