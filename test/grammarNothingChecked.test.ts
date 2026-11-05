import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { GRAMMAR_HARPER_SKIPPED_NOTICE, grammarNothingChecked } from '@kren/core/grammar-input-language';
import { runKrenOperation, type KrenRuntime } from '../src/operations.js';
import { resultDetails } from '../src/render.js';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { explicitTextSubmission } from '../src/submission.js';
import type { GrammarResult } from '../src/types.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const KOREAN = '그는 초대도 없이 파티에 나타났다. 아무도 신경 쓰지 않았다.';
const CLEAN_ENGLISH = 'The committee has reviewed the proposal and it will be sent to the board.';

function runtime(dialect: string): KrenRuntime {
  return {
    getSecret: async () => undefined,
    getSetting: <T>(key: string, fallback: T): T => (key === 'grammar.dialect' ? dialect : fallback) as T,
    reserveCloudCharacters: async () => undefined,
    beforeGeminiRequest: async () => undefined
  };
}

async function check(dialect: string, text: string): Promise<GrammarResult> {
  const result = await runKrenOperation(
    runtime(dialect),
    'grammar',
    explicitTextSubmission(text),
    new AbortController().signal
  );
  if (result.kind !== 'grammar') throw new Error('expected a grammar result');
  return result;
}

describe('Grammar Check when nothing was checked (V4)', () => {
  it('marks a result whose offline checker did not run, under Auto-detect and non-English text', async () => {
    const result = await check('auto', KOREAN);
    expect(result.issues).toEqual([]);
    expect(result.harperSkipped).toBe(true);
    expect(grammarNothingChecked(result)).toBe(true);
  });

  it('says nothing was checked and how to check it, not that no issues were found', async () => {
    const details = resultDetails(await check('auto', KOREAN));
    expect(details).toContain(GRAMMAR_HARPER_SKIPPED_NOTICE);
    expect(details).toContain('This text does not look like English.');
    expect(details).toContain('Turn on Smart Grammar Check in Settings');
    expect(details).not.toContain('No spelling or grammar issues found');
  });

  // The grammar worker is a built file that a source-only run does not have, so the result a
  // real English check returns with no findings is written out by hand here.
  it('keeps the existing sentence when the check ran and found nothing', () => {
    const result: GrammarResult = {
      kind: 'grammar',
      providerId: 'harper',
      sourceText: CLEAN_ENGLISH,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      dialect: 'american',
      issues: []
    };
    expect(grammarNothingChecked(result)).toBe(false);
    expect(resultDetails(result)).toContain('No spelling or grammar issues found by Harper.');
    expect(resultDetails(result)).not.toContain('nothing was checked');
  });

  it('says so in the results panel too, and keeps the clean sentence for a real clean check', () => {
    const render = (result: GrammarResult): string => renderKrenResultViewHtml({
      cspSource: 'vscode-webview://test',
      nonce: 'test-nonce',
      result,
      sourceText: result.sourceText,
      allowReplace: true,
      settings: PANEL_SETTINGS_FIXTURE,
      proModels: []
    });
    const base: GrammarResult = {
      kind: 'grammar',
      providerId: 'harper',
      sourceText: KOREAN,
      sourceLanguage: 'en',
      targetLanguage: 'en',
      createdAt: '1970-01-01T00:00:00.000Z',
      dialect: 'american',
      issues: []
    };

    const skipped = render({ ...base, harperSkipped: true });
    expect(skipped).toContain('This text does not look like English.');
    expect(skipped).toContain('Turn on Smart Grammar Check in Settings');
    expect(skipped).not.toContain('No spelling or grammar issues found');
    expect(render(base)).toContain('No spelling or grammar issues found.');
    expect(render({ ...base, harperSkipped: true, smartModelId: 'some-model' }))
      .toContain('No spelling or grammar issues found.');
  });

  it('does not claim nothing was checked when a Smart Grammar Check model completed', async () => {
    const result = { ...(await check('auto', KOREAN)), smartModelId: 'some-model' };
    expect(grammarNothingChecked(result)).toBe(false);
    expect(resultDetails(result)).toContain('No spelling or grammar issues found by Harper.');
  });
});
