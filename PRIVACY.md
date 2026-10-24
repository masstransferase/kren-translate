# Privacy

KREN Translate does not collect telemetry or persist lookup or translation history. It processes only text explicitly submitted through an editor command, a click on the clipboard status-bar button followed by an operation choice, or a confirmed native VS Code agent tool.

Provider policies can change. Review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [Anthropic commercial data retention](https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [Cloud Translation attribution requirements](https://docs.cloud.google.com/translate/attribution), [Merriam-Webster API terms](https://dictionaryapi.com/info/terms-of-service), and [Basic Korean Dictionary copyright policy](https://krdict.korean.go.kr/eng/kboardPolicy/copyRightTermsInfo) before submitting sensitive material.

Provider errors shown in KREN or written to its output use HTTP status and fixed KREN wording. Provider free-text messages are never quoted in errors. KREN may include validated quota identifiers, retry delays, and safety or refusal finish reasons.

## Check for updates

After startup, at most once a day, KREN checks Python, edge-tts, optional Handy, and VS Code without an API key. The daily check sends at most one anonymous request to pypi.org for edge-tts's public version information, with no text, key, or identifier. Turn off `kren.updates.dailyCheck` in VS Code Settings to disable the daily check. **Check for updates**, the last item in the KREN menu, always runs on request. The check stores only its date and result statuses in VS Code global state, and keeps detailed results in memory. Daily checks and the re-check after Update preserve model and voice details within the session; after a restart, choose Check again for details. In Restricted Mode, KREN does not run the configured Python, including probes, Edge voice discovery, or Update. **Update** asks for confirmation before running the configured Python with `-m pip install -U edge-tts`; pip contacts its configured package index to install the package. On failure, only pip's last error line is shown and written to KREN's Output log, after URLs and credential prefixes are removed and the line is capped at 200 characters.

Only the menu command, never the daily check, asks each provider with a stored key for its public model list and Google Cloud Text-to-Speech for its en-US voice list. These requests send only the key in the provider's usual authentication header, never in the URL, and no text. Google voice discovery uses the stored Text-to-Speech key or the Cloud Translation key, as speech playback does. Edge voice discovery runs `edge_tts.list_voices()` in the configured Python and contacts Microsoft's public voice list without a key or text. Cloudflare models are marked not checked because KREN has no model lister. Model and voice details stay in memory; only result statuses are saved. The Output log records a missing-name count for each checked provider, never a key or a provider response body.

## Content boundary

KREN uses Fast steps for hints, conversation replies and Ask, and Thorough steps for lessons, practice, reviews, corrections and diagnosis. A Fast step moves to Thorough once when validation fails, learner input exceeds 40 words, the transcript exceeds 10 turns, or you ask again. In Settings, Usage, Switch to the next provider is on by default: if a daily or monthly limit is used up, the same submitted text goes to the next provider with stored credentials in your order until local midnight. Per-minute limits keep their usual handling; Live and pictures stay with their selected provider.

KREN never automatically adds surrounding lines, filenames, paths or URIs, workspace names or contents, language IDs, cursor positions, other selections, source-control data, open tabs, or chat history. There is one exception: when Smart Word Capture is on (the default), Add to User Dictionary also sends the single sentence that contains the selected word, if that sentence is 500 characters or shorter. The sentence is stored with the entry, and the entry's Source line says a sentence was sent. Turn Smart Word Capture off to send the selected expression alone.

The clipboard is read once when the user clicks `KREN`. KREN does not monitor clipboard changes. The user sees the clipboard preview and chooses an operation before any provider request occurs.

## Harper Grammar Check

Grammar Check runs through the Harper engine bundled inside KREN. The selected or copied English text is processed only in the local VS Code extension host. It is not sent to Harper, LanguageTool, an LLM provider, or any other network service. Findings and unchosen corrections remain only in the latest in-memory result. KREN modifies an editor selection only after the user explicitly chooses alternatives and clicks Apply selected corrections.

## Merriam-Webster

English Dictionary, Synonyms, and Medical Dictionary searches send the exact submitted English word or short expression to the respective Merriam-Webster Collegiate Dictionary, Collegiate Thesaurus, or Medical Dictionary API. Medical Dictionary provides terminology definitions only and never invokes Cloud Translation fallback.

KREN accepts only user-owned Merriam-Webster keys issued for the selected references. KREN includes no developer-owned or shared keys and does not copy credentials into GitHub, the VSIX, documentation, logs, telemetry, settings, or project files. Keys remain in the user's local VS Code Secret Storage. Requests go directly from that KREN installation to Merriam-Webster; KREN operates no credential relay or proxy and does not bypass provider account or reference limits.

If an API response contains only spelling/stem suggestions, KREN may make one follow-up request using the first API-provided suggestion. If Collegiate Dictionary returns no entry for a multi-word expression, KREN may send that same expression to Google Cloud Translation. Single-word misses and provider errors do not trigger this fallback.

Merriam-Webster results display the required official logos bundled unmodified with KREN. The webview loads these images locally and makes no internet image request. Pronunciation streams an approved MP3 from `media.merriam-webster.com`. On local Windows, KREN downloads the allowlisted URL without redirects, enforces a 2 MB maximum, writes a unique temporary MP3, and gives the hidden PowerShell/WPF process only that local path through a restricted environment. The directory is removed after playback. No headword, selection, API key, URL command text, or unrelated extension-host environment variable is passed to PowerShell. On other platforms or failure, the KREN Results webview plays the MP3 under a content security policy that blocks all other network, script, and media origins.

## Korean Basic Dictionary

Korean Dictionary Search sends one submitted Korean word to the Korean Basic Dictionary API. English words and surrounding context are not sent to it.

Results identify the Basic Korean Dictionary and the National Institute of Korean Language as the source. Retrieved text is presented under CC BY-SA. KREN does not request dictionary images, video, music, or pronunciation media, whose licensing can differ.

## Google Cloud Translation

Requests contain only the exact submitted text, target-language code, and text-format setting. KREN omits the source-language code so Google can detect it automatically.

Google Translate powers results obtained through the Cloud Translation API. Every such result includes Google's official linked attribution badge and makes a translation warranty disclaimer available in KREN. KREN does not imply affiliation with or endorsement by Google.

KREN reserves the submitted text's Unicode code-point count in a locked local ledger before transmission. It refuses requests that would exceed 500,000 characters in the current Google billing month, measured in Pacific Time. Failed or uncertain requests are not refunded because Google might have processed them.

The ledger cannot see unrelated clients or survive intentional clearing of local extension storage. A dedicated Google Cloud project with a provider-side quota is the authoritative cost backstop.

## Cloudflare Workers AI

With Cloudflare chosen as the picture provider, the situation scene text goes to Cloudflare Workers AI FLUX. Later pictures also send the last six displayed dialogue turns as text, never the previous picture. No hidden coaching, panel settings, document text, or workspace content is included. Pictures stay in session memory. With Cloudflare dictation selected or resolved by Auto, one WAV microphone clip recorded in memory goes to Cloudflare Workers AI Whisper (whisper-large-v3-turbo) only when dictation stops. KREN writes no dictation audio file; Live is unchanged.

The Cloudflare account ID and API token remain in VS Code SecretStorage, never panel HTML, logs, settings, or files. The account ID is used only in the HTTPS request path and the token only in its Authorization header. Remote error bodies are never displayed or logged. Auto chooses Handy if installed, otherwise configured Cloudflare, otherwise Groq, otherwise the Gemini Free Tier key.

Cloudflare pictures and Whisper dictation share the account's free daily allowance of 10,000 neurons a day. A 1024 by 1024 FLUX.1 schnell picture used about 173 neurons in a test on 2026-10-10, roughly 57 pictures a day before dictation or other account use; Cloudflare does not report FLUX.2 klein 4B's usage. Continuation pictures from FLUX may not keep the same people.

## Gemini

Situation picture defaults to None, which sends nothing. Intro Only sends the situation intro to the configured Gemini Image Model with the Gemini Paid profile's key (default `gemini-3.1-flash-lite-image`) for one realistic scene. Developing sends the situation intro for the first picture; each next request also sends the last six dialogue turns, both sides, as shown in the conversation, and the most recent picture as references, for up to 10 pictures per conversation, including the first. No hidden corrections, deferred feedback, explanations, hints, panel settings, document text, or workspace content are included. Pictures stay in memory only and are discarded when the panel closes or Start new clears the conversation; Back to chat keeps them.

Gemini is optional and uses a key supplied by the user. Google's current [Gemini API terms](https://ai.google.dev/gemini-api/terms) require API users to be at least 18, use the service for professional or business purposes, and comply with regional restrictions. Gemini is available only in [regions listed by Google](https://ai.google.dev/gemini-api/docs/available-regions). KREN does not classify a Gemini key or project by service tier and cannot determine or guarantee project eligibility, billing status, regional availability, model access, quotas, pricing, retention, or permitted use. Before first use, users must confirm that they are at least 18 and will use their own eligible Google project in compliance with the current terms. Do not submit secrets, personal data, confidential source code, or unpublished documents unless Google's current terms and controls are acceptable.

Each request contains KREN's fixed translation or explanation instructions, the exact submitted text, automatic-input and selected-output language metadata, and non-user generation settings. Gemini is not used as a dictionary or thesaurus fallback.

Rewrite Text sends the exact submitted text plus fixed, provider-independent rewriting rules and visible language and style settings. The selected provider detects or follows the configured source language and rewrites in that same language. KREN does not attach surrounding editor or chat context. The three-variant operation requests Natural, Concise, and Jargon-Free results; direct operations request only the selected variant.

The Gemini Free Tier rewrite profile uses the Gemini Free Tier key. The optional Gemini Paid rewrite profile uses a separate user-supplied SecretStorage key and configurable model. If explicit Paid-profile fallback is enabled, KREN resubmits the same exact text to the configured fallback model only after the primary model exhausts retries with HTTP 429, 503, or 504, or returns unusable structured output. The result identifies both models. Authentication, invalid-request, empty-result, and safety errors never trigger fallback.

The Gemini Paid-profile model-refresh button sends a model-list request authenticated by the Gemini Paid key. It sends no selected text, clipboard text, filenames, workspace data, or rewrite result. The API key remains in SecretStorage and is placed in the request header, not the URL or webview.

Rewrite Read Aloud is initiated only by clicking its button and uses the same explicit speech source, voice, speed, and volume as editor Read Aloud. Local Windows mode passes the active variant only to the local System.Speech path. If the user explicitly selects Edge Online and accepts its first-use disclosure, only the cleaned active variant is sent through the Edge path described below. KREN never sends rewrite audio to Gemini TTS or a different speech provider.

Editor **Read Aloud** is available only in a local Windows extension host. KREN creates an in-memory speech copy that removes common Markdown, checkbox, URL, HTML, code-fence, and citation artifacts, then passes only the cleaned text over standard input to a fixed hidden PowerShell/System.Speech process. The selected text is not placed in command arguments, environment variables, logs, temporary files, or network requests, and KREN does not modify the source document. The child environment excludes unrelated extension-host secrets.

If the user explicitly changes Read Aloud to **Microsoft Edge Online (experimental)** and accepts the first-use disclosure, KREN passes only that same cleaned speech copy over standard input to a fixed Python process using the unofficial `edge-tts` package. `edge-tts` sends the cleaned text and selected voice/rate/volume to Microsoft's Edge speech service and downloads synthesized audio. KREN writes only the returned audio to a unique bounded temporary MP3. An already-resolved KREN panel plays the audio through its constrained audio element; otherwise KREN uses a hidden local process. The file is deleted afterward. No selected text is placed in command arguments, environment variables, logs, or text files. Local Windows remains the default and does not use this network path.

Edge Online speech is disabled while VS Code is in Restricted Mode because it launches the configured machine-scoped Python executable. Local Windows speech does not launch a user-configurable executable and remains available.

KREN warns that provider requests may incur charges and does not maintain a Gemini token or spending ledger. Access and billing are determined by the Google project associated with the selected key.

## OpenAI API

OpenAI is optional and used only when explicitly selected for explanation or rewriting. A request contains fixed KREN instructions, the exact submitted text, and the chosen operation settings. KREN uses schema-constrained Responses output and sets `store: false`. OpenAI states that API data is not used for model training by default, but standard abuse-monitoring logs may be retained for 30 days. The `store: false` setting does not guarantee zero retention; approved organization controls and current OpenAI policies remain authoritative.

Model discovery and Test Connection call only OpenAI's model-list endpoint. They send no submitted text. Authentication uses the SecretStorage key in an authorization header.

## Anthropic Claude API

Anthropic is optional and used only when explicitly selected for explanation or rewriting. A request contains fixed KREN instructions, the exact submitted text, and the chosen operation settings. KREN requests schema-constrained Messages output. Anthropic states that standard API inputs and outputs are normally deleted within 30 days, with longer retention possible for policy enforcement or law. Zero data retention requires a separate approved agreement. Current Anthropic terms and Console controls remain authoritative.

Model discovery and Test Connection call only Anthropic's model-list endpoint. They send no submitted text. Authentication uses the SecretStorage key in a request header.

KREN never silently falls back between Gemini, OpenAI, and Anthropic. OpenAI and Anthropic automatic retries remain on the same configured provider and model. All providers may charge for repeated attempts.

## Native VS Code agent tools

KREN contributes six Language Model Tools, including Medical Dictionary. Before invocation, VS Code confirmation identifies the provider and displays the exact text KREN will submit. Tool results contain the provider result and no additional workspace data.

KREN does not bundle an MCP server and does not export provider credentials to Claude Code or Codex.

## Secrets and local state

AI English Tutor dictation for practice answers and Standard conversation records microphone PCM in memory and assembles one WAV clip in memory. Only stopping dictation sends that clip to the selected transcription provider: Google for Gemini, Groq, or Cloudflare Workers AI; KREN writes no dictation audio file. Live uses its separate microphone streaming route. Leaving the tutor stops its capture, closes Live sessions and stops pending speech. Drafts, answers and the transcript remain in memory for the host session.

Credentials remain in VS Code SecretStorage. They are not written to settings, workspace files, logs, or telemetry by KREN.

Gemini, OpenAI, and Anthropic authentication is placed in HTTPS request headers. The Cloud Translation Basic v2, Merriam-Webster, and Korean Basic Dictionary APIs require their keys in HTTPS query parameters. KREN never prints those URLs, but URL-based credentials can be visible to the destination service and approved network infrastructure. Use dedicated keys, restrict them by API and project where the provider supports it, apply provider-side quotas, and rotate any key that may have been exposed.

The latest result is held in memory for display and actions. Persistent KREN state consists of the Cloud Translation character counter, provider settings (including the selected local voice identifier), and provider consent flags. KREN does not maintain a lookup, translation, explanation, grammar, or rewrite history.

If the user explicitly chooses **Open Full Details**, KREN writes a plain-text copy of that result to its VS Code Output channel. VS Code can persist Output channel content in extension-host session log files under the user's VS Code data directory. Clearing the KREN panel does not delete those VS Code-managed logs. Avoid Open Full Details for sensitive text, or remove the applicable VS Code session logs according to the user's local retention policy.

## Groq and Cloudflare language models

When Groq or Cloudflare Workers AI is the selected language-model provider, Translation, Explain Meaning or Nuance, Rewrite Text, and Smart Grammar Check send the explicitly submitted text and KREN's instruction for that feature. User Dictionary sends the selected expression and KREN's generation instruction, with the single bounded sentence when Smart Word Capture is on. Raw Merriam-Webster responses are never sent to either model. AI English Tutor sends the lesson targets and question for lessons; the relevant lesson and submitted answer for practice, hints, and diagnosis; displayed conversation turns and the submitted reply for Standard conversation, conversation hints, and take-home. These are the same explicit-action inputs used by the existing providers. No filenames, workspace paths, surrounding document paragraphs, other provider responses, or other provider credentials are added. Gemini remains the default. Live replies, Live voices, and Gemini speech detection use the stored Gemini profile key independently of the text provider. Groq, Cloudflare, OpenAI, and Anthropic still handle the routed text requests.

Limits checked on 2026-10-11: Groq's free plan permits 1,000 requests and 200,000 tokens per day per model, and 8,000 tokens per minute. Cloudflare text, pictures, and Whisper share the account's 10,000 daily neurons. Quotas and access can change. A limit or JSON-mode failure uses fixed KREN wording; no remote error text or credentials appear in a message. Responses pass local JSON parsing and each feature's validator. Groq uses strict schemas on openai/gpt-oss-120b, openai/gpt-oss-20b, and qwen/qwen3.8-27b; other Groq models use JSON object mode. Cloudflare JSON mode is best-effort and an invalid result is a KREN failure.

Set `kren.tutor.speechProvider` to `groq` for Groq Whisper large v3 turbo dictation. Recording stays in memory; one WAV clip is sent to Groq at Stop, in one multipart request, and no audio file is written. Auto chooses Handy, then configured Cloudflare, then configured Groq, then configured Gemini Free Tier. The Groq API key is stored only in VS Code SecretStorage and used only with Groq; the Cloudflare token is used only with Cloudflare.

When the reader chooses **Google Cloud Chirp 3 HD** for tutor Speech Source, the text spoken is sent to Google Cloud Text-to-Speech with its en-US voice name and speaking rate. This includes Standard conversation replies, lessons, practice, take-home text, and read-only Live Replay, Demo, and voice previews. Live conversation replies still use Gemini Live with the stored Gemini profile key independently of the routed text provider. Without that key or after a Live failure, Standard replies use the chosen Speech Source. KREN adds no document context, filename, workspace path, dictionary response, or other provider credential to the speech request.

The separate `kren.googleCloudTextToSpeech.apiKey` slot stays in VS Code SecretStorage. If it is empty, the reader's Cloud Translation key is used for this Google Cloud API. The key travels only in the `X-Goog-Api-Key` header. The MP3 response is played in memory and no Chirp audio file is written. Stop, Reset, leaving the tutor, and new utterances cancel synthesis and playback. Local usage stores only provider, model, requests, and character counts, never the spoken text or audio. Chirp failures use fixed KREN notices and status codes, never Google's error text, and fall back to the existing Edge path for the utterance. Usage is billed to the reader's Google Cloud project after any free allowance.
