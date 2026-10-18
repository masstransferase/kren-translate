# Privacy and Cost

## What KREN sends

For a provider-backed operation, KREN sends only:

- the text explicitly selected in an editor or confirmed from the clipboard;
- fixed instructions for the chosen KREN operation; and
- selected language or English variety, domain, tone, formatting, and output settings.

One operation sends more, and only when you have left its setting on. User Dictionary capture with Smart Word Capture (`kren.userDictionary.smartWordCapture`, on by default) adds the single sentence your selection sits in, so the model can say which meaning applies there; the sentence is stored on the entry and the entry's Source line records that it was sent. A sentence over 500 characters is dropped rather than clipped. Turning the setting off returns capture to the expression alone.

Apart from that one sentence, KREN does not add surrounding file text, filenames, workspace contents, editor history, clipboard history, previous results, or other open documents.

AI English Tutor has one explicit selected-passage operation. Choose Ask with its field empty, then choose **Weakness analysis** or **Text analysis** in the modal that shows the selected passage. KREN sends that exact passage, the chosen analysis instruction, and the learning-map identifiers and labels to the configured tutor provider. Dismissing the modal sends nothing. The passage is used only to select learning-map targets for that request. It is not kept in tutor state, placed in the lesson recipe, or used to seed lesson examples or practice.

## Provider destination

Dictionary operations go only to their named dictionary API. Medical Dictionary sends only the submitted English term to Merriam-Webster's Medical Dictionary endpoint and never invokes translation fallback. Translation goes only to the configured Google Cloud Translation or Gemini provider. Explanation and rewriting go only to the explicitly configured Gemini, OpenAI, or Anthropic provider. KREN never silently falls back across companies.

For Explain Meaning or Nuance and Rewrite Text, the Gemini Paid profile may use its explicitly configured same-provider fallback model after an unavailable model response, bounded temporary-failure retries, or unusable structured output. The fallback has an independent thinking-level setting, and the result identifies fallback use. OpenAI and Anthropic retries remain on the same model and provider.

## Storage and retention

API keys are stored in VS Code Secret Storage. KREN Settings provides a per-provider waste-basket control that removes one key and a confirmed **Delete all API keys** action that removes every stored key. Selected and clipboard text used by ordinary operations is retained in memory as the latest result; KREN does not maintain an operation history. A passage sent by AI English Tutor diagnosis is not retained after its target-selection request. If the user chooses **Open Full Details**, KREN writes a plain-text copy to its VS Code Output channel, and VS Code may persist that channel in extension-host session log files. Clearing the rich panel does not delete those VS Code-managed logs. OpenAI requests set `store: false`, but that option is not a promise of zero provider-side security or abuse-monitoring retention. Each provider's current terms and data controls remain authoritative.

Harper Grammar Check is offline. If the user chooses **Add to local dictionary**, KREN stores only that word in VS Code global storage. If the user chooses **Ignore this finding**, KREN stores only Harper's privacy-preserving context hash. Automatic paragraph checking is disabled by default and never stores or transmits the paragraph.

## Cost controls

KREN is free software, but third-party API use is not universally free. KREN does not control provider billing. The Google Cloud Translation character ledger is a conservative local guard, not a substitute for billing reports. Configure provider-side budgets, hard project limits, alerts, prepaid credit, or restricted keys where available. Bounded retries can repeat billable requests, so keep attempts low when cost is the priority.
