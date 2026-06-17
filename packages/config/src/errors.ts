export type ErrorCategory =
  | 'VALIDATION'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'PROVIDER'
  | 'NETWORK'
  | 'DATABASE'
  | 'INTERNAL'
  | 'WEBHOOK';

export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AppErrorOptions {
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly severity?: ErrorSeverity;
  readonly code?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  readonly retryable?: boolean;
}

export class AppError extends Error {
  public readonly category: ErrorCategory;
  public readonly statusCode: number;
  public readonly severity: ErrorSeverity;
  public readonly code: string;
  public readonly context: Readonly<Record<string, unknown>>;
  public readonly retryable: boolean;
  public readonly isOperational = true;

  constructor(message: string, options: AppErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.category = options.category;
    this.statusCode = options.statusCode;
    this.severity = options.severity ?? 'MEDIUM';
    this.code = options.code ?? this.category;
    this.context = Object.freeze({ ...(options.context ?? {}) });
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Error.captureStackTrace(this, new.target);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      statusCode: this.statusCode,
      severity: this.severity,
      retryable: this.retryable,
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      category: 'VALIDATION',
      statusCode: 400,
      severity: 'LOW',
      code: 'VALIDATION_FAILED',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed', context?: Record<string, unknown>) {
    super(message, {
      category: 'AUTHENTICATION',
      statusCode: 401,
      severity: 'MEDIUM',
      code: 'AUTH_FAILED',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden', context?: Record<string, unknown>) {
    super(message, {
      category: 'AUTHORIZATION',
      statusCode: 403,
      severity: 'MEDIUM',
      code: 'FORBIDDEN',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, context?: Record<string, unknown>) {
    super(`${resource} not found`, {
      category: 'NOT_FOUND',
      statusCode: 404,
      severity: 'LOW',
      code: 'NOT_FOUND',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      category: 'CONFLICT',
      statusCode: 409,
      severity: 'LOW',
      code: 'CONFLICT',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', context?: Record<string, unknown>) {
    super(message, {
      category: 'RATE_LIMIT',
      statusCode: 429,
      severity: 'LOW',
      code: 'RATE_LIMITED',
      retryable: true,
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export interface UpstreamErrorOptions {
  readonly upstream: string;
  readonly upstreamCode?: string;
  readonly upstreamStatus?: number;
  readonly upstreamMessage?: string;
  readonly requestSnapshot?: Readonly<Record<string, unknown>>;
  readonly responseSnapshot?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
  readonly severity?: ErrorSeverity;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
}

export class UpstreamError extends AppError {
  public readonly upstream: string;
  public readonly upstreamCode: string | undefined;
  public readonly upstreamStatus: number | undefined;
  public readonly upstreamMessage: string | undefined;
  public readonly requestSnapshot: Readonly<Record<string, unknown>> | undefined;
  public readonly responseSnapshot: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, opts: UpstreamErrorOptions) {
    const baseContext: Record<string, unknown> = {
      ...(opts.context ?? {}),
      upstream: opts.upstream,
    };
    if (opts.upstreamCode !== undefined) baseContext['upstreamCode'] = opts.upstreamCode;
    if (opts.upstreamStatus !== undefined) baseContext['upstreamStatus'] = opts.upstreamStatus;
    if (opts.upstreamMessage !== undefined) baseContext['upstreamMessage'] = opts.upstreamMessage;
    super(message, {
      category: 'PROVIDER',
      statusCode: 502,
      severity: opts.severity ?? 'HIGH',
      code: 'UPSTREAM_ERROR',
      retryable: opts.retryable ?? false,
      context: baseContext,
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
    this.upstream = opts.upstream;
    this.upstreamCode = opts.upstreamCode;
    this.upstreamStatus = opts.upstreamStatus;
    this.upstreamMessage = opts.upstreamMessage;
    this.requestSnapshot = opts.requestSnapshot
      ? Object.freeze({ ...opts.requestSnapshot })
      : undefined;
    this.responseSnapshot = opts.responseSnapshot
      ? Object.freeze({ ...opts.responseSnapshot })
      : undefined;
  }
}

export class NetworkError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, {
      category: 'NETWORK',
      statusCode: 502,
      severity: 'MEDIUM',
      code: 'NETWORK_ERROR',
      retryable: true,
      ...(context !== undefined ? { context } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown, context?: Record<string, unknown>) {
    super(message, {
      category: 'DATABASE',
      statusCode: 500,
      severity: 'HIGH',
      code: 'DATABASE_ERROR',
      ...(context !== undefined ? { context } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class WebhookError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      category: 'WEBHOOK',
      statusCode: 400,
      severity: 'MEDIUM',
      code: 'WEBHOOK_INVALID',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message = 'Insufficient balance', context?: Record<string, unknown>) {
    super(message, {
      category: 'VALIDATION',
      statusCode: 402,
      severity: 'LOW',
      code: 'INSUFFICIENT_BALANCE',
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError ||
  (typeof value === 'object' &&
    value !== null &&
    (value as { isOperational?: boolean }).isOperational === true);
