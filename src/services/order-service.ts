import {
  DatabaseError,
  NotFoundError,
  TERMINAL_ORDER_STATUSES,
  logger,
  type OrderStatus,
} from '@gaian-stellar-integration/config';
import {
  cryptoTransfers,
  orderPayment,
  orderStatusHistory,
  orders,
  type AppDb,
  type OrderRow,
} from '@gaian-stellar-integration/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import type { CryptoOrder } from '@gaian-stellar-integration/core';

export interface OrderInsert {
  readonly orderId: string;
  readonly tenantId: number;
  readonly status: string;
  readonly fiatAmount: number;
  readonly fiatCurrency: string;
  readonly cryptoAmount: number;
  readonly cryptoCurrency: string;
  readonly exchangeRate: number;
  readonly isPrefunded?: boolean;
  readonly routeId?: number;
  readonly userId?: number;
  readonly expiresAt?: Date;
  readonly qrInfo: CryptoOrder['qrInfo'];
  readonly cryptoTransferInfo: CryptoOrder['cryptoTransferInfo'];
  readonly metadata?: Record<string, unknown>;
  readonly transactionHash?: string;
  readonly protocolFee?: number;
  readonly feeShare?: number;
  readonly tenantFeeShare?: number;
  readonly providerCharge?: number;
}

const numericText = (n: number | undefined): string | null =>
  n === undefined || Number.isNaN(n) ? null : n.toString();

export class OrderService {
  constructor(private readonly db: AppDb) {}

  async createOrder(input: OrderInsert): Promise<OrderRow> {
    const created = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(orders)
        .values({
          orderId: input.orderId,
          tenantId: input.tenantId,
          status: input.status,
          fiatAmount: input.fiatAmount.toString(),
          fiatCurrency: input.fiatCurrency,
          cryptoAmount: input.cryptoAmount.toString(),
          cryptoCurrency: input.cryptoCurrency,
          exchangeRate: numericText(input.exchangeRate),
          isPrefunded: input.isPrefunded ?? false,
          ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
          protocolFee: numericText(input.protocolFee),
          feeShare: numericText(input.feeShare),
          tenantFeeShare: numericText(input.tenantFeeShare),
          providerCharge: numericText(input.providerCharge),
        })
        .returning();

      const order = inserted[0];
      if (!order) {
        throw new DatabaseError('insert order returned no rows');
      }

      const cryptoTxHash = input.isPrefunded ? 'prefund mode' : input.transactionHash;
      await tx.insert(cryptoTransfers).values({
        orderId: order.id,
        fromAddress: input.cryptoTransferInfo.fromAddress,
        toAddress: input.cryptoTransferInfo.toAddress,
        chain: input.cryptoTransferInfo.chain,
        token: input.cryptoTransferInfo.token,
        amount: input.cryptoTransferInfo.amount.toString(),
        ...(cryptoTxHash !== undefined ? { transactionHash: cryptoTxHash } : {}),
        status: input.isPrefunded ? 'completed' : 'pending',
        isConfirmed: input.isPrefunded ?? false,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });

      await tx.insert(orderPayment).values({
        orderId: order.id,
        provider: input.qrInfo.qrProvider,
        amount: input.fiatAmount.toString(),
        currency: input.fiatCurrency,
        status: 'pending',
        qrPayload: input.qrInfo,
      });

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'started',
        toStatus: input.status,
        triggeredBy: 'system',
        event: 'Order created',
      });

      return order;
    });

    logger.info(
      {
        audit: 'order.created',
        orderId: input.orderId,
        tenantId: input.tenantId,
        status: input.status,
        fiatAmount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency,
        cryptoAmount: input.cryptoAmount,
        cryptoCurrency: input.cryptoCurrency,
        routeId: input.routeId,
        isPrefunded: input.isPrefunded ?? false,
      },
      'audit.order.created',
    );

    return created;
  }

  async findByOrderId(orderId: string): Promise<OrderRow | null> {
    const rows = await this.db.select().from(orders).where(eq(orders.orderId, orderId)).limit(1);
    return rows[0] ?? null;
  }

  async findByOrderIdAndTenant(orderId: string, tenantId: number): Promise<OrderRow | null> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.orderId, orderId), eq(orders.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async requireByOrderId(orderId: string): Promise<OrderRow> {
    const found = await this.findByOrderId(orderId);
    if (!found) throw new NotFoundError(`Order ${orderId}`);
    return found;
  }

  async updateStatus(orderId: string, nextStatus: string, event = 'status updated'): Promise<void> {
    let didTransition = false;
    let fromStatus: string | undefined;
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: orders.id, current: orders.status })
        .from(orders)
        .where(eq(orders.orderId, orderId))
        .limit(1);
      const current = rows[0];
      if (!current) return;
      if (current.current === nextStatus) return;
      if (TERMINAL_ORDER_STATUSES.has(current.current as OrderStatus)) {
        logger.debug(
          { orderId, currentStatus: current.current, attemptedStatus: nextStatus, event },
          'order in terminal state; skipping status update',
        );
        return;
      }
      await tx
        .update(orders)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(orders.id, current.id));
      await tx.insert(orderStatusHistory).values({
        orderId: current.id,
        fromStatus: current.current,
        toStatus: nextStatus,
        triggeredBy: 'system',
        // Legacy app_order_status_history.event is varchar(50) in prod (the
        // drizzle mirror says 255 but the pre-existing table wins). Truncate so
        // a long event (e.g. 'verify failed: <reason>') can't 22001 the tx.
        event: event.slice(0, 50),
      });
      fromStatus = current.current;
      didTransition = true;
    });

    // Money-movement audit trail. One structured, greppable line per real order
    // Structured audit log per status transition.
    if (didTransition) {
      logger.info(
        { audit: 'order.status', orderId, fromStatus, toStatus: nextStatus, event, triggeredBy: 'system' },
        'audit.order.status',
      );
    }

  }

  async setTransactionHash(
    orderId: string,
    transactionHash: string,
    orderRowId?: number,
  ): Promise<void> {
    // Callers that already hold the order row pass its numeric id to skip the
    // lookup SELECT (e.g. verify, which fetched the order moments earlier).
    let rowId = orderRowId;
    if (rowId === undefined) {
      const orderRows = await this.db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderId, orderId))
        .limit(1);
      rowId = orderRows[0]?.id;
      if (rowId === undefined) return;
    }
    await this.db
      .update(cryptoTransfers)
      .set({ transactionHash, status: 'completed', isConfirmed: true, confirmedAt: new Date() })
      .where(eq(cryptoTransfers.orderId, rowId));
  }

  async getTenantTotalSpent(tenantId: number): Promise<number> {
    // SUM in the DB with the status filter — avoids streaming every tenant
    // order row to the app just to add them up.
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${orders.cryptoAmount}), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          inArray(orders.status, ['completed', 'processing', 'pending']),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Sum of `cryptoAmount` (≈USD) for non-cancelled/-expired/-failed orders
   * for a user since the start of the rolling 24-hour window. Used to gate
   * `maxPerDayUsd*` against country_config.
   */
  async getUserDailySpent(userId: number, since: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${orders.cryptoAmount}), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          gte(orders.createdAt, since),
          inArray(orders.status, [
            'completed',
            'processing',
            'pending',
            'awaiting_crypto_transfer',
            'payment_received',
          ]),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }
}
