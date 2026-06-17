export const ErrorCode = {
  TENANT_NOT_FOUND: 'ERR_TENANT_NOT_FOUND',
  USER_NOT_REGISTERED: 'ERR_USER_NOT_REGISTERED',
  INVALID_WALLET_ADDRESS: 'ERR_INVALID_WALLET_ADDRESS',
  CURRENCY_MISMATCH: 'ERR_CURRENCY_MISMATCH',
  UNSUPPORTED_COUNTRY: 'ERR_UNSUPPORTED_COUNTRY',
  QR_INVALID: 'ERR_QR_INVALID',
  KYC_REQUIRED: 'ERR_KYC_REQUIRED',
  AMOUNT_BELOW_MIN: 'ERR_AMOUNT_BELOW_MIN',
  AMOUNT_ABOVE_MAX: 'ERR_AMOUNT_ABOVE_MAX',
  ORDER_NOT_FOUND: 'ERR_ORDER_NOT_FOUND',
  VERIFICATION_FAILED: 'ERR_VERIFICATION_FAILED',
  UNKNOWN: 'ERR_UNKNOWN',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class V1AppError extends Error {
  readonly code: ErrorCodeValue;
  constructor(code: ErrorCodeValue, message: string) {
    super(message);
    this.name = 'V1AppError';
    this.code = code;
  }
}
