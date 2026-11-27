# Gaian stablecoin inflow: wallet list and query

This file lets anyone check Gaian's on-chain inflow without trusting our dashboard. It lists every wallet the public Dune dashboard counts, and the exact SQL behind it.

- Dashboard: https://dune.com/kelvin_truong/gaian-stablecoin-inflow-by-month
- Result on 9 November 2026: about $740,821 received from 1 January to 9 November 2026, in 12,061 transfers.
- To check it yourself, paste the SQL below into a new query on any Dune account and run it.

## What is counted

- Base: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) sent to a partner prepayment wallet.
- BNB Chain: USDT (`0x55d398326f99059fF775485246999027B3197955`) sent to a partner prepayment wallet.
- Solana: USDC and USDT sent to a partner prepayment wallet or to a Gaian settlement wallet, where users pay per order.
- Tron: USDT (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`) sent to a partner prepayment wallet.
- Each token is counted at 1 USD. Transfers between two listed wallets on the same chain are left out, so internal moves are not counted twice. Our test wallets are not listed.

Partners are labelled by letter, not by name. Some partners use more than one wallet, and the list includes partners that are no longer active, so the number of letters is not the number of live partners.

## Wallets

| Chain | Label | Address |
|---|---|---|
| Base | Partner A | [0x1B0D7d0AE87238c0A22fE3F1aFC53091ea0397e5](https://basescan.org/address/0x1B0D7d0AE87238c0A22fE3F1aFC53091ea0397e5) |
| Base | Partner B | [0x29F3C4A365e38780F3E3f27dA3871d4Ef740c1f6](https://basescan.org/address/0x29F3C4A365e38780F3E3f27dA3871d4Ef740c1f6) |
| Base | Partner C | [0x1222F27ef574A39081C86932E80A470eE80701D2](https://basescan.org/address/0x1222F27ef574A39081C86932E80A470eE80701D2) |
| Base | Partner D | [0x0d79F733652f0AACf9b1fBff605eebB394A3Ca16](https://basescan.org/address/0x0d79F733652f0AACf9b1fBff605eebB394A3Ca16) |
| Base | Partner E | [0x77d7BD46038857241389003FF2139717Fff71568](https://basescan.org/address/0x77d7BD46038857241389003FF2139717Fff71568) |
| Base | Partner F | [0xa859aA8Fd2c17455Da10B0dFAcb3ea03C38799d3](https://basescan.org/address/0xa859aA8Fd2c17455Da10B0dFAcb3ea03C38799d3) |
| BNB Chain | Partner A | [0x1B0D7d0AE87238c0A22fE3F1aFC53091ea0397e5](https://bscscan.com/address/0x1B0D7d0AE87238c0A22fE3F1aFC53091ea0397e5) |
| BNB Chain | Partner G | [0x71989ad55B123B32D1e5723cc47c0208990f12e8](https://bscscan.com/address/0x71989ad55B123B32D1e5723cc47c0208990f12e8) |
| BNB Chain | Partner H | [0x89FF7F24FD02A75f06Cc6e7CBBa57ff4D6339557](https://bscscan.com/address/0x89FF7F24FD02A75f06Cc6e7CBBa57ff4D6339557) |
| BNB Chain | Partner I | [0xa02FBb3941BDBD9406CF0333f08704f1C16dFc17](https://bscscan.com/address/0xa02FBb3941BDBD9406CF0333f08704f1C16dFc17) |
| Tron | Partner J | [TSGpPNV2WeAvjKcN3RvF76Sa3N7iGcrzfu](https://tronscan.org/#/address/TSGpPNV2WeAvjKcN3RvF76Sa3N7iGcrzfu) |
| Solana | Partner K | [8aEh42noQnZS3kDrrkjBFVGSbz2Sa3Xfop95mnh6mUwd](https://solscan.io/account/8aEh42noQnZS3kDrrkjBFVGSbz2Sa3Xfop95mnh6mUwd) |
| Solana | Gaian settlement wallet 1 (current) | [9qAbEcqmwJb3ENzVuBieituQEGvTMCYZhNUoFgr1XLAx](https://solscan.io/account/9qAbEcqmwJb3ENzVuBieituQEGvTMCYZhNUoFgr1XLAx) |
| Solana | Gaian settlement wallet 2 | [9C1pXosUtDntvUyZTvNJDAqtjK64ueNTqfQ69C6iAmFy](https://solscan.io/account/9C1pXosUtDntvUyZTvNJDAqtjK64ueNTqfQ69C6iAmFy) |
| Solana | Gaian settlement wallet 3 | [FK2ABh32TKMHgZRQKrxAQqopcs8Gm4igPB4s2roUCKJb](https://solscan.io/account/FK2ABh32TKMHgZRQKrxAQqopcs8Gm4igPB4s2roUCKJb) |
| Solana | Gaian settlement wallet 4 | [7Wj9tR9F22RC1SNgx1vieHmngQXcDGjkpTWSrppswGZC](https://solscan.io/account/7Wj9tR9F22RC1SNgx1vieHmngQXcDGjkpTWSrppswGZC) |
| Solana | Gaian settlement wallet 5 | [HYfqpeCvMG51inzmbmoFxw4tT3u7vEnnV7fymfqA5KSN](https://solscan.io/account/HYfqpeCvMG51inzmbmoFxw4tT3u7vEnnV7fymfqA5KSN) |
| Solana | Gaian settlement wallet 6 | [21TCjSBkRN13n2rAarAXkSBGSUQG3Q2EBhwMvPCUZqvN](https://solscan.io/account/21TCjSBkRN13n2rAarAXkSBGSUQG3Q2EBhwMvPCUZqvN) |
| Solana | Gaian settlement wallet 7 | [9YdfcB4hD9xbqVsZjhuNjdcy2LtANMoJxHHBpYPyNCz8](https://solscan.io/account/9YdfcB4hD9xbqVsZjhuNjdcy2LtANMoJxHHBpYPyNCz8) |
| Solana | Gaian settlement wallet 8 | [29gJiXj83z5ZBKmU9gnjYJC7Ry54GqeS7RfnXpQk1dhn](https://solscan.io/account/29gJiXj83z5ZBKmU9gnjYJC7Ry54GqeS7RfnXpQk1dhn) |
| Solana | Gaian settlement wallet 9 | [2gnKNE6B5UXR2UwnM98AeGMcvoHVcB2fJ3VrAxCuFRtn](https://solscan.io/account/2gnKNE6B5UXR2UwnM98AeGMcvoHVcB2fJ3VrAxCuFRtn) |
| Solana | Gaian settlement wallet 10 | [6NjarGHuuVhwXVvHn4n1gQPpWSNhdLLBgTxpU181Kd3n](https://solscan.io/account/6NjarGHuuVhwXVvHn4n1gQPpWSNhdLLBgTxpU181Kd3n) |
| Solana | Gaian settlement wallet 11 | [Bo4KrhRwq5ERW1iNZnp1iuaPQdq6ot74eGWE43dro3Yu](https://solscan.io/account/Bo4KrhRwq5ERW1iNZnp1iuaPQdq6ot74eGWE43dro3Yu) |
| Solana | Gaian settlement wallet 12 | [F5FNpKCeFFSV4jjzUkQGVro1CP9osSSJJVU8VdstdHLP](https://solscan.io/account/F5FNpKCeFFSV4jjzUkQGVro1CP9osSSJJVU8VdstdHLP) |
| Solana | Gaian settlement wallet 13 | [EEA4HdK2VVt8s1GKfaXsLFBkySYdRF61E5DMwdy6VxSj](https://solscan.io/account/EEA4HdK2VVt8s1GKfaXsLFBkySYdRF61E5DMwdy6VxSj) |

## Query (DuneSQL)

The same query feeds the "Monthly inflow (USD) by chain" chart on the dashboard.

```sql
WITH gb AS (SELECT from_hex(substr(a, 3)) AS addr FROM (VALUES
  ('0x1B0D7d0AE87238c0A22fE3F1aFC53091ea0397e5'), ('0x29F3C4A365e38780F3E3f27dA3871d4Ef740c1f6'),
  ('0x1222F27ef574A39081C86932E80A470eE80701D2'), ('0x0d79F733652f0AACf9b1fBff605eebB394A3Ca16'),
  ('0x77d7BD46038857241389003FF2139717Fff71568'), ('0xa859aA8Fd2c17455Da10B0dFAcb3ea03C38799d3')) AS t(a)),
gn AS (SELECT from_hex(substr(a, 3)) AS addr FROM (VALUES
  ('0x71989ad55B123B32D1e5723cc47c0208990f12e8'), ('0x89FF7F24FD02A75f06Cc6e7CBBa57ff4D6339557'),
  ('0xa02FBb3941BDBD9406CF0333f08704f1C16dFc17'), ('0x1B0D7d0AE87238c0A22fE3F1aFC53091ea0397e5')) AS t(a)),
gs AS (SELECT a AS addr FROM (VALUES
  ('8aEh42noQnZS3kDrrkjBFVGSbz2Sa3Xfop95mnh6mUwd'), ('9qAbEcqmwJb3ENzVuBieituQEGvTMCYZhNUoFgr1XLAx'),
  ('9C1pXosUtDntvUyZTvNJDAqtjK64ueNTqfQ69C6iAmFy'), ('FK2ABh32TKMHgZRQKrxAQqopcs8Gm4igPB4s2roUCKJb'),
  ('7Wj9tR9F22RC1SNgx1vieHmngQXcDGjkpTWSrppswGZC'), ('HYfqpeCvMG51inzmbmoFxw4tT3u7vEnnV7fymfqA5KSN'),
  ('21TCjSBkRN13n2rAarAXkSBGSUQG3Q2EBhwMvPCUZqvN'), ('9YdfcB4hD9xbqVsZjhuNjdcy2LtANMoJxHHBpYPyNCz8'),
  ('29gJiXj83z5ZBKmU9gnjYJC7Ry54GqeS7RfnXpQk1dhn'), ('2gnKNE6B5UXR2UwnM98AeGMcvoHVcB2fJ3VrAxCuFRtn'),
  ('6NjarGHuuVhwXVvHn4n1gQPpWSNhdLLBgTxpU181Kd3n'), ('Bo4KrhRwq5ERW1iNZnp1iuaPQdq6ot74eGWE43dro3Yu'),
  ('F5FNpKCeFFSV4jjzUkQGVro1CP9osSSJJVU8VdstdHLP'), ('EEA4HdK2VVt8s1GKfaXsLFBkySYdRF61E5DMwdy6VxSj')) AS t(a)),
gt AS (SELECT a AS addr FROM (VALUES ('TSGpPNV2WeAvjKcN3RvF76Sa3N7iGcrzfu')) AS t(a)),
base AS (SELECT date_trunc('month', block_time) AS month, 'Base' AS chain,
    sum(cast(amount_raw AS double) / 1e6) AS usd_amount, count(*) AS transfer_count
  FROM tokens_evm.transfers
  WHERE blockchain = 'base' AND block_date >= date '2026-01-01'
    AND contract_address = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    AND "to" IN (SELECT addr FROM gb) AND "from" NOT IN (SELECT addr FROM gb)
  GROUP BY 1),
bnb AS (SELECT date_trunc('month', block_time) AS month, 'BNB Chain' AS chain,
    sum(cast(amount_raw AS double) / 1e18) AS usd_amount, count(*) AS transfer_count
  FROM tokens_evm.transfers
  WHERE blockchain = 'bnb' AND block_date >= date '2026-01-01'
    AND contract_address = 0x55d398326f99059fF775485246999027B3197955
    AND "to" IN (SELECT addr FROM gn) AND "from" NOT IN (SELECT addr FROM gn)
  GROUP BY 1),
sol AS (SELECT date_trunc('month', block_time) AS month, 'Solana' AS chain,
    sum(cast(amount AS double) / 1e6) AS usd_amount, count(*) AS transfer_count
  FROM tokens_solana.transfers
  WHERE block_date >= date '2026-01-01'
    AND token_mint_address IN ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
    AND action LIKE 'transfer%'
    AND to_owner IN (SELECT addr FROM gs) AND coalesce(from_owner, '') NOT IN (SELECT addr FROM gs)
  GROUP BY 1),
tron AS (SELECT date_trunc('month', block_time) AS month, 'Tron' AS chain,
    sum(cast(amount_raw AS double) / 1e6) AS usd_amount, count(*) AS transfer_count
  FROM tokens_tron.transfers
  WHERE block_date >= date '2026-01-01' AND token_standard = 'trc20'
    AND contract_address_varchar = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    AND to_varchar IN (SELECT addr FROM gt) AND from_varchar NOT IN (SELECT addr FROM gt)
  GROUP BY 1)
SELECT * FROM base UNION ALL SELECT * FROM bnb UNION ALL SELECT * FROM sol UNION ALL SELECT * FROM tron
ORDER BY month, chain
```
