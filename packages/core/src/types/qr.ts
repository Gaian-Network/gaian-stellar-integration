import { z } from 'zod';

export const decodedQrInfoSchema = z
  .object({
    isValid: z.boolean(),
    encodedString: z.string(),
    country: z.string(),
    qrProvider: z.string(),
    bankBin: z.string(),
    accountNumber: z.string(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    purpose: z.string().optional(),
    beneficiaryName: z.string(),
    detailedQrInfo: z.unknown(),
  })
  .passthrough();

export type DecodedQrInfo = z.infer<typeof decodedQrInfoSchema>;
