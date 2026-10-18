import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { readFileSync } from 'node:fs';
import { hostSource } from './support/hostSource.js';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { EDGE_SPEECH_LOCALES } from '@kren/core/edge-speech';
import { validatedPanelSetting } from '../src/panelSettings.js';
import { renderKrenResultViewHtml, type KrenPanelSettings } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const TUTOR_VOICE_DEFAULTS = {
  // Changed 2026-10-16: V254, owner item I36, edgeOnline to googleChirp default.
  'kren.tutor.readAloud.provider': 'googleChirp',
  'kren.tutor.readAloud.edgeLocale': 'en-US',
  'kren.tutor.readAloud.edgeVoice': 'en-US-ChristopherNeural',
  'kren.tutor.readAloud.edgeFemaleVoice': 'en-US-AvaNeural',
  'kren.tutor.readAloud.edgeMaleVoice': 'en-US-ChristopherNeural',
  'kren.tutor.readAloud.edgeRatePercent': 0,
  'kren.tutor.readAloud.voice': 'Microsoft David Desktop',
  'kren.tutor.readAloud.rate': 0,
  'kren.tutor.readAloud.volume': 100,
  // Changed 2026-10-03: Replay voice follows current tutor defaults.
  'kren.tutor.liveFemaleVoice': TUTOR_DEFAULTS.configuration['tutor.liveFemaleVoice'],
  // Changed 2026-10-10: V212 selects Enceladus as the male Gemini default.
  'kren.tutor.liveMaleVoice': 'Enceladus'
} as const;

function tutorPage(overrides: Partial<KrenPanelSettings> = {}): string {
  return renderKrenResultViewHtml({
    cspSource: 'test',
    nonce: 'test',
    settings: { ...PANEL_SETTINGS_FIXTURE, ...overrides },
    activeScreen: 'tutor',
    proModels: []
  });
}

describe('V102 tutor voice settings', () => {
  it('declares every tutor voice setting with the code default', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
    };
    for (const [key, value] of Object.entries(TUTOR_VOICE_DEFAULTS)) {
      expect(manifest.contributes.configuration.properties[key]?.default, key).toBe(value);
    }
  });

  /*
   * V102, 2026-09-15. A declared setting that is absent from KREN's panel has shipped
   * before. These controls must be reachable on the tutor page inside its own child group.
   */
  it('renders every new key in the TUTOR VOICE child of SETTING', () => {
    const $ = load(tutorPage());
    const group = $('details[data-tutor-child]').filter((_, element) =>
      $(element).find('summary .rewrite-group-name').first().text().trim() === 'TUTOR VOICE'
    );
    expect(group).toHaveLength(1);
    for (const key of Object.keys(TUTOR_VOICE_DEFAULTS)) {
      const shortKey = key.slice('kren.'.length);
      const controls = group.find(`[data-setting="${shortKey}"], [data-tutor-voice-setting="${shortKey}"]`);
      // 2026-10-11: Keep Edge's layout while adding one mutually exclusive Chirp speed view.
      expect(controls, key).toHaveLength(shortKey === 'tutor.readAloud.edgeRatePercent' ? 2 : 1);
      if (shortKey === 'tutor.readAloud.edgeRatePercent') for (const source of ['edgeOnline', 'googleChirp']) {
        expect(group.find(`[data-provider-value="${source}"] [data-setting="${shortKey}"]`)).toHaveLength(1);
      }
    }
    // Changed 2026-09-20: V125 summarizes the always-visible Gemini choice too.
    // Changed 2026-10-03: compare summary meaning with its selected voice control.
    const voice = group.find('[data-tutor-conversation-live-voice] option:selected').text();
    expect(group.find('summary').text()).toContain('Edge Online | en-US Christopher Natural');
    // 2026-10-04: V203 names the live voice and the two Gemini defaults explicitly.
    // 2026-10-05: preserve the selected-voice assertion across label capitalization changes.
    expect(group.find('summary').text().replace(/Live voice:/iu, 'Live voice:')).toContain(`Live voice: ${voice}`);
    expect(group.find('summary').text()).toContain('0% | 100');
  });

  it('offers only English catalog locales and voices', () => {
    const englishLocales = EDGE_SPEECH_LOCALES.filter((locale) => locale.id.startsWith('en-'));
    const $ = load(tutorPage());
    const locales = $('[data-setting="tutor.readAloud.edgeLocale"] option')
      .map((_, option) => $(option).attr('value')).get();
    expect(locales).toEqual(englishLocales.map((locale) => locale.id));

    for (const locale of englishLocales) {
      const localePage = load(tutorPage({
        tutorEdgeReadAloudLocale: locale.id,
        tutorEdgeReadAloudVoice: locale.defaultVoice
      } as Partial<KrenPanelSettings>));
      const voices = localePage('[data-edge-voice-preset="tutor.readAloud.edgeVoice"] option')
        .map((_, option) => localePage(option).attr('value')).get()
        .filter((value) => value !== '__custom__');
      expect(voices, locale.id).toEqual(locale.voices.map((voice) => voice.id));
      expect(voices.every((voice) => voice?.startsWith('en-')), locale.id).toBe(true);
    }
  });

  it('accepts an English stored choice and rejects a non-English one', () => {
    expect(validatedPanelSetting('tutor.readAloud.edgeLocale' as never, 'en-GB')).toBe('en-GB');
    expect(validatedPanelSetting('tutor.readAloud.edgeLocale' as never, 'de-DE')).toBeUndefined();
    expect(validatedPanelSetting(
      'tutor.readAloud.edgeVoice' as never,
      'en-US-AvaNeural'
    )).toBe('en-US-AvaNeural');
    expect(validatedPanelSetting(
      'tutor.readAloud.edgeVoice' as never,
      'ko-KR-SunHiNeural'
    )).toBeUndefined();
  });
});

