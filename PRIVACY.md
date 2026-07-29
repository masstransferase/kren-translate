# Privacy

KREN Translate does not collect telemetry or persist lookup or translation history. It processes only text explicitly submitted through an editor command, a click on the clipboard status-bar button followed by an operation choice, or a confirmed native VS Code agent tool.

Provider policies can change. Review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [Anthropic commercial data retention](https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [Cloud Translation attribution requirements](https://docs.cloud.google.com/translate/attribution), [Merriam-Webster API terms](https://dictionaryapi.com/info/terms-of-service), and [Basic Korean Dictionary copyright policy](https://krdict.korean.go.kr/eng/kboardPolicy/copyRightTermsInfo) before submitting sensitive material.

## Content boundary

KREN never automatically adds surrounding lines, filenames, paths or URIs, workspace names or contents, language IDs, cursor positions, other selections, source-control data, open tabs, or chat history.

The clipboard is read once when the user clicks `KREN`. KREN does not monitor clipboard changes. The user sees the clipboard preview and chooses an operation before any provider request occurs.

## Harper Grammar Check

Grammar Check runs through the Harper engine bundled inside KREN. The selected or copied English text is processed only in the local VS Code extension host. It is not sent to Harper, LanguageTool, an LLM provider, or any other network service. Findings and unchosen corrections remain only in the latest in-memory result. KREN modifies an editor selection only after the user explicitly chooses alternatives and clicks Apply selected corrections.

## Merriam-Webster

English Dictionary and Synonyms searches send the exact submitted English word or short expression to the respective Merriam-Webster Collegiate Dictionary or Collegiate Thesaurus API.

Every user must obtain and enter their own Merriam-Webster keys. KREN includes no developer-owned or shared keys and does not copy credentials into GitHub, the VSIX, documentation, logs, telemetry, settings, or project files. Keys remain in the user's local VS Code Secret Storage. Requests go directly from that KREN installation to Merriam-Webster; KREN operates no credential relay or proxy.

If an API response contains only spelling/stem suggestions, KREN may make one follow-up request using the first API-provided suggestion. If Collegiate Dictionary returns no entry for a multi-word expression, KREN may send that same expression to Google Cloud Translation. Single-word misses and provider errors do not trigger this fallback.

Merriam-Webster results display the required official logo from `dictionaryapi.com`. That image request contains no submitted text but exposes normal network metadata such as the user's IP address. Pronunciation streams an approved MP3 from `media.merriam-webster.com`. On local Windows, KREN downloads the allowlisted URL without redirects, enforces a 2 MB maximum, writes a unique temporary MP3, and gives the hidden PowerShell/WPF process only that local path through a restricted environment. The directory is removed after playback. No headword, selection, API key, URL command text, or unrelated extension-host environment variable is passed to PowerShell. On other platforms or failure, the KREN Results webview plays the MP3 under a content security policy that blocks all other network, script, and media origins.

## Korean Basic Dictionary

Korean Dictionary Search sends one submitted Korean word to the Korean Basic Dictionary API. English words and surrounding context are not sent to it.

Results identify the Basic Korean Dictionary and the National Institute of Korean Language as the source. Retrieved text is presented under CC BY-SA. KREN does not request dictionary images, video, music, or pronunciation media, whose licensing can differ.

## Google Cloud Translation

Requests contain only the exact submitted text, target-language code, and text-format setting. KREN omits the source-language code so Google can detect it automatically.

Google Translate powers results obtained through the Cloud Translation API. Every such result includes Google's official linked attribution badge and makes a translation warranty disclaimer available in KREN. KREN does not imply affiliation with or endorsement by Google.

KREN reserves the submitted text's Unicode code-point count in a locked local ledger before transmission. It refuses requests that would exceed 500,000 characters in the current Google billing month, measured in Pacific Time. Failed or uncertain requests are not refunded because Google might have processed them.

The ledger cannot see unrelated clients or survive intentional clearing of local extension storage. A dedicated Google Cloud project with a provider-side quota is the authoritative cost backstop.

## Gemini

Gemini is optional and uses a key supplied by the user. Google's current [Gemini API terms](https://ai.google.dev/gemini-api/terms) require API users to be at least 18, use the service for professional or business purposes, and comply with regional restrictions. Gemini is available only in [regions listed by Google](https://ai.google.dev/gemini-api/docs/available-regions). KREN does not classify a Gemini key or project by service tier and cannot determine or guarantee project eligibility, billing status, regional availability, model access, quotas, pricing, retention, or permitted use. Before first use, users must confirm that they are at least 18 and will use their own eligible Google project in compliance with the current terms. Do not submit secrets, personal data, confidential source code, or unpublished documents unless Google's current terms and controls are acceptable.

Each request contains KREN's fixed translation or explanation instructions, the exact submitted text, automatic-input and selected-output language metadata, and non-user generation settings. Gemini is not used as a dictionary or thesaurus fallback.

Rewrite / Polish Text sends the exact submitted text plus fixed, provider-independent rewriting rules and visible language and style settings. The selected provider detects or follows the configured source language and rewrites in that same language. KREN does not attach surrounding editor or chat context. The three-variant operation requests Natural, Concise, and Jargon-Free results; direct operations request only the selected variant.

The default rewrite profile uses the primary Gemini key. The optional alternate rewrite profile uses a separate user-supplied SecretStorage key and configurable model. If explicit alternate-profile fallback is enabled, KREN resubmits the same exact text to the configured fallback model only after the primary model exhausts retries with HTTP 429, 503, or 504, or returns unusable structured output. The result identifies both models. Authentication, invalid-request, empty-result, and safety errors never trigger fallback.

The alternate-profile model-refresh button sends a model-list request authenticated by the alternate Gemini key. It sends no selected text, clipboard text, filenames, workspace data, or rewrite result. The API key remains in SecretStorage and is placed in the request header, not the URL or webview.

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

KREN contributes five Language Model Tools. Before invocation, VS Code confirmation identifies the provider and displays the exact text KREN will submit. Tool results contain the provider result and no additional workspace data.

KREN does not bundle an MCP server and does not export provider credentials to Claude Code or Codex.

## Secrets and local state

Credentials remain in VS Code SecretStorage. They are not written to settings, workspace files, logs, or telemetry by KREN.

Gemini, OpenAI, and Anthropic authentication is placed in HTTPS request headers. The Cloud Translation Basic v2, Merriam-Webster, and Korean Basic Dictionary APIs require their keys in HTTPS query parameters. KREN never prints those URLs, but URL-based credentials can be visible to the destination service and approved network infrastructure. Use dedicated keys, restrict them by API and project where the provider supports it, apply provider-side quotas, and rotate any key that may have been exposed.

The latest result is held in memory for display and actions. Persistent KREN state consists of the Cloud Translation character counter, provider settings (including the selected local voice identifier), and provider consent flags. KREN does not maintain a lookup, translation, explanation, grammar, or rewrite history.

If the user explicitly chooses **Open Full Details**, KREN writes a plain-text copy of that result to its VS Code Output channel. VS Code can persist Output channel content in extension-host session log files under the user's VS Code data directory. Clearing the KREN panel does not delete those VS Code-managed logs. Avoid Open Full Details for sensitive text, or remove the applicable VS Code session logs according to the user's local retention policy.
