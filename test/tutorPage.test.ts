import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import {
  TUTOR_MAP,
  validateTrainingReview,
  type ResolvedTrainingTarget,
  type TrainingExample,
  type TrainingReview,
  type TrainingTargetRole,
  type TutorExerciseSet,
  type TutorLesson
} from '@kren/core/tutor';
import { iconSvgMarkup } from '@kren/core/icons';
import {
  renderKrenResultViewHtml,
  renderTutorConversation,
  type KrenPanelSettings
} from '../src/resultViewHtml.js';
import {
  changeTutorMapSelection,
  changeTutorTarget,
  createTutorViewState,
  moveTutorExample,
  replaceTutorExample,
  replaceTutorExerciseSet,
  tutorExerciseChannelLabel,
  tutorMapPathForNode,
  tutorPreparedPrompt,
  tutorRecipeFromState,
  tutorTargetActionReason,
  tutorTargetPathLabel,
  type TutorViewState
} from '../src/tutor/state.js';
import {
  serializeTutorRecipe,
  tutorDiagnosticReport,
  tutorLessonGenerationRequest,
  tutorReviewGenerationRequest
} from '../src/tutor/generation.js';

it('V74 R2 exposes a keyboard reachable demote control in the open map and makes its Primary a Support', () => {
  const state = selectedState();
  const output = html(state);
  const map = output.match(/<details[^>]*data-persist-id="tutor-map"[^>]*>[\s\S]*?<\/details>/u)?.[0] ?? '';
  expect(map.match(/^<details[^>]*>/u)?.[0]).toContain(' open');
  const row = map.match(/<div class="tutor-tray-row"><strong>Primary<\/strong>[\s\S]*?<\/div>/u)?.[0] ?? '';
  const button = row.match(/<button[^>]*data-tutor-role="support"[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? '';
  expect(button).not.toBe('');
  expect(map.slice(0, map.indexOf(button)).match(/<details\b/gu)).toHaveLength(1);
  expect(button).toMatch(/^<button\b/u);
  expect(button).toContain('data-command="updateTutorTarget"');
  expect(button).toContain(`aria-label="Make ${tutorTargetPathLabel(primaryNode.id)} a support target"`);
  // 2026-10-04: the owner replaced the shared Support glyph with a heavier panel glyph.
  expect(load(button)('svg g').attr('stroke-width')).toBe('3.4');
  expect(load(button)('svg path').attr('d')).toMatch(/^M15\.5 7\.4A4 4/u);
  expect(button).not.toContain(iconSvgMarkup('back'));
  const promote = map.match(/<button[^>]*data-tutor-role="primary"[^>]*title="Make primary"[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? '';
  // 2026-10-04: promotion retains the P geometry inside the owner's heavier stroke group.
  expect(load(promote)('svg g').attr('stroke-width')).toBe('3.4');
  expect(load(promote)('svg path').first().attr('d')).toBe('M9 5.5v13');
  // Inspect the control itself because its decorative SVG is correctly aria-hidden.
  const buttonTag = button.match(/^<button\b[^>]*>/u)![0];
  expect(buttonTag).not.toMatch(/disabled|tabindex="-1"|hidden/u);
  expect(row.indexOf(button)).toBeLessThan(row.indexOf('data-tutor-role="off"'));
  const targetId = button.match(/data-tutor-target="([^"]+)"/u)![1]!;
  const changed = changeTutorTarget(state.selection, targetId, 'support');
  expect(changed.refusal).toBeUndefined();
  expect(changed.selection).toEqual([
    { nodeId: supportNode.id, role: 'support' },
    { nodeId: primaryNode.id, role: 'support' }
  ]);
});

it.each(['primary', 'support'] as const)('V74 R3 omits the %s controls at the limit and states the limits once beside Compatibility', (role) => {
  const hubs = TUTOR_MAP.filter((node) => node.kind === 'hub');
  const state = changeTutorMapSelection(createTutorViewState(), 'hub', hubs[3]!.id);
  const otherRole = role === 'primary' ? 'support' : 'primary';
  state.selection = [
    ...hubs.slice(0, 3).map((node) => ({ nodeId: node.id, role })),
    { nodeId: hubs[4]!.id, role: otherRole }
  ];
  const output = html(state);
  // Changed 2026-10-01: dropdowns now follow the tray, so inspect only the tray itself.
  const tray = load(output)('.tutor-tray').prop('outerHTML')!;
  expect(new RegExp(`<button[^>]*data-tutor-role="${role}"`, 'u').test(tray)).toBe(false);
  const limit = '<p class="tutor-target-limits">Up to three Primary targets and three Support targets.</p>';
  expect(tray.split(limit)).toHaveLength(2);
  expect(tray).toContain(`</p>${limit}`);
  expect(tray.indexOf(limit)).toBeGreaterThan(tray.indexOf('<strong>Compatibility:</strong>'));
  expect(tray).not.toContain('tutor-map-reason');
  expect(tray).not.toContain('aria-disabled');
});

it('V74 R1 holds two Primaries in selection order with no Support created', () => {
  const [first, second] = TUTOR_MAP.filter((node) => node.kind === 'microTarget');
  const one = changeTutorTarget([], first!.id, 'primary');
  const two = changeTutorTarget(one.selection, second!.id, 'primary');
  expect(two.refusal).toBeUndefined();
  expect(two.selection).toEqual([
    { nodeId: first!.id, role: 'primary' },
    { nodeId: second!.id, role: 'primary' }
  ]);
});

it('V74 R1 holds three Primaries and carries all three in the recipe', () => {
  const hubs = TUTOR_MAP.filter((node) => node.kind === 'microTarget').slice(0, 3);
  const state = createTutorViewState();
  for (const node of hubs) {
    const changed = changeTutorTarget(state.selection, node.id, 'primary');
    expect(changed.refusal).toBeUndefined();
    state.selection = changed.selection;
  }
  expect(state.selection).toEqual(hubs.map((node) => ({ nodeId: node.id, role: 'primary' })));
  expect(tutorRecipeFromState(state).primaryTargets).toEqual(hubs.map((node) => node.id));
});

it('V74 R1 refuses a fourth Primary with its own limit reason', () => {
  const hubs = TUTOR_MAP.filter((node) => node.kind === 'hub');
  const selection = hubs.slice(0, 3).map((node) => ({ nodeId: node.id, role: 'primary' as const }));
  const changed = changeTutorTarget(selection, hubs[3]!.id, 'primary');
  expect(changed.selection).toEqual(selection);
  expect(changed.refusal).toBe('three primary targets is the limit');
  expect(tutorTargetActionReason(selection, hubs[3]!.id, 'primary')).toBe(changed.refusal);
});

it.each(['hub', 'cluster'] as const)('V75 refuses a %s beside another Primary in either order and omits promotion', (kind) => {
  const parent = TUTOR_MAP.find((node) => node.kind === kind)!;
  const exact = TUTOR_MAP.filter((node) => node.kind === 'microTarget').at(-1)!;
  const reason = 'A Hub or Cluster must be the only Primary because Explore chooses one child for the lesson.';
  for (const [first, second] of [[parent, exact], [exact, parent]]) {
    const state = createTutorViewState();
    state.selection = [{ nodeId: first!.id, role: 'primary' }, { nodeId: second!.id, role: 'support' }];
    state.mapPath = Object.fromEntries(tutorMapPathForNode(second!.id).map((node) => [node.kind, node.id]));
    const changed = changeTutorTarget(state.selection, second!.id, 'primary');
    expect(changed).toEqual({ selection: state.selection, refusal: reason });
    expect(tutorTargetActionReason(state.selection, second!.id, 'primary')).toBe(reason);
    const map = html(state).match(/<details[^>]*data-persist-id="tutor-map"[^>]*>[\s\S]*?<\/details>/u)![0];
    expect(map.match(/^<details[^>]*>/u)![0]).toContain(' open');
    expect(map).not.toMatch(new RegExp(`<button[^>]*data-tutor-target="${second!.id}"[^>]*data-tutor-role="primary"`, 'u'));
    // The explicit command reports the same reason in the visible selection status.
    state.selectionMessage = changed.refusal;
    expect(html(state)).toContain(`<p class="tutor-selection-footnote" role="status">${reason}</p>`);
  }
});

const settings: KrenPanelSettings = {
  userDictionaryEnabled: false,
  userDictionaryCaptureMode: 'llmOnly',
  userDictionaryFallbackOnMerriamWebsterNoMatch: false,
  userDictionaryProvider: 'gemini',
  userDictionaryModel: 'gemini-3.6-flash',
  userDictionaryAlternateModel: 'gemini-3.1-pro-preview',
  userDictionaryThinkingOrEffort: 'low',
  userDictionaryProfile: 'standard',
  userDictionaryFallbackEnabled: false,
  userDictionaryFallbackModel: 'gemini-3.5-flash',
  userDictionaryFallbackThinkingOrEffort: 'low',
  userDictionaryEntryLanguage: 'auto',
  userDictionaryIncludePronunciation: true,
  userDictionaryIncludeSynonyms: true,
  userDictionaryIncludeUsageNotes: true,
  userDictionaryNumberOfExamples: 2,
  userDictionaryIncludeTechnicalMeanings: true,
  userDictionarySmartWordCapture: true,
  rewriteOtherOutputLanguage: 'ko',
  openResultsAtStartup: false,
  translationProvider: 'googleCloudTranslation',
  translationSourceLanguage: 'auto',
  translationTargetLanguage: 'ko',
  translationRoutingProvider: 'gemini',
  translationModel: 'gemini-3.6-flash',
  translationAlternateModel: 'gemini-3.1-pro-preview',
  translationThinkingOrEffort: 'auto',
  translationProfile: 'standard',
  translationFallbackEnabled: false,
  translationFallbackModel: 'gemini-3.5-flash',
  translationFallbackThinkingOrEffort: 'low',
  grammarDialect: 'auto',
  grammarSmart: true,
  grammarAutoCheck: false,
  grammarAutoCheckDelayMs: 900,
  grammarCustomWordCount: 0,
  grammarIgnoredFindingCount: 0,
  explanationOutputLanguage: 'sameAsSource',
  explanationProvider: 'gemini',
  explanationModel: 'gemini-3.5-flash',
  explanationAlternateModel: 'gemini-3.1-pro-preview',
  explanationThinkingOrEffort: 'auto',
  explanationProfile: 'standard',
  explanationFallbackEnabled: true,
  explanationFallbackModel: 'gemini-3.5-flash',
  explanationFallbackThinkingOrEffort: 'low',
  rewriteProvider: 'gemini',
  rewriteModel: 'gemini-3.5-flash',
  rewriteAlternateModel: 'gemini-3.1-pro-preview',
  rewriteThinkingOrEffort: 'auto',
  rewriteFallbackEnabled: true,
  rewriteFallbackModel: 'gemini-3.5-flash',
  rewriteFallbackThinkingOrEffort: 'low',
  rewriteSourceLanguage: 'auto',
  rewriteModality: 'written',
  rewriteFunction: 'general',
  rewriteEnglishVariety: 'sameAsSource',
  geminiModel: 'gemini-3.6-flash',
  geminiThinkingLevel: 'auto',
  openAIModel: 'gpt-5.4',
  openAIReasoningEffort: 'low',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicEffort: 'low',
  rewriteProfile: 'standard',
  alternateModel: 'gemini-3.1-pro-preview',
  alternateThinkingLevel: 'low',
  alternateFallbackEnabled: true,
  alternateFallbackModel: 'gemini-3.6-flash',
  alternateFallbackThinkingLevel: 'low',
  tutorProvider: 'gemini',
  tutorModel: 'gemini-3.5-flash',
  tutorAlternateModel: 'gemini-3.1-pro-preview',
  tutorThinkingOrEffort: 'medium',
  tutorProfile: 'standard',
  tutorFallbackEnabled: false,
  tutorFallbackModel: 'gemini-3.5-flash',
  tutorFallbackThinkingOrEffort: 'low',
  tutorReadAloudProvider: 'edgeOnline',
  tutorEdgeReadAloudLocale: 'en-US',
  tutorEdgeReadAloudVoice: 'en-US-ChristopherNeural',
  tutorEdgeReadAloudRatePercent: 0,
  tutorReadAloudVoice: 'Microsoft David Desktop',
  tutorReadAloudRate: 0,
  tutorReadAloudVolume: 100,
  // 2026-10-21: V286 requires the tutor sentence pause default.
  tutorSentencePauseMilliseconds: 0,
  quickMenuRewriteVariant: 'all',
  rewriteDomain: 'general',
  rewriteFormality: 'preserve',
  rewriteVoice: 'preserve',
  rewriteStance: 'preserve',
  rewriteLength: 'preserve',
  rewritePerspective: 'preserve',
  rewriteRhetoricalMode: 'preserve',
  preserveFormatting: true,
  includeChangeNotes: false,
  rewriteCopyToClipboard: false,
  multiWordTranslationFallback: true,
  windowsNativePronunciation: true,
  geminiRetryEnabled: true,
  geminiRetryMaxAttempts: 4,
  languageModelRetryEnabled: true,
  languageModelRetryMaxAttempts: 3,
  ttsEnabled: true,
  readAloudVoice: '',
  readAloudRate: 0,
  readAloudVolume: 100,
  readAloudVoices: [],
  readAloudProvider: 'windowsLocal',
  edgeReadAloudLocale: 'auto',
  edgeReadAloudVoice: 'en-US-ChristopherNeural',
  edgeReadAloudRatePercent: 0,
  edgeReadAloudPythonCommand: 'python',
  translationDomain: 'general',
  explanationDomain: 'general',
  displayMode: 'hover',
  requestTimeoutMs: 45000,
  translationMaxCharacters: 5000,
  userDictionaryMaxImportEntries: 5000,
  extensionVersion: '1.4.2'
};

const leaves = TUTOR_MAP.filter((node) =>
  !TUTOR_MAP.some((candidate) => candidate.parentId === node.id)
);
const primaryNode = leaves[0]!;
const supportNode = leaves.find((node) => node.id !== primaryNode.id)!;

function selectedState(): TutorViewState {
  const state = createTutorViewState();
  state.selection = [
    { nodeId: primaryNode.id, role: 'primary' },
    { nodeId: supportNode.id, role: 'support' }
  ];
  return state;
}

function target(nodeId: string, role: TrainingTargetRole): ResolvedTrainingTarget {
  const node = TUTOR_MAP.find((candidate) => candidate.id === nodeId)!;
  return {
    nodeId,
    label: node.label,
    kind: node.kind,
    role,
    description: node.description
  };
}

function example(index: number): TrainingExample {
  return {
    id: `example-${index}`,
    sentence: `Today our careful team uses this clear English pattern in example number ${index}.`,
    targetIds: [primaryNode.id, supportNode.id],
    annotations: [{
      targetId: primaryNode.id,
      excerpt: 'clear English pattern',
      explanation: `Explanation ${index}`
    }]
  };
}

function lesson(exampleCount = 6): TutorLesson {
  return {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    lessonTitle: '<script>Target lesson</script>',
    level: 'B2',
    primaryTarget: target(primaryNode.id, 'primary'),
    supportingTargets: [target(supportNode.id, 'support')],
    conceptExplanation: 'A concise concept.',
    patternStatement: 'Each sentence shows the two targets working together.',
    interactionExplanation: 'The two targets work together.',
    rules: [{ statement: 'Use the pattern deliberately.', status: 'rule' }],
    examples: Array.from({ length: exampleCount }, (_, index) => example(index + 1)),
    commonErrors: [],
    practice: [],
    answerKey: [],
    generationNotes: []
  };
}

function html(
  state: TutorViewState,
  extra: {
    focusTutorTargetId?: string;
    tutorAnnouncement?: string;
    focusTutorResult?: 'lesson' | 'exercises';
  } = {}
): string {
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings,
    activeScreen: 'tutor',
    tutor: state,
    proModels: [],
    ...extra
  });
}

// Execute the shipped disclosure restoration and toggle handler against lesson markup.
function lessonReader(state: TutorViewState, restored: Record<string, boolean> = {}) {
  const output = html(state);
  const lessonStart = output.indexOf('<article class="tutor-lesson"');
  // The lesson may contain nested example articles, so balance the article tags.
  let depth = 0;
  let end = lessonStart;
  for (const match of output.slice(lessonStart).matchAll(/<article\b[^>]*>|<\/article>/gu)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) { end = lessonStart + match.index! + match[0].length; break; }
  }
  const lessonMarkup = output.slice(lessonStart, end);
  class Details {
    open: boolean;
    constructor(readonly original: string, readonly tag: string) { this.open = /\sopen(?:\s|>)/u.test(tag); }
    getAttribute(name: string) { return this.tag.match(new RegExp(`${name}="([^"]*)"`, 'u'))?.[1] ?? ''; }
    serialize() {
      return this.original.replace(this.tag, this.tag.replace(/\sopen(?=\s|>)/gu, '').replace(/>$/u, this.open ? ' open>' : '>'));
    }
  }
  const sections = [...lessonMarkup.matchAll(/(<details\b[^>]*>)[\s\S]*?<\/details>/gu)].map(([whole, tag]) => new Details(whole, tag!));
  let saved = { openSections: { ...restored } };
  let onToggle: (event: { target: Details }) => void = () => {};
  const script = output.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/u)![1]!;
  runInNewContext(script.slice(0, script.indexOf('const activeScreen =')), {
    acquireVsCodeApi: () => ({ getState: () => saved, setState: (value: typeof saved) => { saved = value; } }),
    HTMLDetailsElement: Details,
    document: {
      // Changed 2026-10-21 (owner, I56/I57): this disclosure-only adapter has no Conversation entry row.
      querySelector: () => null,
      querySelectorAll: () => sections,
      addEventListener: (name: string, handler: typeof onToggle, capture: boolean) => {
        expect(name).toBe('toggle');
        expect(capture).toBe(true);
        onToggle = handler;
      }
    }
  });
  return {
    output, sections,
    saved: () => saved.openSections,
    markup: () => sections.reduce((markup, section) => markup.replace(section.original, section.serialize()), lessonMarkup),
    toggle: (section: Details, open: boolean) => { section.open = open; onToggle({ target: section }); }
  };
}

function readerState(): TutorViewState {
  const state = selectedState();
  const drafted = lesson();
  drafted.examples[1]!.id = 'model-own-id<&"';
  drafted.commonErrors = Array.from({ length: 3 }, (_, i) => ({ id: `error-${i}`,
    incorrect: `Incorrect ${i}`, corrected: `Corrected ${i}`, explanation: `Reason ${i}`, status: 'rule' as const }));
  drafted.practice = Array.from({ length: 6 }, (_, i) => ({ id: `practice-${i}`, channel: 'written' as const,
    prompt: `Exercise ${i}`, targetIds: [primaryNode.id] }));
  drafted.answerKey = Array.from({ length: 6 }, (_, i) => ({ id: `answer-${i}`, exerciseId: `practice-${i}`,
    answer: `Unrequested secret answer ${i}`, explanation: `Unrequested answer reason ${i}` }));
  state.lesson = { recipe: tutorRecipeFromState(state), lesson: drafted, findings: [] };
  return state;
}

function readerCommands(markup: string): string[] {
  return [...markup.matchAll(/data-command="(playTutorExample|copyTutorExample|openTutorTool|regenerateTutorExample)"/gu)].map((match) => match[1]!);
}

it('V84 R1 renders exactly one sentence across the whole lesson and paging changes it', () => {
  let state = readerState();
  for (let index = 0; index < 6; index++) {
    const markup = lessonReader(state).markup();
    const plain = markup.replace(/<[^>]*>/gu, '');
    expect(markup.match(/data-tutor-example-card=/gu)).toHaveLength(1);
    // Count actual sentences everywhere, not only in the intended card or heading.
    const sentences = state.lesson!.lesson.examples.flatMap((item) => plain.split(item.sentence).slice(1).map(() => item.sentence));
    expect(sentences).toEqual([state.lesson!.lesson.examples[index]!.sentence]);
    expect(markup).toContain(`<h3 class="tutor-item-heading">${index + 1}. Today our careful team uses this <strong class="tutor-taught">clear English pattern</strong> in example number ${index + 1}.</h3>`);
    const card = markup.match(/<article[^>]*data-tutor-example-card[^>]*>[\s\S]*?<\/article>/u)![0];
    expect(card).toContain(`Explanation ${index + 1}`);
    expect(card).not.toMatch(/<details|\shidden|display:\s*none/u);
    // Changed 2026-09-30: V175 puts navigation immediately after the sentence and explanation card.
    const controls = load(markup)('[data-tutor-example-card]').next('.tutor-example-controls');
    expect(controls.text()).toContain(`${index + 1} / 6`);
    expect(controls.find('[aria-label="Lesson example navigation"]')).toHaveLength(1);
    state = moveTutorExample(state, 1);
  }
});

it('V84 R1 keeps boundary arrows visible and disabled', () => {
  const state = readerState();
  const first = lessonReader(state).markup();
  // Changed 2026-09-30: boundary arrows hold their positions while unavailable.
  expect(load(first)('[data-command="showPreviousTutorExample"][disabled][aria-disabled="true"]')).toHaveLength(1);
  expect(load(first)('[data-command="showNextTutorExample"]:not([disabled])')).toHaveLength(1);
  state.currentExampleIndex = 5;
  const last = lessonReader(state).markup();
  expect(load(last)('[data-command="showPreviousTutorExample"]:not([disabled])')).toHaveLength(1);
  expect(load(last)('[data-command="showNextTutorExample"][disabled][aria-disabled="true"]')).toHaveLength(1);
});

