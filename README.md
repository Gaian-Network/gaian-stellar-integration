# Gaian Network — Stellar Integration

A payment API that bridges **Stellar USDC** to local fiat disbursement across Southeast Asia. This repository demonstrates how Gaian Network uses the Stellar blockchain as the settlement layer for real-time cross-border payments.

## Overview

Gaian Network enables merchants and end-users to pay local fiat bills (QR payments, bank transfers) by sending USDC on the Stellar network. The integration handles:

- **QR code parsing** — decode EMVCo / VietQR payment QR codes to extract fiat amount and recipient
- **Quote generation** — compute the exact USDC amount required at current exchange rates
- **Transaction encoding** — build a Stellar XDR payment transaction for the user to sign
- **On-chain verification** — confirm USDC received on Stellar Horizon before releasing fiat

## Why Stellar

- **Low fees** — sub-cent transaction costs make small-value retail payments viable
- **Fast finality** — 3–5 second settlement vs. multi-day traditional remittance
- **USDC native** — Circle's USDC on Stellar is the settlement asset; no wrapping or bridging
- **Horizon API** — simple, reliable REST interface for transaction submission and verification

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

Delivered under Stellar Instaward 2 (payment reconciliation engine).
