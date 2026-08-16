# Broke Cat Bot V8.7 — Autonomous Position Sizing

- Live bot is no longer capped by a fixed `LIVE_POSITION_USD` amount when `AUTO_POSITION_SIZING=true`.
- The bot can allocate from `AUTO_SIZE_MIN_WALLET_PCT` through `AUTO_SIZE_MAX_WALLET_PCT` of the wallet based on candidate score, bundle/holder/dev risk data, liquidity, and recent volume.
- Default maximum is 100% of wallet, while `MIN_SOL_RESERVE` is always retained for Solana network fees and a future exit.
- Stronger candidates receive larger allocations; marginal qualifying entries receive smaller allocations.
- Every buy logs the chosen confidence, wallet percentage, SOL/USD size, reserve, and sizing reasons.
- Existing V8.6 exact-mint verification, wallet reconciliation, position recovery, and sell verification are preserved.
- `LIVE_POSITION_USD` remains available only as a legacy fallback when autonomous sizing is disabled.
