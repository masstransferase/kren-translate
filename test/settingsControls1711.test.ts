import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';
import { validatedPanelSetting } from '../src/panelSettings.js';
import {
  configuredDomain,
  KREN_SECRET_KEYS,
  runKrenOperation,
  type KrenRuntime
} from '../src/operations.js';
import { REWRITE_DOMAINS } from '@kren/core/rewrite-axes';

afterEach(() => vi.restoreAllMocks());

const ENGLISH = 'The committee deferred the motion without a recorded vote this morning.';

function settingsHtml(overrides = {}): string {
  return renderKrenResultViewHtml({
    cspSource: 'vscode-webview://test',
    nonce: 'test-nonce',
    settings: { ...PANEL_SETTINGS_FIXTURE, ...overrides },
    activeScreen: 'settings',
    proModels: []
  });
}

function control(html: string, key: string): string {
  const at = html.indexOf(`data-setting="${key}"`);
  expect(at, `${key} renders no control`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<label', at), html.indexOf('</label>', at));
}

/*
 * Four settings had no control anywhere in the panel, and the panel's route to VS Code's own
 * settings screen went with the button renamed to Reset KREN in 1.7.8. For three versions
 * they were unreachable from KREN entirely. The owner placed each one on 2026-08-28.
 */
describe('the four settings that had no control', () => {
  const html = settingsHtml();

  function sectionOf(key: string): string {
    const sections = [...html.matchAll(/data-settings-section="([^"]+)"/gu)];
    const at = html.indexOf(`data-setting="${key}"`);
    let name = 'none';
    for (const section of sections) {
      if (section.index! < at) name = section[1]!;
    }
    return name;
  }

  it('puts the immediate-result choice and the timeout under Usage', () => {
    // 2026-10-10: V217 keeps both usage controls in Settings after credentials move.
    expect(sectionOf('display.mode')).toBe('usage');
    expect(sectionOf('request.timeoutMs')).toBe('usage');
  });

  it('places both above the API keys, where the owner asked for them', () => {
    const firstKeyRow = html.indexOf('data-action="kren.setGeminiApiKey"');
    expect(firstKeyRow).toBeGreaterThan(-1);
    expect(html.indexOf('data-setting="display.mode"')).toBeLessThan(firstKeyRow);
    expect(html.indexOf('data-setting="request.timeoutMs"')).toBeLessThan(firstKeyRow);
  });

  it('puts the character cap in Translation and the import cap in User Dictionary', () => {
    expect(sectionOf('translation.maxCharacters')).toBe('translation');
    expect(sectionOf('userDictionary.maxImportEntries')).toBe('userDictionary');
  });

  it('offers all three immediate-result choices, because it is not a two-state setting', () => {
    const rendered = control(html, 'display.mode');
    for (const id of ['hover', 'quickPick', 'details']) {
      expect(rendered, `${id} is not offered`).toContain(`value="${id}"`);
    }
  });

  /*
   * The owner asked for seconds. Milliseconds is the unit the provider call takes and not
   * the unit anyone thinks in, so the control divides and the webview multiplies back.
   */
  it('shows the timeout in seconds while the setting keeps its milliseconds', () => {
    const rendered = control(settingsHtml({ requestTimeoutMs: 45000 }), 'request.timeoutMs');
    expect(rendered).toContain('value="45"');
    expect(rendered).toContain('data-seconds');
    expect(rendered).toContain('sec');
    expect(rendered, 'the control offers a value the setting refuses').toContain('min="1"');
    expect(rendered).toContain('max="120"');
    // Stored unchanged: 45 seconds is still 45000 to everything downstream.
    expect(validatedPanelSetting('request.timeoutMs', 45000)).toBe(45000);
  });

  it('multiplies a seconds control back to milliseconds, in one place', () => {
    const script = html.slice(html.indexOf("const key = target.getAttribute('data-setting')"));
    const branch = script.slice(0, script.indexOf('applyConditionalSettings();'));
    expect(branch).toContain("target.hasAttribute('data-seconds') ? 1000 : 1");
  });

  it('validates all four, so no control writes a value the setting refuses', () => {
    expect(validatedPanelSetting('display.mode', 'quickPick')).toBe('quickPick');
    expect(validatedPanelSetting('display.mode', 'nonsense')).toBeUndefined();
    expect(validatedPanelSetting('request.timeoutMs', 500)).toBeUndefined();
    expect(validatedPanelSetting('request.timeoutMs', 120001)).toBeUndefined();
    expect(validatedPanelSetting('translation.maxCharacters', 4000)).toBe(4000);
    expect(validatedPanelSetting('translation.maxCharacters', 0)).toBeUndefined();
    expect(validatedPanelSetting('translation.maxCharacters', 12.5)).toBeUndefined();
    expect(validatedPanelSetting('userDictionary.maxImportEntries', 2500)).toBe(2500);
    expect(validatedPanelSetting('userDictionary.maxImportEntries', 100001)).toBeUndefined();
  });
});

/*
 * `rewrite.preferredVariant` removed on the owner's instruction. It had been inert since the
 * panel began showing both variants together, and its own control said so.
 */
describe('the retired preferred-variant setting is gone', () => {
  it('is absent from the manifest, the panel, and the validator', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    expect(Object.keys(manifest.contributes.configuration.properties))
      .not.toContain('kren.rewrite.preferredVariant');
    expect(settingsHtml()).not.toContain('data-setting="rewrite.preferredVariant"');
    expect(validatedPanelSetting('rewrite.preferredVariant' as never, 'full')).toBeUndefined();
  });

  it('leaves the quick-menu setting, which still does something', () => {
    expect(settingsHtml()).toContain('data-setting="rewrite.quickMenuVariant"');
  });
});

