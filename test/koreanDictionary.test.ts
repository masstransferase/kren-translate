import { describe, expect, it } from 'vitest';
import { parseKoreanDictionaryXml } from '../src/providers/koreanDictionary.js';
import type { DictionaryRequest } from '../src/types.js';

const request: DictionaryRequest = {
  text: '나무',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  kind: 'dictionary',
  operation: 'translate'
};

describe('Korean Basic Dictionary XML normalization', () => {
  it('normalizes English meanings and limits the popup to three senses', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <channel>
        <item>
          <word>나무</word>
          <pronunciation>나무</pronunciation>
          <pos>명사</pos>
          <sense><translation><trans_lang>영어</trans_lang><trans_word>tree</trans_word><trans_dfn>A woody plant.</trans_dfn></translation></sense>
          <sense><translation><trans_lang>영어</trans_lang><trans_word>wood</trans_word><trans_dfn>Material from a tree.</trans_dfn></translation></sense>
          <sense><translation><trans_lang>영어</trans_lang><trans_word>firewood</trans_word><trans_dfn>Wood used as fuel.</trans_dfn></translation></sense>
          <sense><translation><trans_lang>영어</trans_lang><trans_word>extra</trans_word><trans_dfn>Should be omitted.</trans_dfn></translation></sense>
        </item>
      </channel>`;

    const result = parseKoreanDictionaryXml(xml, request);
    expect(result?.headword).toBe('나무');
    expect(result?.pronunciation).toBe('나무');
    expect(result?.entries).toHaveLength(3);
    expect(result?.entries.map((entry) => entry.meaning)).toEqual(['tree', 'wood', 'firewood']);
    expect(result?.entries[0]).toMatchObject({
      partOfSpeech: '명사',
      definition: 'A woody plant.'
    });
  });

});
