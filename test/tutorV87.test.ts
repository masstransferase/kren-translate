import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { TUTOR_MAP } from '@kren/core/tutor';
import { renderKrenResultViewHtml, tutorWaitingNotice } from '../src/resultViewHtml.js';
import { createTutorViewState, tutorRecipeFromState, type TutorAskBusyKind } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const target = TUTOR_MAP.find((node) => node.kind === 'microTarget')!;
function page(state = createTutorViewState()) {
  return load(renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor', tutor: state, proModels: [] }));
}
function reportState() {
  const state = createTutorViewState();
  state.diagnosticReportDrawerOpen = true;
  state.diagnosticReport = { findings: [{ level: 2, observation: 'Use the past.', evidence: 'I go', correction: 'I went' }],
    polish: [{ evidence: 'I made a party', suggestion: 'I threw a party', reason: 'This is the usual collocation.', targetId: target.id }],
    targets: [{ nodeId: target.id, role: 'primary' }] };
  return state;
}
function lessonState() {
  const state = createTutorViewState();
  state.selection = [{ nodeId: target.id, role: 'primary' }];
  state.lesson = { recipe: tutorRecipeFromState(state), lesson: { schemaVersion: 1, mapVersion: '1.0.0', lessonTitle: 'Lesson', level: 'B2',
    primaryTarget: { nodeId: target.id, label: target.label, kind: target.kind, role: 'primary', description: target.description },
    supportingTargets: [], conceptExplanation: 'Concept', interactionExplanation: 'Interaction', rules: [],
    examples: Array.from({ length: 3 }, (_, i) => ({ id: `example-${i}`, sentence: `Sentence ${i}.`, targetIds: [target.id],
      annotations: [{ targetId: target.id, excerpt: 'Sentence', explanation: 'Explanation.' }] })),
    commonErrors: [], generationNotes: [] }, findings: [] };
  return state;
}
function practiceState(count: number) {
  const state = createTutorViewState();
  state.exerciseSet = { schemaVersion: 1, mapVersion: '1.0.0', channel: 'written',
    exercises: Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, channel: 'written', prompt: `Prompt ${i}`,
      targetIds: [TUTOR_MAP[i]!.id] })) };
  for (const [i, item] of state.exerciseSet.exercises.entries()) {
    state.reviews[item.id] = { schemaVersion: 1, exerciseId: item.id, learnerText: 'I go yesterday.',
      correct: [{ excerpt: 'yesterday', reason: 'Time' }],
      incorrect: i < 2 ? [{ excerpt: 'go', corrected: 'went', reason: 'Past', status: 'rule' }] : [] };
  }
  // Changed 2026-09-15: V87's completed fixture is specifically an opened results screen.
  state.practiceResultsOpened = true;
  return state;
}
function declarations($: ReturnType<typeof page>, selector: string) {
  const values: Record<string, string> = {};
  parseCss($('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
  });
  return values;
}

