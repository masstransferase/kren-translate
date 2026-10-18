// 2026-10-13: Read Aloud owns this catalog and default independently of tutor voices.
export const READ_ALOUD_CHIRP_VOICES = [
  ['Achernar', 'female'], ['Achird', 'male'], ['Algenib', 'male'], ['Algieba', 'male'],
  ['Alnilam', 'male'], ['Aoede', 'female'], ['Autonoe', 'female'], ['Callirrhoe', 'female'],
  ['Charon', 'male'], ['Despina', 'female'], ['Enceladus', 'male'], ['Erinome', 'female'],
  ['Fenrir', 'male'], ['Gacrux', 'female'], ['Iapetus', 'male'], ['Kore', 'female'],
  ['Laomedeia', 'female'], ['Leda', 'female'], ['Orus', 'male'], ['Puck', 'male'],
  ['Pulcherrima', 'female'], ['Rasalgethi', 'male'], ['Sadachbia', 'male'], ['Sadaltager', 'male'],
  ['Schedar', 'male'], ['Sulafat', 'female'], ['Umbriel', 'male'], ['Vindemiatrix', 'female'],
  ['Zephyr', 'female'], ['Zubenelgenubi', 'male']
] as const;
export const READ_ALOUD_CHIRP_DEFAULT = 'Callirrhoe';
export function isReadAloudChirpVoice(value: unknown): value is string {
  return READ_ALOUD_CHIRP_VOICES.some(([voice]) => voice === value);
}
export function normalizedReadAloudChirpVoice(value: unknown): string {
  return isReadAloudChirpVoice(value) ? value : READ_ALOUD_CHIRP_DEFAULT;
}
export const READ_ALOUD_CHIRP_LOCALES = [
  'ar-XA', 'bn-IN', 'bg-BG', 'yue-HK', 'hr-HR', 'cs-CZ', 'da-DK', 'nl-BE', 'nl-NL',
  'en-AU', 'en-IN', 'en-GB', 'en-US', 'et-EE', 'fi-FI', 'fr-CA', 'fr-FR', 'de-DE',
  'el-GR', 'gu-IN', 'he-IL', 'hi-IN', 'hu-HU', 'id-ID', 'it-IT', 'ja-JP', 'kn-IN',
  'ko-KR', 'lv-LV', 'lt-LT', 'ml-IN', 'cmn-CN', 'mr-IN', 'nb-NO', 'pl-PL', 'pt-BR',
  'pa-IN', 'ro-RO', 'ru-RU', 'sr-RS', 'sk-SK', 'sl-SI', 'es-ES', 'es-US', 'sw-KE',
  'sv-SE', 'ta-IN', 'te-IN', 'th-TH', 'tr-TR', 'uk-UA', 'ur-IN', 'vi-VN'
] as const;
export function resolveReadAloudChirpLocale(locale: string): string | undefined {
  if (READ_ALOUD_CHIRP_LOCALES.some(value => value === locale)) return locale;
  if (['zh-CN', 'zh-SG', 'zh'].includes(locale)) return 'cmn-CN';
  if (locale === 'zh-HK') return 'yue-HK';
  const language = locale.split('-')[0]!;
  const primary: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', nl: 'nl-NL' };
  if (primary[language]) return primary[language];
  const matches = READ_ALOUD_CHIRP_LOCALES.filter(value => value.split('-')[0] === language);
  return matches.length === 1 ? matches[0] : undefined;
}
