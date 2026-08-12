# Changelog

This changelog describes the private local KREN build.

## Unreleased

## 1.1.0

- Adds the Merriam-Webster Medical Dictionary alongside the Collegiate Dictionary and Collegiate Thesaurus. Merriam-Webster issues two API keys per account, so KREN offers all three reference works and each user configures any two. Adding a third key is refused at entry, and the unconfigured reference work stays visible with the reason rather than being hidden.
- Reports a settings-panel action that could not be completed. A command that is unavailable or that fails now names itself instead of leaving a button that appears to do nothing. Provider error text is passed through with credentials redacted.
- Hardens the Cloud Translation usage ledger with stale-lock recovery and fail-closed corruption handling.
- Keeps read-aloud stop and audio acknowledgements responsive while provider model discovery runs in the background.
- Bounds Harper worker shutdown, removes its working-directory executable fallback, validates translated HTML entities, and clears pending grammar timers on deactivation.

## 1.0.4

- Adds an explicit, global `Open KREN Sidebar at startup` option for controlled
  startup testing. It is off by default.
- Keeps startup sidebar rendering free of eager grammar-worker warm-up, Windows
  voice discovery, and hidden-webview retention.

## 1.0.3

- Restores the KREN status-bar entry when VS Code starts.
- Keeps the hardened results view gated until an explicit KREN action and does
  not retain the webview while hidden.
- Defers Windows voice discovery until the user opens KREN settings.

## 1.0.2

- Adds automatic source-language detection to Rewrite Text and keeps the result in the detected language.
- Adds a manual source-language override and applies English-variety preferences only when the source language is English.
- Removes automatic startup activation and eager grammar-worker warm-up.
- Keeps the KREN results webview unavailable until an explicit KREN action reveals it.
- Stops retaining hidden webview content and disposes view-scoped listeners and audio waiters.

## 1.0.1

- Replaces the retired alternate-profile fallback preset with stable `gemini-3.5-flash` and migrates the former saved default automatically.
- Adds an independent fallback thinking level and applies the same-provider fallback to both Rewrite Text and Explain Meaning or Nuance.
- Keeps KREN commands responsive while ordinary provider-error notifications remain visible.

## 1.0.0

- Based on the final public KREN 1.0.0 source and kept under the separate `local.kren-translate` extension identity.
- Provides English, Medical, and Korean dictionaries, sense-grouped synonyms, offline English grammar checking, multilingual translation, meaning and nuance explanation, multilingual rewriting, pronunciation, and read-aloud workflows.
- Uses explicitly selected or copied text only, stores API keys in VS Code Secret Storage, collects no telemetry, and keeps grammar checking offline.
- Adds private-local Merriam-Webster Medical Dictionary lookup with a separately stored user-owned key; no shared keys are included.
- Adds guarded editor replacement, provider-specific settings, retry controls, Cloud Translation usage protection, Workspace Trust protection for Edge Online speech, complete attribution, and public security and privacy documentation.
