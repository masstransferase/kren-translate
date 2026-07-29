# Public KREN Release Process

This runbook is the authoritative update method for the public VS Code edition of KREN.

## Release boundaries

- Release only from the public repository whose remote is `https://github.com/masstransferase/kren-translate.git`.
- Keep the private KREN checkout separate. Do not copy private-only features, credentials, global storage, logs, test documents, or generated output into the public repository.
- Public KREN includes Merriam-Webster Collegiate Dictionary and Collegiate Thesaurus. It does not include private-only provider integrations or key settings.
- Every API key must be obtained and entered by the user. No developer or shared key may appear in source, tests, documentation, a VSIX, Git history, screenshots, or release automation.
- Do not publish directly from an Office or unrelated KREN project.

## 1. Confirm the intended change

Start with a current `main` branch and inspect the complete worktree:

```powershell
git status -sb
git diff
git remote -v
```

Include only files belonging to the planned public update. Preserve unrelated work and stop if the public/private boundary is uncertain.

Review provider terms, attribution, privacy statements, and API requirements whenever a provider, endpoint, submitted field, or stored value changes. Update `PRIVACY.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, and provider documentation when applicable.

## 2. Update the release metadata

Use an unused semantic version. Marketplace versions cannot be overwritten or reused.

```powershell
npm version <version> --no-git-tag-version
```

This must update both `package.json` and `package-lock.json`. Add a short user-facing entry at the top of `CHANGELOG.md`. Include only changes introduced since the previous public release.

Also update the README, User Guide, provider setup, troubleshooting, settings descriptions, and in-panel manual when the user experience or requirements changed.

## 3. Run the release gate

Install from the committed lockfile when dependencies changed or the checkout is fresh:

```powershell
npm ci
```

Then run:

```powershell
npm run check
npm audit --omit=dev
npm run package
```

`npm run check` performs type checking, builds the extension bundles, and runs the automated tests. `npm run package` creates `kren-translate-<version>.vsix`.

Before continuing, confirm:

- all tests pass;
- the VSIX contains the expected public files;
- no API key, PAT, credential file, `.env`, certificate, selected text, history, or log is packaged;
- no private-only command, setting, credential, documentation, or artwork is present;
- public artwork and attribution files are included;
- the manifest publisher is `masstransferase`;
- the manifest version matches the VSIX filename and changelog.

Never solve a release failure by weakening privacy tests, removing attribution, bypassing type checking, or using `--no-verify`.

## 4. Commit through a protected release branch

The public `main` branch requires a pull request and status checks. Start the release branch from current `main`, stage the reviewed public files explicitly, and use a concise release commit:

```powershell
git switch main
git pull --ff-only origin main
git switch -c release/kren-<version>
git add <reviewed-public-files>
git diff --cached
git commit -m "Release KREN <version>"
git push -u origin release/kren-<version>
```

Open a pull request from `release/kren-<version>` to `main`. Ordinary Git credentials are sufficient to push the branch. GitHub CLI is optional because the pull request can be opened through the connected GitHub tools or website.

Check the GitHub Actions run for the pull request. Both the package job and extension-host tests must pass. Merge as one concise release commit, then synchronize local `main`:

```powershell
git switch main
git pull --ff-only origin main
```

Do not bypass the branch rule or force-push `main`.

## 5. Publish to the VS Code Marketplace

Publisher: `masstransferase`

Publisher portal:

`https://marketplace.visualstudio.com/manage/publishers/masstransferase`

Upload the exact verified `kren-translate-<version>.vsix` generated from the pushed commit. If automated `vsce publish` is used in the future, supply its Marketplace PAT only through a protected prompt or environment secret. Never put a PAT in a command saved to documentation, source, shell history, GitHub, or a VSIX.

Do not rebuild between GitHub push and Marketplace upload. The uploaded VSIX must correspond to the verified source state.

## 6. Verify the public release

After Marketplace processing:

1. Confirm the Marketplace page shows the new version, changelog, README, icon, overview image, categories, license, repository, privacy, and support links.
2. Install or update KREN from the Marketplace in a clean VS Code profile.
3. Confirm no API key is preloaded and all Set/Remove key controls behave correctly.
4. Smoke-test Grammar Check without a key.
5. Smoke-test English Dictionary, Synonyms, Korean Dictionary, Translation, Explain Nuance, multilingual Rewrite / Polish Text, and supported Read Aloud modes with user-owned restricted test keys.
6. Confirm passive hovering and ordinary typing send nothing.
7. Confirm editor replacement rechecks the original range.
8. Confirm the public build has no private-only feature or provider setting.
9. Confirm GitHub Actions passed for the exact release commit.

Record any failure before attempting another upload. Marketplace fixes require a new patch version; do not try to replace an existing published version.

## 7. Preserve release hygiene

- Keep generated `dist/`, `.vsix`, test-host, coverage, and log files ignored by Git.
- Keep previous public source in Git history; local VSIX files may be removed after the release is verified.
- Do not rewrite public release history or force-push `main`.
- Do not expose release credentials while troubleshooting.
- Apply private-only changes separately after the public release is complete.
