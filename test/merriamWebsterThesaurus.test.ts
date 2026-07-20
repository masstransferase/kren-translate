import { describe, expect, it } from 'vitest';
import { parseMerriamWebsterThesaurusResponse } from '../src/providers/merriamWebsterThesaurus.js';
import type { DictionaryRequest } from '../src/types.js';

const request: DictionaryRequest = {
  text: 'merry',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  kind: 'dictionary',
  operation: 'translate'
};

describe('Merriam-Webster Thesaurus provider', () => {
  it('preserves synonym categories by sense', () => {
    const payload = [{
      meta: { id: 'merry:1', stems: ['merry'] },
      hwi: { hw: 'mer*ry', prs: [{ mw: 'ˈmer-ē', sound: { audio: 'merry01' } }] },
      fl: 'adjective',
      def: [{
        sseq: [[['sense', {
          sn: '1',
          dt: [['text', '{bc}showing high spirits or lightheartedness']],
          syn_list: [[{ wd: 'cheerful' }, { wd: 'jolly' }]],
          sim_list: [[{ wd: 'festive', wsls: { wsl: 'informal' } }]],
          phrase_list: [[{ wd: 'in high spirits' }]],
          ant_list: [[{ wd: 'gloomy' }]],
          opp_list: [[{ wd: 'somber' }]]
        }]]]
      }]
    }];

    const result = parseMerriamWebsterThesaurusResponse(
      payload,
      request,
      '1970-01-01T00:00:00.000Z'
    );

    expect(result?.headword).toBe('mer·ry');
    expect(result?.sections[0]).toMatchObject({
      partOfSpeech: 'adjective',
      pronunciation: 'ˈmer-ē'
    });
    expect(result?.sections[0]?.senses[0]).toEqual({
      senseNumber: '1',
      definition: 'showing high spirits or lightheartedness',
      synonyms: [{ word: 'cheerful' }, { word: 'jolly' }],
      nearSynonyms: [{ word: 'festive', labels: ['informal'] }],
      synonymousPhrases: [{ word: 'in high spirits' }],
      antonyms: [{ word: 'gloomy' }],
      nearAntonyms: [{ word: 'somber' }]
    });
    expect(result?.sections[0]?.audioUrl).toContain('/m/merry01.mp3');
  });
});
