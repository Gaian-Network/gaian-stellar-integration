import {
  users,
  walletAddresses,
  wallets,
  userWalletTenant,
  type AppDb,
} from '@gaian-stellar-integration/db';
import { and, desc, eq } from 'drizzle-orm';

export interface UserView {
  readonly id: number;
  readonly userId: string | null;
  readonly email: string | null;
  readonly walletAddress: string;
  readonly walletChain: string | null;
  readonly tenantId: number | null;
}

export interface UserService {
  findByWalletAddressAndTenantId(walletAddress: string, tenantId: number): Promise<UserView | null>;
  findByUserIdAndTenantId(userId: string, tenantId: number): Promise<UserView | null>;
  findByEmailAndTenantId(email: string, tenantId: number): Promise<UserView | null>;
}

const USER_COLUMNS = {
  id: users.id,
  userId: users.userId,
  email: users.email,
  address: walletAddresses.address,
  chain: walletAddresses.chain,
  tenantId: userWalletTenant.tenantId,
} as const;

const mapRow = (row: {
  id: number;
  userId: string | null;
  email: string | null;
  address: string;
  chain: string | null;
  tenantId: number | null;
}): UserView => ({
  id: row.id,
  userId: row.userId,
  email: row.email,
  walletAddress: row.address,
  walletChain: row.chain,
  tenantId: row.tenantId,
});

export const createUserService = (db: AppDb): UserService => ({
  async findByWalletAddressAndTenantId(walletAddress, tenantId) {
    const rows = await db
      .select(USER_COLUMNS)
      .from(users)
      .innerJoin(userWalletTenant, eq(userWalletTenant.userId, users.id))
      .innerJoin(wallets, eq(wallets.userId, users.id))
      .innerJoin(walletAddresses, eq(walletAddresses.walletId, wallets.id))
      .where(and(eq(walletAddresses.address, walletAddress), eq(userWalletTenant.tenantId, tenantId)))
      .orderBy(desc(users.id))
      .limit(1);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findByUserIdAndTenantId(userId, tenantId) {
    const rows = await db
      .select(USER_COLUMNS)
      .from(users)
      .innerJoin(userWalletTenant, eq(userWalletTenant.userId, users.id))
      .innerJoin(wallets, eq(wallets.userId, users.id))
      .innerJoin(walletAddresses, eq(walletAddresses.walletId, wallets.id))
      .where(and(eq(users.userId, userId), eq(userWalletTenant.tenantId, tenantId)))
      .orderBy(desc(users.id))
      .limit(1);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findByEmailAndTenantId(email, tenantId) {
    const rows = await db
      .select(USER_COLUMNS)
      .from(users)
      .innerJoin(userWalletTenant, eq(userWalletTenant.userId, users.id))
      .innerJoin(wallets, eq(wallets.userId, users.id))
      .innerJoin(walletAddresses, eq(walletAddresses.walletId, wallets.id))
      .where(and(eq(users.email, email), eq(userWalletTenant.tenantId, tenantId)))
      .orderBy(desc(users.id))
      .limit(1);
    return rows[0] ? mapRow(rows[0]) : null;
  },
});
