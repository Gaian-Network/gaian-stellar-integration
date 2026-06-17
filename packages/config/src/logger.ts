import { pino, stdSerializers, stdTimeFunctions, type Logger, type LoggerOptions } from 'pino';

import { env, isProduction } from './env.js';
import { getRequestContext } from './request-context.js';

const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-event-signature"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.privateKey',
  '*.signature',
  '*.webhookSecret',
  '*.clientSecret',
  '*.authorization',
  'context.password',
  'context.secret',
  'context.token',
  'context.apiKey',
  'context.privateKey',
  'context.signature',
];

const buildOptions = (): LoggerOptions => {
  const base: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { service: env.SERVICE_NAME, env: env.NODE_ENV },
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]', remove: false },
    // Stamp correlation fields from AsyncLocalStorage onto EVERY log line —
    // shared-logger calls included — so a single payment is greppable end to end
    // by requestId. An explicit field on the log object still wins over these.
    mixin() {
      const ctx = getRequestContext();
      if (!ctx) return {};
      return {
        requestId: ctx.requestId,
        ...(ctx.tenantId !== undefined ? { tenantId: ctx.tenantId } : {}),
        ...(ctx.orderId !== undefined ? { orderId: ctx.orderId } : {}),
      };
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: {
      err: stdSerializers.err,
      error: stdSerializers.err,
    },
  };

  if (!isProduction()) {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    };
  }
  return base;
};

export const logger: Logger = pino(buildOptions());

export const createChildLogger = (bindings: Record<string, unknown>): Logger =>
  logger.child(bindings);

export type { Logger };
