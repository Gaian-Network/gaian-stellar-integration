import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { wallets } from './wallets.js';

export const orders = pgTable(
  'app_orders',
  {
    id: serial('id').primaryKey(),
    orderId: varchar('order_id', { length: 255 }).notNull(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    fiatAmount: numeric('fiat_amount', { precision: 18, scale: 2 }).notNull(),
    fiatCurrency: varchar('fiat_currency', { length: 10 }).notNull(),
    cryptoAmount: numeric('crypto_amount', { precision: 18, scale: 8 }).notNull(),
    cryptoCurrency: varchar('crypto_currency', { length: 10 }).notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 }),
    isPrefunded: boolean('is_prefunded').default(false),
    routeId: integer('route_id'),
    userId: integer('user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: false }),
    protocolFee: numeric('protocol_fee', { precision: 18, scale: 6 }),
    feeShare: numeric('fee_share', { precision: 18, scale: 6 }),
    tenantFeeShare: numeric('tenant_fee_share', { precision: 18, scale: 6 }),
    providerCharge: numeric('provider_charge', { precision: 18, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_orders_order_id').on(t.orderId),
    index('idx_orders_tenant_id').on(t.tenantId),
    index('idx_orders_status').on(t.status),
    index('idx_orders_created_at').on(t.createdAt),
  ],
);

export const orderPayment = pgTable(
  'app_order_payment',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull(),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    providerRef: varchar('provider_ref', { length: 255 }),
    qrPayload: jsonb('qr_payload'),
    providerPayload: jsonb('provider_payload'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: false }),
  },
  (t) => [
    index('idx_order_payment_order_id').on(t.orderId),
    index('idx_order_payment_provider').on(t.provider),
  ],
);

export const cryptoTransfers = pgTable(
  'app_crypto_transfers',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    wallet: integer('wallet').references(() => wallets.id),
    fromAddress: varchar('from_address', { length: 255 }).notNull(),
    toAddress: varchar('to_address', { length: 255 }).notNull(),
    chain: varchar('chain', { length: 50 }).notNull(),
    token: varchar('token', { length: 50 }).notNull(),
    amount: numeric('amount', { precision: 18, scale: 8 }).notNull(),
    transactionHash: varchar('transaction_hash', { length: 255 }),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    isConfirmed: boolean('is_confirmed').default(false).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: false }),
  },
  (t) => [
    index('idx_crypto_transfers_order_id').on(t.orderId),
    index('idx_crypto_transfers_from_address').on(t.fromAddress),
    index('idx_crypto_transfers_to_address').on(t.toAddress),
    index('idx_crypto_transfers_transaction_hash').on(t.transactionHash),
  ],
);

export const orderStatusHistory = pgTable(
  'app_order_status_history',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: varchar('from_status', { length: 50 }).notNull(),
    toStatus: varchar('to_status', { length: 50 }).notNull(),
    triggeredBy: varchar('triggered_by', { length: 50 }),
    triggeredId: integer('triggered_id'),
    event: varchar('event', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_order_status_history_order_id').on(t.orderId),
    index('idx_order_status_history_created_at').on(t.createdAt),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
export type OrderPaymentRow = typeof orderPayment.$inferSelect;
export type CryptoTransferRow = typeof cryptoTransfers.$inferSelect;
export type OrderStatusHistoryRow = typeof orderStatusHistory.$inferSelect;
