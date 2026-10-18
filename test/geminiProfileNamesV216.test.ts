import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ commands: { executeCommand: vi.fn() }, env: {},
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }));

import { renderKrenResultViewHtml } from '../src/resultViewHtml.js';
import { KrenResultsViewProvider } from '../src/resultsView.js';
import { ensureTutorConversationPicture, pauseTutorPictures } from '../src/resultsViewConversation.js';
import { KREN_SECRET_KEYS } from '../src/operations.js';
import { TUTOR_DEFAULTS } from '../src/tutor/defaults.js';
import { PANEL_SETTINGS_FIXTURE } from './support/panelSettingsFixture.js';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
// 2026-10-10: No exceptions. Stored identifiers and script comments are not reader-visible text.
const oldNames = /Default Gemini|Alternate Gemini|default Gemini profile|alternate Gemini profile|Default profile|Alternate profile/iu;
const missingNotice = 'Pictures paused: no Gemini Paid key is set. The conversation continues without pictures.';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness(paid = true) {
  const settings = { ...PANEL_SETTINGS_FIXTURE, tutorProfile: 'standard' as const,
    tutorPictureProvider: 'gemini' as const, credentialPresence: { geminiDefault: true, geminiAlternate: paid } };
  const actions = { settings: () => settings, generateSituationPicture: vi.fn(async () => 'data:image/png;base64,AAAA'), log: vi.fn() };
  const view = new KrenResultsViewProvider(actions as never, {} as never);
  const postMessage = vi.fn(async (_message: unknown) => true);
  view.view = { webview: { postMessage } } as never;
  view.tutorState.conversation.status = 'active';
  view.tutorState.conversation.situationPicture = 'intro';
  view.tutorState.conversation.draftAnswer = 'Keep this answer.';
  view.tutorConversationScene = 'A cafe.';
  return { view, settings, actions, postMessage };
}

function render(activeScreen: 'settings' | 'tutor' | 'manual', paid = false) {
  const h = harness();
  const profile = paid ? 'pro' : 'standard';
  return load(renderKrenResultViewHtml({ activeScreen, cspSource: 'test', nonce: 'test', proModels: [], tutor: h.view.tutorState,
    settings: { ...h.settings, tutorProfile: profile, rewriteProfile: profile, translationProfile: profile,
      explanationProfile: profile, userDictionaryProfile: profile } }));
}

function hostPictureAction(profile: 'standard' | 'pro', paid = true) {
  const source = readFileSync('src/extension.ts', 'utf8');
  const start = source.indexOf('generateSituationPicture: async');
  expect(start).toBeGreaterThan(0);
  const action = source.slice(start + 'generateSituationPicture: '.length, source.indexOf('    transcribeTutorAudio:', start)).trim().replace(/,$/u, '');
  const getSecret = vi.fn(async (slot: string) => slot === KREN_SECRET_KEYS.geminiPro
    ? paid ? 'test-paid-credential' : undefined : 'test-free-tier-credential');
  const beforeGeminiRequest = vi.fn(async (_profile: string) => undefined);
  const generate = vi.fn(async () => 'data:image/png;base64,AAAA');
  const callback = runInNewContext('(' + action + ')', { context: {},
    extensionRuntime: () => ({ getSecret, beforeGeminiRequest }), KREN_SECRET_KEYS, TUTOR_DEFAULTS,
    readPanelSettings: () => ({ tutorProfile: profile, tutorPictureProvider: 'gemini' }),
    vscode: { workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } },
    generateSituationPicture: generate }) as (scene: string, signal: AbortSignal) => Promise<string>;
  return { callback, getSecret, beforeGeminiRequest, generate };
}

