// Must be the first import of a route test: the config package validates these at
// import time. The values point at local ports nothing listens on. No test that
// uses them opens a connection, because the stores are stubbed.
process.env['DATABASE_URL'] ??= 'postgres://route-test:route-test@127.0.0.1:1/route_test';
process.env['REDIS_URL'] ??= 'redis://127.0.0.1:1';
process.env['LOG_LEVEL'] ??= 'error';
