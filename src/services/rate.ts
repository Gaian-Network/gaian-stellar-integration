import { env, ValidationError } from '@gaian-stellar-integration/config';
import { FIAT_CURRENCY_BY_COUNTRY, type FiatCountry } from '@gaian-stellar-integration/core';

// Rates are fiat units per 1 USDC. Configure via FX_RATES env var.
export const getExchangeRate = (country: FiatCountry): { fiatPerCrypto: number; fiatCurrency: string } => {
  const fiatCurrency = FIAT_CURRENCY_BY_COUNTRY[country];
  const rate = env.FX_RATES[fiatCurrency];
  if (!rate || rate <= 0) {
    throw new ValidationError(`no exchange rate configured for ${fiatCurrency}`);
  }
  return { fiatPerCrypto: rate, fiatCurrency };
};
