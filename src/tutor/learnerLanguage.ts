import { detectedLanguage } from '../detectedLanguage.js';

/** Format recognized words for display only. Do not infer sentence boundaries from word order. */
export function tutorSpokenAnswerForDisplay(rawTranscript: string): string {
  let answer = rawTranscript.trim();
  if (!answer) return answer;
  answer = answer.replace(/\bi\b/gu, 'I')
    .replace(/(^|[.!?]\s+)([\s"'\u201c\u2018(]*)(\p{L})/gu,
      (_match, boundary: string, quote: string, letter: string) => boundary + quote + letter.toLocaleUpperCase('en-US'));
  if (/[.!?]["'\u201d\u2019)]*$/u.test(answer)) return answer;
  const sentence = answer.split(/[.!?]\s+/u).at(-1) ?? answer;
  const question = /^[\s"'\u201c\u2018(]*(?:what|where|when|why|who|whom|whose|which|how|do|does|did|is|are|am|was|were|can|could|will|would|shall|should|may|might|must|have|has|had)\b/iu.test(sentence) ||
    /\b(?:can|could|would|will|do|does|did|is|are|am|was|were|should|shall|may|might|must|have|has|had)\s+(?:I|you|we|they|he|she|it)\b/iu.test(sentence);
  return answer.replace(/(["'\u201d\u2019)]*)$/u, `${question ? '?' : '.'}$1`);
}

/** English requests may quote words in any language. Extend this list for new forms. */
export const TUTOR_ENGLISH_REQUEST_PATTERNS: readonly RegExp[] = [
  /\bhow\s+(?:do\s+(?:i|you)|can\s+i)\s+say\b[\s\S]+\bin\s+english\b/iu,
  /\bhow\s+do\s+(?:i|you)\s+translate\b[\s\S]+/iu,
  /\btranslate\b[\s\S]+\binto\s+english\b/iu,
  /\bhow\s+do\s+i\s+express\b[\s\S]+\bin\s+english\b/iu,
  /\bwhat\s+is\b[\s\S]+\bin\s+english\b/iu,
  /\bwhat\s+does\b[\s\S]+\bmean\b/iu
];

export const TUTOR_COMMON_ENGLISH_WORDS = [
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'be', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'what', 'how', 'why', 'where',
  'when', 'who', 'this', 'that', 'to', 'of', 'and', 'in', 'on', 'for', 'with', 'not',
  'yes', 'no', 'my', 'your', 'me'
] as const;

export const TUTOR_COMMON_SPANISH_WORDS = [
  'cómo', 'como', 'qué', 'que', 'dónde', 'donde', 'se', 'llama', 'tu', 'es', 'el', 'la',
  'los', 'las', 'de', 'por', 'para', 'gracias', 'hola', 'está', 'estás', 'eres', 'soy', 'muy', 'bien'
] as const;

export function tutorLearnerTurnNotShown(text: string): boolean {
  if (TUTOR_ENGLISH_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) return false;
  const letters = text.match(/\p{L}/gu) ?? [];
  const nonLatin = letters.filter((letter) => !/\p{Script=Latin}/u.test(letter)).length;
  if (nonLatin > letters.length / 2) return true;
  const latinText = nonLatin > 0
    ? text.replace(/\p{L}/gu, (letter) => /\p{Script=Latin}/u.test(letter) ? letter : ' ')
    : text;
  const englishWords = (latinText.toLowerCase().match(/\p{L}+/gu) ?? [])
    .filter((word) => (TUTOR_COMMON_ENGLISH_WORDS as readonly string[]).includes(word)).length;
  if (englishWords > 1) return false;
  const language = detectedLanguage(latinText);
  // 2026-10-02: Inverted punctuation needs a Spanish word, not just an accented name.
  const spanishWords: readonly string[] = latinText.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}+/gu) ?? [];
  if (language === undefined && /[¿¡]/u.test(latinText) && TUTOR_COMMON_SPANISH_WORDS.some(
    (word) => spanishWords.includes(word.normalize('NFD').replace(/\p{M}/gu, ''))
  )) return true;
  return language !== undefined && !/^en(?:-|$)/iu.test(language);
}

/** Drop misrecognized non-Latin segments wherever they occur, preserving English requests. */
export function tutorLearnerTurnText(text: string, segments: 'all' | 'tail' = 'all'): string {
  if (!/[^\p{Script=Latin}\P{L}]/u.test(text) ||
      TUTOR_ENGLISH_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) return text;
  // Typed text keeps its existing policy because a quoted name is not misrecognized speech.
  if (segments === 'tail') {
    if (tutorLearnerTurnNotShown(text)) return text;
    const tail = /[^\p{Script=Latin}]*$/u.exec(text);
    if (!tail) return text;
    const firstLetter = tail[0].search(/\p{L}/u);
    if (firstLetter < 0) return text;
    let start = tail.index + firstLetter;
    while (start > tail.index && /\p{N}/u.test(text[start - 1]!)) start--;
    return /[\s\p{P}]/u.test(text[start - 1] ?? '') ? text.slice(0, start).trimEnd() : text;
  }
  const cleaned = text.replace(/[^\p{Script=Latin}]*[^\p{Script=Latin}\P{L}][^\p{Script=Latin}]*/gu,
    (segment, offset: number) => {
      // Preserve the punctuation and numbers belonging to the preceding English clause.
      const first = segment.search(/[^\p{Script=Latin}\P{L}]/u);
      let start = first;
      while (start > 0 && /\p{N}/u.test(segment[start - 1]!)) start--;
      const prefix = segment.slice(0, start).trimEnd();
      return (offset > 0 ? prefix : '') + ' ';
    }).replace(/\s+/gu, ' ').trim();
  // Entirely unrecognized turns keep the existing hidden-turn path.
  return cleaned && !tutorLearnerTurnNotShown(cleaned) ? cleaned : text;
}
