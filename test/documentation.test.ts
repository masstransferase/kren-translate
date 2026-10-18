import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
const privacyAndCost = readFileSync('docs/PRIVACY_AND_COST.md', 'utf8');
const manifestVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const skippedDirectories = new Set(['.git', '.vscode-test', 'coverage', 'dist', 'node_modules']);

function filesWithExtension(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : filesWithExtension(path, extension);
    }
    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

const publicSurfaceFiles = [
  'BRAND_ASSETS.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  ...filesWithExtension('docs', '.md').filter((file) => !file.endsWith('RELEASE_CHECKLIST.md')),
  ...filesWithExtension('.github', '.md'),
  ...filesWithExtension('.github', '.yml'),
  ...filesWithExtension('.github', '.yaml')
];

describe('KREN User Guide', () => {
  it('V204 documents completion, situation choice, target use and the exact privacy expansion in both manuals', () => {
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    const manual = panel.slice(panel.indexOf('function renderManual('), panel.indexOf('function sameLanguageWarning('));
    for (const document of [guide, manual]) {
      expect(document).toContain('Finish the lesson and its practice first.');
      expect(document).toContain('Let KREN choose');
      // 2026-10-11: V218 shortens the manual while retaining completion of every lesson example/practice item.
      expect(document).toMatch(/every (?:current |lesson )?(?:practice item|example)/u);
      expect(document).toMatch(/annotation excerpts/u);
      expect(document).toMatch(/reviewed answers|saved reviewed answer/u);
      expect(document).toMatch(/prefetched Hint/u);
      expect(document).toMatch(/deferred (?:or|and) retry coaching/u);
      expect(document).toMatch(/Demo casting and batches/u);
      expect(document).toMatch(/underlined in the theme's link color/u);
      expect(document).toMatch(/abstract grammar (?:and|or) inflected/u);
      expect(document).toMatch(/dictionary response/u);
      expect(document).toMatch(/unrelated history/u);
      expect(document).not.toContain('It receives no lesson text');
    }
  });
  it('documents the two-of-three reference choice and omits the retired design feature in both manuals', () => {
    // Added 2026-10-04: V198 keeps the reference choice explicit on both independently rendered surfaces.
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    const manual = panel.slice(panel.indexOf('function renderManual('), panel.indexOf('function sameLanguageWarning('));
    for (const document of [guide, manual]) {
      expect(document).toMatch(/configure two of the three Merriam-Webster references/u);
      for (const reference of ['Collegiate Dictionary', 'Collegiate Thesaurus', 'Medical Dictionary']) {
        expect(document).toContain(reference);
      }
      expect(document).not.toMatch(/design[\s-]+twin/iu);
    }
  });

  it('V153 names the short conversation buttons on every reader-facing surface', () => {
    const panel = readFileSync('src/resultViewHtml.ts', 'utf8');
    for (const oldLabel of ['Start conversation', 'Reset to defaults']) {
      expect(guide).not.toContain(oldLabel);
      expect(panel).not.toContain(oldLabel);
    }
  });

  // The guide ships inside the VSIX, so a stale version on it is delivered to every
  // user. This shipped with "KREN 1.0.4" on the 1.1.0 release and reached a public
  // pull request before an automated reviewer caught it. A hand-maintained version
  // string in a shipped document rots on every release unless something asserts it.
  it('states the version in package.json', () => {
    const stated = /This guide applies to KREN ([0-9]+\.[0-9]+\.[0-9]+)\./.exec(guide);
    expect(stated, 'The guide must state which version it applies to.').not.toBeNull();
    expect(stated?.[1]).toBe(manifestVersion);
  });

  it('retains every essential manual section', () => {
    for (const heading of [
      // Changed 2026-10-06: V211 maps setup/navigation and reference material to task headings.
      'Set up',
      'Look up a word',
      'Smart Grammar Check',
      'Translate',
      'Explain Nuance',
      'Rewrite',
      'Read Aloud',
      'User Dictionary',
      'AI English Tutor',
      'Light and dark view',
      'Reference',
      'Troubleshooting',
      'Reset'
    ]) {
      expect(guide).toContain(`## ${heading}`);
    }
    // Changed 2026-09-30: V175 moves drafting below Lesson settings; check guidance by meaning.
    // Changed 2026-10-01: V177 keeps the title and gear and adds master Reset beside them.
    // Changed 2026-10-06: Check action, location, and focus in steps rather than the old narrative sentences.
    expect(guide).toMatch(/master \*\*Reset\*\* beside[^.]*page title and gear/iu);
    expect(guide).toMatch(/\*\*LESSON\*\*[^\n]*\*\*Setting\*\*[^\n]*\*\*LESSON SETTING\*\*/u);
    expect(guide).toMatch(/\*\*Draft\*\* below the lesson settings/u);
    expect(guide).toMatch(/\*\*Reset\*\* on the LESSON row/u);
    expect(guide).toMatch(/\*\*Setting\*\* to open[^\n]*scroll[^\n]*focus/u);
    // Changed 2026-09-30: V175b retains the practice action's location without pinning its wording.
    expect(guide).toMatch(/\bpractice\b[^.]*\b(?:below|after)\b[^.]*\bexample controls\b[^.]*\bbefore\b[^.]*\bCOMMON ERRORS\b/iu);
    // Changed 2026-10-01: master Reset now closes disclosures; lesson Reset preserves inputs.
    expect(guide).toMatch(/Master Reset clears[^\n]*folds LESSON SETTING, MODE, and VOICE & MODEL/iu);
    expect(guide).toMatch(/Reset\*\* on the LESSON row to clear only[^\n]*lesson and practice/u);
    // Changed 2026-09-25 for V152: the panel buttons use short labels; the search-result
    // dialog deliberately retains its longer action labels.
    expect(guide).toMatch(/use \*\*Primary\*\* or \*\*Support\*\* on the \*\*Selected targets\*\* heading line/iu);
    expect(guide).toContain('returns all four learning-map dropdowns to Select an option');
    /*
     * The two tutor design documents are design notes rather than shipped documentation,
     * so they are not present in every build of this tree. Read unconditionally, they
     * failed here with ENOENT wherever they are absent. They are asserted where they exist
     * and skipped where they are not.
     */
    const blueprintPath = 'docs/tutor/ai_english_tutoring.md';
    const planPath = 'docs/tutor/ai_english_tutoring_dev_plan.md';
    const banned = /use the pin control|\| \*\*O\*\* \||\| \*\*M\*\* \||Generate control lives inside/iu;
    if (existsSync(blueprintPath) && existsSync(planPath)) {
      const tutorBlueprint = readFileSync(blueprintPath, 'utf8');
      const tutorPlan = readFileSync(planPath, 'utf8');
      expect(tutorBlueprint).toContain('Sections open and close independently.');
      expect(tutorPlan).toContain('restored multi-section open state is valid');
      expect(`${guide}\n${tutorBlueprint}\n${tutorPlan}`).not.toMatch(banned);
    } else {
      // The guide ships in both channels and carries the same prohibition on its own.
      expect(guide).not.toMatch(banned);
    }
  });

  it.skipIf(!existsSync('docs/tutor/ai_english_tutoring.md'))(
    'V46 R6 removes the per-Cluster Support limit from the blueprint and guide',
    () => {
      const tutorBlueprint = readFileSync('docs/tutor/ai_english_tutoring.md', 'utf8');

      expect(tutorBlueprint).toContain(
        'Support targets may come from the same cluster.'
      );
      expect(tutorBlueprint).toContain(
        'More than one Support may come from the same cluster.'
      );
      expect(tutorBlueprint).not.toMatch(/no more than one Support target from the same cluster/iu);
      expect(tutorBlueprint).not.toContain('already one support target from Time and Reality');
      expect(tutorBlueprint).not.toContain('up to five Support targets');
      expect(guide).toContain('Two or more Supports may come from the same Cluster.');
    }
  );

  it.skipIf(!existsSync('docs/tutor/ai_english_tutoring.md'))(
    'V63 R5 makes the tutor blueprint, privacy disclosure, and guide agree',
    () => {
      const tutorBlueprint = readFileSync('docs/tutor/ai_english_tutoring.md', 'utf8');
      for (const document of [guide, privacyAndCost, tutorBlueprint]) {
        expect(document).toContain('Weakness analysis');
        expect(document).toContain('Text analysis');
        expect(document).toMatch(/passage[^\n]*(?:not (?:kept|stored)|not retained)/iu);
        expect(document).toMatch(/lesson recipe/iu);
      }
      expect(privacyAndCost).toContain('Dismissing the modal sends nothing.');
      expect(tutorBlueprint).toContain('contacts no model and opens no modal');
      expect(guide).toContain('the modal shows the exact passage that would be sent');
    }
  );

  it('documents platform, credential, network, cost, and optional dependency boundaries', () => {
    for (const requirement of [
      'VS Code Desktop 1.106 or later',
      'No Node.js, npm, Python, GPU, or API key is required',
      'Merriam-Webster Collegiate API key',
      'Merriam-Webster Collegiate Thesaurus API key',
      'Merriam-Webster Medical Dictionary API key',
      'Korean Basic Dictionary Open API key',
      'Google Cloud Translation Basic v2',
      'Gemini, OpenAI API, or Anthropic API key',
      'local Windows extension host',
      'python -m pip install edge-tts',
      '500,000',
      '5,000',
      'WSL, SSH, Dev Containers, Codespaces'
    ]) {
      expect(guide).toContain(requirement);
    }
    // Changed 2026-10-04: V198 checks the timeout's purpose and declared default instead of stale wording.
    const timeout = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration.properties['kren.request.timeoutMs'].default / 1000;
    expect(guide).toMatch(new RegExp(`default[^.]*timeout[^.]*${timeout} seconds`, 'iu'));
    expect(guide).toContain('KREN includes no shared credentials');
    expect(guide).toContain('KREN includes no shared credentials');
    expect(guide).toContain('KREN makes no service-tier claim');
    // Changed 2026-10-06: Retain the eligibility fact while allowing operational wording.
    expect(guide).toMatch(/Gemini API users[^.]*at least 18/u);
    expect(guide).toContain('professional or business purposes');
    expect(guide).toContain('Delete all API keys');
    expect(guide).toContain('https://ai.google.dev/gemini-api/docs/available-regions');
    expect(guide).not.toMatch(/Free API|Paid Gemini/iu);
    expect(guide).toContain('Medical Dictionary');
  });

  it('omits private preview history from the public changelog', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    expect(changelog).not.toContain('Pre-public development');
    expect(changelog).not.toMatch(/0\.1\.0|0\.14\.1/u);
  });

  it('contains no obvious encoding corruption', () => {
    expect(guide).not.toContain('\uFFFD');
    expect(guide).not.toContain('??');
  });

  it('states each active conversation switch and Hint cancellation rule once without contradiction', () => {
    // Added 2026-09-20 after V129 documented Send as both disabled and enabled in Live,
    // and made Stop talking appear to cancel a request it does not own.
    expect(guide).not.toContain(
      'Register, Correction, Answers, Send, Replies and Reply thinking remain enabled and apply from the next turn.'
    );
    // Changed 2026-09-23: V140 keeps the freeze but documents all three choices together.
    expect(guide.match(/Register, Correction, and Replies are disabled while a conversation is active/gu))
      .toHaveLength(1);
    expect(guide).not.toContain('Answers and Reply thinking apply from the next turn');
    expect(guide).not.toContain('Changing **Replies** during a conversation takes effect at once');
    // Changed 2026-09-24 for V147: Send alone is not the boundary. Standard completion and
    // the first Live fragment must clear before the next KREN message can own the screen.
    // Changed 2026-10-06: Preserve both cancellation boundaries and independent stopping in Reference.
    expect(guide).toMatch(/completed Standard turn[^.]*clears[^.]*Hint before rendering/u);
    expect(guide).toMatch(/first Live reply fragment[^.]*clears[^.]*Hint before rendering/u);
    expect(guide).toMatch(/cancels pending Hint work/u);
    expect(guide).toMatch(/Stop talking does not cancel Hint/u);
    // Changed 2026-10-06: HEAD's tutorConversationTurnInProgress includes Hint work; the old guide contradicted that guard.
    expect(guide).toMatch(/Stop talking remains available while a Hint is pending/u);
    expect(guide).toMatch(/Stop conversation waits for that Hint to finish/u);
    expect(guide).not.toContain('Stopping cancels that Hint');
  });

  it('V145 documents KREN-owned Live turn detection without synthetic silence', () => {
    // Added 2026-09-23: the shipped guide must describe the local gate boundary that replaced
    // Gemini's variable automatic detector, including what protects a mid-sentence pause.
    // Changed 2026-10-06: Assert the local detector's boundaries without pinning a paragraph.
    expect(guide).toMatch(/KREN speech detection[^.]*Gemini's automatic activity detection is disabled/u);
    expect(guide).toMatch(/local gate closes after its hangover[^.]*pause ends the turn/u);
    // Changed 2026-10-02 for V186: Live uses the independent pause. Check that returning
    // speech before the pause expires preserves the turn, rather than pinning its wording.
    // Changed 2026-10-06: V211 states the same pause continuity fact without narrative tense.
    expect(guide).toMatch(/speech[^.]*return(?:s|ing)[^.]*before[^.]*pause[^.]*same[^.]*turn/iu);
    expect(guide).toContain('Suppressed sound and synthetic silence are not sent.');
    expect(guide).toMatch(/Press to talk sends audio between its first and second presses only/u);
  });

  it('V153 retains the V152 correction layout while reversing its Live transcript wait', () => {
    // Changed 2026-09-25 for V153: the owner kept V152's layout and reversed its Live request timing.
    // Changed 2026-09-25 for V156: the owner asked for American English in the user guide.
    // Changed 2026-10-06: Keep correction placement, exactness, timing, and recast highlighting as facts.
    expect(guide).toMatch(/Complete corrections appear under your turn in normal foreground text/u);
    expect(guide).toMatch(/correct sentences have no empty block/u);
    expect(guide).toMatch(/Standard names exact correction spans/u);
    expect(guide).toMatch(/Live correction starts when Gemini starts replying, without its reply transcript/u);
    expect(guide).toMatch(/highlights follow .Actually, you would say./u);
    // Changed 2026-10-03: language is now a conversation ADVANCED choice, independent of routing.
    // Changed 2026-10-06: The task names the rendered ADVANCED group rather than calling it conversation mode.
    expect(guide).toMatch(/conversation (?:\*\*)?ADVANCED(?:\*\*)?[^\n]*Live transcription language/u);
    expect(guide).toMatch(/Automatic[^.]*provider detection/u);
    expect(guide).toMatch(/transcription stays verbatim/u);
    expect(guide).toMatch(/reset information dialog[^.]*choose OK/u);
    expect(guide).toMatch(/Reset confirmation is also announced to screen readers/u);
    expect(guide).not.toContain('highlights the longest meaningful quoted run');
    expect(guide).not.toContain('correction appears in its own neutral right-side bubble');
    expect(guide).not.toContain('The Live protocol does not offer a language field');
  });

  // A byte-order mark reached USER_GUIDE.md on 2026-08-14 from a PowerShell
  // Set-Content -Encoding utf8, which writes one in Windows PowerShell 5.1. It is
  // invisible in an editor and surfaces only as a noisy diff and the occasional renderer
  // printing a stray character before the first heading. Checked across every public
  // document, because the tool that produced it will be reached for again.
  it('starts no public document with a byte-order mark', () => {
    const withMark = publicSurfaceFiles.filter((file) =>
      readFileSync(file, 'utf8').charCodeAt(0) === 0xFEFF
    );

    expect(withMark, `byte-order mark found in: ${withMark.join(', ')}`).toEqual([]);
  });

  it('keeps the local Medical Dictionary documented with the renamed Gemini profiles', () => {
    for (const file of publicSurfaceFiles) {
      const content = readFileSync(file, 'utf8');
      // 2026-10-10: V216 permits Gemini Free Tier and Gemini Paid, replacing the old profile names.
      expect(content, file).not.toMatch(
        /Free API|(?:free[- ]?tier|paid|unpaid)\s+Gemini|Gemini\s+unpaid/iu
      );
    }
    expect(readFileSync('README.md', 'utf8')).toContain('Medical Dictionary');
    expect(readFileSync('PRIVACY.md', 'utf8')).toContain('Medical Dictionary');
  });

  it('keeps public documentation on KREN branding without em or en dashes', () => {
    for (const file of filesWithExtension('.', '.md')) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/\bKren\b/u);
      expect(content, file).not.toMatch(/[\u2014\u2013]/u);
    }
  });

  it('keeps user-facing source strings on KREN branding', () => {
    for (const file of filesWithExtension('src', '.ts')) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bKren\b/u);
    }
  });
});

