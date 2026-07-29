# KREN User Guide

KREN is a selection-first language workbench for VS Code. It operates only on text you explicitly select, copy, or submit to a confirmed VS Code language-model tool. Passive hovering, ordinary typing, and opening a file do not call remote providers.

This guide applies to KREN 1.x public releases.

## Requirements

### Base installation

- **VS Code Desktop 1.106 or later.** KREN uses VS Code's Secondary Sidebar contribution point, is a desktop Node extension, and is not a browser-only `vscode.dev` extension.
- **A local VSIX installation.** Run **Extensions: Install from VSIX...**, select the KREN package, and reload VS Code.
- **No Node.js, npm, Python, GPU, or API key is required for ordinary installation or offline Grammar Check.** Node.js and npm are development requirements only.
- **Outbound HTTPS access is required only for online dictionaries, translation, AI explanation/rewriting, Merriam-Webster pronunciation, and Edge Online speech.** Corporate proxies, firewalls, VPNs, and certificate inspection can affect those features.

Core text operations work on supported Windows, macOS, and Linux VS Code Desktop hosts. Audio capabilities have additional Windows requirements described below.

### Requirements by feature

| Feature | Required account, key, or software | Network use |
| --- | --- | --- |
| Grammar Check | Nothing; Harper is bundled | None |
| English Dictionary | Merriam-Webster Collegiate API key | Exact submitted lookup text goes to Merriam-Webster |
| Synonyms | Separate Merriam-Webster Collegiate Thesaurus API key | Exact submitted lookup text goes to Merriam-Webster |
| Korean Dictionary | Korean Basic Dictionary Open API key | Exact Korean headword goes to the dictionary API |
| Translation | Google Cloud Translation Basic v2 key by default, or a Gemini API key if Gemini is selected | Exact submitted text goes only to the selected provider |
| Explain Meaning or Nuance | A Gemini, OpenAI API, or Anthropic API key for the selected provider | Exact submitted text and selected settings go to that provider |
| Rewrite / Polish Text | A Gemini, OpenAI API, or Anthropic API key for the selected provider | Exact submitted text and visible language and rewrite settings go to that provider |
| Merriam-Webster pronunciation | A successful Merriam-Webster lookup and network access to its allowlisted audio host | Downloads the provider's pronunciation MP3 |
| Local Windows Read Aloud | A local Windows extension host, PowerShell, Windows System.Speech, and an installed speech voice | None |
| Edge Online Read Aloud | A local Windows extension host, working Python, `edge-tts`, network access, and first-use consent | Sends only KREN's cleaned speech copy to Microsoft's Edge speech service |

Every user must obtain and enter their own API keys; KREN includes no shared credentials. Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus use separate keys from the user's own developer account. Standard free Merriam-Webster API use is limited to noncommercial applications, two reference works, and 1,000 queries per day per reference. ChatGPT, Claude, Gemini app, Google One, or similar consumer subscriptions do not automatically include developer API access or credits.

### Windows, remote, WSL, SSH, and containers

- Local Windows pronunciation and Read Aloud require the extension host itself to run locally on Windows.
- KREN refuses Windows-native speech in WSL, SSH, Dev Containers, Codespaces, and other remote extension hosts, even when the VS Code user interface is running on Windows.
- On macOS, Linux, or remote hosts, dictionary pronunciation can use KREN's constrained in-panel web audio fallback when the audio URL is available. Editor Read Aloud is currently Windows-only.
- Online provider calls originate from the extension host. In a remote workspace, that host needs outbound network access even though the VS Code user interface is local.

### Credentials, billing, and quotas

KREN is free software, but third-party API access and charges depend on each provider and user project. Store keys only through KREN commands or KREN Settings; they are kept in VS Code Secret Storage, not in project settings, the webview, or Git. Google's current [Gemini API terms](https://ai.google.dev/gemini-api/terms) require Gemini API users to be at least 18, use it for professional or business purposes, and comply with regional restrictions. Gemini is available only in [regions listed by Google](https://ai.google.dev/gemini-api/docs/available-regions). KREN makes no service-tier claim and cannot determine project eligibility, billing status, regional availability, model access, quotas, pricing, retention, or permitted use. KREN asks users to confirm their age and eligibility before first Gemini use.

Google Cloud Translation has a conservative local KREN ceiling of 500,000 submitted characters per Google billing month. The ledger cannot see use from other applications or protect against cleared/restored local state, so a dedicated project and provider-side quota remain the authoritative backstop. Retries can repeat billable requests.

## Install and first setup

