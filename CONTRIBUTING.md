# Contributing

Focused issues and pull requests are welcome. Public contributors can propose changes through a fork and pull request, but only the repository owner can merge or publish KREN.

All changes must preserve KREN's selection-first privacy boundary. Do not add workspace scanning, passive text submission, telemetry, credential export, secret logging, hidden storage of submitted text, or silent cross-provider fallback. A new network destination, stored field, executable path, provider request, or billable retry requires explicit documentation and tests.

Use invented or public sample text and mocked provider responses. Never commit API keys, tokens, personal data, confidential text, real provider payloads, local user paths, generated `dist`, `node_modules`, coverage, logs, temporary audio, credential bundles, or VSIX files.

Before submitting a change, run:

```powershell
npm ci
npm run check
npm run test:integration
npm run package
```

Describe user-visible behavior, privacy and provider effects, tests, and any environment limitation in the pull request. Keep changes reviewable and update the User Manual, Privacy Policy, notices, or provider setup when behavior changes. By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md).