describe('V102 tutor playback routing guard', () => {
  it('marks every tutor playback call site to use the tutor voice', () => {
    const source = hostSource();
    // Changed 2026-09-26: Playback functions now receive the view as their first argument.
    const calls = [...source.matchAll(/(?:this|view)\.actions\.readAloudText\(([\s\S]*?)\)/gu)]
      .map((match) => match[1] ?? '');
    const tutorCalls = calls.filter((call) => call.includes("'en'"));
    // Changed 2026-09-20: Replay, conversation replay and the reply-then-question sequence share one
    // helper, so the conversation has one call site rather than two, alongside practice and
    // example playback. V125 adds one explicit Edge Preview call on 2026-09-20.
    // 2026-10-11: Chirp adds the Gemini-voice preview to the tutor Speech Source path.
    expect(tutorCalls, 'conversation, practice, example and both preview playback paths stay guarded').toHaveLength(5);
    expect(tutorCalls.every((call) => call.includes("'tutor'"))).toBe(true);
  });

  it('leaves every non-tutor playback on the shared default route', () => {
    const source = hostSource();
    const calls = [...source.matchAll(/(?:this|view)\.actions\.readAloudText\(([\s\S]*?)\)/gu)]
      .map((match) => match[1] ?? '');
    const nonTutorCalls = calls.filter((call) => !call.includes("'en'"));
    expect(nonTutorCalls).toHaveLength(2);
    expect(nonTutorCalls.every((call) => !call.includes("'tutor'"))).toBe(true);

    const extension = readFileSync('src/speech/speechCenter.ts', 'utf8');
    expect(extension).toContain("settingsSource: 'shared' | 'tutor' = 'shared'");
    const readAloud = extension.slice(
      extension.indexOf('  private settings('),
      extension.length
    );
    for (const suffix of [
      'provider', 'edgeLocale', 'edgeVoice', 'edgeRatePercent', 'voice', 'rate', 'volume'
    ]) {
      // Changed 2026-09-20: V125 splits the namespaces into explicit branches, so neither
      // runtime path can assemble or accidentally cross into the other namespace.
      expect(readAloud, `tutor playback does not own ${suffix}`)
        .toContain(`'tutor.readAloud.${suffix}'`);
      expect(readAloud, `shared playback does not own ${suffix}`)
        .toContain(`'readAloud.${suffix}'`);
    }
    expect(readAloud).toContain("config.get<string>('readAloud.edgePythonCommand', 'python')");
    expect(readAloud).not.toContain('tutor.readAloud.edgePythonCommand');
    expect(readAloud).not.toContain('settingPrefix');
  });

  // Added 2026-09-20. V125 separated the tutor and shared speech settings and hard-coded the
  // interpreter to 'python' for the tutor, which would ignore a reader's own interpreter, such as
  // one inside a virtual environment. Where the edge-tts program lives is not a voice preference,
  // so both branches read the one shared key, and both must keep reading it.
  it('reads the edge-tts interpreter from the one shared setting in both branches', () => {
    const extension = readFileSync('src/speech/speechCenter.ts', 'utf8');
    const readAloud = extension.slice(extension.indexOf('  private settings('));
    const branches = readAloud.slice(0, readAloud.length);
    const interpreter = /config\.get<string>\('readAloud\.edgePythonCommand', 'python'\)/gu;
    expect([...branches.matchAll(interpreter)]).toHaveLength(2);
    expect(branches).not.toContain("pythonCommand: 'python'");
  });
});
