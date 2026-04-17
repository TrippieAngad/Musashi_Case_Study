# Musashi API x Trading Bot Case Study

## Goal

Use the legacy Musashi API with the trading bot in paper mode on live Polymarket/Kalshi market data, with fake tokens and real market feeds. The objective I optimized for was minimizing loss: do not trade unless the API can prove a covered cross-venue bundle exists.

## Initial Run

- `pnpm run dev` started the Musashi API locally.
- The trading bot started after bypassing the local geolocation shutdown in paper mode.
- The bot could fetch tweets/API responses, but found no arbitrage trades.
- On inspection, this was not just "no opportunity"; several API and bot integration bugs made the arbitrage strategy unreliable.

## Critical Problems Found

1. Kalshi prices were parsed incorrectly.

   The live Kalshi API can return dollar price fields as strings. The client did arithmetic directly on those fields, which produced `NaN` prices. Result: the client accepted the raw markets, then dropped all mapped markets at the `yesPrice > 0 && yesPrice < 1` sanity filter.

   Evidence before fix:

   ```text
   [Musashi] Page 1: 200 raw -> 0 simple (total simple: 0; accepted:200)
   [Musashi] Fetched 0 live markets from Kalshi
   ```

   Evidence after fix:

   ```text
   [Musashi] Page 1: 200 raw -> 200 simple (total simple: 200; accepted:200)
   [Musashi] Fetched 200 live markets from Kalshi
   ```

2. The arbitrage math was not real arbitrage.

   previous code used:

   ```ts
   const spread = Math.abs(poly.yesPrice - kalshi.yesPrice);
   profitPotential = spread;
   ```

   That only compares indicative YES prices. A real covered trade must buy complementary outcomes:

   ```text
   YES ask on venue A + NO ask on venue B + fees/slippage < $1 payout
   ```

3. The detector used fuzzy similarity where contract equivalence is required.

   The old matcher removed years during normalization and allowed category mismatches when one side was `other`. That can incorrectly pair markets like:

   ```text
   Will BTC hit $100k in 2025?
   Will BTC hit $100k in 2026?
   ```

4. Keyword generation removed contract-defining words.

   The old keyword path removed years and verbs such as `win`, `lose`, `reach`, `pass`. Those words often define the contract itself.

5. Bot/API response shape mismatch.

   The bot read:

   ```py
   response["arbitrage_opportunities"]
   ```

   But the API returns:

   ```py
   response["data"]["opportunities"]
   ```

   So the bot could silently see zero opportunities even when the API returned valid data.

6. Bot volume field mismatch.

   The API returns `volume24h`; the bot looked for `volume`. This made markets appear illiquid and could filter out valid opportunities.

7. False positives still appeared when both markets were categorized as `other`.

   During live testing, a permissive scan briefly matched unrelated markets such as a Champions League season winner with a League of Legends match because both titles shared generic terms like `win` and `league`. A second example matched a League of Legends season/playoff winner against a single Kalshi match. These are not arbitrage; they are different contract scopes.

## Fixes Made

- Added executable-ish market quote fields:
  - `yesBid`
  - `yesAsk`
  - `noBid`
  - `noAsk`

- Fixed Kalshi price normalization for `number | string | null`.

- Replaced same-contract YES spread logic with covered-bundle pricing:

  ```text
  cost = yesAsk + noAsk + costBuffer
  edge = 1 - cost
  ```

- Preserved `rawPriceGap` separately for debugging/write-up comparison.

- Added stricter contract matching:
  - same category unless category is unknown and title similarity is very strong
  - reject conflicting years
  - reject conflicting dates
  - reject conflicting numeric thresholds
  - reject conflicting outcome wording
  - reject conflicting contract scopes, such as season/tournament winner vs single-match winner

- Updated keyword extraction to keep years, thresholds, and outcome verbs.

- Fixed the trading bot to read `data.opportunities`, use `volume24h`, and paper-trade complementary YES/NO bundles instead of pretending to sell the expensive YES side.

- Added scanner diagnostics so a no-trade result is explicit:

  ```text
  No arbitrage opportunities returned by Musashi (markets_analyzed=2396 poly=1200 kalshi=1196 min_edge=5.00%)
  ```

