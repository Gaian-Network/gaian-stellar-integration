import fp from 'fastify-plugin';

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';

export interface PaginationMeta {
  readonly page?: number;
  readonly pageSize?: number;
  readonly total?: number;
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
}

declare module 'fastify' {
  interface FastifyReply {
    ok(data: unknown, pagination?: PaginationMeta): FastifyReply;
  }
}

const replyEnvelopeImpl: FastifyPluginAsync = (app: FastifyInstance) => {
  app.decorateReply('ok', function okEnvelope(
    this: FastifyReply,
    data: unknown,
    pagination?: PaginationMeta,
  ): FastifyReply {
    return this.send({
      success: true,
      requestId: this.request.id,
      data,
      ...(pagination ? { pagination } : {}),
    });
  });
  return Promise.resolve();
};

export const replyEnvelopePlugin = fp(replyEnvelopeImpl, { name: 'reply-envelope' });
