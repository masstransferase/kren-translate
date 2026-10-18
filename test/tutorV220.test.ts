// 2026-10-11: V220 patches the saved hint control without replacing the active composer.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PANEL_SETTING_KEYS, validatedPanelSetting } from '../src/panelSettings.js';

describe('V220 hint setting patch', () => {
  it('patches the mounted checkbox in place and preserves the answer element and draft', () => {
    class Input { checked = false; value = ''; }
    const toggle = new Input(), answer = new Input(); answer.value = 'Keep my unfinished answer.';
    const document = { querySelector: (selector: string) => selector.includes('hintPrefetch') ? toggle : answer };
    const source = readFileSync('src/resultViewHtml.ts', 'utf8');
    const patch = source.split("if (message.command === 'tutorConversationHintPrefetchSetting') {")[1]!
      .split("if (message.command === 'tutorConversationTakeHomeSetting')")[0]!;
    for (const value of [true, false]) {
      runInNewContext(`if (true) {${patch}`, { document, HTMLInputElement: Input, message: { value } });
      expect(toggle.checked).toBe(value);
      expect(document.querySelector('[data-tutor-conversation-answer]')).toBe(answer);
      expect(answer.value).toBe('Keep my unfinished answer.');
    }
  });
  it('allowlists boolean hint prefetch values and rejects other types', () => {
    expect(PANEL_SETTING_KEYS.has('tutor.conversation.hintPrefetch')).toBe(true);
    for (const value of [true, false]) expect(validatedPanelSetting('tutor.conversation.hintPrefetch', value)).toBe(value);
    for (const value of ['true', 'false', 1, null]) expect(validatedPanelSetting('tutor.conversation.hintPrefetch', value as never)).toBeUndefined();
  });
});

it('reads production hint prefetch with its declared default and patches external setting changes', () => {
  const source = readFileSync('src/extension.ts', 'utf8');
  const line = source.split('\n').find(line => line.includes('tutorConversationHintPrefetch:'))!;
  const reads: unknown[][] = [];
  const result = runInNewContext(`({${line.replace('get<boolean>', 'get')}})`, { config: { get: (key: string, fallback: unknown) => { reads.push([key, fallback]); return fallback; } },
    TUTOR_DEFAULTS: { configuration: { 'tutor.conversation.hintPrefetch': false } } });
  expect(reads).toEqual([['tutor.conversation.hintPrefetch', false]]);
  expect(result.tutorConversationHintPrefetch).toBe(false);
  expect(source).toContain("if (event.affectsConfiguration('kren.tutor.conversation.hintPrefetch')) postTutorHintPrefetchSetting(resultsView)");
});
it('patches Review all and stale review state after edits without replacing the answer', () => {
  const source = readFileSync('src/resultViewHtml.ts', 'utf8');
  const functions = source.split('    function syncTutorReviewState')[1]!.split("    document.addEventListener('keydown'")[0]!;
  const attributes = new Map([['data-review-busy', 'false'], ['data-item-number', '6'], ['data-item-reviewed', 'true'], ['data-reviewed-answer', 'Original.']]);
  let hidden = true;
  const stale = { classList: { toggle: (_class: string, value: boolean) => { hidden = value; } } };
  const panel = { getAttribute: (key: string) => attributes.get(key), querySelector: (selector: string) => selector === '[data-tutor-review-outdated]' ? stale : null };
  const controlAttributes = new Map([['data-review-all', 'true'], ['data-first-unanswered-other', '-1'], ['data-pending-other', 'false'], ['data-reviewed-answer', 'Original.']]);
  const control = { disabled: true, closest: () => panel, getAttribute: (key: string) => controlAttributes.get(key), setAttribute: (key: string, value: string) => controlAttributes.set(key, value) };
  for (const [answer, disabled, isHidden] of [['Original.', true, true], ['Edited.', false, false], ['  ', true, false], ['Original.', true, true]] as const) {
    runInNewContext(`function syncTutorReviewState${functions}; syncTutorReviewAvailability(answer, control);`, { answer, control });
    expect(control.disabled).toBe(disabled); expect(hidden).toBe(isHidden);
  }
});
it('patches Requests today without replacing the active composer', () => {
  const source = readFileSync('src/resultViewHtml.ts', 'utf8');
  const patch = source.split("if (message.command === 'languageModelUsage') {")[1]!.split("if (message.command === 'tutorConversationHintPrefetchSetting')")[0]!;
  const usage = { innerHTML: '' }, composer = { value: 'Keep this draft.' };
  const document = { querySelector: (selector: string) => selector.includes('language-model-usage') ? usage : composer };
  runInNewContext(`(function() { if (true) {${patch} })()`, { document, message: { html: '<h3>Requests today</h3>' } });
  expect(usage.innerHTML).toContain('Requests today'); expect(composer.value).toBe('Keep this draft.');
});
