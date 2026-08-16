# Broke Cat Bot V8.5 — Wallet Position Recovery

Built on the V8.4 real bundle-scanner branch.

## New
- Scans the live Solana wallet for non-zero SPL Token and Token-2022 holdings.
- Prints live wallet positions every poll cycle with symbol, current value, price, and P&L when a cost basis is known.
- Adds `openPositions` and `positions` to `/health`.
- On startup, if the local live-state file is missing, checks recent Helius enhanced transaction history and tries to recover the most recent live buy that is still held in the wallet.
- Restores the token amount, pair, buy signature, SOL cost basis, and entry time for a recovered position.
- Recovered positions use SOL-denominated entry basis for stop-loss, take-profit, and trailing-stop calculations, avoiding the need to guess the historical SOL/USD price.
- Startup no longer requires enough free SOL for a new trade before it can recover/monitor an existing token position. Funding is checked when opening a new trade.

## Railway setting
Optional: `RECOVERY_LOOKBACK_HOURS` (default `72`).

## Important
Wallet discovery can show any priced token held by the wallet. Only a position that can be matched to a recent wallet buy is marked as the managed Broke Cat position and used by the automatic exit logic.