it('V84 R1 keeps six tools with their existing icon names and the current example identifier', () => {
  let state = readerState();
  for (let index = 0; index < 6; index++) {
    const markup = lessonReader(state).markup();
    expect(readerCommands(markup)).toEqual(['playTutorExample', 'copyTutorExample', 'openTutorTool', 'openTutorTool', 'openTutorTool', 'regenerateTutorExample']);
    const buttons = [...markup.matchAll(/<button[^>]*data-tutor-example="[^"]*"[^>]*>[\s\S]*?<\/button>/gu)].map(([button]) => button);
    expect(buttons).toHaveLength(6);
    const id = state.lesson!.lesson.examples[index]!.id.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    for (const [position, icon] of (['speaker', 'copy', 'dictionary', 'translate', 'ask', 'regenerate'] as const).entries()) {
      expect(buttons[position]).toContain(iconSvgMarkup(icon));
      expect(buttons[position]).toContain(`data-tutor-example="${id}"`);
      expect(buttons[position]!.match(/^<button[^>]*>/u)![0]).not.toMatch(/disabled|tabindex="-1"|hidden/u);
    }
    state = moveTutorExample(state, 1);
  }
});

it('V84 R2 states the identical labelled pattern above every example', () => {
  let state = readerState();
  const pattern = `<p data-tutor-lesson-pattern><strong>Pattern:</strong> ${state.lesson!.lesson.patternStatement}</p>`;
  for (let index = 0; index < 6; index++) {
    const markup = lessonReader(state).markup();
    expect(markup.match(/<p data-tutor-lesson-pattern>[\s\S]*?<\/p>/gu)).toEqual([pattern]);
    expect(markup.indexOf(pattern)).toBeLessThan(markup.indexOf('data-tutor-example-card'));
    state = moveTutorExample(state, 1);
  }
});

it('V84 R2 omits the entire pattern line without a container or placeholder when missing', () => {
  const state = readerState();
  const withPattern = lessonReader(state).markup();
  const line = withPattern.match(/<p data-tutor-lesson-pattern>[\s\S]*?<\/p>/u)![0];
  for (const missing of [undefined, '', '   ']) {
    state.lesson!.lesson.patternStatement = missing;
    const markup = lessonReader(state).markup();
    expect(markup).toBe(withPattern.replace(line, ''));
    expect(markup).not.toContain('data-tutor-lesson-pattern');
    expect(markup).not.toContain('Pattern:');
  }
});

it('V165 ignores a previously enabled practice setting in both subject modes', () => {
  for (const questionOnly of [false, true]) for (const practice of [false, true]) for (const legacy of [false, true]) {
    const state = readerState();
    Object.assign(state.settings, { questionOnly, includePractice: practice, includeAnswerKey: legacy });
    state.question = 'How does this pattern work?';
    expect(html(state)).not.toContain('Include answer key');
    expect(html(state)).not.toContain('data-setting="tutor.includeAnswerKey"');
    // Changed 2026-09-26: lesson requests omit practice even when an older session stored it on.
    expect(tutorRecipeFromState(state).output.includePractice).toBe(false);
    expect(tutorRecipeFromState(state).output.includeAnswerKey).toBe(false);
    const recipe = html(state).match(/<dt>Include<\/dt><dd>(.*?)<\/dd>/u)?.[1];
    expect(recipe).not.toContain('practice');
    expect(recipe).not.toContain('answer key');
  }
});

it('V87 R5 keeps regeneration cancellation in the overlay from any example position', () => {
  const state = readerState();
  state.exampleBusyIds = ['example-4', 'example-6'];
  for (const id of [...state.exampleBusyIds]) {
    const reader = lessonReader(state);
    const overlay = reader.output.match(/<div class="busy-overlay"[\s\S]*?<\/div><\/div>/u)![0];
    expect(reader.markup()).toContain('data-tutor-example-card="example-1"');
    expect(overlay).toContain(`data-tutor-example="${id}"`);
    const cancel = overlay.match(/<button[^>]*data-command="cancelTutorExample"[^>]*>/u)![0];
    expect(cancel).not.toMatch(/disabled|tabindex="-1"|hidden/u);
    expect(reader.markup()).not.toContain('data-command="cancelTutorExample"');
    state.exampleBusyIds.shift();
  }
});

it('V81 R3 renders CONCEPT AND RULES closed by default and retains an explicit open choice', () => {
  const reader = lessonReader(readerState());
  const section = reader.sections.find((candidate) => candidate.getAttribute('data-persist-id') === 'tutor-lesson-explanation')!;
  expect(section.original).toContain('>CONCEPT AND RULES</span>');
  expect(section.tag).not.toMatch(/\sopen(?:\s|>)/u);
  const restored = lessonReader(readerState(), { 'tutor-lesson-explanation': true });
  expect(restored.sections.find((candidate) => candidate.getAttribute('data-persist-id') === 'tutor-lesson-explanation')!.open).toBe(true);
});

it.each([1, 6])('V81 R4 folds closing sections with exact summary counts for %i answers and exercises', (count) => {
  const state = readerState();
  state.lesson!.lesson.practice = state.lesson!.lesson.practice!.slice(0, count);
  state.lesson!.lesson.answerKey = state.lesson!.lesson.answerKey!.slice(0, count);
  state.lesson!.lesson.commonErrors = state.lesson!.lesson.commonErrors.slice(0, Math.min(3, count));
  const reader = lessonReader(state);
  for (const [id, label, size, noun] of [
    ['errors', 'COMMON ERRORS', Math.min(3, count), 'error'],
    ['practice', 'Lesson practice', count, 'exercise']
  ] as const) {
    const section = reader.sections.find((candidate) => candidate.getAttribute('data-persist-id') === `tutor-lesson-${id}`)!;
    expect(section.tag).not.toMatch(/\sopen(?:\s|>)/u);
    const summary = section.original.match(/<summary[^>]*>[\s\S]*?<\/summary>/u)![0];
    expect(summary).toContain(`<span class="rewrite-group-name">${label}</span>`);
    expect(summary).toContain(`<span class="rewrite-group-summary">${size} ${noun}${size === 1 ? '' : 's'}</span>`);
  }
});

it.each([false, true])('V84 R3 R4 omits answer text from all markup with disclosure open: %s until Show answers is requested', (open) => {
  const state = readerState();
  for (const requested of [false, true]) {
    state.lessonAnswersVisible = requested;
    const reader = lessonReader(state, { 'tutor-lesson-practice': open });
    const section = reader.sections.find((candidate) => candidate.getAttribute('data-persist-id') === 'tutor-lesson-practice')!;
    expect(section.open).toBe(open);
    for (const answer of state.lesson!.lesson.answerKey!) {
      expect(reader.output.includes(answer.answer)).toBe(requested);
      expect(reader.output.includes(answer.explanation)).toBe(requested);
      expect(reader.markup().includes(answer.answer)).toBe(requested);
    }
    expect(section.serialize().includes('data-command="showTutorAnswers"')).toBe(!requested);
  }
});

it('V84 retains V81 reading without a score or completion state at every position', () => {
  let state = readerState();
  for (let index = 0; index < 6; index++) {
    expect(lessonReader(state).markup()).not.toMatch(/<progress\b|role="progressbar"|\bscore\b|\bcompletion\b|\bcompleted?\b|mark[ -]as[ -]read/iu);
    state = moveTutorExample(state, 1);
  }
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

// Count direct element children, including decorative elements, but not nested SVG paths.
function gridChildCount(row: string): number {
  let depth = 0;
  let children = 0;
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of row.matchAll(/<(\/?)([a-z][\w:-]*)\b[^>]*>/giu)) {
    const [, closing, name] = match;
    if (closing) {
      depth -= 1;
    } else {
      if (depth === 1) children += 1;
      if (!voidElements.has(name!.toLowerCase()) && !match[0].endsWith('/>')) depth += 1;
    }
  }
  expect(depth, 'the complete grid row must have balanced elements').toBe(0);
  return children;
}

describe('AI English Tutor page', () => {
  function reportDrawer(state: TutorViewState): string {
    return html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
  }

  /*
   * The owner asked for filled bullets aligned with Primary and Support, and for the numbers
   * to line up with the report's paragraphs. A nested list defaults to hollow circles and to
   * a second level of indent, so both are stated rather than inherited.
   */
  /*
   * The reader asked for the target bullets to line up with the detail bullets, and for the
   * roles to be bold. Asserted as agreement between the two lists rather than as a number,
   * because a number in a test is one more place for them to drift apart.
   */
  it('gives both report lists one marker position, and bolds the target roles', () => {
    const state = selectedState();
    state.diagnosticReport = { findings: [], targets: [{ nodeId: primaryNode.id, role: 'primary' }] };
    state.diagnosticReportDrawerOpen = true;
    const output = html(state);
    const shared = output.match(/\.tutor-report-details, \.tutor-report-targets, \.tutor-missed-details \{[^}]*\}/u)?.[0] ?? '';
    for (const declaration of ['padding-left: 0', 'list-style: disc inside', 'margin-block: 0']) {
      expect(shared).toContain(declaration);
    }
    // The nested list cancels the numbered list's indent; the direct child has none to cancel.
    // A quarter em past cancelling the numbered indent, so discs sit under the numbers.
    expect(output).toContain('.tutor-report-details { margin-left: -0.95em; }');
    expect(output).toContain('.tutor-report-targets { margin-left: .25em; }');
    expect(output).toContain('<ul class="tutor-report-targets">');
    expect(output).toContain('<li><strong>Primary:</strong> ');
  });

  it('V79 R1 numbers findings and keeps joined evidence in one uninterrupted bullet list', () => {
    const state = selectedState();
    state.diagnosticReport = { findings: [{ level: 2, observation: 'Match the verb to the subject.',
      evidence: 'is the major issues', correction: 'are the major issues', targetId: primaryNode.id }], targets: [] };
    state.diagnosticReportDrawerOpen = true;
    const drawer = reportDrawer(state);
    const findings = drawer.match(/<section aria-label="Findings">([\s\S]*?)<\/section>/u)![1]!;
    expect(findings.startsWith('<h3>Findings</h3><ol><li><p>Match the verb to the subject.</p>')).toBe(true);
    expect(findings.endsWith('</li></ol>')).toBe(true);
    const details = findings.match(/<ul class="tutor-report-details">([\s\S]*?)<\/ul>/u)![1]!;
    expect(details).toBe('<li><strong>Evidence from your words:</strong> <q>is the major issues</q> (Incorrect but understandable)</li>' +
      '<li><strong>Correction:</strong> are the major issues</li>' +
      `<li><strong>Target:</strong> ${primaryNode.label}</li>`);
    expect(findings.includes('<p>Incorrect but understandable</p>')).toBe(false);
    expect(findings.match(/Incorrect but understandable/gu)).toHaveLength(1);
  });

  it.each([false, true])('V79 R1 numbers suggestions with uninterrupted detail bullets, target present: %s', (withTarget) => {
    const state = selectedState();
    state.diagnosticReport = { findings: [], targets: [], polish: [{ evidence: 'a good result',
      suggestion: 'a strong result', reason: 'Strong is more precise.',
      ...(withTarget ? { targetId: primaryNode.id } : {}) }] };
    state.diagnosticReportDrawerOpen = true;
    const section = reportDrawer(state).match(/<section aria-label="Naturalness suggestions">([\s\S]*?)<\/section>/u)![1]!;
    expect(section.includes('<ol><li><p><strong>Evidence from your words:</strong> <q>a good result</q></p><ul class="tutor-report-details">')).toBe(true);
    expect(section.endsWith('</ul></li></ol>')).toBe(true);
    const details = section.match(/<ul class="tutor-report-details">([\s\S]*?)<\/ul>/u)![1]!;
    expect(details).toBe('<li><strong>Suggestion:</strong> a strong result</li><li><strong>Why:</strong> Strong is more precise.</li>' +
      (withTarget ? `<li><strong>Target:</strong> ${primaryNode.label}</li>` : ''));
  });

  it.each([1, 3])('V79 R1 keeps %i conversation turns inside the evidence level parenthesis', (turnCount) => {
    const state = selectedState();
    state.diagnosticReport = { findings: [{ level: 2, observation: 'Match the verb.',
      evidence: 'is the major issues', turnCount }], targets: [] };
    state.diagnosticReportSource = { kind: 'conversation', turnCount: 5 };
    state.diagnosticReportDrawerOpen = true;
    const drawer = reportDrawer(state);
    const details = drawer.match(/<ul class="tutor-report-details">([\s\S]*?)<\/ul>/u)![1]!;
    expect(details).toBe('<li><strong>Evidence from your words:</strong> <q>is the major issues</q> ' +
      `(Incorrect but understandable; appeared in ${turnCount} turn${turnCount === 1 ? '' : 's'})</li>`);
    expect(drawer.match(/appeared in/gu)).toHaveLength(1);
  });

  it('V79 R1 gives report detail lists and their bullets zero added vertical spacing', () => {
    const output = html(createTutorViewState());
    /*
     * Scoped to the declarations this test is named after. It pinned the whole rule as one
     * string, so adding the owner's bullet styling to the same rule broke a guard about
     * vertical spacing, which that styling does not touch.
     */
    const rule = output.match(/\.tutor-report-details, \.tutor-report-targets, \.tutor-missed-details \{[^}]*\}/u)?.[0] ?? '';
    expect(rule).toContain('margin-block: 0');
    // Changed 2026-09-16: report bullets stay at zero while missed details gain measured spacing.
    expect(output).toContain('.tutor-report-details > li { margin: 0; padding: 0; }');
    expect(output).toContain('.tutor-missed-details > li { margin: 0; margin-left: 3px; padding: 0; }');
    expect(output).toContain('.tutor-missed-details > li:first-child { margin-top: 7px; }');
  });

  it('V79 R2 hides the protocol throughout the drawer while retaining its report field', () => {
    const state = selectedState();
    state.diagnosticReport = tutorDiagnosticReport({ findings: [], targets: [] }, 'Some words.');
    expect(state.diagnosticReport.protocolVersion).toBe(1);
    state.diagnosticReportDrawerOpen = true;
    expect(reportDrawer(state).includes('Diagnostic protocol')).toBe(false);
    expect(state.diagnosticReport.protocolVersion).toBe(1);
  });

  it('V79 R3 explains the empty panel routes and exposes the map and Ask to the keyboard', () => {
    const output = html(createTutorViewState());
    const status = output.match(/<p id="tutor-action-readiness"[^>]*>(.*?)<\/p>/u)![1]!;
    expect(status).toBe('Open the learning map, select or search learning map targets. Alternatively, type a question or select text from the editor to initiate a model-based lesson and practice.');
    expect(status).toContain('learning map');
    expect(output.includes('Select a primary target')).toBe(false);
    expect(status).not.toMatch(/files|text\/files/u);
    const map = output.match(/<details[^>]*data-persist-id="tutor-map"[^>]*>[\s\S]*?<\/details>/u)![0];
    expect(map.match(/^<details[^>]*>/u)![0]).toContain(' open');
    const search = map.match(/<textarea[^>]*data-tutor-map-search[^>]*>/u)![0];
    expect(search).not.toMatch(/disabled|hidden|tabindex="-1"/u);
    for (const command of ['findTutorTargets', 'askTutorQuestion']) {
      const button = map.match(new RegExp(`<button[^>]*data-command="${command}"[^>]*>`, 'u'))![0];
      expect(button).not.toMatch(/disabled|hidden|tabindex="-1"/u);
      expect(map.slice(0, map.indexOf(button)).match(/<details\b/gu)).toHaveLength(1);
    }
    expect(map).toContain('data-command="updateTutorMapPath"');
  });

  it('V76 R1 names all three finding levels without raw level numbers', () => {
    const state = selectedState();
    state.diagnosticReport = { findings: [1, 2, 3].map((level) => ({
      level, observation: 'A pattern to correct.', evidence: 'words'
    })), targets: [] };
    state.diagnosticReportDrawerOpen = true;
    const drawer = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
    expect(drawer).not.toMatch(/Level\s+\d/u);
    for (const label of ['Blocks meaning', 'Incorrect but understandable']) {
      expect(drawer).toContain(`<q>words</q> (${label})</li>`);
      expect(drawer).not.toContain(`<p>${label}</p>`);
    }
  });

  it.each([{ label: 'missing', polish: undefined }, { label: 'empty', polish: [] }])(
    'V76 R2 omits the entire polish section for a $label list', ({ polish }) => {
      const state = selectedState();
      state.diagnosticReport = { findings: [], targets: [], polish };
      state.diagnosticReportDrawerOpen = true;
      const drawer = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
      expect(drawer).not.toContain('Naturalness suggestions');
      expect(drawer).not.toContain('Suggestion:');
      expect(drawer).not.toContain('Your English here is already correct.');
    });

  it.each(['none', 'lesson', 'exercises'].flatMap((outputKind) =>
    [false, true].map((hasReport) => ({ outputKind, hasReport }))))(
    'V78 R1 R2 keeps one reachable report opener and matches tracks to grid children with $outputKind and report: $hasReport', ({ outputKind, hasReport }) => {
    const state = selectedState();
    if (outputKind === 'lesson') state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    if (outputKind === 'exercises') state.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written', exercises: [] };
    if (hasReport) state.diagnosticReport = { findings: [], targets: [] };
    const output = html(state);
    const map = output.match(/<details[^>]*data-persist-id="tutor-map"[^>]*>[\s\S]*?<\/details>/u)![0];
    expect(map.match(/^<details[^>]*>/u)![0].includes(' open')).toBe(hasReport || outputKind === 'none');
    const row = map.match(/<div class="tutor-map-search-row">[\s\S]*?<\/div>/u)![0];
    expect(map.slice(0, map.indexOf(row)).match(/<details\b/gu)).toHaveLength(1);
    const commands = [...row.matchAll(/data-command="([^"]+)"/gu)].map((match) => match[1]);
    expect(commands).toEqual(['findTutorTargets', 'askTutorQuestion', 'openTutorPreparedPrompt',
      ...(hasReport ? ['openTutorDiagnosticReport'] : []), 'clearTutorSearch']);
    const children = gridChildCount(row);
    const template = output.match(/\.tutor-map-search-row \{[^}]*grid-template-columns:\s*([^;]+);/u)![1]!;
    expect(template.match(/minmax\([^)]*\)|[^\s]+/gu)).toHaveLength(children);
    expect(output.match(/data-command="openTutorDiagnosticReport"/gu) ?? []).toHaveLength(hasReport ? 1 : 0);
    const openers = output.match(/<button[^>]*data-command="openTutorDiagnosticReport"[^>]*>[\s\S]*?<\/button>/gu) ?? [];
    if (hasReport) {
      const opener = openers[0]!;
      expect(row).toContain(opener);
      expect(opener).toContain('aria-label="View diagnostic report"');
      expect(opener).toContain('title="View diagnostic report"');
      expect(opener).toContain('class="icon-button tutor-action-icon"');
      expect(opener).toContain(iconSvgMarkup('document'));
      expect(opener.match(/^<button[^>]*>/u)![0]).not.toMatch(/hidden|disabled|tabindex="-1"/u);
    }
  });

  it.each([undefined, 'lesson', 'exercises'].flatMap((focusTutorResult) =>
    [false, true].map((hasReport) => ({ focusTutorResult, hasReport }))))(
    'V78 R1 preserves report reachability through saved closure and focus $focusTutorResult with report: $hasReport', ({ focusTutorResult, hasReport }) => {
      const state = selectedState();
      state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
      if (hasReport) state.diagnosticReport = { findings: [], targets: [] };
      const output = html(state, { focusTutorResult: focusTutorResult as 'lesson' | 'exercises' | undefined });
      class Details {
        open: boolean;
        constructor(readonly id: string) {
          this.open = output.match(new RegExp(`<details[^>]*data-persist-id="${id}"[^>]*>`, 'u'))![0].includes(' open');
        }
        getAttribute() { return this.id; }
      }
      const sections = ['map', 'lesson', 'setting', 'recipe'].map((id) => new Details(`tutor-${id}`));
      let saved = { openSections: Object.fromEntries(sections.map((section) => [section.id, false])) };
      const script = output.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/u)![1]!;
      // Execute the shipped restoration and generation-focus code, stopping before unrelated handlers.
      runInNewContext(script.slice(0, script.indexOf('const focusTutorTarget =')), {
        acquireVsCodeApi: () => ({ getState: () => saved, setState: (value: typeof saved) => { saved = value; } }),
        HTMLDetailsElement: Details, HTMLElement: Details,
        document: {
          querySelectorAll: (selector: string) => selector === 'details[data-persist-id]' || selector === 'details[data-tutor-parent]' ? sections : [],
          querySelector: (selector: string) => selector === '[data-command="openTutorDiagnosticReport"]'
            ? output.match(/<button[^>]*data-command="openTutorDiagnosticReport"[^>]*>/u)?.[0] : undefined,
          addEventListener() {}, fonts: { ready: Promise.resolve() },
          body: { getAttribute: (name: string) => name === 'data-active-screen' ? 'tutor'
            : name === 'data-focus-tutor-result' ? focusTutorResult : undefined }
        },
        window: { addEventListener() {} }
      });
      expect(sections[0]!.open).toBe(hasReport);
      expect(sections.slice(1).map((section) => section.open)).toEqual([false, false, false]);
      if (focusTutorResult) expect(saved.openSections['tutor-map']).toBe(hasReport);
    });

  it.each([1, 5])('V76 R2 renders separate findings and polish sections with %i findings', (count) => {
    const state = selectedState();
    state.diagnosticReport = tutorDiagnosticReport({
      findings: Array.from({ length: count }, (_, index) => ({
        level: 2, observation: `Correct pattern ${index}.`, evidence: `error ${index}`
      })),
      polish: [{ evidence: 'a good result', suggestion: 'a strong result',
        reason: 'Strong describes the result more precisely.', targetId: primaryNode.id }]
    }, 'error 0 error 1 error 2 error 3 error 4 and a good result.');
    expect(state.diagnosticReport.findings).toHaveLength(count);
    expect(state.diagnosticReport.polish).toHaveLength(1);
    state.diagnosticReportDrawerOpen = true;
    const drawer = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
    const findings = drawer.match(/<section aria-label="Findings">[\s\S]*?<\/section>/u)?.[0] ?? '';
    const polish = drawer.match(/<section aria-label="Naturalness suggestions">[\s\S]*?<\/section>/u)?.[0] ?? '';
    expect(gridChildCount(findings.match(/<ol>[\s\S]*<\/ol>/u)![0])).toBe(count);
    expect(polish).toContain('<h3>Naturalness suggestions</h3>');
    expect(polish).toContain('Your English here is already correct. These are optional ways to make it more natural.');
    expect(polish).toContain('<q>a good result</q>');
    expect(polish).toContain('<strong>Suggestion:</strong> a strong result');
    expect(polish).toContain('<strong>Why:</strong> Strong describes the result more precisely.');
    expect(polish).toContain(`<strong>Target:</strong> ${primaryNode.label}`);
    expect(findings).not.toContain('a strong result');
    expect(polish).not.toContain('Correct pattern');
  });

  it.each([false, true])('V87 R3 renders spaced Apply Delete and Back to tutor with targets: %s', (hasTargets) => {
    const state = selectedState();
    state.diagnosticReport = { findings: [], targets: hasTargets ? state.selection : [] };
    state.diagnosticReportDrawerOpen = true;
    const output = html(state);
    const drawer = output.match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
    const cancel = '<button type="button" class="secondary" data-command="cancelTutorDiagnosticReport">Delete</button>';
    expect(drawer).toContain(cancel);
    expect(drawer.match(/data-command="closeTutorDiagnosticReport"/gu)).toHaveLength(1);
    const actions = drawer.match(/<div class="settings-buttons">[\s\S]*?<\/div>/u)?.[0] ?? '';
    expect(actions.match(/data-command="([^"]+)"/gu)).toEqual([
      ...(hasTargets ? ['data-command="applyTutorDiagnosticReport"'] : []),
      'data-command="cancelTutorDiagnosticReport"', 'data-command="closeTutorDiagnosticReport"'
    ]);
    expect(actions).toContain('>Back to tutor</button>');
    const style = output.match(/\.settings-buttons \{([^}]+)\}/u)![1]!;
    expect(style).toContain('display: flex');
    expect(style).toMatch(/gap: [1-9]\d*px/u);
    if (!hasTargets) expect(output.match(/data-command="applyTutorDiagnosticReport"/gu) ?? []).toEqual([]);
    // Native buttons outside disclosures have no hidden ancestor or keyboard exclusion.
    expect(drawer).not.toMatch(/<details|\bhidden\b|aria-hidden|tabindex="-1"|\bdisabled\b/u);
    const prefix = output.slice(output.indexOf('<div class="tutor-content">'), output.indexOf(drawer));
    expect((prefix.match(/<details\b/gu) ?? []).length).toBe((prefix.match(/<\/details>/gu) ?? []).length);
    if (hasTargets) {
      expect(drawer).toContain('<button type="button" data-command="applyTutorDiagnosticReport">Apply</button>' + cancel);
    } else {
      expect(drawer).toContain('No learning-map targets were proposed.');
      // Inspect all markup, including hidden controls, not only visible text.
    }
  });

  it('V72 R6 correction reaches the drawer while a finding without it keeps observation and evidence', () => {
    const state = selectedState();
    state.diagnosticReport = tutorDiagnosticReport({ findings: [
      { level: 2, observation: 'Use a past form.', evidence: 'I go', correction: '  I went <there>  ' },
      { level: 2, observation: 'Keep the time phrase.', evidence: 'yesterday' }
    ] }, 'I go yesterday.');
    state.diagnosticReportDrawerOpen = true;
    const drawer = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
    expect(drawer).toContain('<strong>Correction:</strong> I went &lt;there&gt;');
    expect(drawer.match(/<strong>Correction:<\/strong>/gu)).toHaveLength(1);
    expect(drawer).toContain('Keep the time phrase.');
    expect(drawer).toContain('<q>yesterday</q>');
  });

  it('V67 R1 makes the selection status a footnote without the warning class', () => {
    const state = selectedState();
    state.selectionMessage = 'The model chose these learning-map targets for this question.';
    const output = html(state);
    const footnote = output.match(/<p[^>]*>The model chose these learning-map targets for this question\.<\/p>/u)?.[0] ?? '';
    expect(footnote).not.toMatch(/\btutor-message\b/u);
    expect(footnote).toContain('class="tutor-selection-footnote"');
    expect(footnote).toContain('role="status"');
    const style = output.match(/\.tutor-selection-footnote\s*\{([^}]+)\}/u)?.[1];
    expect(style).toContain('font-size: 0.9em');
    expect(style).toContain('color: var(--vscode-descriptionForeground)');
    expect(style).toContain('border: none');
    expect(style).toContain('background: none');
  });

  it('V148 keeps reset confirmation accessible without a visible page-foot message', () => {
    const state = selectedState();
    state.question = 'An explicit question.';
    state.preparedPrompt = 'An editable prompt.';
    state.preparedPromptDrawerOpen = true;
    state.preparedPromptNotice = 'A replacement notice.';
    const output = html(state, { tutorAnnouncement: 'A live announcement.' });
    const messages = output.match(/<p class="tutor-message"[^>]*>[\s\S]*?<\/p>/gu) ?? [];
    // Changed 2026-09-24: reset confirmation moved to a host dialog. The status consumer
    // remains for screen readers, but it is no longer a visible tutor-message at page foot.
    // Changed 2026-10-15: V246, owner item I19, provider switches use the popup, so remove the leftover banner.
    expect(messages).toHaveLength(2);
    expect(messages.some(message => message.includes('data-provider-switch-notice'))).toBe(false);
    expect(messages).toContain('<p class="tutor-message"><strong>Lesson question:</strong> An explicit question.</p>');
    expect(messages).toContain('<p class="tutor-message" role="status">A replacement notice.</p>');
    expect(output).toContain('<p class="tutor-screen-reader-status" data-tutor-live role="status" aria-live="polite"></p>');
    expect(output).toContain('.tutor-screen-reader-status { position: absolute; width: 1px;');
  });

  it('V67 R2 omits nextQuestion text from the completed learner turn including hidden markup', () => {
    const state = selectedState();
    const nextQuestion = 'Which unique book did you read there?';
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'active', recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [{ question: 'What happened?', learnerAnswer: 'I go yesterday.',
        correction: 'I went yesterday.', explanation: 'Use the past tense.', nextQuestion }],
      currentTurnIndex: 0, currentQuestion: nextQuestion, draftAnswer: '', busy: false
    };
    const output = renderTutorConversation(state);
    const learnerTurn = load(output)('[data-tutor-learner-turn="0"]');
    // Changed 2026-09-25 for V152: the owner reversed V148. The correction is plain feedback
    // inside this turn, outside the reader's own blue bubble.
    expect(learnerTurn.find('[data-tutor-turn-feedback] > [data-tutor-correction]').text())
      .toBe('I went yesterday.');
    expect(learnerTurn.children('.tutor-chat-learner').find('[data-tutor-correction]')).toHaveLength(0);
    expect(learnerTurn.text()).not.toContain(nextQuestion);
    expect(output).toContain(nextQuestion);
  });

  it('V76 R4 keeps the report opener in the search row and renders every finding with evidence', () => {
    const state = selectedState();
    state.diagnosticReport = {
      summary: 'You describe a past event. Your time phrase is clear.',
      findings: [{ level: 2, observation: 'Use the past tense.', evidence: 'I go', targetId: primaryNode.id },
        { level: 2, observation: 'Your time phrase is explicit.', evidence: 'yesterday <today>' }],
      targets: state.selection, focus: 'Practise completed events.'
    };
    const output = html(state);
    const row = output.match(/<div class="tutor-map-search-row">[\s\S]*?<\/div>/u)![0];
    expect(row).toContain('data-command="openTutorDiagnosticReport"');
    expect(output).not.toContain('class="tutor-drawer tutor-diagnostic-report-drawer"');
    expect(html(createTutorViewState())).not.toContain('data-command="openTutorDiagnosticReport"');
    state.diagnosticReportDrawerOpen = true;
    const drawer = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)?.[0] ?? '';
    expect(drawer).toContain('role="dialog" aria-modal="true" aria-label="Diagnostic report"');
    expect(drawer).toContain('data-command="cancelTutorDiagnosticReport">Delete</button>');
    // Changed 2026-09-16: the visible title capitalises Report while the dialog label does not.
    expect(drawer).toContain('<h2>Diagnostic Report</h2>');
    expect(drawer).toContain(state.diagnosticReport.summary);
    expect(drawer).toContain('<q>I go</q>');
    expect(drawer).toContain('<q>yesterday &lt;today&gt;</q>');
    expect(drawer).toContain(primaryNode.label);
    expect(drawer).toContain('Proposed targets');
    expect(drawer).toContain('stay unchanged until you choose Apply');
    expect(drawer).toContain('Practise completed events.');
    expect(drawer.match(/data-command="applyTutorDiagnosticReport"/gu)).toHaveLength(1);
    expect(drawer).toContain('<button type="button" data-command="applyTutorDiagnosticReport">Apply</button>');
    expect(drawer).not.toContain('It replaces your prepared prompt when complete.');
    state.diagnosticReport = { targets: [], findings: [] };
    const empty = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)?.[0] ?? '';
    expect(empty).toContain('The analysis found nothing specific to correct.');
    expect(empty).toContain('No summary was returned.');
    expect(empty).toContain('No focus was returned.');
    expect(empty).toContain('No learning-map targets were proposed.');
  });

  it('V67 6b an empty findings response renders its summary focus and nothing-specific message', () => {
    const state = selectedState();
    state.diagnosticReport = tutorDiagnosticReport({
      summary: 'Your writing is clear. Your verb forms fit the events.', findings: [],
      focus: 'Practise varying your sentence structure.', targets: []
    }, 'I went to the library.');
    state.diagnosticReportDrawerOpen = true;
    const drawer = html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)?.[0] ?? '';
    expect(drawer).toContain('Your writing is clear. Your verb forms fit the events.');
    expect(drawer).toContain('Practise varying your sentence structure.');
    expect(drawer).toContain('The analysis found nothing specific to correct.');
    expect(drawer).not.toContain('<ul>');
  });

  it('V65 R2 groups repeated excerpts without losing any explanation', () => {
    const state = selectedState();
    const draftedLesson = lesson(1);
    draftedLesson.examples[0]!.annotations = [
      {
        targetId: primaryNode.id,
        excerpt: 'clear English pattern',
        explanation: 'The first explanation introduces the form.'
      },
      {
        targetId: supportNode.id,
        excerpt: 'careful team',
        explanation: 'The different excerpt keeps its own explanation.'
      },
      {
        targetId: supportNode.id,
        excerpt: 'clear English pattern',
        explanation: 'The second explanation connects the supporting target.'
      },
      {
        targetId: primaryNode.id,
        excerpt: 'clear English pattern',
        explanation: 'The third explanation adds the final teaching point.'
      }
    ];
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: draftedLesson, findings: [] };

    const output = html(state);
    const card = output.match(
      /<article class="tutor-example[^>]*>[\s\S]*?<\/article>/u
    )?.[0] ?? '';
    const paragraphs = [...card.matchAll(
      /<li class="tutor-annotation">[\s\S]*?<\/li>/gu
    )].map((match) => match[0]);
    const sharedParagraph = paragraphs.find((paragraph) =>
      paragraph.includes('clear English pattern')
    ) ?? '';

    expect(paragraphs).toHaveLength(2);
    expect(sharedParagraph.match(/clear English pattern/gu)).toHaveLength(1);
    for (const explanation of draftedLesson.examples[0]!.annotations.map(
      (annotation) => annotation.explanation
    )) {
      expect(card).toContain(explanation);
    }
    expect(sharedParagraph.indexOf('The first explanation introduces the form.'))
      .toBeLessThan(sharedParagraph.indexOf(
        'The second explanation connects the supporting target.'
      ));
    expect(sharedParagraph.indexOf('The second explanation connects the supporting target.'))
      .toBeLessThan(sharedParagraph.indexOf(
        'The third explanation adds the final teaching point.'
      ));
  });

  it('V65 R2 groups excerpt keys without case or whitespace distinctions', () => {
    const state = selectedState();
    const draftedLesson = lesson(1);
    draftedLesson.examples[0]!.annotations = [
      {
        targetId: primaryNode.id,
        excerpt: 'clear English pattern',
        explanation: 'First normalized explanation.'
      },
      {
        targetId: supportNode.id,
        excerpt: '  CLEAR   english pattern  ',
        explanation: 'Second normalized explanation.'
      }
    ];
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: draftedLesson, findings: [] };

    const output = html(state);
    const card = output.match(
      /<article class="tutor-example[^>]*>[\s\S]*?<\/article>/u
    )?.[0] ?? '';
    const paragraphs = [...card.matchAll(
      /<li class="tutor-annotation">[\s\S]*?<\/li>/gu
    )].map((match) => match[0]);

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain(
      '<span class="tutor-annotation-excerpt">clear English pattern</span>'
    );
    expect(paragraphs[0]).toContain('First normalized explanation. Second normalized explanation.');
  });

  it('V65 R1 gives the search row one grid track for every rendered child', () => {
    const output = html(selectedState());
    const row = output.match(/<div class="tutor-map-search-row">[\s\S]*?<\/div>/u)?.[0] ?? '';
    const childCount = row.match(/<(?:textarea|button)\b/gu)?.length ?? 0;
    const template = output.match(
      /\.tutor-map-search-row \{[^}]*grid-template-columns:\s*([^;]+);/u
    )?.[1] ?? '';
    const trackCount = template.match(/minmax\([^)]*\)|[^\s]+/gu)?.length ?? 0;

    expect(childCount).toBeGreaterThan(0);
    expect(trackCount).toBe(childCount);
  });

  it('V65 R3 shows each stored learner level with exactly one reader label', () => {
    const state = selectedState();
    state.settings.learnerLevel = 'B2';
    const output = html(state);
    const setting = output.match(
      /<label class="setting"><span><span class="setting-title">Learner level<\/span>[\s\S]*?<\/label>/u
    )?.[0] ?? '';
    const options = [...setting.matchAll(
      /<option value="([^"]+)"(?: selected)?>([^<]+)<\/option>/gu
    )].map((match) => [match[1], match[2]]);
    const visibleText = setting
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    expect(options).toEqual([
      ['A1', 'Beginner'],
      ['A2', 'Elementary'],
      ['B1', 'Intermediate'],
      ['B2', 'Upper-intermediate'],
      ['C1', 'Advanced'],
      ['C2', 'Proficient'],
      ['auto', 'Auto']
    ]);
    expect(visibleText).toBe(
      'Learner level Common European Framework level for the explanation and examples. ' +
      'Beginner Elementary Intermediate Upper-intermediate Advanced Proficient Auto'
    );
  });

  it('V62 R1 puts the shared edit icon between Ask and Clear on the map action row', () => {
    const output = html(selectedState());
    const row = output.match(/<div class="tutor-map-search-row">[\s\S]*?<\/div>/u)?.[0] ?? '';
    const button = row.match(
      /<button[^>]*data-command="openTutorPreparedPrompt"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';

    expect(row.indexOf('data-tutor-ask')).toBeLessThan(
      row.indexOf('data-command="openTutorPreparedPrompt"')
    );
    expect(row.indexOf('data-command="openTutorPreparedPrompt"')).toBeLessThan(
      row.indexOf('data-tutor-clear-search')
    );
    expect(button).toContain('class="icon-button tutor-action-icon');
    expect(button).toContain(iconSvgMarkup('edit'));
  });

  it('V62 R2 keeps the prompt button visible and marks whether a prompt exists', () => {
    const empty = html(selectedState());
    const emptyButton = empty.match(
      /<button[^>]*data-command="openTutorPreparedPrompt"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';
    expect(emptyButton).not.toBe('');
    expect(emptyButton).toContain('setting-inactive');
    expect(emptyButton).toContain('aria-disabled="true"');
    expect(emptyButton).toContain('aria-description="Ask a question or apply a diagnostic report to prepare a prompt."');

    const state = selectedState();
    state.question = 'When should I use which instead of that?';
    state.questionPrepared = true;
    state.preparedPrompt = tutorPreparedPrompt(state);
    const active = html(state);
    const activeButton = active.match(
      /<button[^>]*data-command="openTutorPreparedPrompt"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';
    expect(activeButton).not.toContain('setting-inactive');
    expect(activeButton).not.toContain('aria-disabled="true"');
  });

  it('V62 R3 keeps the prepared prompt control and drawer after a lesson exists', () => {
    const state = selectedState();
    state.question = 'When should I use which instead of that?';
    state.questionPrepared = true;
    state.preparedPrompt = tutorPreparedPrompt(state);
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };
    state.preparedPromptDrawerOpen = true;

    const output = html(state);
    expect(output).toContain('data-command="openTutorPreparedPrompt"');
    expect(output).toContain('aria-label="Prepared lesson prompt"');
    expect(output).toContain(state.preparedPrompt);
  });

  it('V62 R4 renders an editable prompt and the recipe-change replacement notice', () => {
    const state = selectedState();
    state.question = 'When should I use which instead of that?';
    state.questionPrepared = true;
    state.preparedPrompt = tutorPreparedPrompt(state);
    state.preparedPromptDrawerOpen = true;
    Object.assign(state, {
      preparedPromptNotice: 'Your edited prepared prompt was replaced because the lesson recipe changed.'
    });

    const output = html(state);
    const drawer = output.match(
      /<aside class="tutor-drawer tutor-prepared-prompt-drawer"[\s\S]*?<\/aside>/u
    )?.[0] ?? '';
    expect(drawer).not.toBe('');
    expect(drawer).toContain('data-command="closeTutorPreparedPrompt"');
    expect(drawer).toContain('<textarea class="tutor-prepared-prompt-text"');
    expect(drawer).toContain('data-tutor-prepared-prompt');
    expect(drawer).toContain('Your edited prepared prompt was replaced because the lesson recipe changed.');
    expect(drawer).not.toContain('data-command="submitTutorTool"');
    expect(drawer).not.toContain('data-tutor-tool-target-language');
  });

  it('V54 R1 shows the exact prepared lesson prompt in its drawer before a lesson exists', () => {
    const question = 'Which and that difference. When do I use which, and when that?';
    const state = selectedState();
    state.question = question;
    Object.assign(state, {
      questionPrepared: true,
      preparedPrompt: tutorPreparedPrompt(state),
      preparedPromptDrawerOpen: true
    });
    const output = html(state);
    const expected = `Prepare an English lesson that directly answers this exact reader question:
${question}
Teach ${primaryNode.label} as the Primary learning-map target.
Follow the visible lesson recipe for level B2, 6 examples of 11 to 18 words, and the selected lesson and style settings.`;

    expect(state.lesson).toBeUndefined();
    const drawer = output.match(
      /<aside class="tutor-drawer tutor-prepared-prompt-drawer"[\s\S]*?<\/aside>/u
    )?.[0] ?? '';
    expect(drawer).toContain('<h2>Prepared lesson prompt</h2>');
    expect(drawer).toContain(expected);
  });

  it('V62 R5 shrinks both button sets by one fifth and keeps both glyph sets 18 by 18', () => {
    const output = html(selectedState());

    expect(output).toContain(
      '.tutor-map-level-heading .icon-button { width: 21px; min-width: 21px; height: 21px; padding: 1px; }'
    );
    expect(output).toContain(
      '.tutor-tray-row .icon-button { width: 24px; min-width: 24px; height: 24px; padding: 2px; }'
    );
    expect(output).toContain(
      '.tutor-map-level-heading .icon-button svg, .tutor-tray-row .icon-button svg { width: 18px; height: 18px; }'
    );

    // The three assertions above check that the intended rules are present, which a more
    // specific rule added beside them would not disturb: the glyph shrinks and every one of
    // them still passes. Found by mutation on 2026-09-04, the third guard this week to fail
    // that way. So the real check is that no rule anywhere sizes an icon glyph to anything
    // other than 18 pixels.
    const styles = (output.match(/<style[\s\S]*?<\/style>/gu) ?? []).join(' ');
    const glyphRules = styles
      .split('}')
      .map((rule) => rule.trim())
      // Changed 2026-10-16: V250, owner item I32, the shared stroke rule carries stroke-width,
      // which is not a size; match only a width declaration of its own.
      .filter((rule) => /\.icon-button[^{]*svg[^{]*\{/u.test(rule + '{') && /(?:^|[{;\s])width:/u.test(rule));

    expect(glyphRules.length, 'no rule sizes an icon glyph at all').toBeGreaterThan(0);
    for (const rule of glyphRules) {
      expect(rule, 'this rule sizes an icon glyph away from 18px: ' + rule.slice(0, 90))
        .toContain('width: 18px');
    }
  });

  it('V54 R4 keeps temporary explanation out of Selected targets', () => {
    const state = selectedState();
    state.settings.questionOnly = true;
    const output = html(state);

    expect(output).toContain('aria-label="Selected targets"');
    // Changed 2026-09-25 for V152: the old long action label was also present in the
    // page script, so it never proved this question-only state rendered an action button.
    expect(output).toMatch(/class="tutor-tray-row"><strong>Support<\/strong>/u);
    expect(output).not.toContain(
      'Question-led lessons use learning-map targets as Supports.'
    );
  });

  it('V51 R4 pins the switch-off panel messages byte for byte', () => {
    const statusRegion = (output: string): string => output.match(
      /<section class="tutor-action-status-region"[^>]*>[\s\S]*?<\/section>/u
    )?.[0] ?? '';
    const initial = html(createTutorViewState());
    const ready = html(selectedState());
    const recoveryState = createTutorViewState();
    recoveryState.question = 'what vs. that';
    recoveryState.selectionMessage = 'No target was selected for this question. Choose a target in the dropdowns and use Primary, or type another question and choose Ask.';
    const recovery = html(recoveryState);

    expect(statusRegion(initial)).toBe(
      '<section class="tutor-action-status-region" data-tutor-action-status aria-labelledby="tutor-page-heading" role="status" aria-live="polite"><p id="tutor-action-readiness" class="tutor-action-status">Open the learning map, select or search learning map targets. Alternatively, type a question or select text from the editor to initiate a model-based lesson and practice.</p></section>'
    );
    // Changed 2026-09-30: V175 omits the ordinary ready paragraph but retains the live region.
    // Changed 2026-09-30: V175b restores presence and announcement guards before checking empty text.
    const readyStatus = load(statusRegion(ready))('[data-tutor-action-status]');
    expect(readyStatus).toHaveLength(1);
    expect(readyStatus.attr('role')).toBe('status');
    expect(readyStatus.attr('aria-live')).toBe('polite');
    expect(readyStatus.text()).toBe('');
    expect(recovery).toContain(
      '<p class="tutor-selection-footnote" role="status">No target was selected for this question. Choose a target in the dropdowns and use Primary, or type another question and choose Ask.</p>'
    );
  });

  it('V51 R1 keeps question-only lessons off by default and stores the toggle with lesson settings', () => {
    const state = createTutorViewState();
    const initial = html(state);
    const initialToggle = initial.match(
      /<label class="setting"><span><span class="setting-title">Use question without learning-map targets<\/span>[\s\S]*?data-setting="tutor\.questionOnly"[^>]*>/u
    )?.[0] ?? '';

    expect(state.settings.questionOnly).toBe(false);
    expect(initialToggle).not.toBe('');
    expect(initialToggle).not.toContain(' checked');

    state.settings.questionOnly = true;
    const enabledToggle = html(state).match(
      /<label class="setting"><span><span class="setting-title">Use question without learning-map targets<\/span>[\s\S]*?data-setting="tutor\.questionOnly"[^>]*>/u
    )?.[0] ?? '';
    expect(enabledToggle).toContain(' checked');
  });

  it('V61 R1 opens only the Learning Map on arrival', () => {
    const state = createTutorViewState();
    const output = html(state);

    for (const [id, startsOpen] of [
      ['map', true],
      ['lesson', false],
      ['setting', false],
      ['recipe', false]
    ] as const) {
      const details = output.match(
        new RegExp(`<details[^>]*data-tutor-parent[^>]*data-persist-id="tutor-${id}"[^>]*>`, 'u')
      )?.[0] ?? '';
      expect(details, `${id} must remain an openable parent`).not.toBe('');
      expect(details.includes(' open'), `${id} arrival disclosure state`).toBe(startsOpen);
    }
  });

  it('V61 R2 removes model-backed Find state and control from all source and rendered markup', () => {
    const removedSetting = ['tutor', 'modelTargetSearch'].join('.');
    const source = sourceFiles('src')
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(source).not.toContain(removedSetting);
    expect(html(createTutorViewState())).not.toContain(removedSetting);
    expect(html(createTutorViewState())).not.toContain(
      'Use model to find learning-map targets'
    );
  });

  it('V61 R3 places the question-only switch under the Learning Map search box, not Lesson', () => {
    const output = html(createTutorViewState());
    const map = output.match(
      /<details[^>]*data-persist-id="tutor-map"[^>]*>[\s\S]*?<details[^>]*data-persist-id="tutor-lesson"/u
    )?.[0] ?? '';
    const lesson = output.match(
      /<details[^>]*data-persist-id="tutor-lesson"[^>]*>[\s\S]*?<details[^>]*data-persist-id="tutor-setting"/u
    )?.[0] ?? '';

    expect(map).toContain('data-tutor-map-search');
    expect(map).toContain('data-setting="tutor.questionOnly"');
    expect(map.indexOf('data-tutor-map-search'))
      .toBeLessThan(map.indexOf('data-setting="tutor.questionOnly"'));
    expect(lesson).not.toContain('data-setting="tutor.questionOnly"');
  });

  it('V51 R2 makes the learning map visibly optional while keeping all browsing controls reachable', () => {
    const state = createTutorViewState();
    state.settings.questionOnly = true;
    state.question = 'Which and that difference. When do I use which, and when that?';
    const output = html(state);
    const map = output.match(
      /<details[^>]*data-persist-id="tutor-map" open>[\s\S]*?<\/details>/u
    )?.[0] ?? '';

    expect(output).toContain('Learning map optional | Lesson follows the question');
    expect(output).not.toContain('Select a primary target');
    /*
     * Drafting is available once a question is recorded. This asserted the opposite until
     * 2026-09-03: it pinned "Question-only lesson generation requires shared Core support",
     * a message that stopped being true when core 0.17.0 accepted a recipe with no primary
     * target, and the test then protected the disabled controls from being noticed.
     */
    expect(output).not.toContain('requires shared Core support');
    // The drafting action only. Reset shares this row and is correctly unavailable when there
    // is nothing yet to clear. Practice has lived only in the lesson panel since 2026-09-15,
    // so with no lesson it is absent here; test/tutorLayout142.test.ts covers it.
    expect(output).not.toContain('data-command="generateTutorExercises"');
    for (const command of ['generateTutorLesson']) {
      const button = output.match(
        new RegExp(`<button[^>]*data-command="${command}"[^>]*>`, 'u')
      )?.[0] ?? '';
      expect(button, `${command} must be rendered`).not.toBe('');
      expect(button, `${command} is usable once a question is recorded`)
        .not.toContain('aria-disabled="true"');
    }
    expect(map).toContain('data-tutor-map-search');
    expect(map).toContain('data-command="findTutorTargets"');
    expect(map).toContain('data-command="askTutorQuestion"');
    /*
     * Operable, not merely present. A probe on 2026-09-03 marked all four selects
     * aria-disabled in this mode and this test still passed, because counting elements
     * says nothing about whether a reader can use them.
     *
     * Compared against the same state with the switch off rather than asserted absolutely:
     * the cascade disables a level until its parent is chosen, which is ordinary and has
     * nothing to do with this mode. What must hold is that the switch changes none of it.
     */
    const mapSelects = (page: string): string[] =>
      page.match(/<select id="tutor-map-(?:hub|cluster|skill|microTarget)"[^>]*>/gu) ?? [];
    const off = createTutorViewState();
    off.question = state.question;
    const selects = mapSelects(output);
    expect(selects).toHaveLength(4);
    expect(selects, 'turning targets optional must not disable browsing the map')
      .toEqual(mapSelects(html(off)));
    expect(selects[0], 'the top level is always browsable')
      .not.toContain('aria-disabled="true"');
    expect(output).toContain('<dt>Teach</dt><dd>The subject stated in the lesson question</dd>');
    expect(output).toContain('<dt>Practice it with</dt><dd>The lesson question, without learning-map targets</dd>');
  });

  it('names the question, not a target, in a question-only lesson header', () => {
    // The renderer said "Primary: ..." for every lesson, including one drafted from a
    // question with no map target at all, which the governing document says shows the
    // question. Found by an independent reading run on 2026-09-03; no test covered it.
    const state = selectedState();
    state.settings.questionOnly = true;
    state.question = 'Which and that difference. When do I use which, and when that?';
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };

    const output = html(state);

    expect(output).toContain(`Question: ${state.question}`);
    expect(output).not.toContain('Primary: ');

    // Read from the lesson's own recipe, not the panel. Turning the switch off while the
    // lesson is still on screen must not relabel the lesson in front of the reader.
    const switchedOff = { ...state, settings: { ...state.settings, questionOnly: false } };
    expect(html(switchedOff)).toContain(`Question: ${state.question}`);
  });

  it('V52 R1 disables Find targets with a reason only while question-only mode is on', () => {
    const state = selectedState();
    const findButton = (output: string) =>
      output.match(/<button[^>]*data-tutor-find-targets[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? '';

    const enabled = findButton(html(state));
    expect(enabled).not.toContain('aria-disabled="true"');

    state.settings.questionOnly = true;
    const disabledOutput = html(state);
    const disabled = findButton(disabledOutput);
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).toContain(
      'aria-description="Turn off Use question without learning-map targets to find map targets."'
    );
    expect(disabledOutput).toContain(
      "if (action?.getAttribute('aria-disabled') === 'true') return;"
    );
  });

  it('V51 enables the drawer submit control as the reader types, without a re-render', () => {
    // The panel does not redraw while typing, and the control's disabled state is decided at
    // render, so Ask opened with an empty box and its button never came back to life.
    // Dictionary and Translate hid this for two versions because their box opens full.
    const output = html(selectedState());
    const handler = output.match(
      /data-tutor-tool-input'\)\) \{[\s\S]*?vscode\.postMessage\(\{ command: 'updateTutorToolInput'/u
    )?.[0] ?? '';

    expect(handler, 'the typing handler must be found before it can be checked').not.toBe('');
    expect(handler).toContain('submitTutorTool');
    expect(handler).toContain('submit.disabled = !String(target.value).trim()');
  });

  it('V51 paints the model mark solid and leaves every other icon an outline', () => {
    const output = html(selectedState());

    expect(output).toContain('.icon-button svg.kren-icon-filled { fill: currentColor;');
    expect(iconSvgMarkup('ask')).toContain('kren-icon-filled');
    expect(iconSvgMarkup('search')).not.toContain('kren-icon-filled');
  });

  it('V49 R1 draws Find targets as a magnifier icon button rather than a text button', () => {
    const output = html(selectedState());
    const find = output.match(/<button[^>]*data-tutor-find-targets[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? '';

    expect(find).not.toBe('');
    expect(find, 'the words are the accessible name now, not the visible label')
      .not.toContain('>Find targets<');
    expect(find).toContain(iconSvgMarkup('search'));
    expect(find).toContain('aria-label="Find learning map targets"');
  });

  it('V56 R6 gives Find, Ask, and Clear primary action styling and the shared Clear icon', () => {
    const output = html(selectedState());
    const buttons = [
      ['data-tutor-find-targets', 'search'],
      ['data-tutor-ask', 'ask'],
      ['data-tutor-clear-search', 'clear']
    ] as const;

    for (const [attribute, icon] of buttons) {
      const button = output.match(
        new RegExp(`<button[^>]*${attribute}[^>]*>[\\s\\S]*?<\\/button>`, 'u')
      )?.[0] ?? '';
      expect(button, attribute).toContain('class="icon-button tutor-action-icon"');
      expect(button, attribute).toContain(iconSvgMarkup(icon));
    }
    expect(output).toContain(
      '.icon-button.tutor-action-icon { color: var(--vscode-button-foreground); background: var(--vscode-button-background);'
    );
    // 2026-10-04: V203 keeps active action icons white on blue and excludes disabled hover.
    expect(output).toMatch(/\.icon-button\.tutor-action-icon:hover[^{}]*:not\(:disabled\)[^{}]*\{[^}]*color: var\(--vscode-button-foreground\);[^}]*background: var\(--vscode-button-hoverBackground\)/u);
  });

  it('V49 R2 sets an example explanation in the secondary colour with space above it', () => {
    const output = html(selectedState());

    // The same variable the foldable summary beside CONCEPT AND RULES already uses, read
    // from the stylesheet rather than restated, so the two cannot drift to different greys.
    /*
     * The space above the first explanation went on 2026-09-12 at the reader's direction: with
     * one example on screen and a heading directly above, it read as a stray blank line. The
     * explanations became bullets in the same change. V94 kept their text edge fixed and
     * positioned a custom marker independently so wrapped lines hang from the first line.
     */
    expect(output).toContain('.tutor-annotation { margin: 2px 0; color: var(--vscode-descriptionForeground); }');
    expect(output).toContain('.tutor-lesson .tutor-annotation-list, .tutor-annotation-list { margin-block: 0; padding-left: 1.55em; list-style: none; }');
    expect(output).toContain('.tutor-annotation-list > li::before { content:');
    expect(output).toContain('.rewrite-group-summary { min-width: 0; color: var(--vscode-descriptionForeground);');
  });

  it('V49 R3 renders an example sentence with its taught words bold', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    const drafted = state.lesson.lesson.examples[0]!;
    const excerpt = drafted.annotations[0]!.excerpt;

    const output = html(state);

    expect(output).toContain(`<strong class="tutor-taught">${excerpt}</strong>`);
  });

  it('V49 R4 colours review spans and draws no highlight', () => {
    // Rendered with real review spans in it. Asserting mark is absent from a page that has
    // no review at all is an assertion that cannot fail, which is the exact defect this
    // suite keeps finding in other tests.
    const state = selectedState();
    state.reviews = {
      'exercise-1': {
        schemaVersion: 1,
        exerciseId: 'exercise-1',
        learnerText: 'I finished the report.',
        correct: [{ excerpt: 'the report', reason: 'This object is clear.' }],
        incorrect: [{
          excerpt: 'finished',
          reason: 'Use the target aspect here.',
          corrected: 'have finished',
          status: 'strongTendency'
        }]
      }
    };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Report a completed action.',
        targetIds: [primaryNode.id]
      }]
    };
    // Keep this span/action fixture in progress; completion has its own V82 tests.
    state.exerciseSet.exercises.push({ id: 'unreviewed', channel: 'written', prompt: 'Next item.', targetIds: [primaryNode.id] });

    const output = html(state);

    // Changed 2026-09-30: the green class marks the verdict, then the excerpt follows.
    // 2026-10-13: The verdict keeps its green class and its quoted answer stays separate from the reason.
    const reviewVerdict = load(output)('.tutor-review-correct');
    expect(reviewVerdict.text()).toBe('Correct.');
    expect(reviewVerdict.parent().text()).toMatch(/"the report"\. /u);
    expect(output).toContain('<span class="tutor-review-wrong">finished</span>');
    expect(output, 'mark carries a yellow background of its own, which is what was removed')
      .not.toContain('<mark>');
    /*
     * Green for what was right, changed 2026-09-13 at the reader's direction: blue for
     * correct and blue for the correction meant one colour carried two meanings. Blue is now
     * the correction only, which is the thing to read and to copy.
     */
    expect(output).toContain('.tutor-review-correct { color: var(--vscode-charts-green');
    expect(output).toContain('.tutor-review-wrong { color: var(--vscode-charts-red');
    expect(output).toContain('.tutor-review-corrected { font-weight: 700; color: var(--vscode-charts-blue');
    expect(output).toContain('<span class="tutor-review-corrected">have finished</span>');
    expect(output, 'the correction starts its own block with a blue rule')
      .toContain('.tutor-review-correction { margin: 6px 0 5px; padding-left: 8px; border-left: 3px solid var(--vscode-charts-blue');
  });

  it('V61 R1 keeps the Learning Map folded after a lesson has been generated', () => {
    const before = selectedState();
    const after = selectedState();
    after.lesson = { recipe: tutorRecipeFromState(after), lesson: lesson(), findings: [] };
    const mapDetails = (page: string): string =>
      page.match(/<details[^>]*data-persist-id="tutor-map"[^>]*>/u)?.[0] ?? '';

    expect(mapDetails(html(before))).toContain(' open');
    expect(mapDetails(html(after))).not.toContain(' open');
    expect(html(after), 'folding must remove nothing the reader can still open')
      .toContain('data-persist-id="tutor-map"');
  });

  it('V56 R3 folds every configuration parent and scrolls only the newly generated result', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Use the target once.',
        targetIds: [primaryNode.id]
      }]
    };
    const focused = html(state, { focusTutorResult: 'lesson' });

    expect(focused).toContain('data-focus-tutor-result="lesson"');
    expect(focused).toContain("document.querySelectorAll('details[data-tutor-parent]')");
    expect(focused).toContain('section.open = false');
    expect(focused).toContain('openSections[id] = false');
    expect(focused).toContain(
      "document.querySelector('[data-tutor-result=\"' + focusTutorResult + '\"]')"
    );
    expect(focused).toContain("target.scrollIntoView({ block: 'start' })");
    for (const id of ['map', 'lesson', 'setting', 'recipe']) {
      const parent = focused.match(
        new RegExp(`<details[^>]*data-tutor-parent[^>]*data-persist-id="tutor-${id}"[^>]*>`, 'u')
      )?.[0] ?? '';
      expect(parent, `${id} remains openable but starts folded`).not.toContain(' open');
    }

    const ordinaryBody = html(state).match(/<body[^>]*>/u)?.[0] ?? '';
    expect(ordinaryBody, 'a later render must not pull the reader back to an older result')
      .not.toContain('data-focus-tutor-result');
  });

  it('B3 keeps a level-four Primary in Selected targets when the Hub dropdown changes', () => {
    const levelFour = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
    const otherHub = TUTOR_MAP.find((node) =>
      node.kind === 'hub' && !levelFour.id.startsWith(`${node.id}.`)
    )!;
    let state = createTutorViewState();
    state.selection = changeTutorTarget([], levelFour.id, 'primary').selection;
    state = changeTutorMapSelection(state, 'microTarget', levelFour.id);

    const changed = changeTutorMapSelection(state, 'hub', otherHub.id);

    const fullPath = tutorMapPathForNode(levelFour.id)
      .map((node) => node.label)
      .join(' / ');
    expect(changed.selection).toEqual([{ nodeId: levelFour.id, role: 'primary' }]);
    expect(changed.mapPath).toEqual({ hub: otherHub.id });
    expect(html(changed)).toContain(fullPath);
  });

  it('imports the complete Core learning map rather than a panel copy', () => {
    expect(TUTOR_MAP).toHaveLength(123);
  });

  it('B9 enables drafting from a selected Support and shows the recipe readiness notice', () => {
    const hubs = TUTOR_MAP.filter((node) => node.kind === 'hub');
    let state = changeTutorMapSelection(createTutorViewState(), 'hub', hubs[1]!.id);
    state.selection = [{ nodeId: hubs[0]!.id, role: 'support' }];
    const before = [...state.selection];
    const output = html(state);

    expect(output).toContain('id="tutor-screen"');
    expect(output).toContain('LEARNING MAP');
    expect(output).toContain('REVIEW RECIPE');
    expect(output).toContain('Open the learning map, select or search learning map targets. Alternatively, type a question or select text from the editor to initiate a model-based lesson and practice.');
    // Changed 2026-10-01: any selected target enables Draft under V177.
    const draft = load(output)('[data-command="generateTutorLesson"]');
    expect(draft.attr('disabled')).toBeUndefined();
    expect(draft.attr('aria-disabled')).not.toBe('true');
    // No lesson, so no practice action: it is offered only in the lesson panel.
    expect(output).not.toContain('data-command="generateTutorExercises"');
    expect(output).not.toMatch(/data-command="generateTutor(?:Lesson|Exercises)" disabled/u);
    expect(output).toContain(`data-tutor-target="${hubs[1]!.id}" data-tutor-role="primary" title="Set a target as primary">Primary`);
    expect(output).toContain(`data-tutor-target="${hubs[1]!.id}" data-tutor-role="support" title="Add a target as support">Support`);
    expect(state.selection).toEqual(before);
  });

  it('V44 R1 places the persistent actions below Lesson settings and keeps every notice associated', () => {
    const output = html(createTutorViewState());
    const tutorPage = output.slice(output.indexOf('<section id="tutor-screen"'));
    const headingRow = tutorPage.match(
      /<div class="tutor-heading-row"[^>]*>[\s\S]*?<\/div><\/div>/u
    )?.[0] ?? '';
    const statusRegion = tutorPage.match(
      /<section class="tutor-action-status-region"[^>]*>[\s\S]*?<\/section>/u
    )?.[0] ?? '';
    const firstDetails = tutorPage.indexOf('<details');
    const headingPosition = tutorPage.indexOf('<div class="tutor-heading-row"');
    const statusPosition = tutorPage.indexOf('<section class="tutor-action-status-region"');

    expect(headingRow).toContain('<h1 id="tutor-page-heading">AI English Tutor</h1>');
    // Changed 2026-09-30: V175 moves drafting actions into the Lesson section.
    expect(load(output)('.tutor-lesson-section > [data-tutor-heading-actions] [data-command="generateTutorLesson"]')).toHaveLength(1);
    expect(headingRow).not.toContain('data-command="generateTutorExercises"');
    expect(statusRegion).not.toContain('data-command="generateTutorLesson"');
    expect(statusRegion).not.toContain('data-command="generateTutorExercises"');
    expect(statusRegion).toContain('aria-labelledby="tutor-page-heading" role="status" aria-live="polite"');
    expect(statusRegion).toContain('id="tutor-action-readiness"');
    expect(statusRegion).toContain('Open the learning map, select or search learning map targets. Alternatively, type a question or select text from the editor to initiate a model-based lesson and practice.');
    // Changed 2026-09-30: the moved Draft control still names its unavailable-action reason.
    expect(load(output)('[data-command="generateTutorLesson"]').attr('aria-disabled')).toBe('true');
    // Changed 2026-10-01: V177b names the target or the switch needed to draft from a question.
    expect(load(output)('[data-command="generateTutorLesson"]').attr('aria-description')).toMatch(/choose.*target.*turn on.*question/iu);
    expect(headingPosition).toBeLessThan(statusPosition);
    expect(statusPosition).toBeLessThan(firstDetails);

    const concurrent = selectedState();
    concurrent.lesson = { recipe: tutorRecipeFromState(concurrent), lesson: lesson(), findings: [] };
    concurrent.lessonStale = true;
    concurrent.lessonBusy = true;
    concurrent.lessonFailure = 'The earlier request failed.';
    const concurrentOutput = html(concurrent);
    const concurrentStatus = concurrentOutput.match(
      /<section class="tutor-action-status-region"[^>]*>[\s\S]*?<\/section>/u
    )?.[0] ?? '';
    const overlay = concurrentOutput.match(
      /<div class="busy-overlay"[^>]*>[\s\S]*?<\/div><\/div>/u
    )?.[0] ?? '';

    expect(concurrentStatus).not.toContain('This lesson was drafted from earlier settings.');
    expect(concurrentOutput.match(/This lesson was drafted from earlier settings\./gu))
      .toHaveLength(1);
    expect(concurrentStatus).toContain('id="tutor-action-lesson-busy"');
    expect(concurrentStatus).toContain('Drafting the lesson.');
    expect(concurrentStatus).toContain('The earlier request failed.');
    expect(overlay).toContain('role="alert" aria-live="assertive"');
    expect(overlay).toContain('Redrafting the lesson. Please wait.');
    expect(overlay).toContain('>Cancel</button>');
  });

  it('V42 R1 leaves lesson cancellation only on the waiting overlay', () => {
    const state = selectedState();
    state.lessonBusy = true;
    const output = html(state);
    const statusRegion = output.slice(
      output.indexOf('<section class="tutor-action-status-region"'),
      output.indexOf('</section>', output.indexOf('<section class="tutor-action-status-region"'))
    );
    const overlay = output.match(/<div class="busy-overlay"[\s\S]*?<\/div><\/div>/u)?.[0] ?? '';

    expect(statusRegion).not.toContain('data-command="cancelTutorLesson"');
    expect(statusRegion).not.toContain('>Cancel</button>');
    expect(overlay, 'the waiting overlay remains the reachable cancellation path')
      .toContain('data-command="cancelTutorLesson"');
  });

  it('V42 R2 keeps Practice now visible, disabled, and described while preparation is in flight', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    state.exerciseBusy = true;
    const output = html(state);
    const headingRow = output.match(
      /<div class="tutor-heading-row"[^>]*>[\s\S]*?<\/div><\/div>/u
    )?.[0] ?? '';
    const statusRegion = output.match(
      /<section class="tutor-action-status-region"[^>]*>[\s\S]*?<\/section>/u
    )?.[0] ?? '';
    // Offered in the lesson panel since 2026-09-15, never in the heading.
    expect(headingRow).not.toContain('generateTutorExercises');
    const exerciseButton = output.match(
      /<div class="tutor-lesson-practice-action"[^>]*><button[^>]*data-command="generateTutorExercises"[^>]*>Practice now<\/button>/u
    )?.[0] ?? '';

    expect(exerciseButton, 'Practice now stays visible while its request is in flight')
      .not.toBe('');
    expect(exerciseButton, 'Practice now uses the panel disabled treatment in flight')
      .toContain('aria-disabled="true"');
    expect(exerciseButton).toContain('aria-describedby="tutor-action-exercise-busy"');
    // Changed 2026-09-23: the one-valued channel no longer occupies status copy.
    expect(statusRegion).toContain(
      'id="tutor-action-exercise-busy" class="tutor-action-status">Preparing practice.'
    );
  });

  it('R8 ends every Selected targets row with the shared waste-basket icon button', () => {
    const output = html(selectedState());

    expect(output).toContain('aria-label="Selected targets"');
    expect(output).toContain(`<strong>Primary</strong><span class="tutor-target-path">${tutorTargetPathLabel(primaryNode.id)}</span>`);
    expect(output).toContain(`<strong>Support</strong><span class="tutor-target-path">${tutorTargetPathLabel(supportNode.id)}</span>`);
    for (const node of [primaryNode, supportNode]) {
      const path = tutorTargetPathLabel(node.id);
      const rowStart = output.indexOf(`data-tutor-target-row="${node.id}"`);
      const button = output.slice(output.lastIndexOf('<button', rowStart), output.indexOf('</button>', rowStart) + 9);
      expect(button).toContain('data-tutor-role="off"');
      expect(button).toContain(`aria-label="Clear ${path}"`);
      expect(button).toContain(iconSvgMarkup('delete'));
      expect(button).not.toMatch(/>Clear<\/button>/u);
    }
  });

  it('B5 keeps both target actions live for a Hub or Cluster and selects either level', () => {
    for (const node of TUTOR_MAP.filter((candidate) =>
      candidate.kind === 'hub' || candidate.kind === 'cluster'
    ).slice(0, 2)) {
      const state = changeTutorMapSelection(createTutorViewState(), node.kind, node.id);
      const output = html(state);
      const actions = output.match(
        /<div class="tutor-tray-actions">[\s\S]*?<\/div>/u
      )?.[0] ?? '';
      expect(actions).toContain(`data-tutor-target="${node.id}" data-tutor-role="primary" title="Set a target as primary">Primary`);
      expect(actions).toContain(`data-tutor-target="${node.id}" data-tutor-role="support" title="Add a target as support">Support`);
      expect(changeTutorTarget([], node.id, 'primary').selection)
        .toEqual([{ nodeId: node.id, role: 'primary' }]);
      expect(changeTutorTarget([], node.id, 'support').selection)
        .toEqual([{ nodeId: node.id, role: 'support' }]);
    }
  });

  it('R6 silently declines to duplicate a target already holding the requested role', () => {
    const hub = TUTOR_MAP.find((node) => node.kind === 'hub')!;
    let state = changeTutorMapSelection(createTutorViewState(), 'hub', hub.id);
    state.selection = [{ nodeId: hub.id, role: 'primary' }];
    const output = html(state);

    expect(output).toContain(`data-tutor-target="${hub.id}" data-tutor-role="primary" title="Set a target as primary">Primary`);
    expect(output).toContain(`data-tutor-target="${hub.id}" data-tutor-role="support" title="Add a target as support">Support`);
    expect(tutorTargetActionReason(state.selection, hub.id, 'primary')).toBeUndefined();
    expect(changeTutorTarget(state.selection, hub.id, 'primary'))
      .toEqual({ selection: state.selection });

    state.selection = [{ nodeId: hub.id, role: 'support' }];
    const supportOutput = html(state);
    expect(supportOutput).toContain(`data-tutor-target="${hub.id}" data-tutor-role="support" title="Add a target as support">Support`);
    expect(supportOutput).toContain(`data-tutor-target="${hub.id}" data-tutor-role="primary" title="Set a target as primary">Primary`);
    expect(tutorTargetActionReason(state.selection, hub.id, 'support')).toBeUndefined();
    expect(changeTutorTarget(state.selection, hub.id, 'support'))
      .toEqual({ selection: state.selection });
    expect(supportOutput).toContain('syncTutorTargetActions(target);');
    expect(supportOutput).toContain('controls.slice(0, changedIndex + 1)');
    expect(supportOutput).toContain("action.setAttribute('data-tutor-target', targetId)");
  });

  it('B7 keeps the opposite role live and uses it to promote or demote without duplication', () => {
    const hubs = TUTOR_MAP.filter((node) => node.kind === 'microTarget');
    const primary = changeTutorTarget([], hubs[0]!.id, 'primary').selection;
    const withSupport = changeTutorTarget(primary, hubs[1]!.id, 'support').selection;
    const promoted = changeTutorTarget(withSupport, hubs[1]!.id, 'primary').selection;
    const demoted = changeTutorTarget(primary, hubs[0]!.id, 'support').selection;

    expect(promoted).toEqual([
      { nodeId: hubs[0]!.id, role: 'primary' },
      { nodeId: hubs[1]!.id, role: 'primary' }
    ]);
    expect(demoted).toEqual([{ nodeId: hubs[0]!.id, role: 'support' }]);
  });

  /*
   * The fixture carries a support the promotion does not touch, and that is the whole
   * point of it. This test shipped with one primary and no supports, so deleting the line
   * that preserves existing supports changed nothing it could see and survived all 678
   * tests. The same defect reached the owner on 2026-08-25, in this same function, where
   * Make Primary discarded the reader's other supports while 496 tests passed, because the
   * only support in that fixture was the one being promoted. An assertion can be right
   * while its fixture cannot exercise it.
   */
  it('V74 R1 keeps the old Primary first and every other Support when adding a Primary', () => {
    const hubs = TUTOR_MAP.filter((node) => node.kind === 'microTarget');
    const bystander = hubs[2]!.id;
    const initial = [
      { nodeId: hubs[0]!.id, role: 'primary' as const },
      { nodeId: bystander, role: 'support' as const }
    ];
    const changed = changeTutorTarget(initial, hubs[1]!.id, 'primary');

    expect(changed.refusal).toBeUndefined();
    expect(changed.selection).toEqual([
      { nodeId: hubs[0]!.id, role: 'primary' },
      { nodeId: hubs[1]!.id, role: 'primary' },
      { nodeId: bystander, role: 'support' }
    ]);
    expect(changed.selection, 'the support nobody touched survives the promotion')
      .toContainEqual({ nodeId: bystander, role: 'support' });
    expect(changeTutorTarget.toString()).not.toContain('confirm');
  });

  /*
   * Blueprint 2.1 says KREN chooses an eligible child and names it. Naming it is the half a
   * reader notices: without it a lesson taught on something other than what they picked
   * reads as the wrong lesson rather than as Explore working.
   */
  it('names the chosen child and the parent it was chosen under', () => {
    const hub = TUTOR_MAP.find((node) => node.kind === 'hub')!;
    const child = TUTOR_MAP.find((node) => node.parentId === hub.id)!;
    const state = selectedState();
    const generated = lesson();
    state.lesson = {
      recipe: tutorRecipeFromState(state),
      lesson: {
        ...generated,
        primaryTarget: {
          ...generated.primaryTarget,
          nodeId: child.id,
          label: child.label,
          chosenUnder: hub.id
        }
      },
      findings: []
    };

    const output = html(state);

    expect(output).toContain(child.label);
    expect(output).toContain(`chosen for you under ${hub.label}`);
  });

  it('says nothing about a choice when the reader selected an exact target', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };

    expect(html(state)).not.toContain('chosen for you under');
  });

  it('V52 R3 renders the stale lesson notice once, inside the lesson', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    (state as TutorViewState & { lessonStale: boolean }).lessonStale = true;

    const output = html(state);
    const statusRegion = output.match(
      /<section class="tutor-action-status-region"[^>]*>[\s\S]*?<\/section>/u
    )?.[0] ?? '';
    const lessonOutput = output.match(
      /<article class="tutor-lesson"[^>]*>[\s\S]*?<\/article>/u
    )?.[0] ?? '';

    expect(statusRegion).not.toContain('This lesson was drafted from earlier settings.');
    expect(lessonOutput).toContain('This lesson was drafted from earlier settings.');
    expect(lessonOutput).toContain('Regenerating one example uses this lesson\'s earlier recipe.');
    expect(output.match(/This lesson was drafted from earlier settings\./gu)).toHaveLength(1);
    // Changed 2026-09-30: V175 shortens the button label while retaining its redrafting meaning.
    expect(load(output)('[data-command="generateTutorLesson"]').text()).toMatch(/^redraft\b/iu);
    expect(load(output)('[data-command="generateTutorLesson"]').text()).not.toMatch(/^draft\b/iu);
    expect(output).toContain('>Practice now</button>');
  });

  it('B1 renders Hub, Cluster, Skill, and Micro-target selects with the placeholder selected first', () => {
    const output = html(createTutorViewState());
    const controls = [...output.matchAll(/<select id="tutor-map-([^"]+)"[\s\S]*?<\/select>/gu)];

    expect(controls.map((match) => match[1])).toEqual([
      'hub', 'cluster', 'skill', 'microTarget'
    ]);
    for (const control of controls) {
      expect(control[0]).toMatch(/<option value="" selected>Select an option<\/option>/u);
    }
    expect(output).not.toContain('tutor-map-tree');
    expect(output).not.toContain('tutor-map-node');
  });

  it('R1 gives all four map levels the same setting-row grid and control placement as LESSON', () => {
    const output = html(createTutorViewState());
    const rows = [...output.matchAll(/<div class="setting tutor-map-level"[\s\S]*?<\/select><\/div>/gu)]
      .map((match) => match[0]);

    expect(rows).toHaveLength(4);
    expect(output).toMatch(/\.setting \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(120px, 42%\); align-items: center; gap: 12px;/u);
    expect(output).not.toMatch(/\.tutor-map-level \{[^}]*grid-template-columns/u);
    for (const row of rows) {
      expect(row.indexOf('class="setting-title"')).toBeLessThan(row.indexOf('class="setting-description"'));
      expect(row.indexOf('class="setting-description"')).toBeLessThan(row.indexOf('<select'));
    }
  });

  it('R2 explains Hub, Cluster, Skill, and Micro-target as product concepts', () => {
    const output = html(createTutorViewState());

    for (const description of [
      'A broad system of English knowledge and use.',
      'A related family of capabilities within a Hub.',
      'A teachable capability within a Cluster.',
      'An exact contrast or rule within a Skill.'
    ]) {
      expect(output).toContain(`<span id="tutor-map-`);
      expect(output).toContain(`class="setting-description">${description}</span>`);
    }
  });

  it('V47 R8 renders a vertically resizable target search field', () => {
    const output = html(createTutorViewState());
    const search = output.match(/<textarea class="tutor-map-search"[^>]*>[\s\S]*?<\/textarea>/u)?.[0] ?? '';

    expect(search).toContain('data-tutor-map-search');
    expect(search).toContain('rows="1"');
    expect(search).toContain('aria-label="Search learning map targets"');
    expect(output).toMatch(/\.tutor-map-search \{[^}]*resize: vertical;/u);
    expect(output).not.toContain('<input class="tutor-map-search"');
    expect(output).not.toContain('<span class="setting-title">Search');
  });

  it('V48 R1 and V63 R1 keep Ask reachable for questions and editor diagnosis', () => {
    const output = html(createTutorViewState());
    const mapSection = output.match(
      /<details[^>]*data-persist-id="tutor-map" open>[\s\S]*?<\/details>/u
    )?.[0] ?? '';
    const searchRow = mapSection.match(
      /<div class="tutor-map-search-row">[\s\S]*?<\/div>/u
    )?.[0] ?? '';

    expect(mapSection, 'the map and its find control are open when the reader arrives')
      .not.toBe('');
    expect(searchRow).toContain('data-tutor-map-search');
    expect(searchRow).toContain('data-command="findTutorTargets"');
    expect(searchRow).toContain('aria-label="Find learning map targets"');
    expect(searchRow).toContain('data-command="askTutorQuestion"');
    expect(searchRow).toContain('data-tutor-ask');
    // Changed 2026-09-24 for V147: as with View diagnostic report on this row, one concise
    // phrase can state the complete action in both the tooltip and accessible name.
    expect(searchRow).toContain(
      'title="Ask or analyze text" aria-label="Ask or analyze text"'
    );
    expect(searchRow).toContain(iconSvgMarkup('ask'));
    expect(searchRow.indexOf('data-tutor-map-search'))
      .toBeLessThan(searchRow.indexOf('data-tutor-find-targets'));
    expect(searchRow.indexOf('data-tutor-find-targets'))
      .toBeLessThan(searchRow.indexOf('data-tutor-ask'));
    expect(output).toContain('filterTutorMap(target.value);');
    expect(output).toContain("vscode.postMessage({ command: 'updateTutorSearch', search: target.value });");
    expect(output).toContain("event.key !== 'Enter'");
    expect(output).toContain("vscode.postMessage({ command: 'findTutorTargets', search: search.value });");
    expect(output).toContain("vscode.postMessage({ command: 'askTutorQuestion', search: search.value });");
  });

  it('V42 R3 uses the information icon beside all four learning-map level names', () => {
    const output = html(createTutorViewState());
    const headings = [...output.matchAll(/<span class="tutor-map-level-heading">[\s\S]*?<\/span>/gu)]
      .map((match) => match[0]);

    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      expect(heading).toContain('data-tutor-info-toggle');
      expect(heading).toContain('class="secondary icon-button tutor-map-information"');
      // 2026-10-04: the owner's information glyph has a filled dot and one curved stem.
      expect(load(heading)('svg circle[fill="currentColor"][stroke="none"]')).toHaveLength(1);
      expect(load(heading)('svg path')).toHaveLength(1);
      expect(load(heading)('svg path').attr('stroke-width')).toBe('2.4');
      expect(heading).not.toContain(iconSvgMarkup('menu'));
      expect(heading).not.toContain('>i</button>');
      expect(
        heading.indexOf('data-tutor-info-toggle'),
        'the information control precedes the level name it belongs to'
      ).toBeLessThan(heading.indexOf('class="setting-title"'));
    }
  });

  it('V43 R1 keeps focus visible on every information control', () => {
    const output = html(createTutorViewState());

    // Changed 2026-10-18: V264, owner item I44, Credentials also uses the information glyph, so count map controls within the map.
    expect(load(output)('#tutor-screen .tutor-map-level-heading .tutor-map-information'))
      .toHaveLength(4);
    expect(output).toMatch(
      /\.tutor-map-information:focus-visible \{ outline: 1px solid var\(--vscode-focusBorder\); outline-offset: 2px; \}/u
    );
  });

  it('V44 R3 keeps an enabled information button available after its level has a selection', () => {
    const hub = TUTOR_MAP.find((node) => node.kind === 'hub')!;
    const output = html(changeTutorMapSelection(createTutorViewState(), 'hub', hub.id));
    const hubHeading = output.match(
      /<span class="tutor-map-level-heading">[\s\S]*?<\/span>/u
    )?.[0] ?? '';
    const informationButton = hubHeading.match(
      /<button[^>]*class="secondary icon-button tutor-map-information"[^>]*>/u
    )?.[0] ?? '';

    expect(informationButton).not.toBe('');
    expect(informationButton).not.toContain('aria-disabled="true"');
  });

  it('V43 R2 gives drafting and practice one voice in actions, waits, and stale notices', () => {
    const initial = html(selectedState());
    const drafted = selectedState();
    drafted.lesson = { recipe: tutorRecipeFromState(drafted), lesson: lesson(), findings: [] };
    drafted.lessonStale = true;
    const practised = selectedState();
    practised.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: []
    };
    const drafting = selectedState();
    drafting.lessonBusy = true;
    const redrafting = { ...drafted, lessonBusy: true };
    const preparingPractice = selectedState();
    preparingPractice.exerciseBusy = true;
    const preparingNewPractice = { ...practised, exerciseBusy: true };

    // Changed 2026-09-30: V175 names the draft action with its shorter label.
    expect(load(initial)('[data-command="generateTutorLesson"]').text()).toMatch(/^draft\b/iu);
    // No lesson, so no practice action; it is offered only in the lesson panel.
    expect(initial).not.toContain('>Practice now</button>');
    expect(html(drafted)).toContain('>Practice now</button>');
    expect(load(html(drafted))('[data-command="generateTutorLesson"]').text()).toMatch(/^redraft\b/iu);
    practised.lesson = drafted.lesson;
    expect(html(practised)).toContain('>Practice again</button>');
    expect(html(drafting)).toContain('Drafting a lesson. Please wait.');
    expect(html(redrafting)).toContain('Redrafting the lesson. Please wait.');
    expect(html(preparingPractice)).toContain('Preparing practice. Please wait.');
    expect(html(preparingNewPractice)).toContain('Preparing new practice. Please wait.');
    expect(html(drafting)).toContain(
      'id="tutor-action-lesson-busy" class="tutor-action-status">Drafting the lesson.'
    );
    // Changed 2026-09-23: the status names the work, not a channel nobody can choose.
    expect(html(preparingPractice)).toContain(
      'id="tutor-action-exercise-busy" class="tutor-action-status">Preparing practice.'
    );
    expect(html(drafted)).toContain('This lesson was drafted from earlier settings.');
    expect(html(drafted)).toContain('Redraft lesson uses the current recipe.');
  });

  it('V44 R1 left-aligns drafting actions in Lesson while keeping target actions right-aligned', () => {
    const output = html(selectedState());
    const headingRow = output.match(
      /<div class="tutor-heading-row"[^>]*>[\s\S]*?<\/div><\/div>/u
    )?.[0] ?? '';

    // Changed 2026-09-30: V175 places drafting actions below settings and left-aligns the row.
    expect(headingRow).not.toContain('data-tutor-heading-actions');
    expect(load(output)('.tutor-lesson-section > .settings-buttons.tutor-heading-actions')).toHaveLength(1);
    expect(output).toMatch(/\.tutor-heading-actions \{[^}]*justify-content: flex-start;/u);
  });

  it('V45 presentation R1 places all three target actions on the Selected targets heading line', () => {
    const output = html(changeTutorMapSelection(selectedState(), primaryNode.kind, primaryNode.id));
    const cascade = output.slice(
      output.indexOf('<div class="tutor-map-cascade">'),
      output.indexOf('<div class="tutor-tray"')
    );
    const trayHeading = output.match(
      /<div class="tutor-tray-heading">[\s\S]*?<\/div><\/div>/u
    )?.[0] ?? '';
    const trayActions = output.match(
      /<div class="tutor-tray-actions">[\s\S]*?<\/div>/u
    )?.[0] ?? '';

    expect(cascade).not.toContain('>Primary</button>');
    expect(cascade).not.toContain('>Support</button>');
    expect(trayHeading).toContain('<strong>Selected targets</strong>');
    expect(trayActions).toContain('>Primary</button>');
    expect(trayActions).toContain('>Support</button>');
    expect(trayActions).toContain('>Clear all</button>');
    expect(trayActions.indexOf('>Primary</button>'))
      .toBeLessThan(trayActions.indexOf('>Clear all</button>'));
    expect(trayActions.indexOf('>Support</button>'))
      .toBeLessThan(trayActions.indexOf('>Clear all</button>'));
    expect(trayHeading.indexOf('<strong>Selected targets</strong>'))
      .toBeLessThan(trayHeading.indexOf('<div class="tutor-tray-actions">'));
    expect(output.indexOf('<div class="tutor-tray-heading">'))
      .toBeLessThan(output.indexOf('<div class="tutor-tray-row">'));
    expect(output).toMatch(/\.tutor-tray-heading \{ display: flex; flex-wrap: nowrap;/u);
  });

  it('V58 R2 keeps the Selected targets heading actions on one line with 8px below it', () => {
    const output = html(changeTutorMapSelection(selectedState(), primaryNode.kind, primaryNode.id));
    const heading = output.match(/<div class="tutor-tray-heading">[\s\S]*?<\/div><\/div>/u)?.[0] ?? '';
    const headingRule = output.match(/\.tutor-tray-heading \{([^}]*)\}/u)?.[1] ?? '';
    const actionsRule = [...output.matchAll(/\.tutor-tray-actions \{([^}]*)\}/gu)]
      .map((match) => match[1] ?? '')
      .find((rule) => rule.includes('flex-wrap')) ?? '';

    expect(heading).toMatch(
      /<strong>Selected targets<\/strong><div class="tutor-tray-actions">[\s\S]*>Primary<\/button>[\s\S]*>Support<\/button>[\s\S]*>Clear all<\/button>/u
    );
    expect(headingRule).toContain('display: flex');
    expect(headingRule).toContain('flex-wrap: nowrap');
    expect(headingRule).toContain('margin-bottom: 8px');
    expect(actionsRule).toContain('flex-wrap: nowrap');
  });

  it('V43 R3 derives shared widths for target and practice actions while drafting actions keep fixed widths', () => {
    const output = html(selectedState());
    const markedButtons = output.match(
      /<button[^>]*data-tutor-shared-action[^>]*>[\s\S]*?<\/button>/gu
    ) ?? [];

    // Changed 2026-09-30: V175 excludes drafting actions; only the two target actions remain without a lesson.
    expect(markedButtons, 'only the named actions participate in the shared width')
      .toHaveLength(2);
    expect(markedButtons.some((button) => button.includes('data-command="generateTutorLesson"')))
      .toBe(false);
    expect(markedButtons.some((button) => button.includes('data-command="resetTutorSession"')))
      .toBe(false);
    expect(markedButtons.some((button) => button.includes('data-command="generateTutorExercises"')))
      .toBe(false);
    const withLesson = selectedState();
    withLesson.lesson = { recipe: tutorRecipeFromState(withLesson), lesson: lesson(), findings: [] };
    expect(html(withLesson)).toMatch(/<button[^>]*data-tutor-shared-action[^>]*data-command="generateTutorExercises"/u);
    expect(markedButtons.some((button) => button.includes('data-tutor-role="primary"')))
      .toBe(true);
    expect(markedButtons.some((button) => button.includes('data-tutor-role="support"')))
      .toBe(true);
    expect(output).toMatch(
      /\[data-tutor-shared-action\] \{[^}]*inline-size: var\(--tutor-shared-action-width, max-content\);/u
    );
    expect(output).toContain(
      "document.querySelectorAll('[data-tutor-shared-action]')"
    );
    expect(output).toContain('action.getBoundingClientRect().width');
    expect(output).toContain('Math.max(...');
    expect(output).toContain(
      "setProperty('--tutor-shared-action-width', widest + 'px')"
    );
  });

  it('R9 names the bottom-right list action Clear all and says nothing when unavailable', () => {
    const selected = html(selectedState());
    const selectedTray = selected.slice(
      selected.indexOf('<div class="tutor-tray"'),
      selected.indexOf('</div></div>', selected.indexOf('<div class="tutor-tray"')) + 12
    );
    const empty = html(createTutorViewState());

    expect(selectedTray).toContain('<div class="tutor-tray-actions">');
    expect(selectedTray).toContain('<button type="button" class="secondary" data-command="clearTutorTargets">Clear all</button>');
    expect(selectedTray.indexOf('>Clear all</button>')).toBeGreaterThan(selectedTray.indexOf('<strong>Compatibility:</strong>'));
    // Changed 2026-09-30: V175 leaves right alignment scoped to target actions.
    expect(selected).toMatch(/\.tutor-tray-actions \{ display: flex; justify-content: flex-end; \}/u);
    expect(empty).toMatch(/data-command="clearTutorTargets" aria-disabled="true"[^>]*>Clear all<\/button>/u);
    expect(empty).not.toContain('tutor-clear-targets-reason');
  });

  it('R11 keeps lower dropdowns accessibly disabled without visible instruction sentences', () => {
    const fresh = html(createTutorViewState());
    const cluster = fresh.match(/<select id="tutor-map-cluster"[^>]*>/u)?.[0] ?? '';
    const skill = fresh.match(/<select id="tutor-map-skill"[^>]*>/u)?.[0] ?? '';
    const microTarget = fresh.match(/<select id="tutor-map-microTarget"[^>]*>/u)?.[0] ?? '';

    for (const control of [cluster, skill, microTarget]) {
      expect(control).toContain('aria-disabled="true"');
      expect(control).toMatch(/aria-description="[^"]+"/u);
      expect(control).not.toMatch(/\sdisabled(?:\s|>)/u);
    }
    for (const sentence of [
      'Select a Hub first',
      'Select a Cluster first',
      'Select a Skill first'
    ]) {
      expect(fresh).not.toContain(sentence);
    }
    const cascade = fresh.slice(
      fresh.indexOf('<div class="tutor-map-cascade">'),
      fresh.indexOf('<div class="tutor-tray"')
    );
    expect(cascade).not.toMatch(/<p[^>]*class="tutor-map-reason"/u);

    const hub = TUTOR_MAP.find((node) => node.kind === 'hub')!;
    const withHub = html(changeTutorMapSelection(createTutorViewState(), 'hub', hub.id));
    expect(withHub.match(/<select id="tutor-map-cluster"[^>]*>/u)?.[0])
      .not.toContain('aria-disabled');
  });

  it('R11 leaves a ragged Micro-target accessibly unavailable without a visible explanation', () => {
    const raggedSkill = TUTOR_MAP.find((node) =>
      node.kind === 'skill' && !TUTOR_MAP.some((candidate) => candidate.parentId === node.id)
    )!;
    const state = changeTutorMapSelection(createTutorViewState(), 'skill', raggedSkill.id);
    const output = html(state);
    const microTarget = output.match(/<select id="tutor-map-microTarget"[^>]*>/u)?.[0] ?? '';

    expect(microTarget).toContain('aria-disabled="true"');
    expect(microTarget).toContain(`aria-description="This branch ends at Skill."`);
    expect(output).not.toContain('no finer targets in this branch');
    expect(output).toContain(`data-tutor-target="${raggedSkill.id}" data-tutor-role="primary" title="Set a target as primary">Primary`);
    expect(changeTutorTarget([], raggedSkill.id, 'primary').selection)
      .toEqual([{ nodeId: raggedSkill.id, role: 'primary' }]);
  });

  it('A1 renders exactly four parent foldables in the required order', () => {
    const output = html(createTutorViewState());
    const tutorPage = output.slice(output.indexOf('<section id="tutor-screen"'));
    // Changed 2026-09-30: V175 renames and moves Lesson settings above drafting.
    // Changed 2026-10-03: compare group identity and order without pinning its display wording.
    const headings = ['map', 'recipe', 'lesson', 'setting'];
    let previous = -1;
    for (const heading of headings) {
      const position = tutorPage.indexOf(`data-persist-id="tutor-${heading}"`);
      expect(position, heading).toBeGreaterThan(previous);
      previous = position;
    }
    expect(tutorPage.match(/<details[^>]*data-tutor-parent/gu)).toHaveLength(4);
  });

  it('A2 nests axes in Lesson settings and keeps voice and routing under SETTING', () => {
    // Changed 2026-10-03: axes belong only to the lesson, with their own folding preserved.
    const $ = load(html(createTutorViewState()));
    const lesson = $('details[data-persist-id="tutor-lesson"]');
    const setting = $('details[data-persist-id="tutor-setting"]');
    for (const id of ['channel', 'subject', 'register', 'shape', 'intent']) {
      expect($(`details[data-persist-id="tutor-${id}"]`)).toHaveLength(1);
      expect(lesson.find(`details[data-persist-id="tutor-${id}"]`)).toHaveLength(1);
      expect(setting.find(`details[data-persist-id="tutor-${id}"]`)).toHaveLength(0);
    }
    expect(lesson.find('[data-tutor-child]')).toHaveLength(5);
    expect(setting.find('[data-tutor-child]')).toHaveLength(2);
    expect(setting.text()).toMatch(/TUTOR VOICE.*LLM ROUTING/s);
  });

  it('A3 keeps exercise controls under LESSON and renders generated items after lesson output', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Use the target once.',
        targetIds: [primaryNode.id]
      }]
    };
    const output = html(state);
    const lessonParent = output.slice(
      output.indexOf('data-persist-id="tutor-lesson"'),
      output.indexOf('data-persist-id="tutor-setting"')
    );

    // Changed 2026-09-26: practice count moved below common errors; the exercise-only group is gone.
    expect(lessonParent).not.toContain('>Exercises and tests</span>');
    expect(lessonParent).not.toContain('>Channel</span>');
    expect(lessonParent).not.toContain('>Item count</span>');
    expect(lessonParent).not.toContain('data-setting="tutor.includePractice"');
    expect(lessonParent).toContain('>Practice item count</span>');
    expect(lessonParent.indexOf('>Practice item count</span>'))
      .toBeGreaterThan(lessonParent.indexOf('>Include common errors</span>'));
    expect(load(lessonParent)('[data-setting="tutor.includeCommonErrors"]')
      .closest('label').next('label').find('[data-setting="tutor.exerciseCount"]'))
      .toHaveLength(1);
    // Changed 2026-09-30: Lesson settings now precede outputs; bound this guard to its own disclosure.
    expect(load(output)('[data-persist-id="tutor-lesson"]').find('.tutor-exercises, .tutor-exercise')).toHaveLength(0);
    expect(output.indexOf('aria-label="Practice exercises"'))
      .toBeGreaterThan(output.indexOf('aria-label="Drafted lesson"'));
  });

  it('V165 keeps written practice while removing the exercise channel control', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Use the target once.',
        targetIds: [primaryNode.id]
      }]
    };
    const output = html(state);
    const start = output.indexOf('data-persist-id="tutor-lesson"');
    const exerciseSettings = output.slice(start, output.indexOf('data-persist-id="tutor-setting"'));

    expect(start).toBeGreaterThan(-1);
    expect(state.exerciseSet.channel).toBe('written');
    expect(state.exerciseSet.exercises[0]?.channel).toBe('written');
    expect(tutorExerciseChannelLabel(state.exerciseSet.channel)).toBe('Display-based');
    // Changed 2026-09-26: written remains the contract value, but the one-choice control is gone.
    // Changed 2026-10-03: the written modality now sits in this section, but practice has no channel picker.
    expect(exerciseSettings).not.toMatch(/data-setting="tutor\.exerciseChannel"/u);
    expect(exerciseSettings).not.toContain('>Channel</span>');
    expect(exerciseSettings).not.toContain('Display-based | 5 items');
  });

  it('A4 states current voice and model values without lesson axes in the parent summary', () => {
    const state = createTutorViewState();
    state.settings.axes.modality = 'spoken';
    state.settings.axes.domain = 'business';
    state.settings.axes.formality = 'neutral';
    state.settings.axes.perspective = 'first person';
    state.settings.axes.rhetoricalMode = 'explain';
    const output = html(state);
    const start = output.indexOf('data-persist-id="tutor-setting"');
    const summary = output.slice(start, output.indexOf('</summary>', start));

    // Changed 2026-10-03: V190 summarizes voice/model controls; axes belong to LESSON SETTING.
    expect(summary).toContain(settings.tutorModel);
    expect(summary).toContain(load(output)('[data-model-preset="tutor.liveModel"] option[selected]').val());
    expect(summary).toContain(state.conversation.liveVoice);
    for (const value of ['Spoken', 'Business', 'Neutral', 'First Person', 'Explain']) {
      expect(summary).not.toContain(value);
    }
    expect(summary).not.toContain('children');
  });

  it('A5 marks every foldable as either a parent or child and stops at two levels', () => {
    const output = html(createTutorViewState());
    const foldables = [...output.matchAll(/<details[^>]*data-tutor-foldable[^>]*>/gu)]
      .map((match) => match[0]);

    expect(foldables.filter((tag) => tag.includes('data-tutor-parent'))).toHaveLength(4);
    // Changed 2026-09-26: the exercise-only child is gone; seven SETTING children remain.
    expect(foldables.filter((tag) => tag.includes('data-tutor-child'))).toHaveLength(7);
    expect(foldables.every((tag) =>
      tag.includes('data-tutor-parent') !== tag.includes('data-tutor-child')
    )).toBe(true);
  });

  it('A6 opens a parent without opening any of its children', () => {
    const output = html(createTutorViewState());
    const parent = output.match(/<details[^>]*data-tutor-parent[^>]*data-persist-id="tutor-map"[^>]*>/u)?.[0] ?? '';
    const children = [...output.matchAll(/<details[^>]*data-tutor-child[^>]*>/gu)]
      .map((match) => match[0]);

    expect(parent).toMatch(/ open>/u);
    // Changed 2026-09-26: seven SETTING children remain closed when their parent opens.
    expect(children).toHaveLength(7);
    expect(children.every((tag) => !/ open>/u.test(tag))).toBe(true);
  });

  it('A7 persists independent open state for both levels and accepts several open sections', () => {
    const output = html(createTutorViewState());
    const ids = [...output.matchAll(/data-tutor-foldable[^>]*data-persist-id="([^"]+)"/gu)]
      .map((match) => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect(output).toContain('Several tutor sections may have been open in an earlier saved state.');
    expect(output).toContain("document.querySelectorAll('details[data-persist-id]')");
    expect(output).toContain('openSections: { ...openSections, [id]: section.open }');
    expect(output).not.toContain('pinnedTutorSections');
  });

  it('A8 renders lesson and exercise output as ordinary output rather than foldables', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{ id: 'exercise-1', channel: 'written', prompt: 'Answer.', targetIds: [primaryNode.id] }]
    };
    const output = html(state);

    expect(output).toContain('<article class="tutor-lesson" data-tutor-result="lesson" aria-label="Drafted lesson">');
    expect(output).toContain('<div class="tutor-exercises" data-tutor-result="exercises" role="region" aria-label="Practice exercises">');
    expect(output).not.toMatch(/<details[^>]*class="[^"]*tutor-(?:lesson|exercises)/u);
  });

  it('V64 R1, V98 keeps Conversation beside Practice as ordinary tutor output', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'A practice prompt that stays separate.',
        targetIds: [primaryNode.id]
      }]
    };
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'stopped',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [{
        question: 'What happened?',
        learnerAnswer: 'I go home.',
        correction: 'I went home.',
        targetId: primaryNode.id,
        explanation: 'A completed past event takes the past form.',
        nextQuestion: 'What did you do at home?'
      }],
      currentTurnIndex: 0,
      currentQuestion: 'What did you do at home?',
      draftAnswer: '',
      busy: false
    };

    const output = html(state);
    const practiceIndex = output.indexOf('data-tutor-result="exercises"');
    const conversationIndex = output.indexOf('class="tutor-conversation"');
    const conversation = output.slice(conversationIndex, output.indexOf('</section>', conversationIndex) + 10);
    const $ = load(output);
    const conversationBox = $('section.tutor-conversation[data-tutor-result="conversation"]');

    expect(practiceIndex).toBeGreaterThan(-1);
    expect(conversationIndex).toBeGreaterThan(practiceIndex);
    // Changed 2026-09-16: V106 keeps the heading outside the white box with its introduction
    // as the sibling between them.
    expect(conversationBox.prev().prev().is('h2#tutor-conversation-heading')).toBe(true);
    expect(conversationBox.prev().is('p.tutor-conversation-intro')).toBe(true);
    expect(conversationBox.find('h2')).toHaveLength(0);
    expect(conversation).toContain('This conversation is stopped.');
    expect(conversation).toContain('I went home.');
    // Changed 2026-09-25 for V156: this is a stopped conversation, whose Start new command
    // returns to setup; the idle Start button still uses startTutorConversation.
    expect(conversation).toContain('data-command="startNewTutorConversation"');
    expect(conversation).not.toContain('role="dialog"');
    expect(conversation).not.toContain('aria-modal');

    // Changed 2026-10-21 (owner, I56/I57): select lesson explicitly to retain unfinished-source coverage.
    const emptyState = createTutorViewState();
    emptyState.conversation.from = 'lesson';
    const empty = html(emptyState);
    // Changed 2026-09-16: V105 names this command in CSS, so inspect rendered controls
    // instead of mistaking a stylesheet selector for an available button.
    // Changed 2026-10-21 (owner, I56/I57): blocked actions stay reachable and explain completion in their tooltips.
    for (const command of ['startTutorConversation', 'startTutorConversationDemo']) {
      const button = load(empty)(`button[data-command="${command}"]`);
      expect(button).toHaveLength(1);
      expect(button.is('[disabled]')).toBe(true);
      expect(button.attr('title')).toBe('Finish the lesson and its practice first.');
    }
    expect(load(empty)('[data-tutor-open-conversation-settings]:not([disabled])')).toHaveLength(1);
    expect(load(empty)('button[data-command="resetTutorConversationDefaults"][hidden]')).toHaveLength(1);
    expect(load(empty)('button[data-command="useTutorSituationSource"]')).toHaveLength(0);
    expect(load(empty)('.tutor-conversation-start').text()).not.toContain('Finish the lesson and its practice first.');
  });

  it('V66 R1 says an unchanged answer was already correct and keeps the explanation', () => {
    const state = selectedState();
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'stopped',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [{
        question: 'What happened?',
        learnerAnswer: 'I went home.',
        correction: 'I went home.',
        targetId: primaryNode.id,
        explanation: 'The simple past is natural for this completed event.',
        nextQuestion: 'What did you do there?'
      }],
      currentTurnIndex: 0,
      currentQuestion: 'What did you do there?',
      draftAnswer: '',
      busy: false
    };

    const output = renderTutorConversation(state);

    // Changed 2026-09-17 at the reader's instruction: an answer that was already right shows
    // nothing but the answer. The match itself is what this asserts, through the absence of
    // the coaching block that a corrected turn carries.
    expect(output).not.toContain('Already correct.');
    expect(output).not.toContain('The simple past is natural for this completed event.');
    expect(output).not.toContain('data-tutor-turn-feedback');
    expect(output).toContain('I went home.');
  });

  it('V66 R1 treats surrounding whitespace as no correction', () => {
    const state = selectedState();
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'stopped',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [{
        question: 'What happened?',
        learnerAnswer: 'I went home.',
        correction: ' \n\tI went home.\u00a0',
        targetId: primaryNode.id,
        explanation: 'The answer already uses the natural tense.',
        nextQuestion: 'What did you do there?'
      }],
      currentTurnIndex: 0,
      currentQuestion: 'What did you do there?',
      draftAnswer: '',
      busy: false
    };

    const output = renderTutorConversation(state);

    // Changed 2026-09-17: surrounding whitespace is still no correction, and no correction
    // now means no coaching block at all.
    expect(output).not.toContain('Already correct.');
    expect(output).not.toContain('The answer already uses the natural tense.');
    expect(output).not.toContain('data-tutor-turn-feedback');
  });

  it('V66 R1 treats straight and typographic quotes as the same answer', () => {
    const state = selectedState();
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'stopped',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [{
        question: 'What did she say?',
        learnerAnswer: `She said, "I'm ready."`,
        correction: 'She said, “I’m ready.”',
        targetId: primaryNode.id,
        explanation: 'Only the quote glyphs differ.',
        nextQuestion: 'What happened next?'
      }],
      currentTurnIndex: 0,
      currentQuestion: 'What happened next?',
      draftAnswer: '',
      busy: false
    };

    const output = renderTutorConversation(state);

    // Changed 2026-09-17: quote glyphs are still the same answer, and the same answer now
    // renders no coaching block.
    expect(output).not.toContain('Already correct.');
    expect(output).not.toContain('Only the quote glyphs differ.');
    expect(output).not.toContain('data-tutor-turn-feedback');
  });

  it('V66 R1 places a genuinely changed answer in quiet inline feedback', () => {
    const state = selectedState();
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'stopped',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [{
        question: 'What happened?',
        learnerAnswer: 'I go home.',
        correction: 'I went home.',
        targetId: primaryNode.id,
        explanation: 'Use the simple past for this completed event.',
        nextQuestion: 'What did you do there?'
      }],
      currentTurnIndex: 0,
      currentQuestion: 'What did you do there?',
      draftAnswer: '',
      busy: false
    };

    const output = renderTutorConversation(state);

    expect(load(output)('[data-tutor-correction]').text()).toBe('I went home.');
    expect(output).toContain('Use the simple past for this completed event.');
    expect(output).not.toContain('Already correct.');
  });

  it('V66 R2 keeps every assessment on its transcript turn and omits turn navigation', () => {
    const state = selectedState();
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'stopped',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [
        {
          question: 'First unique question?',
          learnerAnswer: 'First unique answer.',
          correction: 'First unique correction.',
          explanation: 'First unique explanation.',
          nextQuestion: 'First unique follow-up?'
        },
        {
          question: 'Second unique question?',
          learnerAnswer: 'Second unique answer.',
          correction: 'Second unique correction.',
          explanation: 'Second unique explanation.',
          nextQuestion: 'Second unique follow-up?'
        },
        {
          question: 'Third unique question?',
          learnerAnswer: 'Third unique answer.',
          correction: 'Third unique correction.',
          explanation: 'Third unique explanation.',
          nextQuestion: 'Third unique follow-up?'
        }
      ],
      currentTurnIndex: 1,
      currentQuestion: 'Third unique follow-up?',
      draftAnswer: '',
      busy: false
    };

    const output = renderTutorConversation(state);
    const transcript = load(output)('[data-tutor-transcript]');
    expect(transcript.text()).toContain('First unique question?');
    expect(transcript.text()).toContain('Third unique answer.');
    for (const position of ['First', 'Second', 'Third']) {
      expect(transcript.text()).toContain(`${position} unique question?`);
      expect(transcript.text()).toContain(`${position} unique answer.`);
      expect(transcript.text()).toContain(`${position} unique correction.`);
      expect(transcript.text()).toContain(`${position} unique explanation.`);
    }
    expect(transcript.find('[data-tutor-turn-feedback]')).toHaveLength(3);
    expect(output).not.toContain('data-tutor-conversation-turn');
    expect(output).not.toContain('data-command="showPreviousTutorConversationTurn"');
    expect(output).not.toContain('data-command="showNextTutorConversationTurn"');
  });

  it('V66 R3 places the selection message inside Selected targets after Compatibility', () => {
    const state = selectedState();
    state.selectionMessage = 'The model chose these learning-map targets for this question.';

    const output = html(state);
    const trayStart = output.indexOf('<div class="tutor-tray" aria-label="Selected targets">');
    const compatibility = output.indexOf('<p><strong>Compatibility:</strong>', trayStart);
    const message = output.indexOf(
      `<p class="tutor-selection-footnote" role="status">${state.selectionMessage}</p>`
    );
    // `output.indexOf('</div>', message)` finds the first close tag *after* the message, so
    // `message < trayEnd` held wherever the message sat. Moving it back outside the tray left
    // all 917 tests passing. Found by mutation on 2026-09-04. The tray's real end has to be
    // found by balancing its own tags from where it opens.
    const trayEnd = (() => {
      let depth = 0;
      const tag = /<div\b|<\/div>/gu;
      tag.lastIndex = trayStart;
      for (let m = tag.exec(output); m; m = tag.exec(output)) {
        depth += m[0] === '</div>' ? -1 : 1;
        if (depth === 0) return m.index;
      }
      return -1;
    })();

    expect(trayStart).toBeGreaterThan(-1);
    expect(trayEnd, 'the Selected targets panel never closes').toBeGreaterThan(trayStart);
    expect(compatibility).toBeGreaterThan(trayStart);
    expect(message).toBeGreaterThan(compatibility);
    expect(message, 'the message sits outside the Selected targets panel').toBeLessThan(trayEnd);
    expect(output.slice(0, trayStart)).not.toContain(state.selectionMessage);
  });

  it('V60 R1 renders only the current exercise instead of hiding the other prompts', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [
        { id: 'exercise-1', channel: 'written', prompt: 'First unique prompt.', targetIds: [primaryNode.id] },
        { id: 'exercise-2', channel: 'written', prompt: 'Second unique prompt.', targetIds: [primaryNode.id] },
        { id: 'exercise-3', channel: 'written', prompt: 'Third unique prompt.', targetIds: [primaryNode.id] }
      ]
    };
    state.currentExerciseIndex = 1;

    const output = html(state);

    expect(output).toContain('Second unique prompt.');
    expect(output).not.toContain('First unique prompt.');
    expect(output).not.toContain('Third unique prompt.');
  });

  it('V60 R2 shows practice arrows beside Ask, enables Back, and guards Next on an answer or review', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [
        { id: 'exercise-1', channel: 'written', prompt: 'First prompt.', targetIds: [primaryNode.id] },
        { id: 'exercise-2', channel: 'written', prompt: 'Second prompt.', targetIds: [primaryNode.id] },
        { id: 'exercise-3', channel: 'written', prompt: 'Third prompt.', targetIds: [primaryNode.id] }
      ]
    };
    const reviewed = (exerciseId: string): TrainingReview => ({
      schemaVersion: 1,
      exerciseId,
      learnerText: 'A reviewed answer.',
      correct: [{ excerpt: 'reviewed answer', reason: 'It uses the target.' }],
      incorrect: []
    });

    state.currentExerciseIndex = 1;
    let output = html(state);
    // Changed 2026-10-04: Back remains available; only Next cannot skip an unanswered item.
    expect(load(output)('[data-command="showPreviousTutorExercise"]:not([disabled])')).toHaveLength(1);
    expect(load(output)('[data-command="showNextTutorExercise"][disabled][aria-disabled="true"]')).toHaveLength(1);
    // Ask is rendered from the start and disabled until a review exists, per the owner's
    // 2026-09-13 rule that this row holds its places. Absence became disabled.
    expect(output).toMatch(/data-command="openTutorPracticeAsk"[^>]*disabled/u);

    state.reviews = { 'exercise-2': reviewed('exercise-2') };
    output = html(state);
    /*
     * The row was one group with Ask between the arrows. As of 2026-09-13 it is two: the left
     * controls hold their places, and Back, the position and Next sit together on the right.
     * So Ask no longer separates the arrows, and the order to check is within each group.
     */
    const actions = output.match(/<div class="tutor-exercise-controls">[\s\S]*?<\/div><\/div>/u)?.[0] ?? '';
    const previous = actions.match(
      /<button[^>]*data-command="showPreviousTutorExercise"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';
    const next = actions.match(
      /<button[^>]*data-command="showNextTutorExercise"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';
    expect(actions.indexOf('openTutorPracticeAsk'), 'the left controls come first')
      .toBeLessThan(actions.indexOf('showPreviousTutorExercise'));
    expect(actions.indexOf('showPreviousTutorExercise'), 'Back, position, Next, in that order')
      .toBeLessThan(actions.indexOf('tutor-exercise-position'));
    expect(actions.indexOf('tutor-exercise-position'))
      .toBeLessThan(actions.indexOf('showNextTutorExercise'));
    expect(previous).toContain('class="icon-button tutor-action-icon"');
    expect(previous).toContain('aria-label="Go to the previous practice item"');
    expect(previous).toContain(iconSvgMarkup('back'));
    expect(next).toContain('class="icon-button tutor-action-icon tutor-next-icon"');
    expect(next).toContain('aria-label="Go to the next practice item"');
    expect(next).toContain(iconSvgMarkup('back'));
    expect(output).toContain('.tutor-next-icon svg { transform: rotate(180deg); }');
    expect(output).toContain('.tutor-content .icon-button { color: var(--vscode-button-foreground); background: var(--vscode-button-background);');

    state.currentExerciseIndex = 0;
    state.reviews = { 'exercise-1': reviewed('exercise-1') };
    output = html(state);
    // Changed 2026-09-30: boundary arrows are present and disabled where unavailable.
    expect(load(output)('[data-command="showPreviousTutorExercise"][disabled][aria-disabled="true"]')).toHaveLength(1);
    expect(load(output)('[data-command="showNextTutorExercise"]:not([disabled])')).toHaveLength(1);

    state.currentExerciseIndex = 2;
    state.reviews = { 'exercise-3': reviewed('exercise-3') };
    output = html(state);
    expect(load(output)('[data-command="showPreviousTutorExercise"]:not([disabled])')).toHaveLength(1);
    expect(load(output)('[data-command="showNextTutorExercise"][disabled][aria-disabled="true"]')).toHaveLength(1);
  });

  it('V60 R4 preserves the current position across redraws and resets a replacement set', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [
        { id: 'old-1', channel: 'written', prompt: 'Old first.', targetIds: [primaryNode.id] },
        { id: 'old-2', channel: 'written', prompt: 'Old second.', targetIds: [primaryNode.id] },
        { id: 'old-3', channel: 'written', prompt: 'Old third.', targetIds: [primaryNode.id] }
      ]
    };
    state.currentExerciseIndex = 2;

    expect(html(state)).toContain('Old third.');
    state.selectionMessage = 'An unrelated redraw happened.';
    expect(html(state)).toContain('Old third.');
    expect(state.currentExerciseIndex).toBe(2);

    const replacement = replaceTutorExerciseSet(state, {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [
        { id: 'new-1', channel: 'written', prompt: 'New first.', targetIds: [primaryNode.id] },
        { id: 'new-2', channel: 'written', prompt: 'New second.', targetIds: [primaryNode.id] }
      ]
    });
    expect(replacement.currentExerciseIndex).toBe(0);
    expect(html(replacement)).toContain('New first.');
    expect(html(replacement)).not.toContain('New second.');
  });

  it('A9 leaves every parent and child open attribute unchanged while generating', () => {
    const idle = selectedState();
    const generating = selectedState();
    generating.lessonBusy = true;
    const foldables = (output: string): string[] =>
      [...output.matchAll(/<details[^>]*data-tutor-(?:parent|child)[^>]*>/gu)]
        .map((match) => match[0]);

    expect(foldables(html(generating))).toEqual(foldables(html(idle)));
  });

  it('B14 places name search above Hub and maps a chosen result to all four dropdowns', () => {
    const levelFour = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
    let state = createTutorViewState();
    state.mapSearch = levelFour.label;
    state = changeTutorMapSelection(state, 'microTarget', levelFour.id);
    const output = html(state, {
      focusTutorTargetId: primaryNode.id,
      tutorAnnouncement: `${primaryNode.label} is now Primary.`
    });

    expect(output.indexOf('data-tutor-map-search')).toBeLessThan(output.indexOf('id="tutor-map-hub"'));
    expect(output).toContain(`data-command="updateTutorMapPath" data-tutor-map-level="microTarget" data-tutor-target="${levelFour.id}"`);
    for (const node of tutorMapPathForNode(levelFour.id)) {
      expect(output).toContain(`<option value="${node.id}" selected>${node.label}</option>`);
    }
    expect(output).toContain("name.includes(search)");
    expect(output).toContain(`data-tutor-target="${levelFour.id}" data-tutor-role="primary" title="Set a target as primary">Primary`);
    expect(output).toContain(`data-tutor-target="${levelFour.id}" data-tutor-role="support" title="Add a target as support">Support`);
    expect(output).toContain("document.body.getAttribute('data-focus-tutor-target')");
    expect(output).toContain('target.focus({ preventScroll: true })');
    expect(output).toContain(`data-focus-tutor-target="${primaryNode.id}"`);
    expect(output).toContain(`${primaryNode.label} is now Primary.`);
    expect(output).toContain('role="status" aria-live="polite"');
    expect(output).toContain('tutorLiveRegion.textContent = tutorAnnouncement');
  });

  it('V46 R6 keeps the three-Support cap and accepts two Supports from one Cluster', () => {
    const hubs = TUTOR_MAP.filter((node) => node.kind === 'hub');
    let full = changeTutorMapSelection(createTutorViewState(), 'hub', hubs[3]!.id);
    full.selection = hubs.slice(0, 3).map((node) => ({
      nodeId: node.id,
      role: 'support' as const
    }));
    expect(html(full)).toContain('Up to three Primary targets and three Support targets.');
    expect(tutorTargetActionReason(full.selection, hubs[3]!.id, 'support'))
      .toBe('three support targets is the limit');

    const cluster = TUTOR_MAP.find((node) =>
      node.kind === 'cluster' &&
      TUTOR_MAP.filter((candidate) => candidate.parentId === node.id).length >= 2
    )!;
    const sameCluster = TUTOR_MAP.filter((node) => node.parentId === cluster.id).slice(0, 2);
    let clustered = changeTutorMapSelection(
      createTutorViewState(),
      sameCluster[1]!.kind,
      sameCluster[1]!.id
    );
    clustered.selection = [{ nodeId: sameCluster[0]!.id, role: 'support' }];
    const changed = changeTutorTarget(clustered.selection, sameCluster[1]!.id, 'support');

    expect(changed.refusal).toBeUndefined();
    expect(changed.selection).toEqual([
      { nodeId: sameCluster[0]!.id, role: 'support' },
      { nodeId: sameCluster[1]!.id, role: 'support' }
    ]);
    expect(html({ ...clustered, selection: changed.selection }))
      .not.toContain('already one support target from');
  });

  /*
   * B13 asks that an unavailable control expose its reason. A control can satisfy that in
   * the markup and fail it for the reader, by naming an element that is not rendered in the
   * state that made the control unavailable. That is what the Generate button did while a
   * lesson was generating: it named the readiness paragraph, which exists only when the
   * reason is an unready selection.
   *
   * This checks every describedby on the page rather than that one button, in the four
   * states that change which reasons are live, because the next dangling reference will be
   * somewhere else.
   */
  it('B13 resolves every aria-describedby to an element that is actually rendered', () => {
    const busy = selectedState();
    busy.lessonBusy = true;
    const busyWithLesson = selectedState();
    busyWithLesson.lessonBusy = true;
    busyWithLesson.lesson = {
      recipe: tutorRecipeFromState(busyWithLesson), lesson: lesson(), findings: []
    };
    const exercisesBusy = selectedState();
    exercisesBusy.exerciseBusy = true;

    for (const [name, state] of [
      ['nothing selected', createTutorViewState()],
      ['a valid selection', selectedState()],
      ['a lesson generating', busy],
      ['a lesson regenerating', busyWithLesson],
      ['exercises generating', exercisesBusy]
    ] as const) {
      const output = html(state);
      const referenced = [...output.matchAll(/aria-describedby="([^"]+)"/gu)]
        .flatMap((match) => match[1]!.split(/\s+/u));
      const present = new Set(
        [...output.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]!)
      );
      for (const id of referenced) {
        expect(present.has(id), `${name}: aria-describedby="${id}" names no rendered element`)
          .toBe(true);
      }
    }
  });

  it('B12 shows current-node information fields and omits an unavailable example line', () => {
    const node = TUTOR_MAP.find((candidate) =>
      candidate.kind === 'skill' && candidate.currency && candidate.regionalScope
    )!;
    const renderInformation = (): string => {
      const output = html(changeTutorMapSelection(createTutorViewState(), 'skill', node.id));
      const start = output.indexOf('id="tutor-map-skill-information"');
      return output.slice(start, output.indexOf('</dl>', start));
    };
    const information = renderInformation();

    for (const field of [
      'Description', 'Example', 'Suggested level', 'Modalities', 'Prerequisites',
      'Commonly paired targets', 'Conflicts', 'Usage status'
    ]) {
      expect(information).toContain(`<dt>${field}</dt>`);
    }
    expect(information).toContain(node.description);
    expect(information).toContain(`${node.levelRange.minimum}-${node.levelRange.maximum}`);
    // The status is rendered sentence-cased, so compare without case rather than
    // pinning the capitalisation in two places.
    expect(information.toLowerCase()).toContain(node.currency!.toLowerCase());

    /*
     * Blueprint 5.2 requires a usage status on every target. Both fields it is built from
     * are optional on the node, and the first version of this control rendered the line
     * only where one of them happened to exist, so a hub with neither showed no status and
     * the reader could not tell contemporary from unknown. A node stripped of both still
     * has to say something.
     */
    const currency = node.currency;
    const regionalScope = node.regionalScope;
    delete node.currency;
    delete node.regionalScope;
    try {
      expect(renderInformation(), 'a node carrying neither field still states its status')
        .toContain('<dt>Usage status</dt><dd>Contemporary</dd>');
    } finally {
      node.currency = currency;
      node.regionalScope = regionalScope;
    }

    const exampleSeed = node.exampleSeed;
    delete node.exampleSeed;
    try {
      expect(renderInformation()).not.toContain('<dt>Example</dt>');
    } finally {
      node.exampleSeed = exampleSeed;
    }
  });

  it('B13 labels every dropdown and keeps disabled dropdowns and buttons focusable and described', () => {
    const output = html(createTutorViewState());
    for (const control of ['hub', 'cluster', 'skill', 'microTarget']) {
      expect(output).toContain(`class="setting-title" for="tutor-map-${control}">`);
    }
    const disabledControls = [...output.matchAll(/<(?:select|button)[^>]*(?:data-tutor-map-level|data-tutor-role|data-tutor-info-toggle)[^>]*aria-disabled="true"[^>]*>/gu)]
      .map((match) => match[0]);
    expect(disabledControls.length).toBeGreaterThanOrEqual(8);
    for (const control of disabledControls) {
      const reasonId = control.match(/aria-describedby="([^"]+)"/u)?.[1];
      expect(control).not.toMatch(/\sdisabled(?:\s|>)/u);
      expect(Boolean(reasonId) || control.includes('aria-description='), control).toBe(true);
      if (reasonId) expect(output).toContain(`id="${reasonId}"`);
    }
    expect(output).toContain("if (target.getAttribute('aria-disabled') === 'true') return;");
  });

  it('renders warning findings beside their example and escapes every model string', () => {
    const state = selectedState();
    state.lesson = {
      recipe: tutorRecipeFromState(state),
      lesson: lesson(),
      findings: [{
        code: 'lesson.wordCountAboveMaximum',
        severity: 'warning',
        subjects: ['example-3'],
        detail: { actualWordCount: 19 }
      }]
    };
    // Changed 2026-09-30: use displayed model content to retain the escaping guard after title removal.
    state.lesson.lesson.conceptExplanation = '<script>Concept content</script>';
    const output = html(state);

    expect(output).toContain('Warning: this example has 19 words');
    // Changed 2026-09-30: V175 removes the generated title; warning text still escapes model content.
    expect(output).toContain('&lt;script&gt;Concept content&lt;/script&gt;');
    expect(output).not.toContain('<script>Concept content</script>');
    expect(load(output)('[data-tutor-result="lesson"]').text()).not.toContain(state.lesson!.lesson.lessonTitle);
    expect(output).not.toContain('<script>Target lesson</script>');
  });

  it('renders no lesson after an error outcome', () => {
    const state = selectedState();
    state.lessonFailure = 'KREN refused lesson.exampleCountMismatch';
    const output = html(state);

    expect(output).not.toContain('aria-label="Drafted lesson"');
    expect(output).toContain('lesson.exampleCountMismatch');
  });

  it('R10 covers the page with the existing named overlay for every generated tutor artifact', () => {
    const lessonState = selectedState();
    lessonState.lessonBusy = true;
    const exerciseState = selectedState();
    exerciseState.exerciseBusy = true;
    const exampleState = selectedState();
    exampleState.lesson = {
      recipe: tutorRecipeFromState(exampleState), lesson: lesson(), findings: []
    };
    exampleState.exampleBusyIds = ['example-3'];
    const reviewState = selectedState();
    reviewState.reviewBusyIds = ['exercise-1'];

    // V87 restores the example overlay with cancellation inside it.
    for (const [state, notice] of [
      [lessonState, 'Drafting a lesson. Please wait.'],
      [exerciseState, 'Preparing practice. Please wait.'],
      [reviewState, 'Preparing a review. Please wait.'],
      [exampleState, 'Regenerating an example. Please wait.']
    ] as const) {
      const output = html(state);
      expect(output).toMatch(/<body[^>]*data-busy/u);
      expect(output).toContain('<div class="busy-overlay" role="alert" aria-live="assertive">');
      expect(output).toContain(notice);
    }

    const exampleOutput = html(exampleState);
    expect(exampleOutput).toMatch(/<body[^>]*data-busy/u);
    expect(exampleOutput).toContain('Regenerating an example. Please wait.');
    expect(exampleOutput).toContain('data-command="cancelTutorExample"');
  });

  it('V47 R7 keeps lesson answers hidden until Show answers is used', () => {
    const state = selectedState();
    const generatedLesson = lesson();
    generatedLesson.practice = [{
      id: 'lesson-practice-1',
      channel: 'written',
      prompt: 'Write <one> completed action.',
      targetIds: [primaryNode.id]
    }];
    generatedLesson.answerKey = [{
      id: 'lesson-answer-1',
      exerciseId: 'lesson-practice-1',
      answer: 'I have finished <it>.',
      explanation: 'The action matters now.'
    }];
    state.lesson = {
      recipe: tutorRecipeFromState(state),
      lesson: generatedLesson,
      findings: []
    };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Report a completed action.',
        targetIds: [primaryNode.id]
      }]
    };
    // Keep this span/action fixture in progress; completion has its own V82 tests.
    state.exerciseSet.exercises.push({ id: 'unreviewed', channel: 'written', prompt: 'Next item.', targetIds: [primaryNode.id] });
    state.answers = { 'exercise-1': 'I finished the report.' };
    state.reviews = {
      'exercise-1': {
        schemaVersion: 1,
        exerciseId: 'exercise-1',
        learnerText: 'I finished the report.',
        correct: [{ excerpt: 'the report', reason: 'This object is clear.' }],
        incorrect: [{
          excerpt: 'finished',
          reason: 'Use the target aspect here.',
          corrected: 'have finished',
          status: 'strongTendency'
        }]
      }
    };

    const output = html(state);

    // Changed 2026-09-30: the verdict carries the green class, with the excerpt retained.
    // 2026-10-13: The verdict keeps its green class and its quoted answer stays separate from the reason.
    const reviewVerdict = load(output)('.tutor-review-correct');
    expect(reviewVerdict.text()).toBe('Correct.');
    expect(reviewVerdict.parent().text()).toMatch(/"the report"\. /u);
    expect(output).toContain('<span class="tutor-review-wrong">finished</span>');
    expect(output).toContain('Lesson practice');
    expect(output).toContain('Write &lt;one&gt; completed action.');
    expect(output).toContain('data-command="showTutorAnswers">Show answers</button>');
    expect(output).not.toContain('I have finished &lt;it&gt;.');

    (state as TutorViewState & { lessonAnswersVisible: boolean }).lessonAnswersVisible = true;
    const revealed = html(state);
    expect(revealed).toContain('data-tutor-lesson-answers');
    expect(revealed).toContain('I have finished &lt;it&gt;.');

    const withoutKey = selectedState();
    withoutKey.lesson = {
      recipe: tutorRecipeFromState(withoutKey), lesson: lesson(1), findings: []
    };
    expect(html(withoutKey)).not.toContain('data-command="showTutorAnswers"');
  });

  it('V45 R1 offers one lesson control whose own label says what pressing it does', () => {
    const drafted = selectedState();
    drafted.lesson = {
      recipe: tutorRecipeFromState(drafted),
      lesson: lesson(),
      findings: []
    };
    const before = html(selectedState());
    const after = html(drafted);
    const lessonButtons = (output: string): string[] =>
      output.match(/<button[^>]*data-command="generateTutorLesson"[^>]*>[^<]*<\/button>/gu) ?? [];

    expect(lessonButtons(before)).toHaveLength(1);
    // Changed 2026-09-30: V175 shortens the label; guard the action's drafting meaning.
    expect(load(lessonButtons(before)[0]!)('button').text()).toMatch(/^draft\b/iu);
    expect(lessonButtons(after), 'a drafted lesson relabels the one control, it adds no second one')
      .toHaveLength(1);
    expect(load(lessonButtons(after)[0]!)('button').text()).toMatch(/^redraft\b/iu);
  });

  it('V45 R2 shows Reset in the Lesson action row and marks it unavailable on an untouched page', () => {
    const drafted = selectedState();
    drafted.lesson = {
      recipe: tutorRecipeFromState(drafted),
      lesson: lesson(),
      findings: []
    };
    const untouched = html(createTutorViewState());
    const headingRow = (output: string): string => output.match(
      /<div class="settings-buttons tutor-heading-actions"[\s\S]*?<\/div>/u
    )?.[0] ?? '';

    // Changed 2026-09-30: V175 removes Reset from shared widths while keeping it secondary.
    // Changed 2026-10-01: the Lesson row resets generated work only.
    const reset = load(headingRow(html(drafted)))('[data-command="resetTutorLesson"]');
    expect(reset.hasClass('secondary')).toBe(true);
    expect(reset.text()).toMatch(/reset/iu);
    expect(reset.is('[data-tutor-shared-action]')).toBe(false);
    // Changed 2026-09-30: V175b retains Reset's enabled state when a drafted lesson exists.
    expect(reset.attr('disabled')).toBeUndefined();
    expect(reset.attr('aria-disabled')).not.toBe('true');
    // Changed 2026-10-01: targets alone enable master Reset; lesson Reset needs a lesson.
    expect(load(headingRow(html(selectedState())))('[data-command="resetTutorLesson"]').attr('disabled')).toBeDefined();
    expect(load(html(selectedState()))('[data-tutor-heading-row] [data-command="resetTutorSession"]').attr('disabled')).toBeUndefined();
    expect(load(headingRow(untouched))('[data-command="resetTutorLesson"]').attr('aria-disabled')).toBe('true');
  });

  it('V45 R3 numbers every example and practice item and shows no transport identifier', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(2), findings: [] };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [
        { id: 'exercise-1', channel: 'written', prompt: 'Use the target once.', targetIds: [primaryNode.id] },
        { id: 'exercise-2', channel: 'written', prompt: 'Use the target twice.', targetIds: [primaryNode.id] }
      ]
    };

    const firstOutput = html(state);
    state.currentExerciseIndex = 1;
    const secondOutput = html(state);

    /*
     * The lesson pages one example at a time as of V84, so its numbering is checked by moving
     * through it rather than by finding every heading in one render. The requirement is
     * unchanged: the reader sees a position, never the model's transport identifier.
     */
    expect(firstOutput).toContain('<h3 class="tutor-item-heading">1. Today our careful team');
    expect(firstOutput).not.toContain('<h3 class="tutor-item-heading">2. Today our careful team');
    state.currentExampleIndex = 1;
    const secondExample = html(state);
    expect(secondExample).toContain('<h3 class="tutor-item-heading">2. Today our careful team');
    expect(secondExample).not.toContain('<h3 class="tutor-item-heading">1. Today our careful team');

    expect(firstOutput).toContain('<h3 class="tutor-item-heading">1. Use the target once.</h3>');
    expect(secondOutput).toContain('<h3 class="tutor-item-heading">2. Use the target twice.</h3>');
    expect(firstOutput + secondOutput + secondExample,
      'the model identifier stays on the buttons and off the reader page')
      .not.toContain('<h3 class="tutor-item-heading">example-1');
    expect(firstOutput + secondOutput).not.toContain('>Exercise 1</h3>');
    expect(firstOutput).toContain('data-tutor-example="example-1"');
  });

  it('V45 R4 heads the generated practice region Practice', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Use the target once.',
        targetIds: [primaryNode.id]
      }]
    };

    const output = html(state);

    // Changed 2026-09-16: this is literal uppercase so assistive technology reads what is shown.
    expect(output).toContain('<h2>PRACTICE</h2>');
    expect(output).not.toContain('The Exercises');
  });

  it('V45 R5 aligns lesson list markers with the heading and keeps a disabled label readable', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };

    const output = html(state);

    expect(output).toMatch(
      /\.tutor-lesson ul, \.tutor-lesson ol \{ margin-left: 0; padding-left: 0; list-style-position: inside; \}/u
    );
    expect(
      output,
      'the disabled treatment sets the foreground that belongs with its own background'
    ).toMatch(
      // 2026-10-04: V203 keeps disabled hover at normal-state specificity with :where.
      /button:disabled, button:disabled:where\(:hover\) \{[^}]*color: var\(--vscode-button-secondaryForeground, var\(--vscode-foreground\)\);[^}]*background: var\(--vscode-button-secondaryBackground\);/u
    );
  });

  it('V45 D2 makes Review available locally as the learner types', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Use the target once.',
        targetIds: [primaryNode.id]
      }]
    };
    const output = html(state);
    const source = output.match(
      /function syncTutorReviewAvailability\([^)]*\) \{[\s\S]*?\n    \}/u
    )?.[0] ?? '';

    expect(source, 'the webview carries the local Review-state behavior').not.toBe('');
    // 2026-10-11: the local batch control also patches the stale-review note.
    const staleSource = output.match(/function syncTutorReviewState\([^)]*\) \{[\s\S]*?\n    \}/u)?.[0] ?? '';
    const sync = new Function(`${staleSource}; ${source}; return syncTutorReviewAvailability;`)() as (
      answer: string,
      control: { disabled: boolean; closest(selector: string): unknown; getAttribute(name: string): string | null; setAttribute(name: string, value: string): void }
    ) => void;
    // Changed 2026-10-04: local availability also reads the containing practice page metadata.
    const review = { disabled: true, closest: () => ({ getAttribute: () => null, querySelector: () => null }),
      getAttribute: (name: string) => ({ 'data-review-all': 'true', 'data-first-unanswered-other': '-1', 'data-pending-other': 'false', 'data-reviewed-answer': '' })[name as 'data-review-all'] ?? null, setAttribute: () => undefined };
    sync('My typed answer.', review);
    expect(review.disabled, 'typing a non-blank answer enables Review').toBe(false);
    sync('   ', review);
    expect(review.disabled, 'removing the answer disables Review again').toBe(true);

    const answerInputBranch = output.slice(
      output.indexOf("target.hasAttribute('data-tutor-answer')"),
      output.indexOf("target.hasAttribute('data-tutor-tool-input')")
    );
    // 2026-10-12: V227 removes the obsolete per-item Review lookup and keeps Review all live.
    expect(answerInputBranch).toContain('syncTutorReviewAvailability(target.value, batchAction);');
  });

  it('V56 carries the reader highlight from the box to the lookup', () => {
    // The half that lives in the webview. A probe that stopped sending the highlight left
    // every controller test passing, because they hand it in directly.
    const output = html(selectedState());

    expect(output, 'the highlight is recorded while the box still has focus')
      .toContain("document.addEventListener('selectionchange'");
    expect(output).toContain('active.value.slice(active.selectionStart, active.selectionEnd)');
    // Bounded by the function's own last statement rather than by a brace, so the
    // pattern needs no escape that a generator can collapse.
    const poster = output.match(
      /function postTutorSubmit[\s\S]*?tutorToolHighlight = '';/u
    )?.[0] ?? '';
    expect(poster, 'the submit poster must be found before it can be checked').not.toBe('');
    expect(poster).toContain("command: 'submitTutorTool'");
    expect(poster).toContain('selection: tutorToolHighlight');
  });

  it('V56 opens Dictionary on the whole sentence and asks for a highlight', () => {
    // The box is for reading and picking, not for typing a query: it holds the sentence so
    // the reader can highlight a word in it. Opening it on the annotation excerpt meant
    // every lookup asked a dictionary for a clause.
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(), findings: [] };
    const drafted = state.lesson.lesson.examples[0]!;
    state.toolDrawer = {
      tool: 'dictionary',
      context: drafted.sentence,
      input: drafted.sentence,
      status: 'editing'
    } as TutorViewState['toolDrawer'];

    const output = html(state);
    const drawer = output.match(/<aside class="tutor-drawer"[\s\S]*?<\/aside>/u)?.[0] ?? '';

    expect(drawer).not.toBe('');
    expect(drawer).toContain('<strong>Highlight a word in the sentence, then Look up</strong>');
    expect(drawer, 'the box holds the sentence to pick from').toContain(drafted.sentence);
    expect(drawer).toContain('Highlight a word with the mouse, then Look up.');
    expect(drawer).toMatch(
      /data-command="submitTutorTool"[^>]*>Look up<\/button><button[^>]*data-command="restoreTutorDictionaryContext"[^>]*>Restore sentence<\/button>/u
    );
    expect(output).toContain('.tutor-drawer-result { margin-top: 12px; }');
  });

  it('V47 R6 gives Translate the configured output language and Translation language list', () => {
    const translation = selectedState();
    translation.toolDrawer = {
      tool: 'translate',
      input: example(1).sentence,
      targetLanguage: 'fr-FR',
      status: 'editing'
    } as TutorViewState['toolDrawer'] & { targetLanguage: string };
    const output = html(translation);
    const configured = output.match(
      /<select data-setting="translation\.targetLanguage">([\s\S]*?)<\/select>/u
    )?.[1] ?? '';
    const temporary = output.match(
      /<select[^>]*data-tutor-tool-target-language[^>]*>([\s\S]*?)<\/select>/u
    )?.[1] ?? '';
    const values = (markup: string): string[] => [...markup.matchAll(/<option value="([^"]+)"/gu)]
      .map((match) => match[1]!);

    expect(temporary).not.toBe('');
    // The tutor select must carry no settings key, so changing it cannot reach the stored
    // translation language through the panel settings write path.
    const temporaryTag = output.match(/<select[^>]*data-tutor-tool-target-language[^>]*>/u)?.[0] ?? '';
    expect(temporaryTag).not.toContain('data-setting');
    expect(values(temporary)).toEqual(values(configured));
    expect(temporary).toContain('<option value="fr-FR" selected>');
  });

  it('V182b gives Dictionary and Translate the same one-line Output language control', () => {
    const controls = (['dictionary', 'translate'] as const).map((tool) => {
      const state = selectedState();
      state.toolDrawer = { tool, input: example(1).sentence, status: 'editing' };
      const output = html(state);
      const $ = load(output);
      const drawer = $('.tutor-drawer[aria-label="Learning Tools"]');
      const control = drawer.find('[data-tutor-tool-target-language]');
      expect(control.length).toBe(1);
      const label = control.parent('label.tutor-tool-output-language');
      expect(label.length).toBe(1);
      // 2026-10-04: Dictionary adds the owner's multiword qualifier; the control still names its action.
      expect(label.find('strong').text()).toMatch(/^Output language/u);
      expect(label.find('.tutor-output-language-note')).toHaveLength(tool === 'dictionary' ? 1 : 0);
      expect(label.children().toArray().map((node) => node.tagName)).toEqual(['strong', 'select']);
      expect(label.prev().find('[data-tutor-tool-input]').length).toBe(1);
      expect(label.next().find('[data-command="submitTutorTool"]').length).toBe(1);
      expect(control.find('option[selected]').attr('value')).toBe(settings.translationTargetLanguage);
      expect(control.attr('style')).toBeUndefined();
      expect(label.attr('style')).toBeUndefined();
      expect(output).toMatch(/\.tutor-tool-output-language \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 8px;/u);
      expect(output).toMatch(/\.tutor-tool-output-language select \{[^}]*flex: 0 1 auto;[^}]*min-width: 0;/u);
      return control.html();
    });
    expect(controls[0]).toBe(controls[1]);
  });

  it('V47 R1 offers the shared primary icon only on Support rows', () => {
    const output = html(selectedState());
    const rows = [...output.matchAll(/<div class="tutor-tray-row">[\s\S]*?<\/div>/gu)]
      .map((match) => match[0]);
    const primary = rows.find((row) => row.includes('<strong>Primary</strong>')) ?? '';
    const support = rows.find((row) => row.includes('<strong>Support</strong>')) ?? '';
    const supportPath = tutorTargetPathLabel(supportNode.id);
    const makePrimary = support.match(
      /<button[^>]*data-command="updateTutorTarget"[^>]*data-tutor-role="primary"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';

    expect(primary).not.toContain('title="Make primary"');
    // 2026-10-04: assert absence of promotion behavior rather than the obsolete shared SVG.
    expect(load(primary)('button[data-tutor-role="primary"]')).toHaveLength(0);
    expect(makePrimary).not.toBe('');
    expect(makePrimary).toContain('class="secondary icon-button"');
    expect(makePrimary).toContain(`aria-label="Make ${supportPath} the primary target"`);
    // 2026-10-04: the owner groups the unchanged P paths under a heavier stroke.
    expect(load(makePrimary)('svg g').attr('stroke-width')).toBe('3.4');
    expect(load(makePrimary)('svg path').first().attr('d')).toBe('M9 5.5v13');
  });

  it('V147 renders practice Hint as the shared hint icon without changing its disabled rules', () => {
    // Added 2026-09-24: this was the only text button among the compact actions beside it.
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{ id: 'hint-item', channel: 'written', prompt: 'Answer this.', targetIds: [primaryNode.id] }]
    };
    const hintButton = (value: TutorViewState): string => html(value).match(
      /<button[^>]*data-command="hintTutorExercise"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';

    const ready = hintButton(state);
    expect(ready).toContain('class="icon-button tutor-action-icon"');
    expect(ready).toContain('data-tutor-exercise="hint-item"');
    expect(ready).toContain('title="Hint" aria-label="Hint"');
    expect(ready).toContain(iconSvgMarkup('hint'));
    expect(ready).not.toContain(' disabled');
    expect(ready).not.toContain('>Hint</button>');

    state.exerciseHintBusyIds = ['hint-item'];
    expect(hintButton(state)).toContain(' disabled');
    state.exerciseHintBusyIds = [];
    state.reviewBusyIds = ['hint-item'];
    expect(hintButton(state)).toContain(' disabled');
    state.reviewBusyIds = [];
    state.reviews['hint-item'] = {
      schemaVersion: 1, exerciseId: 'hint-item', learnerText: 'An answer.',
      correctedText: 'An answer.', correct: [], incorrect: []
    };
    expect(hintButton(state)).toContain(' disabled');
  });

  it('V47 R2 uppercases Concept and rules while keeping its fold boundary', () => {
    const state = selectedState();
    const drafted = lesson(1);
    drafted.commonErrors = [{
      id: 'error-1',
      incorrect: 'I finished already.',
      corrected: 'I have already finished.',
      explanation: 'The time remains relevant.',
      status: 'strongTendency'
    }];
    drafted.practice = [{
      id: 'practice-1',
      channel: 'written',
      prompt: 'Write one sentence.',
      targetIds: [primaryNode.id]
    }];
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: drafted, findings: [] };
    const output = html(state);
    const start = output.indexOf(' data-tutor-lesson-explanation');
    const end = output.indexOf('</details>', start);

    expect(start).toBeGreaterThan(-1);
    // Changed 2026-09-30: the border rule also names this attribute in CSS.
    expect(load(output)('[data-tutor-lesson-explanation]')).toHaveLength(1);
    expect(output).toContain('<span class="rewrite-group-name">CONCEPT AND RULES</span>');
    expect(output).not.toContain('<span class="rewrite-group-name">Concept and rules</span>');
    expect(output.slice(output.lastIndexOf('<details', start), start)).toContain(
      'class="rewrite-settings-group"'
    );
    for (const heading of ['<h3>Concept</h3>', '<h3>How the combination works</h3>', '<h3>Rules and tendencies</h3>']) {
      expect(output.indexOf(heading)).toBeGreaterThan(start);
      expect(output.indexOf(heading)).toBeLessThan(end);
    }
    // Changed 2026-09-16: the lesson's section heading is literal uppercase.
    for (const heading of ['<h3>EXAMPLES</h3>', '<span class="rewrite-group-name">COMMON ERRORS</span>', '<span class="rewrite-group-name">Lesson practice</span>']) {
      expect(output.indexOf(heading)).toBeGreaterThan(end);
    }
  });

  it('V45 presentation R4 omits the learner level from the lesson heading line', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };
    const output = html(state);
    const lessonStart = output.indexOf('<article class="tutor-lesson"');
    const explanationStart = output.indexOf('data-tutor-lesson-explanation', lessonStart);
    const heading = output.slice(lessonStart, explanationStart);

    // Changed 2026-09-30: only the role label is bold.
    expect(heading).toContain('<p><strong>Primary:</strong>');
    expect(heading).not.toContain('<strong>B2</strong>');
    expect(heading).not.toContain('B2 | Primary:');
  });

  it('V45 presentation R5 omits the target identifier line from every example', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(2), findings: [] };
    const output = html(state);
    const cards = [...output.matchAll(/<article class="tutor-example[^>]*>[\s\S]*?<\/article>/gu)]
      .map((match) => match[0]);

    /*
     * One card, not two: the lesson pages one example at a time as of V84. The requirement is
     * unchanged and is checked across both examples by moving between them.
     */
    expect(cards).toHaveLength(1);
    state.currentExampleIndex = 1;
    const secondCards = [...html(state).matchAll(/<article class="tutor-example[^>]*>[\s\S]*?<\/article>/gu)]
      .map((match) => match[0]);
    expect(secondCards).toHaveLength(1);
    expect([...cards, ...secondCards].every((card) => !card.includes('<strong>Targets:</strong>'))).toBe(true);
    expect(cards.every((card) => !card.includes(primaryNode.id))).toBe(true);
  });

  it('V45 presentation R6 renders annotated excerpts in bold without underlining them', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };
    const output = html(state);
    const rule = output.match(/\.tutor-annotation-excerpt \{([^}]*)\}/u)?.[1] ?? '';

    expect(output).toContain(
      '<span class="tutor-annotation-excerpt">clear English pattern</span>'
    );
    expect(rule).toContain('font-weight: 700');
    expect(rule).not.toContain('text-decoration');
  });

  it('V45 presentation R7 uses named shared icons for all three per-example controls', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };
    const output = html(state);
    const expectations = [
      ['playTutorExample', 'speaker', 'Play this example'],
      ['copyTutorExample', 'copy', 'Copy this example'],
      ['regenerateTutorExample', 'regenerate', 'Regenerate this example']
    ] as const;

    for (const [command, icon, accessibleName] of expectations) {
      const button = output.match(
        new RegExp(`<button[^>]*data-command="${command}"[^>]*>[\\s\\S]*?<\\/button>`, 'u')
      )?.[0] ?? '';
      expect(button, command).toContain('class="secondary icon-button"');
      expect(button, command).toContain(`aria-label="${accessibleName}"`);
      expect(button, command).toMatch(/ title="[^"]+"/u);
      expect(button, command).toContain(iconSvgMarkup(icon));
    }

    const addedIconButtons = [...output.matchAll(
      /<button[^>]*class="secondary icon-button"[^>]*>[\s\S]*?<\/button>/gu
    )].map((match) => match[0]).filter((button) =>
      button.includes('title="Make primary"') ||
      expectations.some(([command]) => button.includes(`data-command="${command}"`))
    );
    expect(addedIconButtons).toHaveLength(4);
    for (const button of addedIconButtons) {
      expect(button, `new icon button without a title: ${button}`).toMatch(/ title="[^"]+"/u);
      expect(button, `new icon button without an accessible name: ${button}`)
        .toMatch(/ aria-label="[^"]+"/u);
    }
  });

  it('V58 R3 styles every tutor content icon with button variables without repainting the header', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };
    const output = html(state);
    const contentStart = output.indexOf('<div class="tutor-content">');
    const content = output.slice(contentStart);
    const contentIconButtons = content.match(/<button[^>]*class="[^"]*icon-button[^"]*"[^>]*>/gu) ?? [];
    const header = output.match(/<header class="top"[\s\S]*?<\/header>/u)?.[0] ?? '';
    const home = header.match(/<button[^>]*data-command="showStartPage"[^>]*>/u)?.[0] ?? '';

    expect(contentStart).toBeGreaterThan(output.indexOf('</header>'));
    expect(contentIconButtons.length).toBeGreaterThan(0);
    expect(output).toContain(
      '.tutor-content .icon-button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-button-border, transparent); }'
    );
    // 2026-10-04: V203 guards disabled hover and keeps icons white on blue.
    expect(output).toMatch(/\.tutor-content \.icon-button:hover[^{}]*:not\(:disabled\)[^{}]*\{[^}]*color: var\(--vscode-button-foreground\);[^}]*background: var\(--vscode-button-hoverBackground\)/u);
    expect(home).toContain('class="icon-button"');
    expect(home).not.toContain('tutor-action-icon');

    // The assertions above check that the scoped rule is present, which a second, unscoped
    // rule added beside it would not disturb: the header would go blue and every one of them
    // would still pass. Found by mutation on 2026-09-03. So the real check is that no rule
    // painting an icon button with the button variables is left unscoped.
    const styles = (output.match(/<style[\s\S]*?<\/style>/gu) ?? []).join(' ');
    const iconButtonRules = styles
      .split('}')
      .map((rule) => rule.trim())
      .filter((rule) => rule.includes('.icon-button') && rule.includes('--vscode-button-'));

    expect(iconButtonRules.length, 'no icon-button rule uses the button variables').toBeGreaterThan(0);
    for (const rule of iconButtonRules) {
      const selector = rule.slice(0, rule.indexOf('{'));
      // Either scoping is legitimate: the `.tutor-content` wrapper, or the
      // `.tutor-action-icon` class 1.18.0 introduced. What must never appear is a rule that
      // paints a bare `.icon-button`, because the KREN header uses that class too.
      expect(selector, 'this rule paints icon buttons outside the tutor: ' + selector.trim())
        .toContain('tutor');
    }
  });

  it('V48 R6 and R7 draw Dictionary and Translate without reusing Replace', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(1), findings: [] };
    const output = html(state);
    for (const [tool, icon, accessibleName] of [
      ['dictionary', 'dictionary', 'Look up this example in the dictionary'],
      ['translate', 'translate', 'Translate this example']
    ] as const) {
      const button = output.match(
        new RegExp(`<button[^>]*data-tutor-tool="${tool}"[^>]*>[\\s\\S]*?<\\/button>`, 'u')
      )?.[0] ?? '';
      expect(button, tool).toContain('class="secondary icon-button"');
      expect(button, tool).toContain(`aria-label="${accessibleName}"`);
      expect(button, tool).toMatch(/ title="[^"]+"/u);
      expect(button, tool).toContain(iconSvgMarkup(icon));
      expect(button, tool).not.toContain(iconSvgMarkup('replace'));
      expect(button, tool).not.toContain(`>${tool === 'dictionary' ? 'Dictionary' : 'Translate'}<`);
    }
  });

  it('V50 R1 puts an Ask icon in each displayed lesson example action row', () => {
    const state = selectedState();
    state.lesson = { recipe: tutorRecipeFromState(state), lesson: lesson(2), findings: [] };
    for (const index of [0, 1]) {
      state.currentExampleIndex = index;
      const markup = lessonReader(state).markup();
      const ask = markup.match(/<button[^>]*data-command="openTutorTool"[^>]*data-tutor-tool="ask"[^>]*>[\s\S]*?<\/button>/u)![0];
      expect(ask).toContain('aria-label="Ask about this example"');
      expect(ask).toContain(iconSvgMarkup('ask'));
      expect(ask).toContain(`data-tutor-example="example-${index + 1}"`);
    }
  });

  it('V50 R2 shows the fixed example sentence and an editable empty question in the drawer', () => {
    const state = selectedState();
    const sentence = 'Although the team had completed the project, they celebrated.';
    state.toolDrawer = {
      tool: 'ask',
      context: sentence,
      input: '',
      status: 'editing'
    } as TutorViewState['toolDrawer'];
    const drawer = html(state).slice(html(state).indexOf('<aside class="tutor-drawer"'));

    expect(drawer).toContain('<h2>Ask about this sentence</h2>');
    expect(drawer).toContain(`<p class="tutor-drawer-context">${sentence}</p>`);
    expect(drawer).not.toContain(`data-tutor-tool-input>${sentence}</textarea>`);
    expect(drawer).toContain('<strong>Your question</strong>');
    expect(drawer).toContain('data-tutor-tool-input></textarea>');
    expect(drawer).toMatch(/data-command="submitTutorTool" disabled>Ask<\/button>/u);
  });

  it('V50 R4 renders readable Ask prose and the specific failure cause', () => {
    const ready = selectedState();
    ready.toolDrawer = {
      tool: 'ask',
      context: 'The sentence.',
      input: 'Why?',
      status: 'ready',
      answer: {
        directAnswer: 'Use <that> for this defining relative clause.',
        explanation: 'That introduces a defining clause here.',
        examples: ['The project that caused the delay was cancelled.']
      }
    };
    const readyDrawer = html(ready).slice(html(ready).indexOf('<aside class="tutor-drawer"'));
    const answerPosition = readyDrawer.indexOf('<h3>Answer</h3>');
    const explanationPosition = readyDrawer.indexOf('<h3>Explanation</h3>');
    const examplesPosition = readyDrawer.indexOf('<h3>Examples</h3>');
    expect(readyDrawer).toContain('Use &lt;that&gt; for this defining relative clause.');
    expect(readyDrawer).toContain('That introduces a defining clause here.');
    expect(readyDrawer).toContain('<li>The project that caused the delay was cancelled.</li>');
    expect(answerPosition).toBeGreaterThan(-1);
    expect(answerPosition).toBeLessThan(explanationPosition);
    expect(explanationPosition).toBeLessThan(examplesPosition);

    const failed = selectedState();
    failed.toolDrawer = {
      tool: 'ask',
      context: 'The sentence.',
      input: 'Why?',
      status: 'failed',
      message: 'Gemini refused this request because its safety filter blocked it.'
    };
    const failedDrawer = html(failed).slice(html(failed).indexOf('<aside class="tutor-drawer"'));
    expect(failedDrawer).toContain(
      'Gemini refused this request because its safety filter blocked it.'
    );
    expect(failedDrawer).not.toContain('The tool request failed.');
  });

  it('V52 R5 renders an Ask answer when optional explanation and examples are missing', () => {
    const state = selectedState();
    state.toolDrawer = {
      tool: 'ask',
      context: 'The sentence.',
      input: 'Why?',
      status: 'ready',
      answer: { directAnswer: 'Use that here.' }
    };

    const drawer = html(state).slice(html(state).indexOf('<aside class="tutor-drawer"'));

    expect(drawer).toContain('<h3>Answer</h3><p>Use that here.</p>');
    expect(drawer).not.toContain('<h3>Explanation</h3>');
    expect(drawer).not.toContain('<h3>Examples</h3>');
    expect(drawer).not.toContain('No result was returned.');
  });

  it('V50 R5 disables practice Ask until a review exists, then shows its prompt and answer', () => {
    const state = selectedState();
    const exercise = {
      id: 'exercise-1',
      channel: 'written' as const,
      prompt: 'At this time tomorrow, I ______ (fly) to London for the annual conference.',
      targetIds: [primaryNode.id]
    };
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [exercise]
    };
    // Keep this span/action fixture in progress; completion has its own V82 tests.
    state.exerciseSet.exercises.push({ id: 'unreviewed', channel: 'written', prompt: 'Next item.', targetIds: [primaryNode.id] });
    state.answers = { 'exercise-1': 'I am flying.' };

    const before = html(state);
    // Ask is rendered from the start and disabled until a review exists, per the owner's
    // 2026-09-13 rule that this row holds its places. Absence became disabled.
    expect(before).toMatch(/data-command="openTutorPracticeAsk"[^>]*disabled/u);

    state.reviews = {
      'exercise-1': {
        schemaVersion: 1,
        exerciseId: 'exercise-1',
        learnerText: 'I am flying.',
        correct: [],
        incorrect: [{
          excerpt: 'am flying',
          reason: 'The time marker calls for future progressive.',
          corrected: 'will be flying',
          status: 'rule'
        }]
      }
    };
    const after = html(state);
    const ask = after.match(
      /<button[^>]*data-command="openTutorPracticeAsk"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';
    expect(ask).toContain('data-tutor-exercise="exercise-1"');
    expect(ask).toContain('aria-label="Ask about this practice item"');
    expect(ask).toContain(iconSvgMarkup('ask'));

    state.toolDrawer = {
      tool: 'ask',
      context: exercise.prompt,
      learnerAnswer: 'I am flying.',
      input: '',
      status: 'editing'
    } as TutorViewState['toolDrawer'];
    const drawer = html(state).slice(html(state).indexOf('<aside class="tutor-drawer"'));
    expect(drawer).toContain(exercise.prompt);
    expect(drawer).toContain('<strong>Your reviewed answer</strong>');
    expect(drawer).toContain('I am flying.');
  });

  it('V56 R7 styles the reviewed-practice Ask as an action beside Review', () => {
    const state = selectedState();
    state.exerciseSet = {
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: [{
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Use the target once.',
        targetIds: [primaryNode.id]
      }]
    };
    // Keep this span/action fixture in progress; completion has its own V82 tests.
    state.exerciseSet.exercises.push({ id: 'unreviewed', channel: 'written', prompt: 'Next item.', targetIds: [primaryNode.id] });
    state.answers = { 'exercise-1': 'My answer.' };
    state.reviews = {
      'exercise-1': {
        schemaVersion: 1,
        exerciseId: 'exercise-1',
        learnerText: 'My answer.',
        correct: [{ excerpt: 'My answer', reason: 'It uses the target.' }],
        incorrect: []
      }
    };
    const output = html(state);
    // Changed 2026-09-15: the exercise is the inner panel inside the white practice article.
    // 2026-10-11: stale-review notes can follow the review; select the item independently of trailing markup.
    const exercise = load(output)('.tutor-practice-panel').html() ?? '';
    const review = exercise.match(/<button[^>]*data-command="reviewTutorExercise"[^>]*>/u)?.[0] ?? '';
    const ask = exercise.match(
      /<button[^>]*data-command="openTutorPracticeAsk"[^>]*>[\s\S]*?<\/button>/u
    )?.[0] ?? '';

    // 2026-10-11: V220 removes per-item Review; the reviewed-item Ask action keeps its icon.
    expect(review).toBe('');
    expect(ask).toContain('class="icon-button tutor-action-icon"');
    // 2026-10-11: compare the icon after normalizing SVG serialization.
    expect(load(ask)('svg').toString()).toBe(load(iconSvgMarkup('ask'))('svg').toString());
  });

  it('V48 R2 shows the remembered question in the map and visible recipe', () => {
    const state = selectedState();
    state.question = '<which> vs. what, with collocations';
    const output = html(state);

    expect(output).toContain('<strong>Lesson question:</strong> &lt;which&gt; vs. what, with collocations');
    expect(output).toContain('<dt>Answer</dt><dd>&lt;which&gt; vs. what, with collocations</dd>');
    expect(output).not.toContain('<strong>Lesson question:</strong> <which>');
  });

  it('V48 R5 renders the recovery message beside the controls it names', () => {
    const state = createTutorViewState();
    state.question = 'what vs. that';
    state.selectionMessage = 'No target was selected for this question. Choose a target in the dropdowns and use Primary, or type another question and choose Ask.';
    const output = html(state);

    expect(output).toContain(state.selectionMessage);
    expect(output).toContain('data-tutor-role="primary"');
    expect(output).toContain('data-tutor-ask');
    // Changed 2026-10-01: V177b requires question-only mode when no target is selected.
    const draft = load(output)('[data-command="generateTutorLesson"]');
    expect(draft.attr('disabled')).toBeDefined();
    expect(draft.attr('aria-disabled')).toBe('true');
    expect(draft.attr('title')).toMatch(/turn on.*question without learning-map targets/iu);
  });

  it('V47 R4 sets example sentences and practice prompts at explanation-text size', () => {
    const output = html(selectedState());
    const rule = output.match(
      /\.tutor-example \.tutor-item-heading, \.tutor-exercise \.tutor-item-heading \{([^}]*)\}/u
    )?.[1] ?? '';
    expect(rule).toContain('font-size: inherit');
    expect(rule).toContain('font-weight: 400');
  });
});

