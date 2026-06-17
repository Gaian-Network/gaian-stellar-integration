import { numeric, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

import { configSchema } from './schemas.js';

// Singleton row (enforced at app layer: service always reads id=1, upsert
// targets id=1). Holds the global default protocol BPS used when no
// (psp,country) override AND no tenant.custom_fee_bps applies.
export const defaultFeeConfig = configSchema.table('default_fee_config', {
  id: serial('id').primaryKey(),
  protocolBps: numeric('protocol_bps').default('0').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  updatedBy: varchar('updated_by', { length: 255 }),
});

export type DefaultFeeConfigRow = typeof defaultFeeConfig.$inferSelect;
export type DefaultFeeConfigInsert = typeof defaultFeeConfig.$inferInsert;
