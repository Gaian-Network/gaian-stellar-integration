import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const wallets = pgTable('app_wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  tenantId: integer('tenant_id'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
});

export const walletAddresses = pgTable(
  'app_wallet_addresses',
  {
    id: serial('id').primaryKey(),
    walletId: integer('wallet_id').references(() => wallets.id, { onDelete: 'cascade' }),
    address: varchar('address', { length: 255 }).notNull(),
    chain: varchar('chain', { length: 50 }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: false }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_wallet_addresses_address').on(t.address),
    index('idx_wallet_addresses_wallet_id').on(t.walletId),
  ],
);

export type WalletRow = typeof wallets.$inferSelect;
export type WalletAddressRow = typeof walletAddresses.$inferSelect;
