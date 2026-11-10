# Gaian Network: Stellar Integration

A payment API that bridges **Stellar USDC** to local fiat disbursement across Southeast Asia. This repository demonstrates how Gaian Network uses the Stellar blockchain as the settlement layer for real-time cross-border payments.

## Overview

Gaian Network enables merchants and end-users to pay local fiat bills (QR payments, bank transfers) by sending USDC on the Stellar network. The integration handles:

- **QR code parsing**: decode EMVCo / VietQR payment QR codes to extract fiat amount and recipient
- **Quote generation**: compute the exact USDC amount required at current exchange rates
- **Transaction encoding**: build a Stellar XDR transaction for the user to sign, either a USDC payment or an XLM path payment that delivers the same USDC
- **On-chain verification**: confirm USDC received on Stellar Horizon before releasing fiat

## Why Stellar

- **Low fees**: sub-cent transaction costs make small-value retail payments viable
- **Fast finality**: 3 to 5 second settlement vs. multi-day traditional remittance
- **USDC native**: Circle's USDC on Stellar is the settlement asset, with no wrapping or bridging
- **Horizon API**: a REST interface for transaction submission and verification

## Payment flow

```
User app                    Gaian API              Stellar Network
   │                            │                        │
   │  POST /quote (QR code)     │                        │
   │──────────────────────────▶ │                        │
   │  ◀── quoteId + XDR         │                        │
   │                            │                        │
   │  Sign XDR with wallet      │                        │
   │  Submit to Stellar         │──────────────────────▶ │
   │                            │                        │ (USDC transferred)
   │  POST /orders/:id/verify   │                        │
   │──────────────────────────▶ │  Verify on Horizon ──▶ │
   │                            │  ◀── confirmed         │
   │  ◀── status: completed     │                        │
   │                            │  Fiat disbursement     │
   │                            │  (local payment rail)  │
```

## Order reconciliation by memo

Every Stellar order pays into one shared Gaian deposit account. Amount and sender alone cannot tell two orders apart, so each order carries a memo.

- **Memo** = the last 12 hex characters of the order id, written as `MEMO_TEXT`. Helper: `stellarMemoFromOrderId` in `packages/chains/src/stellar.ts`.
- **Build**: `POST /orders` embeds the memo in the XDR the wallet signs and returns it in the response (`memo`).
- **Verify**: `POST /orders/:id/verify` loads the transaction from Horizon and rejects it when the memo differs from the one issued for the order (`reason: "memo does not match expected order memo"`), in addition to the amount, asset and address checks. See `verify()` in `packages/chains/src/stellar.ts`.
- **Status API**: `GET /orders/:id` returns the order status, deposit address and transaction hash for partner polling. Tenant-scoped through the API key plugin in `src/plugins/auth.ts`.
- **Webhooks**: every status transition is handed to Gaian's webhook service (`src/services/webhook-event-publisher.ts`), which stores tenant endpoints, signs deliveries (HMAC) and retries. Event type `order.status.updated`, idempotency key per transition.

Payments carrying an order memo settle into Gaian's Stellar deposit account and are matched to their order by the flow above.

## Accepted assets

A buyer can fund a Stellar order with either asset. The deposit account always receives USDC, and the payout amount is always the USDC amount of the quote.

| Asset | How the buyer pays | What the deposit account receives |
|---|---|---|
| USDC | A plain payment of the exact USDC amount | The exact USDC amount |
| XLM | A path payment (`path_payment_strict_receive`) that spends XLM | The exact USDC amount, swapped on the Stellar DEX |

## Pay with XLM

Send `sourceAsset: "XLM"` in `POST /orders` for a Stellar USDC order. Omit it, or send `"USDC"`, for the plain USDC payment. The field is rejected for any other order.

1. **Quote**: `POST /quote` is unchanged. The quote fixes the USDC amount and the payout.
2. **Order**: `POST /orders` with `sourceAsset: "XLM"` asks Horizon's strict-receive path search for the live XLM price of that exact USDC amount. It returns the XDR plus `sourceAsset` (`"XLM"`) and `sendMax`. If Horizon finds no path, the request fails and no order is created.
3. **Slippage cap**: `sendMax` is the live quote plus 1%, rounded up to the stroop. The wallet signs for at most `sendMax` XLM. The cap is fixed and is not set per tenant.
4. **Sign and submit**: the buyer signs the XDR and submits it to Stellar. The USDC leg is exact, so the deposit account never receives less than the quote.
5. **Verify**: `POST /orders/:id/verify` reads the transaction from Horizon. A path payment is checked like a plain payment: destination account, USDC asset and issuer, order memo and payer address must match, and the USDC delivered must be at least the quoted amount. A path payment delivers exactly the quoted amount by construction.

## Order expiry

Every Stellar transaction is built with the order expiry as its maximum time (`timebounds.maxTime`), for both USDC and XLM payments. A signature that arrives after the order closed is rejected by the network with `tx_too_late`, so it cannot pay a closed order.

`POST /orders/:id/verify` marks an order `expired` only when all of the following hold:

- the hash is the one Gaian built for the order,
- the maximum time plus a 60 second grace has passed,
- Horizon has ingested a ledger that closed after that time and still does not know the hash,
- the payer account shows no successful transaction with the order memo.

Any doubt (a Horizon error, a busy payer history) keeps the order retryable and returns `pending`. When an order does expire, the reply is `statusLabel: "failed"`, `message: "order expired"` and `reasonCode: "ORDER_EXPIRED"`. The same answer is returned if the wallet asks again with the same hash. Verify reads the deposit address, payer, amount and payout recipient from the order records when the cached quote has already expired, so the answer does not depend on how long the quote key lives. The status change is a compare-and-set from `awaiting_deposit`, so a payment verified at the same moment is never overwritten.

### Known gap: a late payment the wallet built itself

The time bound protects only the transactions Gaian builds. A buyer can still send USDC with the order memo straight to the deposit account after the order expired. Verify then answers 409, because the order is no longer awaiting a deposit, so nothing is paid out and that USDC has to be refunded by hand. This gap is accepted and out of scope for the expiry work.

## Run locally

Set `DATABASE_URL` and `REDIS_URL` (in `.env` or the shell), then run `pnpm dev`. The server listens on `HOST:PORT` (default `0.0.0.0:3000`). Routes are under `/api/v2`.

## Tests

`pnpm test` runs the adapter and route tests with the Node test runner. A boot test builds the whole app and checks that every route schema compiles. They cover plain USDC payments, XLM path payments (cheapest path, 1% cap, rounding up), the transaction time bound, verification of plain and path payments (wrong issuer, destination, amount, memo or payer), and the order expiry rules above. Horizon is mocked, so the tests need no network.

Delivered under Stellar Instaward 2 (payment reconciliation engine).