1. Install KREN from the Visual Studio Marketplace. For a reviewed local package, run **Extensions: Install from VSIX...** and select `kren-translate-<version>.vsix`.
2. Reload VS Code.
3. Open KREN in the Secondary Sidebar. KREN is placed there by default on a fresh installation.
4. Open KREN's hamburger menu and choose **Settings**.
5. Select languages, providers, models, grammar dialect, rewrite preferences, and optional speech settings.
6. Run the matching **KREN: Set ... API Key** commands only for the online features you will use.

See [Provider Setup](PROVIDER_SETUP.md) for account-specific instructions.

## Quick start

### Editor selection

1. Select exactly one word, expression, sentence, or passage.
2. Right-click the selection.
3. Choose Dictionary Search, Translate Selection, Explain Meaning or Nuance, Grammar Check, Rewrite / Polish Text, or Read Aloud. Read Aloud is available on local Windows.
4. Review the hover, native Quick Fix, or KREN panel result.
5. Copy the result, explicitly replace eligible editor text, play audio, or open plain-text details.

The default translation shortcut is `Ctrl+Alt+K` on Windows/Linux and `Cmd+Alt+K` on macOS.

### Clipboard text from other VS Code panels

For VS Code Chat, Claude Code, Codex, terminals, output panels, and other copyable views:

1. Copy the exact text you want processed.
2. Click **KREN** in the status bar.
3. Verify the visible clipboard preview and choose an operation in the top-center Quick Pick. The same menu can show KREN or hide the Secondary Sidebar, even when the clipboard is empty.
4. Review the rich result in KREN.

KREN reads the clipboard once after you click the status item. It does not monitor clipboard changes or inspect another extension's private webview.

## KREN panel and navigation

The hamburger menu is available on the Start Page, results, User Manual, and Settings screens:

- **Start Page** returns to the introduction without deleting the latest result.
- **User Manual** opens the built-in concise manual.
- **Settings** opens KREN's feature-scoped controls.
- **Clear** removes the displayed input/result and editor grammar findings from KREN's current in-memory state.

**Open full details** writes a plain-text representation to the KREN Output channel. It is useful for long dictionary entries and audit-friendly rewrite comparison. VS Code may preserve Output channel content in extension-host session log files, and clearing the KREN panel does not remove those VS Code-managed logs.

## Dictionaries

The Dictionary Search submenu is ordered English Dictionary, Synonyms, and Korean Dictionary.

- **English Dictionary** preserves Merriam-Webster homographs, parts of speech, inflections, numbered senses, examples, run-on forms, pronunciation, and editorial synonym discussions when supplied.
- **Synonyms** uses the separate Thesaurus API and groups synonyms, near synonyms, related words, phrases, antonyms, and near antonyms by sense.
- **Korean Dictionary** accepts one Korean headword and returns Korean Basic Dictionary content with English explanations.

Korean Dictionary results identify the Basic Korean Dictionary and the National Institute of Korean Language as the source. Retrieved text is presented under CC BY-SA. KREN does not request Korean dictionary multimedia.

English Dictionary accepts short expressions such as `take on`, `settle on`, and `get rid of`. KREN queries Merriam-Webster first. KREN sends that exact expression to Google Cloud Translation only when no entry is returned for a multi-word expression and the fallback is enabled. Authentication, network, and other errors do not trigger translation fallback.

Dictionary, thesaurus, and Korean dictionary results are lookup-only; they do not offer Replace Selection.

## Grammar Check

Grammar Check uses bundled Harper in a warmed background worker. It requires no key and sends no text over the network.

### Explicit editor check

1. Select an English passage and choose **Grammar Check**.
2. KREN publishes informational underlines without forcing the panel open.
3. Right-click an underline and choose **Quick Fix...**.
4. Choose a KREN correction, **Add ... to local dictionary** for a spelling term, **Ignore this finding**, or **KREN: More details**.

A correction validates the result generation, document version, complete checked range, and original text before editing. After one correction, KREN rechecks the same passage and refreshes the remaining findings.

The detailed panel starts every issue at **Keep original**. You may select several alternatives and then apply them together. Clipboard checks cannot replace an editor range, so they offer **Copy selected corrections** instead.

### Local vocabulary and ignored findings

- **Add to local dictionary** stores only the chosen word in VS Code global storage.
- **Ignore this finding** stores only Harper's privacy-preserving context hash, not the checked sentence.
- Settings and Command Palette commands can clear current findings, all custom words, or all ignored hashes.

### Automatic paragraph checking

Automatic checking is off by default. When enabled, KREN waits for the configured delay after an edit and checks only the current paragraph. If the paragraph exceeds the configured input limit, KREN checks only the current line. It remains entirely local and does not populate the result panel automatically.

Harper is rule-based. A clean result is not a guarantee that every spelling, grammar, style, or factual problem was detected; review every suggested edit.

## Translation

