import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { parse as parseCss } from 'postcss';
import { describe, expect, it } from 'vitest';
import { TUTOR_MAP } from '@kren/core/tutor';
import { renderKrenResultViewHtml, renderTutorExercises } from '../src/resultViewHtml.js';
import { tutorPracticeHintRequest } from '../src/tutor/generation.js';
import { createTutorViewState, type TutorViewState } from '../src/tutor/state.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

function practiceState(): TutorViewState {
  const state = createTutorViewState();
  state.exerciseSet = {
    schemaVersion: 1,
    mapVersion: '1.0.0',
    channel: 'written',
    exercises: [{
      id: 'practice-1',
      channel: 'written',
      prompt: 'Use the requested structure in one sentence.',
      targetIds: [TUTOR_MAP.find((node) => node.kind === 'microTarget')!.id]
    }]
  };
  return state;
}

function page() {
  return load(renderKrenResultViewHtml({
    cspSource: 'test',
    nonce: 'test',
    settings: PANEL_SETTINGS_FIXTURE,
    activeScreen: 'tutor',
    tutor: practiceState(),
    tutorSpeechProvider: 'auto',
    proModels: []
  }));
}

function declarations(selector: string) {
  const values: Record<string, string> = {};
  parseCss(page()('style').text()).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
    }
  });
  return values;
}

describe('V94 lesson and practice corrections', () => {
  it('R1 hangs every annotation from one left-aligned text edge', () => {
    expect(declarations('.tutor-annotation-list')).toMatchObject({
      'padding-left': '1.55em',
      'list-style': 'none'
    });
    expect(declarations('.tutor-annotation-list > li')).toMatchObject({
      position: 'relative',
      'text-align': 'left'
    });
  });

  it('R2 positions only the custom marker, now a drawn disc, independently of the text edge', () => {
    // The bullet character became a drawn disc on 2026-09-15, because the glyph was smaller
    // than the native marker it replaced. Changed later on 2026-09-15 to follow the new badge
    // padding; test/tutorLayout142.test.ts pins its geometry.
    expect(declarations('.tutor-annotation-list > li::before')).toMatchObject({
      content: "''",
      position: 'absolute',
      left: '-0.73em',
      'border-radius': '50%'
    });
  });

  it('R3 lets the provider compose the hint freely while preserving its task and answer limits', () => {
    const request = tutorPracticeHintRequest(
      'Use the requested structure in one sentence.',
      ['Requested structure'],
      { axes: practiceState().settings.axes, learnerLevel: 'B2' }
    );
    expect(request.instruction).toContain('Explain what the practice question is asking');
    expect(request.instruction).toContain('compose the explanation freely');
    expect(request.instruction).not.toMatch(/begin with|current practice question asks/iu);
    expect(request.instruction).toContain('Never write the answer');
  });

  it('R3 shows a supplied task line and omits the block when the task is unknown', () => {
    // Changed 2026-10-14: V236, owner item 1.9, an unknown task has no fallback text.
    const state = practiceState();
    state.reviews['practice-1'] = {
      schemaVersion: 1,
      exerciseId: 'practice-1',
      learnerText: 'My response.',
      correct: [{ excerpt: 'My response.', reason: 'It meets the task.' }],
      incorrect: []
    };
    state.practiceReviewAll = true;
    expect(load(renderTutorExercises(state))('.tutor-question-explanation')).toHaveLength(0);
    state.exerciseSet!.exercises[0]!.taskLine = 'Write a sentence using the requested structure.';
    expect(load(renderTutorExercises(state))('.tutor-question-explanation').text())
      .toMatch(/write.*sentence.*structure/iu);
  });

  it('R4 leaves one empty line above the explanation block', () => {
    expect(declarations('.tutor-question-explanation')).toMatchObject({
      margin: '1.45em 0 5px'
    });
  });

  it('R7 preserves the answer focus by patching dictation state without a full render', () => {
    // 2026-09-26: Dictation moved to src/resultsViewDictation.ts. The original region ran from
    // toggleTutorDictation to the end of the dictation methods, which covered the Gemini start,
    // stop and cancel helpers it calls, so this reads from the toggle to the end of the module.
    // The V160 review showed a narrower slice letting startGeminiDictation render in full.
    const dictation = readFileSync('src/resultsViewDictation.ts', 'utf8');
    const toggleStart = dictation.indexOf('export async function toggleTutorDictation(');
    // A renamed function would make indexOf return -1, so an absent render would prove nothing.
    expect(toggleStart).toBeGreaterThan(-1);
    const toggle = dictation.slice(toggleStart);
    expect(toggle).toContain('export async function startGeminiDictation(');
    expect(toggle).toContain("command: 'tutorDictationState'");
    expect(toggle).not.toMatch(/(?:this|view)\.render\(\)/u);

    const webview = renderKrenResultViewHtml({
      cspSource: 'test',
      nonce: 'test',
      settings: PANEL_SETTINGS_FIXTURE,
      activeScreen: 'tutor',
      tutor: practiceState(),
      tutorSpeechProvider: 'auto',
      proModels: []
    });
    const messageStart = webview.indexOf("message.command === 'tutorDictationState'");
    expect(messageStart).toBeGreaterThan(-1);
    expect(webview.slice(messageStart, messageStart + 1400)).toContain(
      "button[data-command=\"dictateTutorExercise\"]"
    );
    expect(webview.slice(messageStart, messageStart + 1400)).not.toContain('.focus()');
  });
});
