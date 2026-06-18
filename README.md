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

