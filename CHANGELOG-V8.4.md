# Broke Cat Bot V8.4

Built directly from the uploaded working V8.3 source.

## Added
- Axiom-style on-chain bundle heuristic (Broke Cat implementation, not Axiom proprietary API).
- Launch-window same-slot / repeated-wallet clustering.
- Shared-funder checks for early wallets.
- Estimated linked-wallet supply percentage (`bundlePct`).
- Bundle log output such as `bundle 4.2% LOW`.
- Independent risk data fetches so one failed Helius sub-check does not erase all other signals.

## Bundle scoring defaults
- <5%: LOW / +5
- 5-10%: MEDIUM / -5
- 10-20%: elevated MEDIUM / -15
- >=20%: HIGH / -40 and entry rejected
- UNKNOWN: neutral and does not block entry

## Preserved
- V8.3 Trust Wallet/private-key parsing.
- Wallet-address mismatch protection.
- SOL-native Jupiter live execution.
- Existing holder and dev-authority safety gates.
- Existing position, stop, take-profit, trailing, X, Telegram, persistence and Railway behavior.