describe('V216 Gemini Free Tier and Paid names', () => {
  it.each(['settings', 'tutor', 'manual'] as const)('has no old reader-visible names on %s with Free Tier selected', screen => {
    const $ = render(screen);
    $('script, style').remove();
    expect($.root().text()).not.toMatch(oldNames);
    $('[title], [aria-label], [placeholder]').each((_i, el) => {
      for (const attr of ['title', 'aria-label', 'placeholder']) expect($(el).attr(attr) ?? '').not.toMatch(oldNames);
    });
  });

  it.each(['settings', 'tutor', 'manual'] as const)('has no old reader-visible names on %s with Paid selected', screen => {
    const $ = render(screen, true);
    $('script, style').remove();
    expect($.root().text()).not.toMatch(oldNames);
    $('[title], [aria-label], [placeholder]').each((_i, el) => {
      for (const attr of ['title', 'aria-label', 'placeholder']) expect($(el).attr(attr) ?? '').not.toMatch(oldNames);
    });
  });

  it('has no old reader-visible names in manifest contributions, guide, or privacy', () => {
    for (const text of [JSON.stringify(manifest.contributes), readFileSync('docs/USER_GUIDE.md', 'utf8'), readFileSync('PRIVACY.md', 'utf8')]) {
      expect(text).not.toMatch(oldNames);
    }
  });

  it('pins all four command titles while preserving command identifiers', () => {
    const titles = new Map(manifest.contributes.commands.map((command: { command: string; title: string }) => [command.command, command.title]));
    expect(titles.get('kren.setGeminiApiKey')).toBe('Set Gemini Free Tier API Key');
    expect(titles.get('kren.deleteGeminiApiKey')).toBe('Delete Gemini Free Tier API Key');
    expect(titles.get('kren.setGeminiProApiKey')).toBe('Set Gemini Paid API Key');
    expect(titles.get('kren.deleteGeminiProApiKey')).toBe('Delete Gemini Paid API Key');
  });

  it('pins Picture Provider choices in reachable keyboard-operable voice/model routing', () => {
    const $ = render('tutor');
    expect($('[data-setting="tutor.geminiProfile"] option').map((_i, el) => $(el).text()).get()).toEqual(['Free Tier', 'Paid']);
    expect($('[data-persist-id="tutor-routing"] > summary').text()).toContain('Gemini Profile: Free Tier');
    const provider = $('[data-setting="tutor.pictureProvider"]');
    expect(provider.find('option').map((_i, el) => [$(el).attr('value'), $(el).text()]).get()).toEqual([
      'gemini', 'Gemini Paid profile', 'cloudflare', 'Cloudflare free models'
    ]);
    expect(provider.is('select:not([disabled]):not([tabindex="-1"])')).toBe(true);
    expect(provider.parents('details').map((_i, el) => $(el).attr('data-persist-id')).get()).toEqual(['tutor-routing', 'tutor-setting']);
    for (const id of ['tutor-routing', 'tutor-setting']) expect($(`[data-persist-id="${id}"] > summary`)).toHaveLength(1);
    expect($('[data-model-preset="tutor.imageModel"]').closest('label').find('.setting-description').text()).toContain("Gemini Paid profile's key");
  });

  it.each(['standard', 'pro'] as const)('uses the Paid credential and consent when tutor text profile is %s', async profile => {
    const h = hostPictureAction(profile);
    const signal = new AbortController().signal;
    await h.callback('A cafe.', signal);
    expect(h.getSecret).toHaveBeenCalledExactlyOnceWith(KREN_SECRET_KEYS.geminiPro);
    expect(h.beforeGeminiRequest).toHaveBeenCalledExactlyOnceWith('pro');
    // 2026-10-11: V218 adds the default picture style to the existing Paid picture request.
    expect(h.generate).toHaveBeenCalledExactlyOnceWith('A cafe.', 'test-paid-credential', signal, undefined, TUTOR_DEFAULTS.configuration['tutor.imageModel'], TUTOR_DEFAULTS.configuration['tutor.conversation.pictureStyle']);
  });

  it('rejects a host picture without a Paid key even when the Free Tier key exists', async () => {
    const h = hostPictureAction('standard', false);
    await expect(h.callback('A cafe.', new AbortController().signal)).rejects.toThrow('Gemini Paid');
    expect(h.beforeGeminiRequest).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('pauses without a Paid key and patches the notice away after Paid is stored, keeping the conversation', async () => {
    const h = harness(false);
    ensureTutorConversationPicture(h.view);
    await flush();
    expect(h.actions.generateSituationPicture).not.toHaveBeenCalled();
    expect(h.view.tutorState.conversation.picturePaused).toBe(missingNotice);
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorPicturePaused', text: missingNotice });
    expect(h.view.tutorState.conversation.status).toBe('active');
    h.settings.credentialPresence.geminiAlternate = true;
    h.settings.credentialPresence.geminiDefault = false;
    ensureTutorConversationPicture(h.view);
    await flush();
    expect(h.actions.generateSituationPicture).toHaveBeenCalledOnce();
    expect(h.view.tutorState.conversation.picturePaused).toBeUndefined();
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorPicturePaused', text: '' });
    expect(h.view.tutorState.conversation.draftAnswer).toBe('Keep this answer.');
  });

  it('names the Gemini Paid key when billing is required', () => {
    const h = harness();
    pauseTutorPictures(h.view, 'paidKey');
    expect(h.view.tutorState.conversation.picturePaused).toBe('Pictures paused: situation pictures need a Gemini Paid API key with billing enabled. The conversation continues without pictures.');
    expect(h.postMessage).toHaveBeenCalledWith({ command: 'tutorPicturePaused', text: h.view.tutorState.conversation.picturePaused });
  });
});
