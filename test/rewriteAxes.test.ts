import { describe, expect, it } from 'vitest';
import {
  isRewriteAxisSetting,
  isRewriteDomain,
  isRewriteEnglishVarietySetting,
  isRewriteFormality,
  isRewriteFunction,
  isRewriteLength,
  isRewriteModality,
  isRewritePerspective,
  isRewriteRhetoricalMode,
  isRewriteStance,
  isRewriteVoice,
  migrateLegacyRewriteSettings,
  REWRITE_AXIS_SETTINGS,
  REWRITE_DOMAINS,
  REWRITE_ENGLISH_VARIETIES,
  REWRITE_FORMALITIES,
  REWRITE_FUNCTIONS,
  REWRITE_LENGTHS,
  REWRITE_MODALITIES,
  REWRITE_PERSPECTIVES,
  REWRITE_RHETORICAL_MODES,
  REWRITE_STANCES,
  REWRITE_VOICES,
  rewriteAxisOptions,
  type RewriteConfigurationTarget,
  type RewriteMigrationConfiguration
} from '../src/rewriteAxes.js';

type TargetSettings = Record<RewriteConfigurationTarget, Record<string, string>>;

function migrationConfiguration(initial: Partial<TargetSettings>): {
  configuration: RewriteMigrationConfiguration;
  settings: TargetSettings;
} {
  const settings: TargetSettings = {
    global: { ...initial.global },
    workspace: { ...initial.workspace },
    workspaceFolder: { ...initial.workspaceFolder }
  };
  return {
    settings,
    configuration: {
      inspect: <T>(key: string) => ({
        globalValue: settings.global[key] as T | undefined,
        workspaceValue: settings.workspace[key] as T | undefined,
        workspaceFolderValue: settings.workspaceFolder[key] as T | undefined
      }),
      update: async (key, value, target) => {
        if (value === undefined) delete settings[target][key];
        else settings[target][key] = value;
      }
    }
  };
}

describe('rewrite axis definitions', () => {
  it('derives every guard and panel option from its axis array', () => {
    const axes = [
      [REWRITE_MODALITIES, isRewriteModality],
      [REWRITE_FUNCTIONS, isRewriteFunction],
      [REWRITE_ENGLISH_VARIETIES, isRewriteEnglishVarietySetting],
      [REWRITE_DOMAINS, isRewriteDomain],
      [REWRITE_FORMALITIES, isRewriteFormality],
      [REWRITE_VOICES, isRewriteVoice],
      [REWRITE_STANCES, isRewriteStance],
      [REWRITE_LENGTHS, isRewriteLength],
      [REWRITE_PERSPECTIVES, isRewritePerspective],
      [REWRITE_RHETORICAL_MODES, isRewriteRhetoricalMode]
    ] as const;

    for (const [options, guard] of axes) {
      expect(options.every((option) => guard(option.id))).toBe(true);
      expect(guard('__not_an_axis_value__')).toBe(false);
      expect(rewriteAxisOptions(options)).toEqual(
        options.map((option) => [option.id, option.label])
      );
    }
    for (const { key, values } of REWRITE_AXIS_SETTINGS) {
      expect(values.every((option) => isRewriteAxisSetting(key, option.id))).toBe(true);
      expect(isRewriteAxisSetting(key, '__not_an_axis_value__')).toBe(false);
    }
  });

  it.each([
    ['preserveVoice', { formality: 'preserve', voice: 'preserve', stance: 'preserve' }],
    ['formal', { formality: 'formal' }],
    ['professional', { formality: 'formal', stance: 'neutral' }],
    ['neutral', { formality: 'neutral', stance: 'neutral' }],
    ['warm', { stance: 'warm' }],
    ['assertive', { stance: 'assertive' }],
    ['cautious', { stance: 'cautious' }],
    ['diplomatic', { stance: 'diplomatic' }],
    ['direct', { stance: 'direct' }],
    ['plainLanguage', { formality: 'neutral', voice: 'preserve', stance: 'direct' }]
  ] as const)('migrates legacy tone %s once and remains idempotent', async (tone, expected) => {
    const { configuration, settings } = migrationConfiguration({
      global: { 'rewrite.tone': tone }
    });
    await migrateLegacyRewriteSettings(configuration);
    const afterFirst = structuredClone(settings);
    await migrateLegacyRewriteSettings(configuration);
    await migrateLegacyRewriteSettings(configuration);

    expect(settings).toEqual(afterFirst);
    expect(settings.global['rewrite.tone']).toBeUndefined();
    for (const [axis, value] of Object.entries(expected)) {
      expect(settings.global[`rewrite.${axis}`]).toBe(value);
    }
  });

  it('migrates email to function email plus domain business at every setting target', async () => {
    const { configuration, settings } = migrationConfiguration({
      global: { 'rewrite.domain': 'email' },
      workspace: { 'rewrite.domain': 'email' },
      workspaceFolder: { 'rewrite.domain': 'email' }
    });
    await migrateLegacyRewriteSettings(configuration);

    for (const target of ['global', 'workspace', 'workspaceFolder'] as const) {
      expect(settings[target]['rewrite.function']).toBe('email');
      expect(settings[target]['rewrite.domain']).toBe('business');
    }
  });

  it('does not overwrite an axis the user already configured', async () => {
    const { configuration, settings } = migrationConfiguration({
      global: {
        'rewrite.tone': 'professional',
        'rewrite.formality': 'casual',
        'rewrite.stance': 'warm'
      }
    });
    await migrateLegacyRewriteSettings(configuration);

    expect(settings.global['rewrite.formality']).toBe('casual');
    expect(settings.global['rewrite.stance']).toBe('warm');
    expect(settings.global['rewrite.tone']).toBeUndefined();
  });
});
