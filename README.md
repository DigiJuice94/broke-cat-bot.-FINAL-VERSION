# 🐱 Broke Cat Bot V8.3 — SOL-Native Live Trading

Broke Cat V8 is the SOL-native version of the Railway bot. It keeps the V7 scanner, Helius launch/bundle-risk analysis, holder/dev filters, one-position limit, $1 daily realized-loss kill switch, Jupiter execution, X posts, Telegram alerts, persistent state, and `/health` monitoring — but **live entries now spend SOL instead of requiring USDC**.

## What changed from V7

- Live entry: **SOL → meme coin**
- Live exit: **meme coin → SOL**
- Position size remains configured in USD (default **~$2**) and is converted to SOL at entry time.
- Keeps a fixed **SOL reserve** for fees and safety.
- Startup verifies the exported wallet has enough on-chain SOL for one trade plus the reserve.
- Health endpoint reports SOL balance, SOL/USD price and approximate wallet SOL value.
- X live posts report approximate SOL wallet value instead of USDC.

## Critical limitation

V8 can only spend **SOL that actually exists on-chain in the exported Solana wallet**. It cannot spend Fomo's internal/unified USD balance unless those funds are represented as spendable SOL in that wallet. If startup says the SOL balance is too low, do not bypass the check.

## Default risk profile

- Intended small experiment bankroll: about **$11**
- Max live position: **~$2 worth of SOL**
- Max open positions: **1**
- Daily realized-loss kill switch: **-$1**
- Minimum Broke Cat score: **90/100**
- Stop: **-15%**
- Take profit: **+50%**
- Trailing exit arms after **+25%**, exits after a **12%** pullback from the high
- Unknown bundle analysis: shown as `UNKNOWN` and allowed to continue (fail-open); confirmed HIGH bundle risk is blocked
- SOL reserve: **0.003 SOL**

## Railway Variables — LIVE mode

```env
TRADING_MODE=live
LIVE_TRADING_ACK=I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK
HELIUS_API_KEY=...
JUPITER_API_KEY=...
BS58_PRIVATE_KEY=...
DATA_DIR=/data
LIVE_POSITION_USD=2
MIN_SOL_RESERVE=0.003
MAX_DAILY_LOSS_USD=1
MIN_SCORE=90
STOP_LOSS_PCT=15
TAKE_PROFIT_PCT=50
TRAIL_ARM_PCT=25
TRAIL_DRAWDOWN_PCT=12
POLL_SECONDS=30
```

The bot refuses to arm live if Helius, Jupiter, the wallet key, or the exact acknowledgement string is missing. It also refuses to start if on-chain SOL is not enough for approximately one configured trade plus `MIN_SOL_RESERVE`.

### Old V7 variables

These are no longer used for live funding in V8 and can be removed from Railway:

```env
LIVE_POSITION_USDC
MIN_USDC_RESERVE
MIN_SOL_FOR_FEES
```

## Emergency kill switch

Set and redeploy:

```env
TRADING_MODE=paper
```

If a real position is already open, manage/close it manually before switching modes so it is not left unmanaged.

## X posting (optional)

```env
X_POSTING_ENABLED=true
X_API_KEY=...
X_API_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_TOKEN_SECRET=...
```

## Persistent Railway volume

Mount a Railway Volume at:

```text
/data
```

## Health check

Use:

```text
/health
```

## Security

Never commit `BS58_PRIVATE_KEY`, Helius/Jupiter keys, or X credentials to GitHub. Keep secrets only in Railway Variables. Anyone with the wallet private key can control its on-chain funds.

## Commands

```bash
npm install
npm run selftest
npm start
```


## V8.1 wallet diagnostic fix

Add `EXPECTED_WALLET_ADDRESS` to Railway with the public Solana address you intend Broke Cat to trade from. V8.1 derives the public address from `BS58_PRIVATE_KEY`, blocks live trading if it does not match, and cross-checks native SOL balance using both Helius and Solana public RPC. Startup logs show both readings and which source is used. Never place the private key in GitHub.


## V8.3 Trust Wallet private-key format fix

`BS58_PRIVATE_KEY` keeps the same Railway variable name for backward compatibility, but V8.3 now auto-detects common Solana private-key encodings:

- base58
- base64 / base64url (including `+`, `/`, `_`, `-`, and padding)
- hex (with or without `0x`)
- JSON byte arrays such as `[12,34,...]`

After decoding, Broke Cat still derives the public address and compares it with `EXPECTED_WALLET_ADDRESS`. If the addresses do not match, live trading is blocked. Do not paste the key into chat or GitHub; keep it only in Railway Variables.


## V8.3 key-import fix
Accepts Ed25519 PKCS#8 DER/PEM private-key exports in addition to raw base58/base64/hex/JSON formats. The derived public address is still checked against `EXPECTED_WALLET_ADDRESS` before live trading is armed.

## V8.4 — Axiom-style bundle scanner

V8.4 keeps the working V8.3 live-trading/key-import behavior and upgrades bundle analysis with an Axiom-style **on-chain heuristic**. This is Broke Cat's own scanner; it does not claim to use Axiom's proprietary backend.

The scanner now checks launch-window wallet clustering, repeated actors, shared funding between early wallets, and the current supply still held by detected linked wallets. The log/Telegram line reports an estimated bundle percentage when enough on-chain data is available, for example `bundle 4.2% LOW`.

Default bundle treatment:

- under 5%: LOW, small positive score adjustment
- 5-10%: MEDIUM, small score penalty
- 10-20%: MEDIUM/elevated, larger score penalty
- 20% or more: HIGH and entry is rejected
- unavailable data: `UNKNOWN`, neutral score, **does not block a trade by itself**

Holder and dev-authority hard-risk checks remain active. Bundle scanner request failures are isolated so a failed holder/mint request does not automatically wipe out every other risk signal.
