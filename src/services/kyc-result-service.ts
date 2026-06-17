import { userKycResult, type AppDb } from '@gaian-stellar-integration/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

export interface KycResultView {
  readonly id: number;
  readonly userId: number;
  readonly provider: string | null;
  readonly kycStatus: string | null;
  readonly rejectReason: string | null;
  readonly userProviderId: string | null;
  readonly createdAt: Date;
}

const VERIFIED_STATUSES = ['verified', 'approved'];

export interface KycResultService {
  findVerifiedByUserIdAndProviders(
    userId: number,
    providers: readonly string[],
  ): Promise<KycResultView | null>;
  findByUserIdAndProvider(
    userId: number,
    provider: string,
  ): Promise<KycResultView | null>;
}

const mapRow = (row: typeof userKycResult.$inferSelect): KycResultView => ({
  id: row.id,
  userId: row.userId,
  provider: row.provider,
  kycStatus: row.kycStatus,
  rejectReason: row.rejectReason,
  userProviderId: row.userProviderId,
  createdAt: row.createdAt,
});

export const createKycResultService = (db: AppDb): KycResultService => ({
  async findVerifiedByUserIdAndProviders(userId, providers) {
    if (providers.length === 0) return null;
    const rows = await db
      .select()
      .from(userKycResult)
      .where(
        and(
          eq(userKycResult.userId, userId),
          inArray(userKycResult.provider, [...providers]),
          inArray(sql`lower(${userKycResult.kycStatus})`, VERIFIED_STATUSES),
          isNull(userKycResult.deletedAt),
        ),
      )
      .orderBy(desc(userKycResult.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async findByUserIdAndProvider(userId, provider) {
    const rows = await db
      .select()
      .from(userKycResult)
      .where(
        and(
          eq(userKycResult.userId, userId),
          eq(userKycResult.provider, provider),
          isNull(userKycResult.deletedAt),
        ),
      )
      .orderBy(desc(userKycResult.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? mapRow(row) : null;
  },
});
