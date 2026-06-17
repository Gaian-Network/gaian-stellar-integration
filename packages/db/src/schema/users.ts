import { index, integer, jsonb, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

// Existing gaian-services tables. Schema-mirrored for read-only access by
// gaian-payments. Do NOT alter columns from here — migrations live elsewhere.

export const users = pgTable(
  'app_users',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 100 }),
    email: varchar('email', { length: 255 }),
    status: integer('status'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }),
  },
  (t) => [
    index('idx_users_email').on(t.email),
    index('idx_users_user_id').on(t.userId),
  ],
);

export const userWalletTenant = pgTable(
  'app__user_wallet_tenant',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id'),
    userId: integer('user_id'),
    walletId: integer('wallet_id'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_uwt_user_id').on(t.userId),
    index('idx_uwt_tenant_id').on(t.tenantId),
    index('idx_uwt_wallet_id').on(t.walletId),
  ],
);

export const userKycResult = pgTable(
  'app_user_kyc_result',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    kycId: integer('kyc_id'),
    kycEvent: integer('kyc_event'),
    provider: varchar('provider', { length: 100 }),
    userProviderId: varchar('user_provider_id', { length: 255 }),
    kycStatus: varchar('kyc_status', { length: 50 }),
    rejectReason: varchar('reject_reason', { length: 1000 }),
    response: jsonb('response'),
    issueDate: timestamp('issue_date', { withTimezone: false }),
    expiryDate: timestamp('expiry_date', { withTimezone: false }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }),
    deletedAt: timestamp('deleted_at', { withTimezone: false }),
  },
  (t) => [
    index('idx_kyc_result_user_id').on(t.userId),
    index('idx_kyc_result_provider').on(t.provider),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserWalletTenantRow = typeof userWalletTenant.$inferSelect;
export type UserKycResultRow = typeof userKycResult.$inferSelect;
