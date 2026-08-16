# Broke Cat Bot V8.10 — Buy Receipt Reconciliation

## Fixed

- A successful Jupiter buy is no longer treated as missing just because the wallet token-account RPC is slow to update.
- After a confirmed buy, Broke Cat waits up to ~30 seconds for the expected mint to appear in the wallet.
- If wallet visibility still lags, the bot fetches the confirmed Solana transaction and verifies the expected mint using the wallet owner's `preTokenBalances` / `postTokenBalances`.
- A transaction-verified position is created and managed even when the token account is temporarily not visible through the wallet RPC.
- Newly opened transaction-verified positions get a 90-second reconciliation grace window so the normal position reconciler cannot immediately delete them due to RPC lag.
- If the confirmed transaction cannot prove that the expected mint was received, the event is written to live state and trade history and **new buys are safety-paused**. Existing positions can still be monitored and sold.
- `/health` now exposes `tradingPaused`, `pauseReason`, and `lastBuyIncident` for reconciliation incidents.

## Railway log examples

Successful delayed receipt:

```text
BUY CHAIN CONFIRMED SOLCAT | tx ... | waiting for token-account visibility + transaction receipt
BUY RECEIPT VERIFIED SOLCAT | expected mint ... | +123456 raw from confirmed transaction; wallet RPC visibility is delayed
LIVE BUY ... | mint VERIFIED via transaction-token-balance-delta ...
```

Unresolved receipt:

```text
BUY CONFIRMED BUT EXPECTED MINT NOT VERIFIED ... | NEW BUYS PAUSED for safety
```

This update does not change the strategy thresholds or intentionally increase trade size.
