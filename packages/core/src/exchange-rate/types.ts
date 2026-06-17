import { z } from 'zod';

export const fiatCountrySchema = z.enum(['VN', 'PH', 'BR', 'TH', 'KH']);
export type FiatCountry = z.infer<typeof fiatCountrySchema>;

export const FIAT_CURRENCY_BY_COUNTRY: Record<FiatCountry, string> = {
  VN: 'VND',
  PH: 'PHP',
  BR: 'BRL',
  TH: 'THB',
  KH: 'KHR',
};
