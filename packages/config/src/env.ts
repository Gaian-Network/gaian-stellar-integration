import { cleanEnv, str, port, num, bool, url, makeValidator } from 'envalid';

const nodeEnvValidator = makeValidator<'development' | 'production' | 'test'>((input) => {
  if (input === 'development' || input === 'production' || input === 'test') return input;
  throw new Error(`Invalid NODE_ENV: ${input}`);
});

const environmentValidator = makeValidator<'sandbox' | 'production'>((input) => {
  if (input === 'sandbox' || input === 'production') return input;
  throw new Error(`Invalid ENVIRONMENT: ${input} (expected 'sandbox' or 'production')`);
});

const RAW_ENVIRONMENT: 'sandbox' | 'production' =
  process.env['ENVIRONMENT'] === 'sandbox' ? 'sandbox' : 'production';

const setDefault = (key: string, value: string): void => {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
};

if (RAW_ENVIRONMENT === 'sandbox') {
  // Stellar Testnet (Horizon test server + Circle test USDC issuer).
  setDefault('STELLAR_HORIZON_URL', 'https://horizon-testnet.stellar.org');
  setDefault('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015');
  setDefault('STELLAR_USDC_ISSUER', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
}

const logLevelValidator = makeValidator<'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'>(
  (input) => {
    const allowed = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
    if ((allowed as readonly string[]).includes(input))
      return input as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
    throw new Error(`Invalid LOG_LEVEL: ${input}`);
  },
);

// Exchange rates: fiat units per 1 USDC. Format: `CUR:rate,CUR:rate,...`
// Example: `FX_RATES="VND:25000,PHP:56,BRL:5"`
const fxRatesValidator = makeValidator<Record<string, number>>((input) => {
  const map: Record<string, number> = {};
  for (const pair of input.split(',')) {
    if (!pair.trim()) continue;
    const [cur, val] = pair.split(':');
    const n = Number(val);
    if (!cur || !val || !Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid FX_RATES entry: "${pair}"`);
    }
    map[cur.trim().toUpperCase()] = n;
  }
  if (Object.keys(map).length === 0) throw new Error('FX_RATES is empty');
  return map;
});

export const env = cleanEnv(process.env, {
  NODE_ENV: nodeEnvValidator({ default: 'development' }),
  ENVIRONMENT: environmentValidator({ default: 'production' }),

  // Exchange rates — fiat units per 1 USDC.
  FX_RATES: fxRatesValidator({
    default: { VND: 25_000, PHP: 56, BRL: 5, THB: 36, KHR: 4_100, USD: 1 },
  }),

  SERVICE_NAME: str({ default: 'stellar-integration' }),
  LOG_LEVEL: logLevelValidator({ default: 'info' }),
  HOST: str({ default: '0.0.0.0' }),
  PORT: port({ default: 3000 }),

  DATABASE_URL: url(),
  DATABASE_POOL_MAX: num({ default: 20 }),
  DATABASE_POOL_IDLE_MS: num({ default: 10_000 }),
  DATABASE_CONNECTION_TIMEOUT_MS: num({ default: 5_000 }),
  DATABASE_SSL: bool({ default: false }),

  REDIS_URL: url(),

  ORDER_EXPIRATION_MINUTES: num({ default: 5 }),
  QUOTE_TTL_SECONDS: num({ default: 120 }),

  // Fee charged on top of the crypto equivalent of the fiat payment.
  FEE_BPS: num({ default: 70 }),
  MIN_FEE_USD: num({ default: 0.1 }),

  SENTRY_DSN: str({ default: '' }),
  SENTRY_TRACES_SAMPLE_RATE: num({ default: 0.0 }),

  TELEGRAM_ENABLED: bool({ default: false }),
  TELEGRAM_BOT_TOKEN: str({ default: '' }),
  TELEGRAM_CHAT_ID: str({ default: '' }),

  DEPOSIT_ADDRESS_STELLAR_USDC: str({ default: '' }),

  // gaian-webhook: central webhook-dispatch service. This API POSTs every order
  // status transition to its /internal/events; that service stores tenant
  // endpoints, signs deliveries (HMAC) and retries to the tenant.
  GAIAN_WEBHOOK_ENABLED: bool({ default: false }),
  GAIAN_WEBHOOK_URL: str({ default: '' }),
  GAIAN_WEBHOOK_TIMEOUT_MS: num({ default: 5_000 }),
  GAIAN_WEBHOOK_RETRY_ATTEMPTS: num({ default: 2 }),

  STELLAR_HORIZON_URL: url({ default: 'https://horizon.stellar.org' }),
  STELLAR_NETWORK_PASSPHRASE: str({
    default: 'Public Global Stellar Network ; September 2015',
  }),
  STELLAR_USDC_ISSUER: str({
    default: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  }),
  STELLAR_USDC_CODE: str({ default: 'USDC' }),
});

export type AppEnv = typeof env;

export const isProduction = (): boolean => env.NODE_ENV === 'production';
export const isTest = (): boolean => env.NODE_ENV === 'test';
export const isDevelopment = (): boolean => env.NODE_ENV === 'development';
export const isSandboxEnvironment = (): boolean => env.ENVIRONMENT === 'sandbox';
