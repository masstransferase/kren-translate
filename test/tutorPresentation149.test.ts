import { describe, expect, it } from 'vitest';
import { tutorSentenceMarkup } from '../src/resultViewHtml.js';

describe('V49 R3, an example sentence marks the words it teaches', () => {
  it('bolds every occurrence of an excerpt and leaves the rest of the sentence alone', () => {
    const markup = tutorSentenceMarkup(
      'The project that caused stress and the plan that caused delay.',
      ['that caused']
    );

    expect(markup).toBe(
      'The project <strong class="tutor-taught">that caused</strong> stress and the plan ' +
      '<strong class="tutor-taught">that caused</strong> delay.'
    );
  });

  it('escapes the sentence and the excerpt, so neither can carry markup into the page', () => {
    // Both are model output. The tempting implementation replaces inside already-escaped
    // HTML, which fails to match an excerpt containing a quote and concatenates unescaped
    // text around the match. This assertion is what catches that.
    const markup = tutorSentenceMarkup('She said <b>"go"</b> & left.', ['<b>"go"</b>']);

    expect(markup).toBe(
      'She said <strong class="tutor-taught">&lt;b&gt;&quot;go&quot;&lt;/b&gt;</strong> &amp; left.'
    );
    expect(markup).not.toContain('<b>');
  });

  it('takes the earlier match when two excerpts overlap, so no range is wrapped twice', () => {
    const markup = tutorSentenceMarkup('the quick brown fox', ['quick brown', 'brown fox']);

    expect(markup).toBe('the <strong class="tutor-taught">quick brown</strong> fox');
  });

  it('returns an escaped sentence unchanged when it teaches nothing', () => {
    expect(tutorSentenceMarkup('Plain & simple.', [])).toBe('Plain &amp; simple.');
  });

  it('marks nothing when the excerpt is the sentence, because all-bold marks nothing', () => {
    // Core requires an excerpt to occur in the sentence and sets no ceiling on its length,
    // so a model returning the sentence back as its own annotation validates and arrives
    // here. Bolding all of it looks exactly like bolding none of it.
    const sentence = 'At this time tomorrow, I will be flying to London.';

    expect(tutorSentenceMarkup(sentence, [sentence])).toBe(sentence);
    expect(tutorSentenceMarkup(sentence, ['At this time tomorrow, I will be flying to Londo']))
      .toBe(sentence);
  });

  it('matches an excerpt whose case differs from the sentence', () => {
    expect(tutorSentenceMarkup('Although the team finished, they stayed.', ['although']))
      .toBe('<strong class="tutor-taught">Although</strong> the team finished, they stayed.');
  });
});
