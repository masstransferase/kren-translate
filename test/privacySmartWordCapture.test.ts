import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Owner decision, 2026-10-05: Smart Word Capture stays on by default, and every privacy statement
 * says it sends the one sentence around a word added to the User Dictionary. Review R5a found
 * PRIVACY.md, README.md and the Settings intro claiming only selected text is sent.
 */
describe('privacy statements name the Smart Word Capture sentence', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it.each([
    ['PRIVACY.md', read('PRIVACY.md')],
    ['README.md', read('README.md')],
    ['docs/USER_GUIDE.md', read('docs/USER_GUIDE.md')],
    ['docs/PRIVACY_AND_COST.md', read('docs/PRIVACY_AND_COST.md')]
  ])('%s says Smart Word Capture sends one sentence', (_name, text) => {
    expect(text).toMatch(/Smart Word Capture/u);
    expect(text).toMatch(/sentence/u);
    // Changed 2026-10-06: V211 moves the disclosure to Reference; task mentions cannot substitute for it.
    if (_name === 'docs/USER_GUIDE.md') {
      const reference = text.split('## Reference')[1] ?? '';
      expect(reference).toMatch(/Smart Word Capture[^\n]*sends the single sentence[^\n]*500 characters/u);
      expect(reference).toMatch(/sentence is stored[^\n]*exports[^\n]*Source line/u);
      expect(reference).toMatch(/Turn Smart Word Capture off to send the selected expression alone/u);
    }
  });

  it('the Settings intro names the exception next to "sends only text you explicitly select"', () => {
    const source = read('src/resultViewHtml.ts');
    // Changed 2026-10-06: V211 separates the manual from Settings; scope this assertion to the actual Settings disclosure.
    const settings = source.slice(source.indexOf('function renderSettings('), source.indexOf('function renderTutor('));
    // Changed 2026-10-17: V261, F5 owner canvas edit: the owner's shorter intro still names the sentence Smart Word Capture adds.
    const intro = settings.slice(settings.indexOf('KREN sends the selected expression'));
    expect(intro.slice(0, 250)).toMatch(/selected expression[^\n]*plus the surrounding sentence when Smart Word Capture is on/u);
  });
});
