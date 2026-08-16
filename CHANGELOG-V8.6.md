# Broke Cat Bot V8.6 — Position Safety / Wallet Source of Truth

- Exact mint wallet balance is now the source of truth for live positions.
- Before a buy, records the exact mint balance; after Jupiter confirms, waits for that exact mint balance to increase.
- A buy is not marked as an open position unless the expected mint is actually received.
- Stores the verified raw token amount and token decimals from Solana RPC, not only Jupiter quote output.
- Every live loop reconciles the managed position against the wallet.
- Sell uses the current verified wallet amount for the managed mint and verifies that the token balance actually decreases after Jupiter reports success.
- A failed/ambiguous sell leaves the position active instead of silently clearing it.
- When state is missing, recovery uses the actual current wallet balance plus recent Helius buy history.
- New buys are paused when an unmanaged wallet holding worth at least ORPHAN_HOLDING_BLOCK_USD exists, preventing the bot from stacking a new trade while an orphaned position is still in the wallet.
- Position logs now include exact mint and raw token balance.
- For durable entry/cost-basis history on Railway, mount a persistent volume and set DATA_DIR=/data.
