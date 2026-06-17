import { ValidationError } from '@gaian-stellar-integration/config';
import type { DecodedQrInfo } from '@gaian-stellar-integration/core';

// Minimal EMVCo TLV parser (each field: 2-char ID + 2-char decimal length + value).
const parseTlv = (data: string): Map<string, string> => {
  const result = new Map<string, string>();
  let i = 0;
  while (i + 4 <= data.length) {
    const id = data.slice(i, i + 2);
    const len = parseInt(data.slice(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > data.length) break;
    result.set(id, data.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return result;
};

// VietQR / NAPAS: merchant account info (IDs 26–51) with GUID starting
// "A000000727" carries BIN ("01") and account number ("02").
const NAPAS_GUID_PREFIX = 'A000000727';

const parseVietQr = (qrString: string): Partial<DecodedQrInfo> | null => {
  const fields = parseTlv(qrString);
  for (let id = 26; id <= 51; id++) {
    const raw = fields.get(id.toString().padStart(2, '0'));
    if (!raw) continue;
    const sub = parseTlv(raw);
    const guid = sub.get('00') ?? '';
    if (!guid.startsWith(NAPAS_GUID_PREFIX)) continue;
    const bankBin = sub.get('01') ?? '';
    const accountNumber = sub.get('02') ?? '';
    const amountStr = fields.get('54');
    const currencyCode = fields.get('53');
    const country = fields.get('58') ?? 'VN';
    return {
      isValid: true,
      encodedString: qrString,
      country,
      qrProvider: 'vietqr',
      bankBin,
      accountNumber,
      beneficiaryName: fields.get('59') ?? 'UNKNOWN',
      ...(amountStr ? { amount: parseFloat(amountStr) } : {}),
      ...(currencyCode === '704' ? { currency: 'VND' } : {}),
      detailedQrInfo: { bankBin, accountNumber },
    };
  }
  return null;
};

// Detect QR format and extract recipient info locally.
const parseLocal = (qrString: string, countryHint?: string): DecodedQrInfo => {
  const vietQr = parseVietQr(qrString);
  if (vietQr?.bankBin) return vietQr as DecodedQrInfo;

  // Generic EMVCo: best-effort extraction (merchant name, country, amount).
  const fields = parseTlv(qrString);
  const country = fields.get('58') ?? countryHint ?? 'VN';
  const amountStr = fields.get('54');
  return {
    isValid: !!fields.get('58'),
    encodedString: qrString,
    country,
    qrProvider: 'emvco',
    bankBin: '',
    accountNumber: '',
    beneficiaryName: fields.get('59') ?? 'UNKNOWN',
    ...(amountStr ? { amount: parseFloat(amountStr) } : {}),
    detailedQrInfo: { raw: qrString },
  };
};

export interface QrService {
  parse(qrString: string, countryHint?: string): Promise<DecodedQrInfo>;
}

export const createQrService = (): QrService => ({
  async parse(qrString, countryHint): Promise<DecodedQrInfo> {
    if (!qrString || qrString.length < 4) {
      throw new ValidationError('QR string too short');
    }
    return parseLocal(qrString, countryHint);
  },
});
