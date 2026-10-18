# Provider Setup

KREN is bring-your-own-key. A ChatGPT, Claude, Gemini app, or Google One subscription does not automatically include API access or API credits.

## Dictionary providers

Each user must register for and enter their own provider keys. KREN includes no shared credentials.

KREN supports Merriam-Webster Collegiate Dictionary, Collegiate Thesaurus, and Medical Dictionary. Merriam-Webster issues two API keys per account, so KREN refuses a third key before writing it to Secret Storage. Remove one stored key before adding the key for a different reference work. Use only references and keys that Merriam-Webster has authorized for your account. KREN does not combine keys, bypass the two-reference-work or 1000-query-per-day limits, schedule lookups, or relay credentials. Every lookup follows an explicit user action. Review the current [Merriam-Webster registration page](https://dictionaryapi.com/register/index) and [API terms](https://dictionaryapi.com/info/terms-of-service).

Korean Dictionary Search requires a separate Korean Basic Dictionary Open API key. All dictionary keys are stored locally in VS Code Secret Storage and are not bundled, published, logged, or shared by KREN.

## Google Cloud Translation

Enable Cloud Translation Basic v2 for a Google Cloud project, create a restricted API key, then run **KREN: Set Google Cloud Translation API Key**. KREN enforces a local shared monthly guard below 500,000 characters, but Google billing remains authoritative. Configure a billing budget and alert in Google Cloud.

## Google Cloud Text-to-Speech

Enable **Cloud Text-to-Speech API** in the same Google Cloud project as Cloud Translation, with billing enabled. Restrict the API key to the APIs you use. Run **KREN: Set Google Cloud Text-to-Speech API Key**, or use Set on the **Google Cloud Text-to-Speech** Credentials row. If this separate secret slot is empty, KREN uses your stored Cloud Translation key; its restrictions must also permit Text-to-Speech. Remove deletes only the separate slot, so the Translation-key fallback remains available.

Choose **Google Cloud Chirp 3 HD** under **VOICE & MODEL, TUTOR VOICE, Speech Source**. Female and male voices use the existing Gemini defaults, Callirrhoe and Enceladus, in en-US. Usage is billed to your Google Cloud project after any free allowance. KREN states no allowance figure; configure a billing budget and alert. The request uses the `X-Goog-Api-Key` header, never a key in a URL. MP3 audio is played from memory without writing an audio file. HTTP 403 suggests enabling the API; HTTP 429 or network failure falls back to Edge for the current utterance, with one notice per session.

Live replies use the tutor's stored Gemini profile key independently of the text provider. The routed provider still handles Stop coaching, take-home, hints, and diagnosis. Chirp replaces the extra Live sessions for take-home narration, learner Replay, Demo speech, and voice preview.

## Gemini

Run **KREN: Set Gemini Free Tier API Key** for the Gemini Free Tier profile. Explain Meaning or Nuance and Rewrite Text can optionally use a separately supplied key through **KREN: Set Gemini Paid API Key**. Choose the profile independently for Explain and Rewrite. Situation pictures from Gemini always use the Gemini Paid key. The names describe each key's intended use; KREN does not check a key's service tier. Gemini is available only in [regions listed by Google](https://ai.google.dev/gemini-api/docs/available-regions). Availability, access, quotas, pricing, data use, and permitted use depend on the user's Google project and region; review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [documentation](https://ai.google.dev/gemini-api/docs).

## OpenAI API

Create an API key in the OpenAI platform, configure project billing/limits there, and run **KREN: Set OpenAI API Key**. Choose OpenAI independently for explanation and rewriting. KREN uses the Responses API with structured output and `store: false`. See the [OpenAI API documentation](https://platform.openai.com/docs/api-reference/responses).

## Anthropic Claude API

Create an Anthropic Console API key and configure billing/limits there, then run **KREN: Set Anthropic API Key**. Choose Anthropic independently for explanation and rewriting. See the [Anthropic Messages API documentation](https://docs.anthropic.com/en/api/messages).

## Models and connection tests

Model fields are editable so future IDs can be entered. The Refresh buttons query only the selected provider's model-list endpoint. Run **KREN: Test OpenAI Connection** or **KREN: Test Anthropic Connection** to validate the stored key without sending selected text.

## Remove stored keys

Open KREN Settings and press the waste-basket control beside an individual provider, or choose **Delete all API keys** and confirm. The same provider-specific delete commands are available from the Command Palette. Remove keys explicitly before uninstalling or deleting a test profile; uninstalling alone is not KREN's credential-removal workflow.

## Groq and Cloudflare language models

When Groq or Cloudflare Workers AI is the selected language-model provider, Translation, Explain Meaning or Nuance, Rewrite Text, and Smart Grammar Check send the explicitly submitted text and KREN's instruction for that feature. User Dictionary sends the selected expression and KREN's generation instruction, with the single bounded sentence when Smart Word Capture is on. Raw Merriam-Webster responses are never sent to either model. AI English Tutor sends the lesson targets and question for lessons; the relevant lesson and submitted answer for practice, hints, and diagnosis; displayed conversation turns and the submitted reply for Standard conversation, conversation hints, and take-home. These are the same explicit-action inputs used by the existing providers. No filenames, workspace paths, surrounding document paragraphs, other provider responses, or other provider credentials are added. Gemini remains the default. Live replies, Live voices, and Gemini speech detection use the stored Gemini profile key independently of the text provider. Groq, Cloudflare, OpenAI, and Anthropic still handle the routed text requests.

Limits checked on 2026-10-11: Groq's free plan permits 1,000 requests and 200,000 tokens per day per model, and 8,000 tokens per minute. Cloudflare text, pictures, and Whisper share the account's 10,000 daily neurons. Quotas and access can change. A limit or JSON-mode failure uses fixed KREN wording; no remote error text or credentials appear in a message. Responses pass local JSON parsing and each feature's validator. Groq uses strict schemas on openai/gpt-oss-120b, openai/gpt-oss-20b, and qwen/qwen3.8-27b; other Groq models use JSON object mode. Cloudflare JSON mode is best-effort and an invalid result is a KREN failure.

Create a key at [Groq Console](https://console.groq.com), **API Keys**. Use **KREN menu**, **Credentials**, the **Groq** row's **Set**, **Remove**, and **Test** actions, or **KREN: Set Groq API Key** and **KREN: Delete Groq API Key**. Choose **Groq** in the feature's **LLM ROUTING** provider list. The default is `openai/gpt-oss-120b`; `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` are also offered. **Refresh** discovers models from Groq. Thinking levels map to low, medium, or high only on the two GPT-OSS models; Auto leaves effort to the model. Cloudflare uses the existing account ID and API token in Credentials, with no new secret. Choose **Cloudflare Workers AI** in **LLM ROUTING**; the default is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Its list also offers `@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-3-8b-instruct`, `@hf/nousresearch/hermes-2-pro-mistral-7b`, `@hf/thebloke/deepseek-coder-6.7b-instruct-awq`, and `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, with no Refresh action.

Set `kren.tutor.speechProvider` to `groq` for Groq Whisper large v3 turbo dictation. Recording stays in memory; one WAV clip is sent to Groq at Stop, in one multipart request, and no audio file is written. Auto chooses Handy, then configured Cloudflare, then configured Groq, then configured Gemini Free Tier. The Groq API key is stored only in VS Code SecretStorage and used only with Groq; the Cloudflare token is used only with Cloudflare.
