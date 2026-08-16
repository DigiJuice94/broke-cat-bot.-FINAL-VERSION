# Broke Cat Bot V8.9 — GeckoTerminal Scanner

## What changed
- GeckoTerminal Public API is now the **primary Solana discovery and pool market-data source**.
- New pools are pulled from GeckoTerminal's Solana `new_pools` feed.
- GeckoTerminal supplies pool price, reserve/liquidity, FDV/market cap when available, 5m/1h volume, 5m/1h transactions, price change, DEX, pool age, and base-token metadata.
- Every Railway scan line now prints `SOURCE GeckoTerminal` (or the fallback source) so the origin of the numbers is visible.
- Each persisted scan audit record stores its market-data source.
- Existing Helius / SolanaTracker risk checks remain in place; GeckoTerminal does **not** replace wallet, holder, bundle, sellability, or execution safety logic.
- DEX Screener remains an outage fallback by default. Disable it with `DEXSCREENER_FALLBACK=false` if you want strict GeckoTerminal-only scanning.

## New Railway variables (all optional)
- `GECKOTERMINAL_ENABLED=true`
- `GECKOTERMINAL_PAGES=2`
- `GECKOTERMINAL_CANDIDATE_LIMIT=40`
- `GECKOTERMINAL_TIMEOUT_MS=10000`
- `DEXSCREENER_FALLBACK=true`

No GeckoTerminal API key is required for the keyless public API used by this version. Public API rate limits are IP based, so candidate pages/scan rate should stay reasonable.
