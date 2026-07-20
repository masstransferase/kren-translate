# Privacy and Cost

## What KREN sends

For a provider-backed operation, KREN sends only:

- the text explicitly selected in an editor or confirmed from the clipboard;
- fixed instructions for the chosen KREN operation; and
- selected language or English variety, domain, tone, formatting, and output settings.

KREN does not add surrounding file text, filenames, workspace contents, editor history, clipboard history, previous results, or other open documents.

## Provider destination

Dictionary operations go only to their named dictionary API. Translation goes only to the configured Google Cloud Translation or Gemini provider. Explanation and rewriting go only to the explicitly configured Gemini, OpenAI, or Anthropic provider. KREN never silently falls back across companies.

For Rewrite English, the alternate Gemini profile may use its explicitly configured same-provider fallback model after bounded temporary-failure retries. The result identifies fallback use. Explain uses its selected Gemini model without the rewrite fallback. OpenAI and Anthropic retries remain on the same model and provider.

## Storage and retention

API keys are stored in VS Code Secret Storage. KREN Settings provides individual **Remove key** controls and a confirmed **Delete all stored API keys** action. Selected and clipboard text is retained in memory as the latest result; KREN does not maintain an operation history. If the user chooses **Open Full Details**, KREN writes a plain-text copy to its VS Code Output channel, and VS Code may persist that channel in extension-host session log files. Clearing the rich panel does not delete those VS Code-managed logs. OpenAI requests set `store: false`, but that option is not a promise of zero provider-side security or abuse-monitoring retention. Each provider's current terms and data controls remain authoritative.

Harper Grammar Check is offline. If the user chooses **Add to local dictionary**, KREN stores only that word in VS Code global storage. If the user chooses **Ignore this finding**, KREN stores only Harper's privacy-preserving context hash. Automatic paragraph checking is disabled by default and never stores or transmits the paragraph.

## Cost controls

KREN is free software, but third-party API use is not universally free. KREN does not control provider billing. The Google Cloud Translation character ledger is a conservative local guard, not a substitute for billing reports. Configure provider-side budgets, hard project limits, alerts, prepaid credit, or restricted keys where available. Bounded retries can repeat billable requests, so keep attempts low when cost is the priority.
