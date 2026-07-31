# Changelog

## 1.0.3

- Adds automatic source-language detection to Rewrite Text and keeps the result in the detected language.
- Adds a manual source-language override and applies English-variety preferences only when the source language is English.
- Adds targeted Windows Fast Startup guidance for an Intel graphics-driver blue screen after shutdown and startup. KREN does not install a kernel driver, and disabling Fast Startup is not a general requirement.

## 1.0.2

- Adds automatic English-to-Korean and Korean-to-English translation as the default direction.
- Keeps explicit multilingual targets available and migrates the former global Korean default once without overriding workspace-specific targets.

## 1.0.1

- Replaces the retired alternate-profile fallback preset with stable `gemini-3.5-flash` and migrates the former saved default automatically.
- Adds an independent fallback thinking level and applies the same-provider fallback to both Rewrite Text and Explain Meaning or Nuance.
- Keeps KREN commands responsive while ordinary provider-error notifications remain visible.

## 1.0.0

- First public KREN release.
- Provides English and Korean dictionaries, sense-grouped synonyms, offline English grammar checking, multilingual translation, meaning and nuance explanation, multilingual rewriting, pronunciation, and read-aloud workflows.
- Uses explicitly selected or copied text only, stores API keys in VS Code Secret Storage, collects no telemetry, and keeps grammar checking offline.
- Uses only Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus with keys obtained and entered by each user; no shared keys are included.
- Adds guarded editor replacement, provider-specific settings, retry controls, Cloud Translation usage protection, Workspace Trust protection for Edge Online speech, complete attribution, and public security and privacy documentation.
