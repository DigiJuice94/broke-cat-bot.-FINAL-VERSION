# Broke Cat Bot V8.8 — Full Scan Audit Logging

## What changed

- Every discovered coin is now scored on every scan cycle. The old 10-minute scoring skip was removed.
- Railway logs now show the coin name, symbol, mint, DEX, age, price, market cap, liquidity, volume, transaction counts, buy/sell ratio, volume acceleration, price momentum, bundle status, holder risk, dev risk, total score, score components, and final decision.
- A 10-minute **entry attempt cooldown** remains so a token can keep being scored/displayed without repeatedly firing a buy attempt.
- Every scan is persisted as one JSON object per line in `broke-cat-scan-history.jsonl`.
- Bot lifecycle/trading events are persisted in `broke-cat-event-history.jsonl`, including scan-cycle starts/ends, buys, sells, and errors.
- `/health` now exposes the audit file paths and a compact summary of the latest scored coins.
- Score calculation now returns a full `breakdown`, `rawScore`, and derived metrics so every point/penalty is explainable.

## Railway persistence

Set `DATA_DIR` to the directory mounted by your Railway Volume (for example `/data`). Without a persistent Railway Volume, JSONL audit files can disappear when Railway replaces/redeploys the container.

## Files

- `broke-cat-scan-history.jsonl` — permanent per-coin scan journal.
- `broke-cat-event-history.jsonl` — bot/event/trade/error journal.
- Existing `broke-cat-live-state.json` / paper state files remain unchanged.
