import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import * as environment from '../../src/environmentCheck.js';
import * as groq from '../../src/providers/openAICompatible.js';
import * as openai from '../../src/providers/openai.js';
import * as anthropic from '../../src/providers/anthropic.js';
import { renderKrenResultViewHtml, renderEnvironmentChecks } from '../../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './panelSettingsFixture.js';
import type { EnvironmentCheckOptions, EnvironmentSnapshot, ModelCheckProvider } from '../../src/environmentCheck.js';

type Lister = (key: string, signal: AbortSignal) => Promise<readonly { id: string }[]>;
// The fallback lets the same injected cases demonstrate the pre-fix defects on HEAD.
const unfiltered = (module: object, name: string, original: Lister): Lister =>
  (module as Record<string, Lister>)[name] ?? original;
const unreadable = "The provider's list could not be read.";
const restricted = 'Restricted Mode: KREN does not run the configured Python in an untrusted workspace.';
const listedVoice = 'en-US-AvaNeural';
const listedChirp = 'en-US-Chirp3-HD-Callirrhoe';
const credential = ['injected', 'credential', 'only'].join('-');

function harness() {
  let saved: EnvironmentSnapshot | undefined;
  let day = '2026-10-16', trusted = true, installed = '7.2.8';
  const processes: string[][] = [], logs: string[] = [], reports: string[] = [];
  let pipError = '', edgeAnswer = JSON.stringify([listedVoice]);
  let chirpAnswer: unknown = { voices: [{ name: listedChirp }] };
  const wanted = { name: 'qwen/custom-choice', feature: 'Translation', fixTarget: 'translation' as const };
  const options: EnvironmentCheckOptions & { trusted(): boolean } = {
    pythonCommand: () => 'configured-python', trusted: () => trusted,
    vscodeVersion: '1.106.0', vscodeMinimum: '^1.106.0', dailyEnabled: () => true,
    detectHandy: async () => undefined, now: () => new Date(`${day}T12:00:00Z`),
    store: { get: <T>() => saved as T | undefined, update: async (_key, value) => { saved = value as EnvironmentSnapshot; } },
    runProcess: async (command, args) => {
      processes.push([command, ...args]);
      if (args[0] === '--version') return { code: 0, stdout: 'Python 3.13.0', stderr: '' };
      if (args[0] === '-m') { installed = '7.3.1'; return { code: pipError ? 1 : 0, stdout: '', stderr: pipError }; }
      return { code: 0, stdout: args[1]?.includes('list_voices') ? edgeAnswer : installed, stderr: '' };
    },
    fetch: async url => ({ ok: true, json: async () => {
      if (String(url).includes('pypi.org')) return { info: { version: '7.3.1' } };
      if (chirpAnswer instanceof Error) throw chirpAnswer;
      return chirpAnswer;
    } }) as Response,
    manual: { getKey: async provider => provider === 'groq' || provider === 'googleChirp' ? credential : undefined,
      models: () => ({ groq: [wanted] }), edgeVoices: () => [{ name: listedVoice, feature: 'Tutor preset', fixTarget: 'tutorVoice' }],
      chirpVoices: () => [{ name: listedChirp, feature: 'Tutor', fixTarget: 'tutorVoice' }],
      listers: { groq: async () => [{ id: 'some-other-model' }] } },
    log: line => logs.push(line), report: line => reports.push(line), confirm: async () => true, progress: async task => task()
  };
  return { options, checks: new environment.EnvironmentChecks(options), processes, logs, reports, wanted,
    saved: () => saved, nextDay: () => { day = '2026-10-17'; }, trust: (value: boolean) => { trusted = value; },
    pipError: (value: string) => { pipError = value; }, edgeAnswer: (value: string) => { edgeAnswer = value; },
    chirpAnswer: (value: unknown) => { chirpAnswer = value; } };
}

async function withProviderResponse(body: unknown, run: () => Promise<void>, invalidJson = false) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => {
    if (invalidJson) throw new SyntaxError('Injected invalid JSON');
    return body;
  } }) as Response;
  try { await run(); } finally { globalThis.fetch = original; }
}

