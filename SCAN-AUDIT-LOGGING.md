# Scan & Audit Logging Guide

Broke Cat Bot V8.8 is designed so that scanner decisions are visible and reconstructable later.

## Railway live log format

Each candidate receives a unique ID such as `SCAN-20260816045612-00001-03` and prints:

- Token name + symbol
- Mint address + pair address/DEX context
- Token age
- Price, market cap, liquidity
- 5-minute and 1-hour volume
- 5-minute buys and sells
- Buy/sell ratio
- Volume acceleration
- 5-minute price change
- Bundle percentage/status/risk
- Holder concentration risk/top-10 percentage when available
- Dev/mint/freeze authority risk
- Every score component and penalty
- Final 0–100 score
- ENTRY OK, ENTRY COOLDOWN, or REJECTED + reason

## Persistent audit files

### `broke-cat-scan-history.jsonl`
One complete JSON record for every coin scored. This is the source to use for later strategy analysis/backtesting.

### `broke-cat-event-history.jsonl`
Records important bot events such as scan cycle boundaries, buys, sells, and errors.

Both files are written inside `DATA_DIR`.

## Important Railway setup

For records to survive deployments, mount a Railway Volume and set:

`DATA_DIR=/data`

(or use the actual mount path configured in Railway).

## Entry cooldown vs scoring

V8.8 scores and displays every discovered candidate every cycle. A token that was already attempted within 10 minutes is still rescored and logged, but its decision is shown as `ENTRY COOLDOWN` instead of sending another buy attempt.
