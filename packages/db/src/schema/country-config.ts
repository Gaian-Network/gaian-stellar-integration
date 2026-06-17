import { numeric, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { configSchema } from './schemas.js';

export const countryConfig = configSchema.table(
  'country_config',
  {
    id: serial('id').primaryKey(),
    countryCode: varchar('country_code', { length: 10 }).notNull(),
    kycProviders: varchar('kyc_providers', { length: 255 }),
    // numeric(12,2) — allows fractional USD limits like 0.70 / 50.50.
    // Drizzle returns these as `string`; consumers parse to number.
    minPerTxUsd: numeric('min_per_tx_usd', { precision: 12, scale: 2 })
      .default('1')
      .notNull(),
    maxPerTxUsd: numeric('max_per_tx_usd', { precision: 12, scale: 2 })
      .default('10000')
      .notNull(),
    maxPerDayUsd: numeric('max_per_day_usd', { precision: 12, scale: 2 })
      .default('100000')
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
    updatedBy: varchar('updated_by', { length: 255 }),
  },
  (t) => [uniqueIndex('idx_country_config_country').on(t.countryCode)],
);

export type CountryConfigRow = typeof countryConfig.$inferSelect;
