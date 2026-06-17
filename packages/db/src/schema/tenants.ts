import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'app_tenants',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isBlocked: boolean('is_blocked').default(false).notNull(),
    rateLimit: integer('rate_limit').default(1000).notNull(),
    prefund: boolean('is_prefund').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: false }),
    customFeeBps: numeric('custom_fee_bps'),
    tenantFeeBps: numeric('tenant_fee_bps').default('0'),
    regulatoryFeeBps: numeric('regulatory_fee_bps').default('0'),
    isKyb: boolean('is_kyb').default(false).notNull(),
    country: varchar('country', { length: 10 }),
    detectCountry: varchar('detect_country', { length: 10 }),
    email: varchar('email', { length: 255 }),
    phoneNumber: varchar('phone_number', { length: 20 }),
    telegramId: varchar('telegram_id', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
    lastUsed: timestamp('last_used', { withTimezone: false }),
  },
  (t) => [
    index('idx_tenants_is_active').on(t.isActive),
    index('idx_tenants_is_blocked').on(t.isBlocked),
    index('idx_tenants_name').on(t.name),
  ],
);

export const tenantApiKeys = pgTable(
  'app_tenant_api_keys',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    apiKey: varchar('api_key', { length: 255 }).notNull(),
    apiKeyPrefix: varchar('api_key_prefix', { length: 50 }),
    apiKeyHash: varchar('api_key_hash', { length: 255 }),
    environment: varchar('environment', { length: 50 }).default('live'),
    isRevoked: boolean('is_revoked').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_tenant_api_keys_api_key').on(t.apiKey),
    index('idx_tenant_api_keys_tenant_id').on(t.tenantId),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
export type TenantInsert = typeof tenants.$inferInsert;
export type TenantApiKeyRow = typeof tenantApiKeys.$inferSelect;
