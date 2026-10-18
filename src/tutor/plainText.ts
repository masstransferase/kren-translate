/** 2026-10-13: Clean model prose and its matching excerpts together before validation/storage. */
export function tutorPlainText(text: string): string {
  return text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/gu, '$1')
    .replace(/(?<!_)__(?!_)(?=\S)([\s\S]*?\S)__(?!_)/gu, '$1')
    .replace(/(?<![\p{L}\p{N}_*])([*_])(?![*_])(?=\S)([^*_]*?[^\s*_])\1(?![\p{L}\p{N}_*])/gu, '$2');
}

export function cleanTutorModelText(value: unknown, exercises = false): unknown {
  if (typeof value === 'string') return tutorPlainText(value);
  if (Array.isArray(value)) return value.map(item => cleanTutorModelText(item, exercises));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const cleaned = cleanTutorModelText(item, exercises);
    return [key, (exercises || 'targetIds' in value) && key === 'prompt' && typeof cleaned === 'string'
      ? cleaned.replace(/(?<!_)___(?:[ \t]+___)+(?!_)/gu, '___') : cleaned];
  }));
}
