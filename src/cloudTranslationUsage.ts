import { ProviderError } from './errors.js';

export const GOOGLE_CLOUD_FREE_TIER_CHARACTERS = 500_000;

export interface CloudTranslationUsageState {
  month: string;
  characters: number;
}

export interface UsageStateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

const USAGE_KEY = 'kren.googleCloudTranslation.usage.v1';

export class CloudTranslationUsage {
  private pending: Promise<void> = Promise.resolve();

  public constructor(
    private readonly store: UsageStateStore,
    private readonly limit = GOOGLE_CLOUD_FREE_TIER_CHARACTERS,
    private readonly now: () => Date = () => new Date()
  ) {}

  public get(): CloudTranslationUsageState {
    const month = googleBillingMonth(this.now());
    const stored = this.store.get<CloudTranslationUsageState>(USAGE_KEY);
    if (!stored || stored.month !== month || !Number.isSafeInteger(stored.characters)) {
      return { month, characters: 0 };
    }
    return { month, characters: Math.max(0, stored.characters) };
  }

  public reserve(characters: number): Promise<CloudTranslationUsageState> {
    if (!Number.isSafeInteger(characters) || characters < 0) {
      return Promise.reject(new Error('Invalid Cloud Translation character count.'));
    }

    let result!: CloudTranslationUsageState;
    const operation = this.pending.then(async () => {
      const usage = this.get();
      const next = usage.characters + characters;
      if (next > this.limit) {
        const remaining = Math.max(0, this.limit - usage.characters);
        throw new ProviderError(
          `Google Cloud Translation was not called because only ${remaining.toLocaleString()} of the locally tracked ${this.limit.toLocaleString()} monthly characters remain.`
        );
      }
      result = { month: usage.month, characters: next };
      // Reserve before transmission. We intentionally do not refund failed or
      // uncertain requests, because Google might still have processed them.
      await this.store.update(USAGE_KEY, result);
    });
    this.pending = operation.catch(() => undefined);
    return operation.then(() => result);
  }
}

export function countCloudTranslationCharacters(text: string): number {
  // Google bills Unicode code points, including whitespace. Array.from counts
  // astral characters once, unlike JavaScript string.length (UTF-16 units).
  return Array.from(text).length;
}

export function googleBillingMonth(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Could not determine the Google billing month.');
  return `${year}-${month}`;
}
