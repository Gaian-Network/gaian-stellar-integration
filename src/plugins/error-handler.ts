import { isAppError, logger } from '@gaian-stellar-integration/config';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';

// Duck-typed ZodError check. The schema package (`@gaian-stellar-integration/core`) may
// pull in a different `zod` instance than this app's direct dep, in which case
// `instanceof ZodError` returns false even on a real validation failure. Fall
// back to name + issues[] shape so V1 callers still see a clean 400 envelope.
const isZodError = (err: unknown): err is ZodError =>
  err instanceof ZodError ||
  (typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ZodError' &&
    Array.isArray((err as { issues?: unknown }).issues));

// Modern envelope applies to V2 routes. V1 stays frozen on legacy shape.
const isModernPath = (url: string | undefined): boolean =>
  typeof url === 'string' && url.startsWith('/api/v2');

const scrubProviderTokens = (msg: string): string => msg;

const errorHandlerPluginImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    const v2 = isModernPath(req.url);

    if (isZodError(err)) {
      if (v2) {
        reply.status(400).send({
          success: false,
          requestId: req.id,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid request',
            details: { issues: err.issues },
          },
        });
      } else {
        reply.status(400).send({
          error: 'Bad Request',
          message: scrubProviderTokens(err.issues[0]?.message ?? 'Invalid request'),
        });
      }
      return;
    }

    if (isAppError(err)) {
      logger.warn(
        { code: err.code, category: err.category, requestId: req.id },
        err.message,
      );
      if (v2) {
        reply.status(err.statusCode).send({
          success: false,
          requestId: req.id,
          error: {
            code: err.code,
            message: scrubProviderTokens(err.message),
          },
        });
      } else {
        reply.status(err.statusCode).send({
          error: err.code,
          message: scrubProviderTokens(err.message),
        });
      }
      return;
    }

    const fastifyErr = err as FastifyError;
    if (fastifyErr.statusCode !== undefined && fastifyErr.statusCode < 500) {
      if (v2) {
        reply.status(fastifyErr.statusCode).send({
          success: false,
          requestId: req.id,
          error: {
            code: fastifyErr.code ?? 'CLIENT_ERROR',
            message: scrubProviderTokens(fastifyErr.message),
          },
        });
      } else {
        reply.status(fastifyErr.statusCode).send({
          error: fastifyErr.code ?? 'Bad Request',
          message: scrubProviderTokens(fastifyErr.message),
        });
      }
      return;
    }

    logger.error({ err, requestId: req.id }, 'unhandled error');
    if (v2) {
      reply.status(500).send({
        success: false,
        requestId: req.id,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    } else {
      reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Internal server error',
      });
    }
  });
};

export const errorHandlerPlugin = fp(errorHandlerPluginImpl, { name: 'error-handler' });