// DESIGN.md used to enumerate every setting by hand. The list went stale without anyone
// noticing: it named kren.rewrite.tone, removed in 1.2.0, and gave pre-1.2.0 domain
// values, while omitting the ten rewrite axes entirely. A delegated run read it as
// specification and had to be corrected mid-flight.
//
// The enumeration is gone and the manifest is the source of truth, but prose still
// mentions individual keys where that is the clearest way to explain a rule. This asserts
// that every key it mentions actually exists, so the document can go out of date in tone
// but never in fact.
//
// This file is copied into both channels, and DESIGN.md is private-only, so the check is
// conditional on the document being present. That conditional is the point rather than a
// weakness: asserting on a file that does not exist in one channel is how a shared test
// passes privately and fails the public build, which is exactly what happened when this
// test was first written.
describe('DESIGN.md names only settings that exist', () => {
  it.skipIf(!existsSync('DESIGN.md'))('mentions no kren setting key absent from the manifest', () => {
    const design = readFileSync('DESIGN.md', 'utf8');
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    const declared = new Set(Object.keys(manifest.contributes.configuration.properties));
    // Retired keys may be named only where the document is explaining their migration.
    const retired = new Set(['kren.rewrite.tone', 'kren.rewrite.mode']);
    const mentioned = [...design.matchAll(/`(kren\.[A-Za-z0-9.]+)`/gu)].map((match) => match[1]!);
    const unknown = [...new Set(mentioned)]
      .filter((key) => !declared.has(key) && !retired.has(key));

    expect(unknown, `DESIGN.md names settings that do not exist: ${unknown.join(', ')}`)
      .toEqual([]);
  });
});
