import { logger } from '@gaian-stellar-integration/config';

export interface PayoutRecipient {
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly beneficiaryName: string;
  readonly country: string;
}

export interface PayoutInput {
  readonly orderId: string;
  readonly fiatAmount: string;
  readonly fiatCurrency: string;
  readonly recipient: PayoutRecipient;
}

export interface PayoutService {
  dispatch(input: PayoutInput): Promise<void>;
}

// Stub implementation — replace with your fiat disbursement provider.
export const createPayoutStub = (): PayoutService => ({
  async dispatch(input) {
    logger.info(
      { orderId: input.orderId, fiatCurrency: input.fiatCurrency, fiatAmount: input.fiatAmount },
      'payout: stub dispatch — wire up a real provider here',
    );
  },
});
