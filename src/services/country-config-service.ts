import { logger } from '@gaian-stellar-integration/config';
import { countryConfig, type AppDb } from '@gaian-stellar-integration/db';

export interface CountryConfigEntry {
  readonly countryCode: string;
  readonly kycProviders: readonly string[];
  readonly minPerTxUsd: number;
  readonly maxPerTxUsd: number;
  readonly maxPerDayUsd: number;
}

export interface CountryConfigService {
  forCountry(countryCode: string): CountryConfigEntry | null;
  list(): readonly CountryConfigEntry[];
  refresh(): Promise<{ rows: number; loadedAt: Date }>;
  stop(): void;
  lastLoadedAt(): Date | null;
}

const parseProviders = (raw: string | null | undefined): readonly string[] => {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
};

const keyOf = (countryCode: string): string => countryCode.toUpperCase();

export const createCountryConfigService = (db: AppDb): CountryConfigService => {
  const cache = new Map<string, CountryConfigEntry>();
  let entries: CountryConfigEntry[] = [];
  let loadedAt: Date | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const loadOnce = async (): Promise<{ rows: number; loadedAt: Date }> => {
    const rows = await db.select().from(countryConfig);
    const nextCache = new Map<string, CountryConfigEntry>();
    const nextEntries: CountryConfigEntry[] = [];
    for (const row of rows) {
      const entry: CountryConfigEntry = {
        countryCode: row.countryCode.toUpperCase(),
        kycProviders: parseProviders(row.kycProviders),
        // Drizzle returns numeric as string; coerce to number for downstream
        // comparison math. NaN falls back to 0 so a corrupted row degrades
        // safely rather than blocking every order.
        minPerTxUsd: Number(row.minPerTxUsd) || 0,
        maxPerTxUsd: Number(row.maxPerTxUsd) || 0,
        maxPerDayUsd: Number(row.maxPerDayUsd) || 0,
      };
      nextCache.set(keyOf(row.countryCode), entry);
      nextEntries.push(entry);
    }
    cache.clear();
    for (const [k, v] of nextCache) cache.set(k, v);
    entries = nextEntries;
    loadedAt = new Date();
    return { rows: rows.length, loadedAt };
  };

  const refresh = async (): Promise<{ rows: number; loadedAt: Date }> => {
    try {
      const result = await loadOnce();
      logger.info(
        { rows: result.rows, loadedAt: result.loadedAt.toISOString() },
        'country-config.cache.refreshed',
      );
      return result;
    } catch (err: unknown) {
      logger.warn({ err }, 'country-config.cache.refresh.failed (serving stale)');
      return { rows: cache.size, loadedAt: loadedAt ?? new Date(0) };
    }
  };

  timer = setInterval(() => {
    void refresh();
  }, 300_000);

  return {
    forCountry(countryCode): CountryConfigEntry | null {
      return cache.get(keyOf(countryCode)) ?? null;
    },
    list(): readonly CountryConfigEntry[] {
      return entries;
    },
    refresh,
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    lastLoadedAt(): Date | null {
      return loadedAt;
    },
  };
};
