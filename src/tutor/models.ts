import type { LanguageModelRoutingProvider } from '../languageModelRouting.js';
import { TUTOR_DEFAULTS } from './defaults.js';

export type ThinkingMode = 'fast' | 'thorough';
export const TUTOR_MODELS = {
  gemini: { fast: TUTOR_DEFAULTS.configuration['tutor.hintModel'], thorough: TUTOR_DEFAULTS.configuration['tutor.model'] },
  groq: { fast: 'openai/gpt-oss-120b', thorough: 'openai/gpt-oss-120b' },
  cloudflare: { fast: '@cf/meta/llama-3.1-8b-instruct', thorough: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  openai: { fast: 'gpt-5.4', thorough: 'gpt-5.4' },
  anthropic: { fast: 'claude-sonnet-4-6', thorough: 'claude-sonnet-4-6' }
} as const;

/** Owner rule 2026-10-15: retired Groq models read as their replacement, in the panel and in requests. */
export const GROQ_RETIRED_MODELS: Readonly<Record<string, string>> = { 'openai/gpt-oss-20b': 'openai/gpt-oss-120b' };

// 2026-10-12: panel and request routing share this resolver without importing transports.
export function tutorModeModel(provider: LanguageModelRoutingProvider, mode: ThinkingMode, configured?: string): string {
  // 2026-10-15: Read retired Groq choices through the shared panel and request resolver.
  if (provider === 'groq' && configured?.trim() && GROQ_RETIRED_MODELS[configured.trim()]) return GROQ_RETIRED_MODELS[configured.trim()]!;
  if (!configured) return TUTOR_MODELS[provider][mode];
  const owner = /^(?:models\/)?gemini-/u.test(configured) ? 'gemini'
    : /^@(?:cf|hf)\//u.test(configured) ? 'cloudflare' : /^openai\/|^qwen\//u.test(configured) ? 'groq'
      : /^claude-/u.test(configured) ? 'anthropic' : /^(?:gpt-|o\d)/u.test(configured) ? 'openai' : undefined;
  return owner && owner !== provider ? TUTOR_MODELS[provider][mode] : configured;
}
