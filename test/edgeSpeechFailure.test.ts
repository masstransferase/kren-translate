import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  edgeSpeechFailureMessage,
  edgeSpeechLocaleLabel,
  edgeSpeechRetryNotice
} from '../src/edgeSpeechMessages.js';
import { EDGE_SPEECH_LOCALES, resolveEdgeSpeechLocale } from '@kren/core/edge-speech';

/*
 * The owner reported this twice, unchanged both times: Read Aloud failing on a wrong
 * Language/Region produced one generic sentence naming four things to check, none of which
 * was the actual cause. These tests pin what each message names, because a message that is
 * merely different is no better than the one it replaced.
 */
describe('the Edge speech failure message names what was tried', () => {
  it('names both locales when a retry already happened, and stops blaming Language/Region', () => {
    const message = edgeSpeechFailureMessage('de-DE', 'ko-KR', 'de-DE-KatjaNeural');

    expect(message).toContain('German');
    expect(message).toContain('Korean');
    expect(message).toContain('the cause is not Language/Region');
    expect(message).toContain('edge-tts');
  });

  it('names the locale and the voice when Auto-detect was already in force', () => {
    const message = edgeSpeechFailureMessage('en-US', undefined, 'en-US-ChristopherNeural');

    expect(message).toContain('English (United States)');
    expect(message).toContain('en-US-ChristopherNeural');
    expect(message).toContain('Auto-detect');
  });

  it('never reproduces the generic sentence the owner reported', () => {
    for (const message of [
      edgeSpeechFailureMessage('de-DE', 'ko-KR', 'de-DE-KatjaNeural'),
      edgeSpeechFailureMessage('en-US', undefined, 'en-US-ChristopherNeural')
    ]) {
      expect(message).not.toContain('could not generate or play the selected Edge online voice');
      expect(message).not.toContain('voice ID');
    }
  });

  it('falls back to the identifier when the catalog does not know a locale', () => {
    expect(edgeSpeechLocaleLabel('en-US')).toBe('English (United States)');
    expect(edgeSpeechLocaleLabel('xx-XX')).toBe('xx-XX');
  });
});

describe('a failed playback retries with Auto-detect before reporting', () => {
  /*
   * The retry lives in activate()'s Read Aloud path, which needs the vscode module and a
   * spawned Python process to exercise end to end. This reads the source instead, the same
   * technique test/*.test.ts already uses for the known-language argument, because the
   * behaviour is invisible in any rendered output and dropping it still type-checks.
   */
  const source = readFileSync('src/speech/speechCenter.ts', 'utf8');

  it('retries once with the automatic locale when the configured one fails', () => {
    expect(source).toContain("if (result === 'failed' && configuredLocale !== EDGE_SPEECH_AUTO_LOCALE)");
    expect(source).toContain('configured: EDGE_SPEECH_AUTO_LOCALE');
    expect(source).toContain('retriedLocale = auto;');
    expect(source).toContain('result = await speakIn(auto);');
  });

  it('does not retry when the resolved locale would be the one that just failed', () => {
    expect(source).toContain('if (auto !== locale) {');
  });

  it('never writes the retried locale back to the stored setting', () => {
    const retryBlock = source.slice(
      source.indexOf("if (result === 'failed' && configuredLocale !== EDGE_SPEECH_AUTO_LOCALE)"),
      source.indexOf('if (result === \'dependencyMissing\')')
    );
    expect(retryBlock.length).toBeGreaterThan(0);
    expect(retryBlock).not.toContain('update(');
    expect(retryBlock).not.toContain('updateSetting');
  });

  it('tells the reader which locale actually spoke, and that their setting is unchanged', () => {
    expect(source).toContain("edgeSpeechRetryNotice(locale, retriedLocale)");
    const notice = edgeSpeechRetryNotice('de-DE', 'ko-KR');
    expect(notice).toContain('German');
    expect(notice).toContain('Korean');
    expect(notice).toContain('Your Language/Region setting is unchanged.');
  });
});

describe('the locales the messages name are real catalog entries', () => {
  it('resolves German and Korean to locales the catalog carries', () => {
    for (const id of ['de-DE', 'ko-KR', 'en-US']) {
      expect(EDGE_SPEECH_LOCALES.some((locale) => locale.id === id), id).toBe(true);
    }
  });

  it('detects the sentence the owner reported as failing', () => {
    expect(resolveEdgeSpeechLocale({
      configured: 'auto',
      text: 'Wie geht es dir? Lange nicht gesehen.',
      fallback: 'en-US'
    }).locale).toBe('de-DE');
  });
});