describe('tutor request and replacement boundaries', () => {
  it('V48 R2 builds the remembered question into question, never scenario', () => {
    const state = selectedState();
    state.question = 'which vs. what, with collocations';

    const recipe = tutorRecipeFromState(state);
    expect(tutorRecipeFromState(selectedState())).not.toHaveProperty('question');
    expect(recipe.question).toBe('which vs. what, with collocations');
    expect(recipe).not.toHaveProperty('scenario');
    expect(JSON.parse(serializeTutorRecipe(recipe))).toMatchObject({
      question: 'which vs. what, with collocations'
    });
  });

  it('serializes exactly the recipe keys and nothing from an editor or document', () => {
    const recipe = tutorRecipeFromState(selectedState());
    const serialized = serializeTutorRecipe(recipe);
    const body = JSON.parse(serialized) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(Object.keys(recipe));
    expect(Object.keys(JSON.parse(tutorLessonGenerationRequest(recipe).input) as object))
      .toEqual(Object.keys(recipe));
  });

  it('builds a review body with only the answer, exercise, and active target identifiers', () => {
    const request = tutorReviewGenerationRequest({
      learnerAnswer: 'I have finished the report.',
      exercise: {
        id: 'exercise-1',
        channel: 'written',
        prompt: 'Report a completed task.',
        targetIds: [primaryNode.id]
      },
      activeTargets: [primaryNode.id]
    });

    expect(Object.keys(JSON.parse(request.input) as object)).toEqual([
      'learnerAnswer', 'exercise', 'activeTargets'
    ]);
  });

  it('replaces only example 3 and leaves the other five byte-identical', () => {
    const original = lesson();
    const snapshots = original.examples.map((item) => JSON.stringify(item));
    const replacement = { ...example(99), sentence: 'A completely new replacement sentence appears only in the third position today.' };
    const updated = replaceTutorExample(original, 'example-3', replacement);

    for (const index of [0, 1, 3, 4, 5]) {
      expect(JSON.stringify(updated.examples[index])).toBe(snapshots[index]);
      expect(updated.examples[index]).toBe(original.examples[index]);
    }
    expect(updated.examples[2]?.id).toBe('example-3');
    expect(updated.examples[2]?.sentence).toBe(replacement.sentence);
  });

  it('refresh replaces an exercise set instead of appending it', () => {
    const state = selectedState();
    const five = (prefix: string): TutorExerciseSet => ({
      schemaVersion: 1,
      mapVersion: '1.0.0',
      channel: 'written',
      exercises: Array.from({ length: 5 }, (_, index) => ({
        id: `${prefix}-${index}`,
        channel: 'written',
        prompt: `${prefix} prompt ${index}`,
        targetIds: [primaryNode.id]
      }))
    });
    const first = replaceTutorExerciseSet(state, five('old'));
    const refreshed = replaceTutorExerciseSet(first, five('new'));

    expect(refreshed.exerciseSet?.exercises).toHaveLength(5);
    expect(refreshed.exerciseSet?.exercises.every((item) => item.id.startsWith('new-'))).toBe(true);
  });

  it('refuses a review that names no exact span of the learner answer', () => {
    const review: TrainingReview = {
      schemaVersion: 1,
      exerciseId: 'exercise-1',
      learnerText: 'I have finished the report.',
      correct: [],
      incorrect: []
    };

    expect(validateTrainingReview(review)).toContainEqual(expect.objectContaining({
      code: 'review.noSpans',
      severity: 'error'
    }));
  });

  /*
   * Rewritten from the verifying run's probe, which compared the two rows' tag names and
   * found div against label. The tags differ for a reason that is not a defect: a LESSON row
   * wraps one control so it can be a label, and a map row carries a select and an information
   * button, and a label around two interactive controls is invalid and confuses a screen
   * reader about which one it names.
   *
   * What the owner asked for was that the rows look and read the same, so that is what is
   * asserted: the same `setting` class, which is where the whole layout comes from, and the
   * same internal parts in the same order, a title then a description then the control.
   * Asserting the tag would force the accessibility defect.
   */
  /*
   * The overlay's notice and its Cancel are two readings of the same state, so they have to
   * name the same wait. They are computed by two functions checking the same four flags in
   * the same order, and nothing made that order agree: reversing it in one of them left the
   * notice saying "Preparing a review" above a button that cancelled the lesson, and the
   * whole suite passed, because no test had a review in flight.
   */
  it('the waiting overlay cancels the same operation its notice names', () => {
    const cases = [
      ['askBusy', 'targetSearch', 'question', 'cancelTutorAsk'],
      ['reviewBusyIds', ['exercise-1'], 'review', 'cancelTutorReview'],
      ['exerciseBusy', true, 'practice', 'cancelTutorExercises'],
      ['lessonBusy', true, 'lesson', 'cancelTutorLesson']
    ] as const;

    for (const [field, value, noticeWord, command] of cases) {
      const state = selectedState();
      (state as unknown as Record<string, unknown>)[field] = value;
      const output = html(state);
      const overlay = output.match(/<div class="busy-overlay"[\s\S]*?<\/div><\/div>/u)?.[0] ?? '';

      expect(overlay, `${field}: the overlay is shown`).not.toBe('');
      expect(overlay, `${field}: the notice names the operation`).toContain(noticeWord);
      expect(overlay, `${field}: the cancel stops that same operation`)
        .toContain(`data-command="${command}"`);
    }
  });

  it('V64 R5 keeps Stop conversation reachable while a turn is in flight', () => {
    const state = selectedState();
    state.conversation = {
      ...state.conversation, coachOpen: true,
      status: 'active',
      recipeTargets: { primaryTarget: primaryNode.id, supportingTargets: [] },
      transcript: [],
      currentTurnIndex: 0,
      currentQuestion: 'What happened?',
      draftAnswer: 'I go home.',
      busy: true
    };

    const output = html(state);
    expect(output).not.toContain('<div class="busy-overlay"');
    const conversation = renderTutorConversation(state);
    // Changed 2026-09-18: V118 announces the in-transcript typing bubble instead of a status line.
    expect(conversation).not.toContain('Continuing the conversation. Please wait.');
    expect(conversation).toContain('data-tutor-typing');
    expect(conversation).toContain('data-command="stopTutorConversation"');
    expect(conversation).not.toContain('data-command="closeTutorConversation"');
  });

  it('a LEARNING MAP row carries the same row structure as a LESSON row', () => {
    const output = html(createTutorViewState());
    const mapRow = output.match(/<\w+ class="setting tutor-map-level"[\s\S]{0,1200}/u)?.[0] ?? '';
    const lessonRow = output.match(
      /<\w+ class="setting"><span><span class="setting-title">Number of examples[\s\S]{0,300}/u
    )?.[0] ?? '';

    expect(lessonRow, 'the LESSON row is the pattern being matched').not.toBe('');
    for (const [name, row] of [['map', mapRow], ['lesson', lessonRow]] as const) {
      expect(row, `${name} row uses the shared setting class`).toContain('class="setting');
      expect(row, `${name} row has a title`).toContain('class="setting-title"');
      expect(row, `${name} row has a description`).toContain('class="setting-description"');
      expect(row.indexOf('setting-title'), `${name} row puts the title before the description`)
        .toBeLessThan(row.indexOf('setting-description'));
    }
    expect(mapRow, 'the control follows the description').toMatch(
      /class="setting-description"[\s\S]*<select/u
    );
  });

  it('V41 verification probe: three Supports do not disable replacement of a Primary', () => {
    const hubs = TUTOR_MAP.filter((node) => node.kind === 'hub');
    let state = changeTutorMapSelection(createTutorViewState(), 'hub', hubs[4]!.id);
    state.selection = [
      { nodeId: hubs[0]!.id, role: 'primary' },
      ...hubs.slice(1, 4).map((node) => ({ nodeId: node.id, role: 'support' as const }))
    ];
    const output = html(state);
    const setPrimary = output.match(
      new RegExp(`<button[^>]*data-tutor-target="${hubs[4]!.id}"[^>]*data-tutor-role="primary"[^>]*>`, 'u')
    )?.[0] ?? '';

    expect(setPrimary).not.toContain('aria-disabled="true"');
  });

  it('V41 verification probe: a same-Cluster Support does not disable replacement of a Primary', () => {
    const cluster = TUTOR_MAP.find((node) => node.kind === 'cluster' &&
      TUTOR_MAP.filter((candidate) => candidate.parentId === node.id).length >= 2)!;
    const sameCluster = TUTOR_MAP.filter((node) => node.parentId === cluster.id).slice(0, 2);
    const replacement = TUTOR_MAP.find((node) => node.kind === 'hub' &&
      !tutorMapPathForNode(sameCluster[0]!.id).some((ancestor) => ancestor.id === node.id))!;
    let state = changeTutorMapSelection(createTutorViewState(), 'hub', replacement.id);
    state.selection = [
      { nodeId: sameCluster[0]!.id, role: 'primary' },
      { nodeId: sameCluster[1]!.id, role: 'support' }
    ];
    const output = html(state);
    const setPrimary = output.match(
      new RegExp(`<button[^>]*data-tutor-target="${replacement.id}"[^>]*data-tutor-role="primary"[^>]*>`, 'u')
    )?.[0] ?? '';

    expect(setPrimary).not.toContain('aria-disabled="true"');
  });

  it('V41 verification probe: the covering waiting state keeps Cancel pointer-reachable', () => {
    const state = selectedState();
    state.lessonBusy = true;
    const output = html(state);
    const overlayStart = output.indexOf('<div class="busy-overlay"');
    const overlayEnd = output.indexOf('</div></div>', overlayStart) + '</div></div>'.length;
    const overlay = output.slice(overlayStart, overlayEnd);

    expect(output).toMatch(/\.busy-overlay \{ position: fixed; inset: 0; z-index: 40;/u);
    expect(overlay).toContain('data-command="cancelTutorLesson"');
  });
});


describe('V68 diagnosis reachability and provenance', () => {
  // Changed 2026-10-15: V241, owner item I6, review is a stopped action, not a five-turn chat action.
  it('R4, V89 keeps review actions out of chat and exposes Review now after Stop', () => {
    const state = createTutorViewState();
    state.conversation.status = 'active';
    const output = renderTutorConversation(state);
    expect(load(output)('[data-command="diagnoseTutorConversation"]')).toHaveLength(0);
    // Changed 2026-09-20: the empty row stays mounted and hidden below the floor so the Live
    // completion patch can make Diagnose reachable without replacing the answer box.
    expect(output).not.toContain('Have a few more turns first.');
    expect(load(output)('[data-tutor-conversation-actions][hidden]')).toHaveLength(1);
    state.conversation.transcript = Array.from({ length: 5 }, () => ({
      question: 'What happened?', learnerAnswer: 'I went home.', correction: 'I went home.',
      explanation: 'Already correct.', nextQuestion: 'What next?'
    }));
    // Changed 2026-09-18: the short label is shared above the composer and in the stopped row.
    const ready = renderTutorConversation(state);
    expect(load(ready)('[data-command="diagnoseTutorConversation"]')).toHaveLength(0);
    expect(ready).toContain('data-tutor-conversation-actions');
    expect(ready).not.toContain('Have a few more turns first.');

    state.conversation.status = 'stopped';
    const stopped = renderTutorConversation(state);
    const review = load(stopped)('[data-command="reviewTutorConversation"]');
    expect(review.is('button:not(:disabled)')).toBe(true);
    expect(review.text()).toMatch(/review/iu);
    expect(review.parents('details, [hidden], [inert]')).toHaveLength(0);
    // Changed 2026-09-25 for V156: stopped conversations now expose the setup-only command.
    expect(stopped).toContain('data-command="startNewTutorConversation"');
  });

  it('R5 labels both drawer sources and shows conversation turn coverage and finding recurrence', () => {
    const state = createTutorViewState();
    state.diagnosticReport = { findings: [{ level: 2, observation: 'Pattern.', evidence: 'I go', turnCount: 3 }], targets: [] };
    state.diagnosticReportDrawerOpen = true;
    state.diagnosticReportSource = { kind: 'passage' };
    const drawer = () => html(state).match(/<aside class="tutor-drawer tutor-diagnostic-report-drawer"[\s\S]*?<\/aside>/u)![0];
    expect(drawer()).toContain('Source: Passage.');
    state.diagnosticReportSource = { kind: 'conversation', turnCount: 12 };
    expect(drawer()).toContain('Source: Conversation, 12 completed turns.');
    expect(drawer()).toContain('appeared in 3 turns');
    expect(drawer()).not.toContain('Source: Passage.');
    expect(drawer()).not.toContain('data-command="applyTutorDiagnosticReport"');
  });
});
