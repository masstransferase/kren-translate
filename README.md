# KREN: Dictionary, Translate & Rewrite

KREN is a privacy-conscious language workbench for dictionaries, offline grammar checking, translation, nuance explanation, English rewriting, and read-aloud inside VS Code.

![KREN overview showing the select or copy, choose an action, and use the result workflow](https://raw.githubusercontent.com/masstransferase/kren-translate/main/media/kren-marketplace-overview.png)

## Quick start

1. **Select or copy text.** Select editor text, or copy text from chat, terminals, and other panels.
2. **Choose an action.** Right-click an editor selection, or click **KREN** in the status bar for clipboard text.
3. **Use the result.** Review, compare, copy, safely replace eligible text, hear pronunciation, or open details.

Passive hovering sends nothing. KREN starts a remote request only after you explicitly choose an online operation.

## What KREN does

| Feature | What you get | Requirement |
| --- | --- | --- |
| **Grammar Check** | Private English spelling and grammar review with optional corrections | None. Harper runs offline. |
| **English Dictionary** | Structured Merriam-Webster entries, examples, inflections, and pronunciation | Collegiate API key |
| **Synonyms** | Sense-grouped synonyms, related words, and antonyms | Thesaurus API key |
| **Korean Dictionary** | Korean headwords with English explanations | Korean Basic Dictionary API key |
| **Translation** | Automatic English-to-Korean and Korean-to-English direction by default, or a fixed multilingual target | Cloud Translation API or Gemini key |
| **Explain Nuance** | Meaning, connotation, register, ambiguity, and technical usage | Gemini, OpenAI API, or Anthropic API key |
| **Rewrite English** | Natural, Concise, and Jargon-Free variants with English-variety, domain, tone, and rhetorical-mode controls | Gemini, OpenAI API, or Anthropic API key |
| **Read Aloud** | Offline Windows voices or optional Edge Online natural voices | Local Windows; Edge mode also needs Python and `edge-tts` |

You need keys only for the online features you choose. Every user must obtain and enter their own API keys; KREN includes no shared credentials. For Merriam-Webster, obtain your own Collegiate Dictionary and Collegiate Thesaurus keys. Standard free Merriam-Webster API use is limited to noncommercial applications, two reference works, and 1,000 queries per day per reference. Consumer AI subscriptions do not automatically include developer API access.

> **AI reliability:** Rewrite and Explain depend on remote model availability and can occasionally fail even with valid settings. Repeating the request often resolves a transient failure. Higher thinking or effort levels can take noticeably longer; use Auto or Low for routine work.

## Requirements

- **VS Code Desktop 1.106 or later.** Text features work on Windows, macOS, and Linux.
- **Grammar Check needs no key or network.** Online features need outbound HTTPS and the matching provider key.
- **Read Aloud requires local Windows.** Edge Online voices also require Python and `edge-tts`.
- **Gemini is optional and restricted by Google's current terms.** Gemini API users must be at least 18, use it for professional or business purposes, and meet current account and regional eligibility requirements. KREN asks for confirmation before first Gemini use.

Open the KREN Secondary Sidebar menu and choose **Settings**. The settings page guides provider, language, model, rewrite, grammar, speech, and API-key removal. The status-bar KREN menu can show or hide the Secondary Sidebar.

## Privacy and cost

- Remote operations receive only explicitly submitted text and chosen settings, never surrounding files, workspace data, open tabs, or chat history.
- Grammar Check is offline. KREN collects no telemetry, keeps no operation history, and stores keys in VS Code Secret Storage.
- **Open Full Details** writes a copy to the KREN Output channel, which VS Code may retain in session logs.
- Google Cloud Translation has a local 500,000-character monthly ceiling. Provider terms, quotas, retention, and billing remain authoritative.
- Google Translate powers Cloud Translation API results. KREN displays the required linked attribution and translation disclaimer beside those results.

Do not submit secrets, confidential material, or personal data unless the selected provider's terms and controls are acceptable.

## Learn more

- [User Guide](https://github.com/masstransferase/kren-translate/blob/main/docs/USER_GUIDE.md)
- [Provider Setup](https://github.com/masstransferase/kren-translate/blob/main/docs/PROVIDER_SETUP.md)
- [Privacy Policy](https://github.com/masstransferase/kren-translate/blob/main/PRIVACY.md)
- [Troubleshooting](https://github.com/masstransferase/kren-translate/blob/main/docs/TROUBLESHOOTING.md)
- [Public Release Process](https://github.com/masstransferase/kren-translate/blob/main/docs/RELEASE_PROCESS.md)

The same User Manual is available from KREN's in-panel menu.

KREN is independent and is not endorsed by its dictionary, AI, translation, or speech providers.

Source code and documentation are MIT-licensed. The named KREN artwork and brand assets are excluded from that grant; see [KREN Brand Assets](BRAND_ASSETS.md).