describe('V87 panel corrections', () => {

  /*
   * The reader saw the triangles sitting high after V87 doubled them to 2em. Their rows align
   * on the text baseline, which is right for the labels and wrong for a glyph at twice the
   * text size: a 2em character's baseline is low in a tall box, so matching baselines lifts
   * the box. The glyph is centred and the rows keep baseline for their text.
   */
  /*
   * The owner's 2026-09-13 revision, which reverses interface decisions rule 3 for this row
   * only: the left controls hold their places and are enabled or disabled, because a practice
   * item is a repeated form and a control that moves between items costs more than the
    * absent-not-disabled rule buys. Navigation holds its place and stays disabled until Review.
   */
  it('keeps the practice controls in place and navigation disabled until Review', () => {
    const unanswered = createTutorViewState();
    unanswered.exerciseSet = {
      schemaVersion: 1, mapVersion: '1.0.0', channel: 'written',
      exercises: [{ id: 'item-0', channel: 'written', prompt: 'Prompt 0', targetIds: [TUTOR_MAP[0]!.id] }]
    };
    const before = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test',
      settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor', tutor: unanswered, proModels: [] });
    // Changed 2026-10-04: a one-item set uses the last-page Review all action.
    for (const command of ['reviewUnreviewedTutorExercises', 'hintTutorExercise', 'openTutorPracticeAsk',
      'playTutorExercise', 'dictateTutorExercise']) {
      expect(before, `${command} is present before an answer`).toContain(`data-command="${command}"`);
    }
    // Changed 2026-09-30: both arrows and the position stay visible before Review.
    const $ = load(before);
    const navigation = $('.tutor-exercise-navigation');
    expect(navigation).toHaveLength(1);
    expect(navigation.find('.tutor-exercise-position[aria-live="polite"]')).toHaveLength(1);
    expect(navigation.find('button')).toHaveLength(2);
    expect(navigation.find('button[disabled][aria-disabled="true"]')).toHaveLength(2);
    // Changed 2026-09-24: Hint is now the same icon-button form as the adjacent actions.
    const hintButton = before.match(/<button[^>]*data-command="hintTutorExercise"[^>]*>[\s\S]*?<\/button>/u)?.[0] ?? '';
    expect(hintButton, 'Hint is usable from the start').toContain('class="icon-button tutor-action-icon"');
    expect(hintButton, 'Hint is usable from the start').not.toMatch(/\sdisabled(?:\s|>)/u);
    expect(before, 'the microphone is inert until capture exists')
      .toMatch(/data-command="dictateTutorExercise"[^>]*disabled/u);
    // 2026-10-04: V203 restores disabled fading; inactive controls are exempt from text contrast checks.
    expect(before).toContain('.icon-button:disabled { opacity: .55; }');
  });

  it('optically centres both disclosure triangles against rows that centre their text', () => {
    const output = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test',
      settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'tutor',
      tutor: createTutorViewState(), proModels: [] });
    for (const before of [
      ".settings-group > summary::before { content: '▸'; width: 20px; font-size: 2em; line-height: 0; align-self: center;",
      ".rewrite-settings-group > summary::before { content: '▸'; width: 20px; font-size: 2em; line-height: 0; align-self: center;"
    ]) {
      expect(output).toContain(before);
    }
    for (const row of [
      '.settings-group > summary { display: flex; gap: 7px; align-items: center;',
      // Changed 2026-09-16: the shared nested foldable rule is element-qualified.
      'details.rewrite-settings-group > summary { display: grid;'
    ]) {
      expect(output).toContain(row);
    }
    // Changed 2026-09-16: read declarations because V103 inserts measured margins between them.
    const nested = declarations(load(output), 'details.rewrite-settings-group > summary');
    expect(nested['align-items']).toBe('center');
    expect(nested.padding).toBe('9px 2px');
  });
  it('R1 numbers the polish evidence before its detail bullets, with no bare nested lists', () => {
    const $ = page(reportState());
    const drawer = $('.tutor-diagnostic-report-drawer');
    const suggestion = drawer.find('[aria-label="Naturalness suggestions"] ol > li');
    expect(suggestion).toHaveLength(1);
    expect(suggestion.children().first().text()).toBe('Evidence from your words: I made a party');
    expect(suggestion.children().first().is('ul, ol')).toBe(false);
    expect(suggestion.children('ul').children('li').map((_, el) => $(el).text().split(':')[0]).get())
      .toEqual(['Suggestion', 'Why', 'Target']);
    drawer.find('li').each((_, el) => expect($(el).children().first().is('ul, ol')).toBe(false));
  });

  it('R2 excludes the long Apply explanation everywhere in the drawer', () => {
    for (const hasTargets of [true, false]) {
      const state = reportState();
      if (!hasTargets) state.diagnosticReport!.targets = [];
      const $ = page(state);
      const text = $('.tutor-diagnostic-report-drawer').text();
      expect(text).not.toContain('then asks the configured tutor provider');
      expect(text).not.toContain('Later target or setting changes keep the tailored prompt');
    }
  });

  it('R4 has exactly one controls row with six tools then one stable navigation group', () => {
    for (let index = 0; index < 3; index++) {
      const state = lessonState();
      state.currentExampleIndex = index;
      const $ = page(state);
      const article = $('[data-tutor-example-card]');
      // Changed 2026-09-30: V175 puts controls after the card, inside the lesson article.
      const row = article.next('.tutor-example-controls');
      const nav = row.find('[aria-label="Lesson example navigation"]');
      expect(row).toHaveLength(1);
      expect(nav).toHaveLength(1);
      expect(nav.parent()[0]).toBe(row[0]);
      expect(row.children().last()[0]).toBe(nav[0]);
       expect(row.children('[data-tutor-example-tools]').find('button')).toHaveLength(6);
       // Changed 2026-09-30: only boundary arrows may be disabled; all six tools remain usable.
       expect(row.children('[data-tutor-example-tools]').find('button[disabled], button[aria-disabled="true"]')).toHaveLength(0);
       // Changed 2026-09-30: boundary arrows remain present and disabled.
      expect(nav.find('[data-command="showPreviousTutorExample"]')).toHaveLength(1);
      expect(nav.find('[data-command="showNextTutorExample"]')).toHaveLength(1);
      expect(nav.find('button[disabled][aria-disabled="true"]')).toHaveLength(index === 1 ? 0 : 1);
      /*
       * Changed 2026-09-30: the owner set one unwrapped row for tools and navigation.
       */
      expect(declarations($, '.tutor-example-controls')).toMatchObject({ display: 'flex', 'flex-wrap': 'nowrap', 'margin-top': '1.5em', 'align-items': 'center' });
      expect(declarations($, '.tutor-example-controls')).not.toHaveProperty('overflow-x');
      expect(declarations($, '.tutor-example-navigation')).toMatchObject({ display: 'flex', 'align-items': 'center', gap: '4px', 'margin-left': 'auto', 'margin-right': '4px' });
      expect(declarations($, '.tutor-example-navigation')).not.toHaveProperty('grid-template-columns');
    }
  });

  it('R5 regeneration raises the overlay with its matching reachable cancel inside', () => {
    const state = lessonState();
    state.exampleBusyIds = ['example-1', 'example-2'];
    const $ = page(state);
    const overlay = $('.busy-overlay');
    expect(overlay).toHaveLength(1);
    expect(overlay.text()).toContain('Regenerating an example. Please wait.');
    const cancel = overlay.find('button[data-command="cancelTutorExample"]');
    expect(cancel).toHaveLength(1);
    expect(cancel.attr('data-tutor-example')).toBe('example-1');
    expect(cancel.is('[disabled], [hidden], [tabindex="-1"]')).toBe(false);
    expect(cancel.parents('details')).toHaveLength(0);
    expect($('[data-tutor-result="lesson"] [data-command="cancelTutorExample"]')).toHaveLength(0);
    state.exampleBusyIds.shift();
    expect(page(state)('.busy-overlay button').attr('data-tutor-example')).toBe('example-2');
  });

  it('R6 enumerates the askBusy type and gives every member its own accurate sentence', () => {
    const source = ts.createSourceFile('state.ts', readFileSync('src/tutor/state.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const alias = source.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === 'TutorAskBusyKind')!;
    expect(ts.isUnionTypeNode(alias.type)).toBe(true);
    const kinds = (alias.type as ts.UnionTypeNode).types.map((node) => {
      expect(ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)).toBe(true);
      return ((node as ts.LiteralTypeNode).literal as ts.StringLiteral).text as TutorAskBusyKind;
    });
    const expected: Record<TutorAskBusyKind, string> = {
      targetSearch: 'Drafting a prompt from your question. Please wait.',
      passageDiagnosis: 'Analyzing your selected text. Please wait.',
      conversationDiagnosis: 'Diagnosing your conversation. Please wait.',
      tailoredPrompt: 'Writing your tailored prompt. Please wait.',
      exampleQuestion: 'Answering your question about this example. Please wait.',
      practiceQuestion: 'Answering your question about this practice item. Please wait.'
    };
    const notices = kinds.map((askBusy) => {
      const state = { ...createTutorViewState(), askBusy };
      const notice = tutorWaitingNotice(state);
      expect(notice, askBusy).toBe(expected[askBusy]);
      expect(page(state)('.busy-overlay').text()).toContain(notice!);
      return notice;
    });
    expect(new Set(notices).size).toBe(kinds.length);
  });

  it('R7 doubles both disclosure glyphs and their reserved width', () => {
    const $ = page();
    for (const selector of ['.settings-group > summary::before', '.rewrite-settings-group > summary::before']) {
      expect(declarations($, selector)).toMatchObject({ 'font-size': '2em', width: '20px' });
    }
    // Changed 2026-09-16: the shared nested foldable rule is element-qualified.
    expect(declarations($, 'details.rewrite-settings-group > summary')['grid-template-columns']).toMatch(/^20px /u);
  });

  it.each([3, 5])('R8 R9 controls name real counts for a %i item set in the plain results panel', (count) => {
    const $ = page(practiceState(count));
    const results = $('[data-tutor-practice-results]');
    for (const [command, label] of [
      ['reviewAllTutorExercises', `Review again (${count} items)`],
      ['walkTutorMissedExercises', 'Review 2 missed items'],
      ['diagnoseTutorPractice', `Show diagnostics (${count} items)`]
    ]) {
      const button = results.find(`button[data-command="${command}"]`);
      expect(button).toHaveLength(1);
      expect(button.text()).toBe(label);
      expect(button.parents('details')).toHaveLength(0);
      expect(button.is('[disabled], [hidden], [tabindex="-1"]')).toBe(false);
    }
    expect(results.find('button').text()).not.toMatch(/\bsix\b/iu);
  });

  it('R10 every score bar shares one width and its label row, aligned right', () => {
    const $ = page(practiceState(5));
    const meters = $('[data-tutor-target-result] meter');
    expect(meters).toHaveLength(5);
    const widths: string[] = [];
    meters.each((_, meter) => {
      const bar = $(meter);
      expect(bar.parent().is('[data-tutor-target-result]')).toBe(true);
      expect(bar.siblings('p')).toHaveLength(1);
      expect(declarations($, '[data-tutor-target-result]')).toMatchObject({ display: 'flex', 'align-items': 'center' });
      // Compute applicable width declarations, including a later selector or inline override.
      let width = '';
      parseCss($('style').text()).walkRules((rule) => {
        // Changed 2026-09-20: V125 adds microphone keyframes. Percentage keyframe stops are
        // CSS rules but not element selectors, so they cannot apply a meter width.
        if (rule.parent?.type === 'atrule' && /keyframes$/u.test(rule.parent.name)) return;
        if (/::|:focus-visible|:hover|:focus\b|:active\b/u.test(rule.selector)) return;
        if (rule.selectors.some((selector) => bar.is(selector))) rule.walkDecls('width', (decl) => { width = decl.value; });
      });
      parseCss(`meter { ${bar.attr('style') ?? ''} }`).walkDecls('width', (decl) => { width = decl.value; });
      widths.push(width);
      expect(bar.parent().children().last()[0]).toBe(meter);
    });
    expect(widths).toEqual(Array(5).fill('var(--tutor-score-bar-width)'));
    expect(declarations($, '[data-tutor-practice-results]')['--tutor-score-bar-width']).toBe('clamp(4rem, 30vw, 10rem)');
    expect(declarations($, '[data-tutor-target-result] meter')).toMatchObject({ 'margin-left': 'auto', 'flex-shrink': '0' });
  });

  it('R11 missed details use the shared report list rule and contiguous filled bullets', () => {
    const $ = page(practiceState(5));
    const lists = $('[data-tutor-missed-item] > ul');
    expect(lists).toHaveLength(2);
    lists.each((_, list) => {
      expect($(list).hasClass('tutor-missed-details')).toBe(true);
      expect($(list).children().map((_, el) => el.tagName).get()).toEqual(['li', 'li']);
      expect($(list).children().map((_, el) => $(el).text().split(':')[0]).get()).toEqual(['You wrote', 'Correction']);
    });
    const rules: string[][] = [];
    parseCss($('style').text()).walkRules((rule) => {
      if (rule.selectors.includes('.tutor-missed-details')) rules.push(rule.selectors);
    });
    expect(rules).toContainEqual(['.tutor-report-details', '.tutor-report-targets', '.tutor-missed-details']);
    expect(declarations($, '.tutor-missed-details')).toMatchObject({ 'list-style': 'disc inside', 'padding-left': '0', 'margin-block': '0' });
    expect(declarations($, '.tutor-missed-details > li')).toMatchObject({ margin: '0', padding: '0' });
    expect(declarations($, '[data-tutor-missed-items] ol')['padding-left']).toBe('0');
  });
});
