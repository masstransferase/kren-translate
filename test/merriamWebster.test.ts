import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanMerriamWebsterMarkup,
  MerriamWebsterProvider,
  parseMerriamWebsterResponse
} from '../src/providers/merriamWebster.js';
import type { DictionaryRequest } from '../src/types.js';

const request: DictionaryRequest = {
  text: 'ledger',
  sourceLanguage: 'en',
  targetLanguage: 'ko',
  kind: 'dictionary',
  operation: 'translate'
};

afterEach(() => vi.restoreAllMocks());

describe('Merriam-Webster provider', () => {
  it('normalizes definitions, pronunciation, part of speech, and examples', () => {
    const payload = [
      {
        meta: { id: 'ledger:1', stems: ['ledger', 'ledgers'] },
        hwi: { hw: 'ledg*er', prs: [{ mw: 'ˈle-jər' }] },
        fl: 'noun',
        shortdef: [
          'a book containing accounts',
          'a digital record of transactions',
          'a horizontal support member'
        ],
        def: [{ vis: [{ t: 'recorded in the {wi}ledger{/wi}' }] }]
      }
    ];

    const result = parseMerriamWebsterResponse(payload, request, 'merriamWebsterCollegiate', '1970-01-01T00:00:00.000Z');

    expect(result?.headword).toBe('ledg·er');
    expect(result?.pronunciation).toBe('ˈle-jər');
    expect(result?.entries).toHaveLength(3);
    expect(result?.entries[0]).toMatchObject({
      meaning: 'a book containing accounts',
      partOfSpeech: 'noun',
      examples: ['recorded in the ledger']
    });
  });

  it('cleans Merriam-Webster formatting tokens', () => {
    expect(cleanMerriamWebsterMarkup('{bc}{sx|large||} {it}book{/it}')).toBe('large book');
  });

  it('preserves all grammatical entries and numbered senses instead of truncating to three', () => {
    const deliberateRequest = { ...request, text: 'deliberate' };
    const payload = [
      {
        meta: { id: 'deliberate:1', stems: ['deliberate', 'deliberated', 'deliberating'] },
        hom: 1,
        hwi: {
          hw: 'de*lib*er*ate',
          prs: [{ mw: 'di-ˈli-bə-ˌrāt', sound: { audio: 'delibe01' } }]
        },
        fl: 'verb',
        ins: [{ if: 'deliberated' }, { if: 'deliberating' }],
        def: [
          {
            vd: 'intransitive verb',
            sseq: [[['sense', {
              sn: '1',
              dt: [['text', '{bc}to think about issues carefully'], ['vis', [{ t: 'the jury {it}deliberated{/it}' }]]]
            }]]]
          },
          {
            vd: 'transitive verb',
            sseq: [[['sense', { sn: '2', dt: [['text', '{bc}to discuss before deciding']] }]]]
          }
        ]
      },
      {
        meta: { id: 'deliberate:2', stems: ['deliberate'] },
        hom: 2,
        hwi: { hw: 'de*lib*er*ate', prs: [{ mw: 'di-ˈli-b(ə-)rət' }] },
        fl: 'adjective',
        def: [{
          sseq: [
            [['sense', { sn: '1', dt: [['text', '{bc}characterized by careful consideration']] }]],
            [['sense', { sn: '2', dt: [['text', '{bc}aware of the consequences']] }]],
            [['sense', { sn: '3', dt: [['text', '{bc}slow and steady']] }]],
            [['sense', { sn: '4', dt: [['text', '{bc}done intentionally']] }]]
          ]
        }]
      }
    ];

    const result = parseMerriamWebsterResponse(
      payload,
      deliberateRequest,
      'merriamWebsterCollegiate'
    );

    expect(result?.sections).toHaveLength(2);
    expect(result?.entries).toHaveLength(6);
    expect(result?.sections?.[0]).toMatchObject({
      homograph: 1,
      partOfSpeech: 'verb',
      inflections: ['deliberated', 'deliberating']
    });
    expect(result?.sections?.[0]?.entries[0]).toMatchObject({
      senseNumber: '1',
      grammaticalLabel: 'intransitive verb',
      meaning: 'to think about issues carefully',
      examples: ['the jury deliberated']
    });
    expect(result?.sections?.[1]?.entries[3]?.meaning).toBe('done intentionally');
    expect(result?.sections?.[0]?.audioUrl).toContain('/d/delibe01.mp3');
  });

  it('preserves Collegiate synonym discussions when the entry provides them', () => {
    const agreeRequest = { ...request, text: 'agree' };
    const payload = [{
      meta: { id: 'agree:1', stems: ['agree'] },
      hwi: { hw: 'agree' },
      fl: 'verb',
      shortdef: ['to have the same opinion'],
      syns: [{
        pl: 'synonyms',
        pt: [
          ['text', '{sc}agree{/sc}, {sc}concur{/sc}, and {sc}coincide{/sc} mean to be in harmony.'],
          ['vis', [{ t: 'we all {it}agree{/it}' }]]
        ],
        sarefs: ['assent']
      }]
    }];

    const result = parseMerriamWebsterResponse(
      payload,
      agreeRequest,
      'merriamWebsterCollegiate'
    );

    expect(result?.sections?.[0]?.synonymDiscussions?.[0]).toEqual({
      label: 'synonyms',
      text: 'agree, concur, and coincide mean to be in harmony.',
      examples: ['we all agree'],
      seeAlso: ['assent'],
      blocks: [
        { kind: 'text', text: 'agree, concur, and coincide mean to be in harmony.' },
        { kind: 'example', text: 'we all agree' }
      ]
    });
  });

  it('keeps synonym discussion explanations and examples in editorial order', () => {
    const descriptionRequest = { ...request, text: 'description' };
    const payload = [{
      meta: { id: 'description:1', stems: ['description'] },
      hwi: { hw: 'description' },
      fl: 'noun',
      shortdef: ['a statement that tells what something is like'],
      syns: [{
        pl: 'synonyms',
        pt: [
          ['text', '{sc}type{/sc} {sc}kind{/sc} {sc}sort{/sc} {sc}nature{/sc} {sc}description{/sc} {sc}character{/sc} mean a group with common qualities.'],
          ['vis', [{ t: 'one of three basic body {it}types{/it}' }]],
          ['text', '{sc}description{/sc} implies agreement in all details.'],
          ['vis', [{ t: 'acts of that {it}description{/it}' }]]
        ]
      }]
    }];

    const result = parseMerriamWebsterResponse(
      payload,
      descriptionRequest,
      'merriamWebsterCollegiate'
    );

    expect(result?.sections?.[0]?.synonymDiscussions?.[0]?.blocks).toEqual([
      {
        kind: 'text',
        text: 'type, kind, sort, nature, description, and character mean a group with common qualities.'
      },
      { kind: 'example', text: 'one of three basic body types' },
      { kind: 'text', text: 'description implies agreement in all details.' },
      { kind: 'example', text: 'acts of that description' }
    ]);
  });

  it('follows one API-provided spelling or stem suggestion', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(['come']), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        meta: { id: 'come:1' },
        hwi: { hw: 'come' },
        fl: 'verb',
        shortdef: ['to move toward something']
      }]), { status: 200 }));
    const cameRequest = { ...request, text: 'came' };

    const result = await new MerriamWebsterProvider('secret-key').lookup(
      cameRequest,
      new AbortController().signal
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/came?');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/come?');
    expect(result?.headword).toBe('come');
    expect(result?.note).toContain('suggestion “come”');
  });

  it('uses the Medical Dictionary endpoint and provider identity when selected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        meta: { id: 'hypertension:1' },
        hwi: { hw: 'hypertension' },
        fl: 'noun',
        shortdef: ['abnormally high arterial blood pressure']
      }]), { status: 200 })
    );

    const result = await new MerriamWebsterProvider('medical-key', 'medical').lookup(
      { ...request, text: 'hypertension' },
      new AbortController().signal
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/references/medical/json/hypertension');
    expect(result?.providerId).toBe('merriamWebsterMedical');
  });

  it('serves the Collegiate Thesaurus through the parameterized provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        meta: { id: 'merry:1', syns: [['cheerful', 'jolly']] },
        hwi: { hw: 'merry' },
        fl: 'adjective'
      }]), { status: 200 })
    );

    const result = await new MerriamWebsterProvider('configured-thesaurus', 'thesaurus').lookup(
      { ...request, text: 'merry', targetLanguage: 'en' },
      new AbortController().signal
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/references/thesaurus/json/merry');
    expect(result).toMatchObject({
      kind: 'thesaurus',
      providerId: 'merriamWebsterThesaurus',
      headword: 'merry'
    });
  });
});