export const environmentReviewCases = [
  { name: 'R11 finding 1: sanitizes and caps the pip line before both sinks', run: async () => {
    for (const detail of ['https://user:token123@pypi.example.com/simple', 'user:token123@proxy.example', 'token123@proxy.example']) {
      const h = harness(); await h.checks.check();
      h.logs.length = 0;
      h.pipError(`ERROR: Failed at ${detail} ${'x'.repeat(240)}`);
      await h.checks.updateEdgeTts();
      assert.equal(h.logs.length, 1);
      assert(!h.logs[0]!.includes('token123'), 'Output must redact the credential');
      assert(!h.reports[0]!.includes('token123'), 'Popup must redact the credential');
      assert(h.logs[0]!.length <= 200, 'Sanitized pip line must be capped at 200 characters');
      assert.equal(h.reports[0], `edge-tts update failed: ${h.logs[0]}`);
      if (detail.includes('://')) assert(h.logs[0]!.includes('<URL>'));
    }
  } },
  { name: 'R11 finding 2: blocks every configured Python path in Restricted Mode', run: async () => {
    const h = harness();
    await h.checks.check(); // Leave an Update action from a trusted check, then revoke trust.
    h.trust(false); h.processes.length = 0;
    await h.checks.updateEdgeTts();
    assert.equal(h.processes.length, 0, 'Update must not launch Python after trust is revoked');
    await h.checks.check();
    h.nextDay(); await h.checks.daily();
    assert.equal(h.processes.length, 0, 'Menu, daily, and Edge discovery must not launch Python');
    for (const name of ['Python', 'edge-tts']) {
      const item = h.checks.items.find(item => item.name === name)!;
      assert.equal(item.status, 'unknown'); assert.equal(item.explanation, restricted); assert.equal(item.fix, undefined);
    }
    const $ = load(renderEnvironmentChecks(h.checks.items));
    assert.equal($('[data-command="updateEdgeTts"]').length, 0);
  } },
  { name: 'R11 finding 3: accepts provider-listed custom ids without changing picker filters', run: async () => {
    for (const [provider, module, name, original, id] of [
      ['groq', groq, 'listGroqModelsUnfiltered', groq.listGroqModels, 'qwen/custom-choice'],
      ['openai', openai, 'listOpenAIModelsUnfiltered', openai.listOpenAIModels, 'custom-choice']
    ] as const) {
      await withProviderResponse({ data: [{ id, active: true }] }, async () => {
        const h = harness();
        h.options.manual!.getKey = async value => value === provider ? credential : undefined;
        h.options.manual!.models = () => ({ [provider]: [{ ...h.wanted, name: id }] });
        h.options.manual!.listers = { [provider]: unfiltered(module, name, original) };
        const items = await h.checks.check();
        assert.equal(items.find(item => item.name === (provider === 'groq' ? 'Groq' : 'OpenAI'))?.status, 'ok', `${provider} custom id is advertised`);
        assert.deepEqual(await original(credential, new AbortController().signal), [], 'Picker filtering stays unchanged');
      });
    }
  } },
  { name: 'R11 finding 4: malformed or empty model and voice lists are unknown', run: async () => {
    const providers: Array<[ModelCheckProvider, Lister, string, string]> = [
      ['gemini', environment.listEnvironmentGeminiModels, 'models', 'Gemini Free Tier'],
      ['openai', unfiltered(openai, 'listOpenAIModelsUnfiltered', openai.listOpenAIModels), 'data', 'OpenAI'],
      ['anthropic', unfiltered(anthropic, 'listAnthropicModelsUnfiltered', anthropic.listAnthropicModels), 'data', 'Anthropic'],
      ['groq', unfiltered(groq, 'listGroqModelsUnfiltered', groq.listGroqModels), 'data', 'Groq']
    ];
    for (const [provider, list, field, label] of providers) {
      for (const [body, invalid] of [[{}, false], [{ [field]: [] }, false], [undefined, true]] as const) {
        await withProviderResponse(body, async () => {
          const h = harness();
          h.options.manual!.getKey = async value => value === provider ? credential : undefined;
          h.options.manual!.models = () => ({ [provider]: [h.wanted] });
          h.options.manual!.listers = { [provider]: list };
          const item = (await h.checks.check()).find(item => item.name === label)!;
          assert.equal(item.status, 'unknown', `${provider}: malformed/empty response must not prove removal`);
          assert.equal(item.explanation, unreadable);
        }, invalid);
      }
    }
    for (const body of [{}, { voices: [] }, null, new SyntaxError('Injected invalid JSON')]) {
      const h = harness(); h.chirpAnswer(body);
      const item = (await h.checks.check()).find(item => item.name === 'Google Cloud Chirp')!;
      assert.equal(item.status, 'unknown'); assert.equal(item.explanation, unreadable);
    }
    for (const body of ['[]', '{}', 'invalid JSON']) {
      const h = harness(); h.edgeAnswer(body);
      const item = (await h.checks.check()).find(item => item.name === 'Edge Online')!;
      assert.equal(item.status, 'unknown'); assert.equal(item.explanation, unreadable);
    }
  } },
  { name: 'R11 finding 5: retains overridden manifest voice defaults in comparisons', run: async () => {
    const defaults: Record<string, string> = { 'readAloud.edgeVoice': 'de-DE-AmalaNeural', 'readAloud.chirpVoice': 'Kore',
      'tutor.readAloud.edgeVoice': 'en-US-ChristopherNeural', 'tutor.readAloud.edgeFemaleVoice': 'en-US-AvaNeural',
      'tutor.readAloud.edgeMaleVoice': 'en-US-GuyNeural', 'tutor.liveFemaleVoice': 'Callirrhoe', 'tutor.liveMaleVoice': 'Enceladus' };
    const collect = environment.availabilityNames as (get: (key: string, fallback: string) => string,
      getDefault: (key: string, fallback: string) => string) => ReturnType<typeof environment.availabilityNames>;
    const names = collect((key, fallback) => key.includes('edge') ? 'en-US-OverrideNeural'
      : key.includes('Voice') ? 'OverrideChirp' : fallback, (key, fallback) => defaults[key] ?? fallback);
    for (const [key, value] of Object.entries(defaults)) {
      const chirp = !key.includes('edge');
      const expected = chirp ? `en-US-Chirp3-HD-${value}` : value;
      assert((chirp ? names.chirpVoices : names.edgeVoices).some(item => item.name === expected && item.feature.startsWith('Default ')), `Overridden default is checked: ${key}`);
    }
    const h = harness(); h.options.manual!.edgeVoices = () => names.edgeVoices;
    const missing = (await h.checks.check()).find(item => item.explanation === 'Default Read Aloud voice de-DE-AmalaNeural is no longer listed.');
    assert(missing); assert.equal(missing.status, 'update'); assert.equal(missing.fixTarget, 'readAloud');
  } },
  { name: 'R11 finding 6: documents at most one PyPI request within the manual budget', run: async () => {
    const guide = readFileSync('docs/USER_GUIDE.md', 'utf8');
    const privacy = readFileSync('PRIVACY.md', 'utf8');
    const html = renderKrenResultViewHtml({ cspSource: 'test', nonce: 'test', proModels: [], settings: PANEL_SETTINGS_FIXTURE, activeScreen: 'manual' });
    const $ = load(html); const manual = load($('#manual-screen').html()!);
    const section = manual('h3').filter((_, el) => manual(el).text() === 'Check for updates').nextUntil('h3, h4').text();
    for (const [label, content] of [['Privacy', privacy], ['Guide', guide], ['Panel manual', section]])
      assert.match(content!, /at most one anonymous request to pypi\.org/u, label);
    const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
    const words = normalize(manual('h2, h3, h4, p, li').map((_, el) => manual(el).text()).get().join(' ')).split(' ').length;
    const budget = Math.ceil(guide.match(/\S+/gu)!.length * 0.35) + guide.split('\n').filter(line => line.startsWith('With Standard replies and the speaker on,') || line.startsWith('Chirp requests speech by sentence,')).join(' ').split(/\s+/u).length;
    assert(words <= budget, `Panel manual has ${words} words; budget is ${budget}`);
  } },
  { name: 'R11 finding 7: preserves detail cards during system checks and explains restart summaries', run: async () => {
    const h = harness();
    h.options.manual!.edgeVoices = () => [{ name: 'en-US-RemovedNeural', feature: 'Tutor', fixTarget: 'tutorVoice' }];
    await h.checks.check();
    const details = h.checks.items.filter(item => item.group === 'Models' || item.group === 'Voices');
    assert(details.some(item => item.status === 'update'));
    h.nextDay(); await h.checks.daily();
    assert.deepEqual(h.checks.items.filter(item => item.group === 'Models' || item.group === 'Voices'), details, 'Daily must retain names, explanations, and fixes');
    await h.checks.updateEdgeTts();
    assert.deepEqual(h.checks.items.filter(item => item.group === 'Models' || item.group === 'Voices'), details, 'Post-Update recheck must retain details');
    const restarted = new environment.EnvironmentChecks(h.options);
    const $ = load(renderEnvironmentChecks(restarted.items));
    const again = $('[data-command="checkForUpdates"]');
    assert.equal(again.length, 1);
    assert.equal(again.is('button:not([disabled])'), true);
    assert.equal(again.parents('details, .hidden').length, 0);
    for (const group of ['Models', 'Voices']) {
      const card = $(`[data-update-group="${group}"]`);
      assert.match(card.text(), /Choose Check again for details\./u);
      assert.match(card.text(), /update/u);
      assert.equal(card.find('[data-update-fix-target]').length, 0, 'A restart does not invent a stored fix destination');
    }
    assert(!JSON.stringify(h.saved()).includes('qwen/custom-choice'));
    assert(!JSON.stringify(h.saved()).includes('en-US-RemovedNeural'));
    assert(!JSON.stringify(h.saved()).includes('explanation'));
    assert(!JSON.stringify(h.saved()).includes('fixTarget'));
  } }
];
