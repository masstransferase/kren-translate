import { describe, expect, it } from 'vitest';
import { isPlausibleLanguageCode, languageName } from '../src/languages.js';

describe('multilingual configuration', () => {
  it('labels common translation languages', () => {
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('ja')).toBe('Japanese');
    expect(languageName('zh-CN')).toBe('Chinese (Simplified)');
    expect(languageName('de')).toBe('German');
  });

  it('accepts plausible ISO and BCP-47 custom codes', () => {
    expect(isPlausibleLanguageCode('ca')).toBe(true);
    expect(isPlausibleLanguageCode('pt-BR')).toBe(true);
    expect(isPlausibleLanguageCode('zh-Hant')).toBe(true);
    expect(isPlausibleLanguageCode('../secret')).toBe(false);
  });
});
