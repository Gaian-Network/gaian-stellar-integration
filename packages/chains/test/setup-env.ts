// The config package validates env at import time. Unit tests never reach a
// database, Redis or a live Horizon, so placeholder values are enough; each test
// mocks the Horizon calls it needs.
process.env['DATABASE_URL'] ??= 'postgres://test@127.0.0.1:1/test';
process.env['REDIS_URL'] ??= 'redis://127.0.0.1:1';
process.env['STELLAR_HORIZON_URL'] = 'https://horizon-testnet.stellar.org';
process.env['STELLAR_NETWORK_PASSPHRASE'] = 'Test SDF Network ; September 2015';
process.env['STELLAR_USDC_CODE'] = 'USDC';
process.env['STELLAR_USDC_ISSUER'] = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
process.env['LOG_LEVEL'] ??= 'error';
