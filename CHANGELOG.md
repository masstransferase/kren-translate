# Changelog

This changelog describes the private local KREN build.

## Unreleased

## 1.3.0

Both channels. The public build carries the same version with the Merriam-Webster key limit at two, which is what Merriam-Webster's terms allow; the private build allows three for development only.

- Completes the User Dictionary. Entries can be searched across term, aliases, meanings, tags, and collections, and filtered by language, collection, entry type, capture mode, and whether a Merriam-Webster reference is attached.
- Adds purge, which always previews before it confirms and then deletes exactly the entries the preview listed rather than recalculating ages at confirm time. Removing everything requires typing the confirmation, which no age-based option can reach.
- Adds import and export in JSON and Markdown. JSON round-trips losslessly and is the backup format; Markdown is human-readable and lossy by design, and the interface says so. Import previews entry count, duplicates, and invalid records, and never overwrites without an explicit decision. The file being imported is never modified.
- Discloses the exact storage path in Settings, with recovery guidance for a corrupt store. A storage error now renders as a storage error and never as an empty dictionary.
- Adds the Merriam-Webster capture mode, which runs a live lookup and a language-model generation as two independent operations, shown separately and attributed. The dictionary text never enters the model prompt and the model output never enters the dictionary request.
- Replaces the four rewrite presets with thirteen: Plain English, Manuscript, Grant Proposal, Instruction, Technical document, Legal document, Regulatory document, Professional email, Casual email, Professional presentation, Research presentation, Teaching presentation, and Investor presentation.
- Reduces the speech controls to a speaker icon and a filled square, and adds read-aloud to User Dictionary entry details using the existing speech settings.
- Folds every settings group to a summary line and moves User Dictionary next to Dictionary.
- Warns that an expression is already in the User Dictionary before spending a provider call on it, and drops the redundant language code from the entry list.
- Fixes the third Merriam-Webster key being refused in the private build despite the raised limit. The panel was comparing against its own copy of the number.
- Stops the Voice axis from governing formality. Voice `Preserve` previously asked to preserve the writer's formality as well, which contradicted the Formality axis whenever it was set to anything other than Preserve. Plain English, Professional email, and Casual email each sent both instructions. Formality is now governed only by the Formality axis.
- Renames the rhetorical-mode default from `Preserve Original` to `Preserve`, matching the five other axes whose leave-it-alone value is named that. An existing stored `preserveOriginal` migrates automatically at every configuration scope.

## 1.2.0

Private only. Public KREN remains at 1.1.0, which is why this is 1.2.0 rather than another 1.1.0: two channels must never carry the same version number with different contents.

- Replaces the four flat rewrite style settings with ten axes: modality, function, English variety, domain, formality, voice, stance, length, perspective, and rhetorical mode. Every axis that can preserve the original leads with `preserve`, so a fresh install is unchanged.
- Removes `kren.rewrite.tone` and migrates all ten of its values onto the new axes. Migration runs once and is idempotent.
- Adds four rewrite modes, Manuscript, Upward email, Presentation, and Plain English, and groups the settings panel so each group collapses to a summary line. A mode is a named point in axis space and stores nothing, so the label is computed and reverts to Custom when any axis changes.
- Adds the User Dictionary in its LLM Only capture mode, off by default. Select an expression, review an editable draft, and save it. Entries are stored locally in VS Code global storage and can be listed, edited, and deleted. Only the selected expression and KREN's bounded instruction are sent to the provider.

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