Translation detects the input language automatically. The default `auto-en-ko` target sends English to Korean and Korean to English. Choose a fixed ISO/BCP-47 target for other languages or mixed-language edge cases. Cloud Translation API Basic v2 is the default provider; Gemini is optional. KREN never silently switches translation providers. Google Translate powers Cloud Translation API results, so KREN places Google's official linked attribution badge and an available translation disclaimer beside every such result.

Editor-originated translation results can be copied or explicitly replace the unchanged original selection. Clipboard-originated results can be copied but have no editor range to replace.

## Explain Meaning or Nuance

Choose Gemini, OpenAI API, or Anthropic API independently for explanation. With Gemini, choose either the Default or Alternate profile, each with its corresponding stored key, model, and thinking level. The Alternate profile can use its configured same-provider fallback model and independent fallback thinking level when the primary model is unavailable or produces unusable structured output. KREN can explain meaning, nuance, connotation, register, ambiguity, and technical usage in a selected language or English/Korean bilingual mode.

KREN never silently falls back across companies. Model discovery and connection tests authenticate only with the selected provider and do not send selected document text.

## Rewrite / Polish Text

Rewrite / Polish Text detects the dominant source language and rewrites in that same language. It does not translate. For short or mixed-language text, select the source language manually in Settings. Choose all three variants or request one directly:

- **Natural** for fluent native-level phrasing in the source language.
- **Concise** for shorter wording that preserves the message.
- **Jargon-Free** for direct, human wording with necessary domain terminology retained.

Configure the source language, a domain (General, Academic, Technical, Business, or Email), a tone, and a rhetorical mode. When English is detected or selected, English variety offers American, British, Australian, Canadian, Indian, and International English. The default, **Follow Grammar Check**, uses the dialect currently selected for Grammar Check. English variety is ignored for non-English text. **Preserve My Voice** and **Preserve Original** are the safest defaults. Formatting protection asks the selected provider to retain Markdown, LaTeX, citations, links, placeholders, filenames, and code. Optional change notes summarize important edits.

KREN instructs providers not to invent facts, evidence, promises, certainty, examples, greetings, or document context. AI output can still be wrong; verify claims, numbers, citations, terminology, and intended tone before replacement. Editor results provide Copy and guarded Replace controls for each variant. Clipboard results provide Copy only.

Rewrite and Explain depend on the selected provider's model and network availability. A valid request can occasionally fail during a temporary demand spike or connection interruption; repeating it often succeeds. The Alternate Gemini profile defaults to the stable `gemini-3.5-flash` fallback, with its own thinking-level control. High thinking or effort settings can add substantial latency, so Auto or Low is usually the better choice for routine editing.

## Pronunciation and Read Aloud

### Merriam-Webster pronunciation

On a local Windows host, the speaker button downloads only an allowlisted Merriam-Webster MP3, rejects redirects and files over KREN's limit, plays it through a hidden PowerShell/WPF media process, and removes the temporary directory. No external application window should open. Disable **Windows background pronunciation** to use the panel player instead.

On other platforms, remote hosts, or native failure, KREN uses its constrained webview audio player when possible and may reveal the panel if the player has not been initialized.

### Local Windows Read Aloud

Select editor text and choose **Read Aloud**. KREN speaks an in-memory cleaned copy and does not edit the source. It removes common Markdown markers, task checkboxes, URLs, HTML tags, code fences, and citation artifacts. Choose an installed System.Speech voice, rate, and volume in Settings. Press `Esc` while KREN speech is active to stop; otherwise Escape retains its normal VS Code behavior.

### Microsoft Edge Online speech

Edge Online is optional and experimental. Install it into the Python interpreter configured in KREN:

```powershell
python -m pip install edge-tts
```

The Python command is a machine-scoped setting. KREN disables Edge Online speech while VS Code is in Restricted Mode because that feature launches the configured executable. Trust only workspaces you control. Local Windows speech remains available in Restricted Mode.

Select Christopher, Ava, or another current Edge voice ID. On first use, KREN explains that only the cleaned speech copy is sent to Microsoft's online Edge speech service through the unofficial `edge-tts` package. Audio is synthesized into a unique temporary MP3, played invisibly or in the panel, and deleted. Preview, editor Read Aloud, and rewrite Read Aloud share the same provider, voice, speed, and 25/50/75/100% volume setting.

## Settings reference

KREN Settings groups controls by feature:

- Translation provider and output language
- Grammar dialect, optional auto-check, delay, vocabulary counts, and reset actions
- Explain provider, output language, Default or Alternate Gemini profile, model, thinking/effort, retries, and connection/model discovery
- Rewrite provider/profile, model/fallback, thinking/effort, variants, English variety, domain, tone, rhetorical mode, formatting, change notes, and TTS controls
- Read Aloud provider, Windows or Edge voice, speed, volume, Python command, Preview, and Stop
- Dictionary multi-word translation fallback and Windows pronunciation playback
- Credential Set/Remove controls, a confirmed **Delete all stored API keys** action, provider connection tests, Cloud Translation usage, and **All KREN settings**

