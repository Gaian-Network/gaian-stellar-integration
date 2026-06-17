import { createHash } from 'node:crypto';

import { AuthenticationError, getRequestContext, setRequestContext } from '@gaian-stellar-integration/config';
import { tenantApiKeys, tenants } from '@gaian-stellar-integration/db';
import { and, eq } from 'drizzle-orm';
import fp from 'fastify-plugin';

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';

const AUTH_HEADER = 'authorization';
const API_KEY_HEADER = 'x-api-key';
const TENANT_ID_HEADER = 'x-tenant-id';

const TENANT_COLUMNS = {
  tenantId: tenants.id,
  tenantName: tenants.name,
  isActive: tenants.isActive,
  isBlocked: tenants.isBlocked,
  isKyb: tenants.isKyb,
  prefund: tenants.prefund,
  customFeeBps: tenants.customFeeBps,
  country: tenants.country,
  email: tenants.email,
} as const;

const hashApiKey = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');

const extractApiKey = (req: FastifyRequest): string | undefined => {
  const direct = req.headers[API_KEY_HEADER];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const auth = req.headers[AUTH_HEADER];
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match?.[1]) return match[1];
  }
  return undefined;
};

// Enrich the request's ALS context with the resolved tenant so every log line
// (via the logger mixin) carries tenantId, without re-deriving the requestId.
const bindTenantContext = (req: FastifyRequest): void => {
  const tenantId = req.tenant?.id;
  if (tenantId === undefined) return;
  const requestId = getRequestContext()?.requestId ?? String(req.id);
  setRequestContext({ requestId, tenantId });
};

const authPluginImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest('tenant', undefined);
  app.decorateRequest('apiKey', undefined);

  app.decorate('requireTenant', async (req: FastifyRequest): Promise<void> => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      throw new AuthenticationError('missing api key');
    }

    const hashed = hashApiKey(apiKey);
    const row = await app.db
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        isActive: tenants.isActive,
        isBlocked: tenants.isBlocked,
        isKyb: tenants.isKyb,
        prefund: tenants.prefund,
        customFeeBps: tenants.customFeeBps,
        country: tenants.country,
        email: tenants.email,
        revoked: tenantApiKeys.isRevoked,
      })
      .from(tenantApiKeys)
      .innerJoin(tenants, eq(tenantApiKeys.tenantId, tenants.id))
      .where(and(eq(tenantApiKeys.apiKey, hashed), eq(tenantApiKeys.isRevoked, false)))
      .limit(1);

    const found = row[0];
    if (!found || found.revoked) {
      throw new AuthenticationError('invalid api key');
    }
    if (!found.isActive || found.isBlocked) {
      throw new AuthenticationError('tenant disabled');
    }

    req.apiKey = apiKey;
    req.tenant = {
      id: found.tenantId,
      name: found.tenantName,
      isKyb: found.isKyb,
      prefund: found.prefund,
      customFeeBps: found.customFeeBps !== null ? Number(found.customFeeBps) : null,
      country: found.country,
      email: found.email,
    };
    bindTenantContext(req);
  });

  // V2 auth model: no api key. The tenant is taken directly from the
  // `x-tenant-id` header (numeric tenants.id). This trusts an upstream
  // authenticated gateway — there is NO per-caller ownership check, so V2 must
  // only be reachable from a trusted network. V1 keeps the api-key flow above.
  // Per-tenant lazy cache for the V2 header flow. Tenant rows change rarely but
  // every V2 request reads one, so the DB lookup dominates the hot path. Cache
  // is in-memory (per app instance) and closure-scoped so test instances don't
  // share state. Only gate-passed tenants are cached; disabled/not-found always
  // re-query. TRADE-OFF: there is no invalidation hook, so a tenant disabled in
  // the DB keeps being served until its entry expires (TENANT_CACHE_TTL_MS).
  const TENANT_CACHE_TTL_MS = 300_000;
  type TenantContext = NonNullable<FastifyRequest['tenant']>;
  const tenantCache = new Map<number, { value: TenantContext; expiresAt: number }>();
  const tenantInflight = new Map<number, Promise<TenantContext>>();

  const loadTenant = async (tenantId: number): Promise<TenantContext> => {
    const row = await app.db
      .select(TENANT_COLUMNS)
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const found = row[0];
    if (!found) {
      throw new AuthenticationError('tenant not found');
    }
    if (!found.isActive || found.isBlocked) {
      throw new AuthenticationError('tenant disabled');
    }

    return {
      id: found.tenantId,
      name: found.tenantName,
      isKyb: found.isKyb,
      prefund: found.prefund,
      customFeeBps: found.customFeeBps !== null ? Number(found.customFeeBps) : null,
      country: found.country,
      email: found.email,
    };
  };

  app.decorate('requireTenantHeader', async (req: FastifyRequest): Promise<void> => {
    const raw = req.headers[TENANT_ID_HEADER];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!value) {
      throw new AuthenticationError('missing x-tenant-id');
    }
    const tenantId = Number(value);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new AuthenticationError('invalid x-tenant-id');
    }

    const cached = tenantCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      req.tenant = cached.value;
      bindTenantContext(req);
      return;
    }

    // Single-flight: collapse a burst of same-tenant misses into one query.
    let inflight = tenantInflight.get(tenantId);
    if (!inflight) {
      inflight = loadTenant(tenantId).finally(() => tenantInflight.delete(tenantId));
      tenantInflight.set(tenantId, inflight);
    }
    const resolved = await inflight;
    tenantCache.set(tenantId, { value: resolved, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
    req.tenant = resolved;
    bindTenantContext(req);
  });
};

export const authPlugin = fp(authPluginImpl, { name: 'auth' });

