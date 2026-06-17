import { index, integer, jsonb, serial, smallint, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { orders } from './orders.js';
import { integrationSchema } from './schemas.js';
import { tenants } from './tenants.js';

export const inboundWebhookEvents = integrationSchema.table(
  'inbound_webhook_events',
  {
    id: serial('id').primaryKey(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payoutTransferId: varchar('payout_transfer_id', { length: 255 }),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 50 }).default('PROCESSED').notNull(),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_inbound_webhook_event_id').on(t.eventId),
    index('idx_inbound_webhook_payout_transfer_id').on(t.payoutTransferId),
  ],
);

export const webhookEndpoints = integrationSchema.table(
  'webhook_endpoints',
  {
    id: serial('id').primaryKey(),
    endpointId: varchar('endpoint_id', { length: 64 }).notNull(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    eventTypes: text('event_types').array().notNull(),
    secretEncrypted: text('secret_encrypted').notNull(),
    isActive: smallint('is_active').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_webhook_endpoint_id').on(t.endpointId),
    index('idx_webhook_endpoint_tenant').on(t.tenantId),
    index('idx_webhook_endpoint_active').on(t.isActive),
  ],
);

export const orderNotifications = integrationSchema.table(
  'order_notifications',
  {
    id: serial('id').primaryKey(),
    notificationId: varchar('notification_id', { length: 64 }).notNull(),
    orderRowId: integer('order_row_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderId: varchar('order_id', { length: 255 }).notNull(),
    endpointId: integer('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    event: varchar('event', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(6).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: false }),
    payload: jsonb('payload').notNull(),
    lastResponseStatus: integer('last_response_status'),
    lastResponseBody: text('last_response_body'),
    sentAt: timestamp('sent_at', { withTimezone: false }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('idx_order_notification_unique').on(t.orderId, t.endpointId, t.event),
    uniqueIndex('idx_order_notification_id').on(t.notificationId),
    index('idx_order_notification_status').on(t.status),
    index('idx_order_notification_next_attempt').on(t.nextAttemptAt),
  ],
);

export type InboundWebhookEventRow = typeof inboundWebhookEvents.$inferSelect;
export type InboundWebhookEventInsert = typeof inboundWebhookEvents.$inferInsert;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;
export type OrderNotificationRow = typeof orderNotifications.$inferSelect;
export type OrderNotificationInsert = typeof orderNotifications.$inferInsert;
