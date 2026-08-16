# Broke Cat Bot V8.4

Built directly from V8.3.

- Added a genuinely separate bundle-data source: Solana Tracker Data API.
- Calls `GET /tokens/{token}/bundlers` with `SOLANA_TRACKER_API_KEY`.
- Uses the provider's `totalBundlerPercentage` rather than a Helius-derived estimate.
- Keeps Helius for holder concentration and mint/freeze authority only.
- Logs bundle source/status explicitly.
- Bundle UNKNOWN does not automatically block an otherwise qualified entry.
- 20%+ bundle percentage is HIGH and blocks entry by default.
