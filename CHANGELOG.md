# Changelog

## 1.0.1

- Replaces the retired alternate-profile fallback preset with stable `gemini-3.5-flash` and migrates the former saved default automatically.
- Adds an independent fallback thinking level and applies the same-provider fallback to both Rewrite English and Explain Meaning or Nuance.
- Keeps KREN commands responsive while ordinary provider-error notifications remain visible.

## 1.0.0

- First public KREN release.
- Provides English and Korean dictionaries, sense-grouped synonyms, offline English grammar checking, multilingual translation, meaning and nuance explanation, English rewriting, pronunciation, and read-aloud workflows.
- Uses explicitly selected or copied text only, stores API keys in VS Code Secret Storage, collects no telemetry, and keeps grammar checking offline.
- Uses only Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus with keys obtained and entered by each user; no shared keys are included.
- Adds guarded editor replacement, provider-specific settings, retry controls, Cloud Translation usage protection, Workspace Trust protection for Edge Online speech, complete attribution, and public security and privacy documentation.