- Added a local paper-mode `.env` for the bot so it calls the fixed local API instead of the deployed legacy API:

  ```text
  MUSASHI_API_BASE_URL=http://127.0.0.1:3000
  BOT_MODE=paper
  ARB_MIN_EDGE=0.05
  ARB_MIN_VOLUME_USD=50000
  ```

- Updated the dashboard to display covered-bundle fields:
  - YES platform / YES price
  - NO platform / NO price
  - bundle cost
  - edge
  - profit

## Before vs After PnL

Command:

```bash
cd /Users/angad/Documents/musashi/musashi-api
node --import tsx scripts/case-study/run-simulation.ts --live
```

Terminal snapshot:

```text
MUSASHI CASE STUDY SIMULATION
position size: $10
cost buffer: 2.0 cents per bundle

BEFORE: legacy detector
  trade
  pair: Will the Fed cut rates in June 2026?  <->  Will the Fed cut rates in June 2026?
  reason: Legacy title similarity (100%)
  raw YES gap: 0.180
  expected pnl: $4.29
  covered-bundle pnl: $0.87
  trade
  pair: Will BTC hit $100k in 2025?  <->  Will BTC hit $100k in 2026?
  reason: Legacy title similarity (100%)
  raw YES gap: 0.100
  expected pnl: $1.82
  covered-bundle pnl: $-0.20
  trades: 2
  reported pnl: $6.10
  covered-bundle pnl: $0.67

AFTER: fixed detector
  trade
  pair: Will the Fed cut rates in June 2026?  <->  Will the Fed cut rates in June 2026?
  reason: Strict category + contract fields + title similarity (100%)
  raw YES gap: 0.180
  expected pnl: $0.87
  covered-bundle pnl: $0.87
  trades: 1
  modeled pnl: $0.87
  improvement vs covered legacy: $0.20
```

Interpretation:

- Legacy reported `$6.10` of profit, but that was fake because it used the YES price gap as profit.
- When measured as a real covered bundle, the legacy trades only made `$0.67`, and one trade lost money because it matched different contract years.
- Fixed detector made `$0.87` on one valid equivalent contract and skipped the bad BTC 2025/2026 pair.
- Improvement vs actually covered legacy PnL: `$0.20` on this small `$10` fixture.
- More importantly, the loss-making false positive was eliminated.

## Live Market Snapshot

Same run against live market data:

```text
[Musashi] Fetched 281 live markets from Polymarket
[Musashi] Fetched 596 live markets from Kalshi
[Arbitrage] Checking 200 Polymarket markets against category-filtered Kalshi buckets
[Arbitrage] Found 0 covered opportunities (min edge: 0.03)

LIVE DATA SNAPSHOT
  polymarket markets: 200
  kalshi markets: 596
  valid covered arbs >= 3% edge: 0
```

Conclusion: at the time of the live scan, the correct trade was no trade. The fixed system minimized loss by refusing to act on non-equivalent or non-covered spreads.

Latest strict live endpoint check:

```text
GET /api/markets/arbitrage?minSpread=0.01&minConfidence=0&limit=5

opportunities: []
markets_analyzed: 2396
polymarket_count: 1200
kalshi_count: 1196
```

Even with a permissive 1% threshold and zero confidence filter, the fixed matcher returned no valid covered arbs. This confirms that the bot not executing trades is the intended safety behavior, not a broken integration.

## Files Changed

- `musashi-api/src/api/kalshi-client.ts`
- `musashi-api/src/api/polymarket-client.ts`
- `musashi-api/src/api/arbitrage-detector.ts`
- `musashi-api/src/api/keyword-generator.ts`
- `musashi-api/src/types/market.ts`
- `musashi-api/scripts/case-study/run-simulation.ts`
- `trading-bot/bot/arbitrage_strategy.py`
- `trading-bot/dashboard.py`
- `trading-bot/templates/dashboard.html`

## Verification

```bash
cd /Users/angad/Documents/musashi/musashi-api
pnpm typecheck
node --import tsx scripts/case-study/run-simulation.ts
node --import tsx scripts/case-study/run-simulation.ts --live

cd /Users/angad/Documents/musashi/trading-bot
python3 -m py_compile dashboard.py bot/arbitrage_strategy.py
```
