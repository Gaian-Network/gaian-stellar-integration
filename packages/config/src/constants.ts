export const ORDER_STATUS = {
  PENDING: 'pending',
  PAYMENT_RECEIVED: 'payment_received',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.FAILED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.EXPIRED,
]);

// V2 order status as numeric code (for wire format). 99 = unknown fallback.
export const V2_ORDER_STATUS_CODE: Record<string, number> = {
  pending: 0,
  awaiting_deposit: 1,
  payment_received: 2,
  queued: 3,
  'queued-for-settlement': 3,
  processing: 4,
  completed: 10,
  failed: 20,
  cancelled: 21,
  expired: 22,
};

export const v2OrderStatusCode = (status: string): number =>
  V2_ORDER_STATUS_CODE[status] ?? 99;

// V2 verify-result status (separate from order lifecycle).
export const V2_VERIFY_STATUS_CODE: Record<string, number> = {
  pending: 0,
  verified: 1,
  failed: 2,
};

export const v2VerifyStatusCode = (status: string): number =>
  V2_VERIFY_STATUS_CODE[status] ?? 99;

export const HEADER_NAMES = {
  AUTHORIZATION: 'authorization',
  API_KEY: 'x-api-key',
  REQUEST_ID: 'x-request-id',
} as const;
