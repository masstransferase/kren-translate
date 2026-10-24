/** Shared sentence boundaries for tutor speech, retaining titles and decimal numbers. */
export function splitSpeechSentences(text: string, retainAbbreviations = true): string[] {
  const segments = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text), part => part.segment.trim());
  const sentences: string[] = [];
  for (const segment of segments) {
    const previous = sentences.at(-1);
    if (retainAbbreviations && previous && /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|[A-Z])\.$/iu.test(previous)) {
      sentences[sentences.length - 1] += ' ' + segment;
    } else if (segment) sentences.push(segment);
  }
  return sentences;
}

export function sentencePause(value: unknown): number {
  return typeof value === 'number' && [0, 250, 500, 750, 1000].includes(value) ? value : 0;
}

export function speechSsml(text: string, milliseconds: number, trailingBreak = false): string {
  // Remove forbidden characters before segmentation so words stay intact.
  const safeText = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu, '');
  const escape = (value: string): string => value.replace(/[&<>"']/gu, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
  const pause = `<break time="${milliseconds}ms"/>`;
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' +
    splitSpeechSentences(safeText).map(escape).join(pause) + (trailingBreak ? pause : '') + '</speak>';
}