Settings are global to the current VS Code profile. API keys remain in Secret Storage and are never embedded in the panel HTML.

## Native VS Code language-model tools

KREN registers five tools for compatible VS Code chat agents: English Dictionary, Korean Dictionary, Synonyms, Translate, and Explain. VS Code presents the tool invocation for confirmation. The tool receives only its explicit `text` argument and optional language setting; KREN does not attach editor, file, workspace, or chat context.

KREN does not bundle an MCP server. Copying text and using the KREN status item is the consistent workflow for Claude Code and Codex extension panels.

## Privacy, storage, limits, and cost

- Remote operations receive only explicitly submitted text, fixed KREN instructions, and selected operation settings.
- KREN does not attach surrounding text, filenames, paths, workspace contents, open tabs, source-control data, previous results, or chat history.
- KREN collects no telemetry and maintains no translation or rewrite history.
- The latest submitted input and result remain in memory until replaced, cleared, or the extension host stops. Open Full Details also writes a copy to the KREN Output channel, which VS Code may preserve in session logs.
- API keys are stored in VS Code Secret Storage. KREN Settings shows only whether each key is stored, never the key value. Remove an existing key before setting its replacement.
- Custom grammar words, ignored Harper hashes, consent flags, and the Cloud Translation usage ledger are stored in VS Code global storage.
- The default submitted-text limit is 5,000 characters and is configurable from 1 to 20,000 with `kren.translation.maxCharacters`; despite its historical name, this shared limit applies to KREN operations generally.
- The default provider/local-operation timeout is 45 seconds and is configurable from 1 to 120 seconds with `kren.request.timeoutMs`.
- Same-provider retries are bounded. For Rewrite / Polish Text, the alternate Gemini profile can use only its explicitly configured same-provider fallback after eligible temporary overload errors or an unusable structured response, and results identify fallback use. Authentication, invalid-request, empty-result, and safety errors do not trigger fallback. Explain uses the selected model without this rewrite fallback.
- OpenAI Responses requests set `store: false`, but provider-side security, abuse-monitoring, and legal retention can still apply.

See [Privacy and Cost](PRIVACY_AND_COST.md) for the complete boundary.

## Troubleshooting

- **No API result:** verify the matching key, API enablement, billing/quota, selected model, network path from the extension host, and retry settings.
- **400 thinking/effort error:** choose Auto or a level supported by the selected model.
- **401/403:** replace the key and confirm project/API permissions.
- **404 model unavailable:** refresh models or enter a current compatible model ID.
- **429 or quota error:** inspect provider billing/quota; more retries do not fix a hard limit.
- **503 high demand:** retry later or select another model from the same provider.
- **Grammar first check is slow:** Harper is warming in a worker; retry after several seconds. The extension host remains responsive.
- **A valid term is underlined:** add it to KREN's local dictionary.
- **Read Aloud is unavailable:** confirm this is a local Windows extension host, install an OS speech voice, and use Preview.
- **Edge voice fails:** verify the configured Python command, run `python -m pip install edge-tts` in that interpreter, confirm the voice ID and network, then use Preview.
- **Pronunciation opens KREN:** native playback was disabled/unavailable or failed, so KREN safely used the panel fallback.

See [Troubleshooting](TROUBLESHOOTING.md) for additional details. Never paste an API key into a document, issue, log, screenshot, or support request.

## Clear data and uninstall

1. Run each provider-specific **KREN: Delete ... API Key** command for secrets you want explicitly removed.
2. Clear custom grammar words and ignored findings from KREN Settings if desired.
3. Clear the rich result to remove KREN's current in-memory input/result.
4. Uninstall KREN.
5. To remove remaining consent flags and the Cloud Translation usage ledger, delete KREN's VS Code global storage for `masstransferase.kren-translate` after uninstalling.

Deleting or resetting the local Cloud Translation ledger does not change provider billing records and must not be used to bypass the configured safety ceiling.

## Known limitations

- Grammar Check is English-focused and rule-based.
- Rewrite / Polish Text relies on provider language detection when Source language is Auto; short or mixed-language text may require a manual source-language selection.
- Korean Dictionary accepts one Korean headword; other dictionary products are English-specific.
- Read Aloud is currently limited to a local Windows extension host.
- Edge Online speech relies on an unofficial service interface that may change independently of KREN.
- API model IDs, access, quotas, pricing, permitted use, and retention policies can change; provider documentation is authoritative.
- AI explanations are informational and are not professional medical, legal, or financial advice.