/*
 * Domain for Translation and Explain, 2026-08-28. The eight subject areas are the ones the
 * Rewrite Text axis already carries, so a subject area means the same thing whichever
 * feature asked for it.
 */
describe('Domain on Translation and Explain', () => {
  function runtimeFor(settings: Record<string, unknown>): KrenRuntime {
    return {
      getSecret: async (key) => (
        key === KREN_SECRET_KEYS.gemini ? 'gemini-key'
          : key === KREN_SECRET_KEYS.googleCloudTranslation ? 'cloud-key'
            : undefined
      ),
      getSetting: <T>(key: string, fallback: T): T => (
        key in settings ? settings[key] as T : fallback
      ),
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    } as KrenRuntime;
  }

  async function geminiInstruction(
    operation: 'translate' | 'explain',
    settings: Record<string, unknown>
  ): Promise<string> {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          kind: 'translation', translatedText: 'x', note: 'y'
        }) }] } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    await runKrenOperation(
      runtimeFor({
        translationProvider: 'gemini',
        'translation.provider': 'gemini',
        'explanation.provider': 'gemini',
        'translation.targetLanguage': 'ko-KR',
        ...settings
      }),
      operation,
      { text: ENGLISH },
      new AbortController().signal
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      systemInstruction?: { parts?: Array<{ text?: string }> };
    };
    return body.systemInstruction?.parts?.[0]?.text ?? '';
  }

  it('offers the same eight subject areas as Rewrite Text, from one list', () => {
    const html = settingsHtml();
    for (const key of ['translation.domain', 'explanation.domain']) {
      const rendered = control(html, key);
      for (const option of REWRITE_DOMAINS) {
        expect(rendered, `${key} is missing ${option.id}`).toContain(`value="${option.id}"`);
      }
    }
  });

  it('sends the subject area to a translation', async () => {
    const instruction = await geminiInstruction('translate', { 'translation.domain': 'medical' });
    expect(instruction).toContain('Use precise medical prose');
  });

  it('sends the subject area to an explanation', async () => {
    const instruction = await geminiInstruction('explain', { 'explanation.domain': 'legal' });
    expect(instruction).toContain('Use precise legal prose');
  });

  it('reads each feature separately, so one does not set the other', async () => {
    const instruction = await geminiInstruction('translate', {
      'translation.domain': 'general',
      'explanation.domain': 'medical'
    });
    expect(instruction, 'the explanation domain leaked into a translation')
      .not.toContain('medical prose');
  });

  /*
   * General adds nothing. An instruction saying "use general-purpose prose" is noise in
   * every request that did not ask for a subject area, and it would be sent on every
   * default run.
   */
  it('adds no instruction under General, which is the default', async () => {
    const instruction = await geminiInstruction('translate', {});
    expect(instruction).not.toContain('general-purpose prose');
    expect(REWRITE_DOMAINS[0].id).toBe('general');
  });

  it('falls back to General when the stored value is not one of the eight', async () => {
    const instruction = await geminiInstruction('translate', { 'translation.domain': 'nonsense' });
    expect(instruction).not.toContain('prose');
  });

  /*
   * Asserted on the function rather than through the prompt. An unrecognised value finds no
   * instruction and adds nothing either way, so removing the fallback survived the suite;
   * what it breaks is the guarantee the return type makes to anything that reads the field.
   */
  it('always returns one of the eight, whatever is stored', () => {
    const stored = (value: unknown): KrenRuntime => ({
      getSecret: async () => undefined,
      getSetting: <T>(key: string, fallback: T): T => (
        key.endsWith('.domain') ? value as T : fallback
      ),
      reserveCloudCharacters: async () => undefined,
      beforeGeminiRequest: async () => undefined
    } as KrenRuntime);
    const ids = REWRITE_DOMAINS.map((option) => option.id);
    for (const value of ['nonsense', '', '  ', 'MEDICAL', 'general ']) {
      expect(ids, `${JSON.stringify(value)} escaped the axis`)
        .toContain(configuredDomain(stored(value), 'translation'));
    }
    expect(configuredDomain(stored('medical'), 'translation')).toBe('medical');
    expect(configuredDomain(stored('  legal  '), 'explanation')).toBe('legal');
  });

  it('refuses a subject area that is not on the shared list', () => {
    expect(validatedPanelSetting('translation.domain', 'medical')).toBe('medical');
    expect(validatedPanelSetting('explanation.domain', 'scientific')).toBe('scientific');
    expect(validatedPanelSetting('translation.domain', 'nonsense')).toBeUndefined();
  });

  /*
   * Google Cloud Translation Basic v2 takes a text, a source, a target, and a format. It has
   * no domain, glossary, or model parameter of any kind, so the control is shown inert with
   * the reason rather than hidden or silently ignored.
   */
  it('sends nothing extra to Google Cloud Translation, whose API has no such parameter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: { translations: [{ translatedText: '결과', detectedSourceLanguage: 'en' }] }
      }), { status: 200 })
    );
    await runKrenOperation(
      runtimeFor({
        translationProvider: 'googleCloudTranslation',
        'translation.domain': 'medical',
        'translation.targetLanguage': 'ko-KR'
      }),
      'translate',
      { text: ENGLISH },
      new AbortController().signal
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['format', 'q', 'source', 'target']);
  });

  it('shows the control inert under Cloud Translation, with the reason beside it', () => {
    const cloud = settingsHtml({ translationProvider: 'googleCloudTranslation' });
    const at = cloud.indexOf('data-setting="translation.domain"');
    expect(at, 'the Domain control vanished instead of being dimmed').toBeGreaterThan(-1);
    const around = cloud.slice(at - 700, at + 200);
    expect(around).toContain('setting-inactive');
    // Changed 2026-10-17: V261, F5 owner canvas edit, the shorter reason still explains the API limit and retained value.
    expect(around).toMatch(/API takes no subject area/u);
    expect(around).toMatch(/stored value is kept.*applies again with a language model/u);
    expect(cloud.slice(at - 60, at)).toContain('disabled');
  });

  it('leaves the control live under a language model', () => {
    const llm = settingsHtml({ translationProvider: 'gemini' });
    const at = llm.indexOf('data-setting="translation.domain"');
    expect(llm.slice(at - 60, at)).not.toContain('disabled');
  });

  it('never dims the Explain control, which has no Cloud Translation path', () => {
    const cloud = settingsHtml({ translationProvider: 'googleCloudTranslation' });
    const at = cloud.indexOf('data-setting="explanation.domain"');
    expect(cloud.slice(at - 60, at)).not.toContain('disabled');
  });
});
