/**
 * Shared market cache for Vercel API endpoints
 * Prevents duplicate market fetching across endpoints
 * Stage 0: Added per-source tracking and freshness metadata
 */

import { Market, ArbitrageOpportunity, MultiVenueArbitrageOpportunity } from '../../src/types/market';
import { fetchPolymarkets } from '../../src/api/polymarket-client';
import { fetchKalshiMarkets } from '../../src/api/kalshi-client';
import { fetchPredictItMarkets } from '../../src/api/predictit-client';
import { fetchManifoldMarkets } from '../../src/api/manifold-client';
import { detectArbitrage, detectMultiVenueArbitrage } from '../../src/api/arbitrage-detector';
import { FreshnessMetadata, SourceStatus } from './types';

// In-memory cache for markets
// Default: 20 seconds (configurable via MARKET_CACHE_TTL_SECONDS env var)
let cachedMarkets: Market[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = (parseInt(process.env.MARKET_CACHE_TTL_SECONDS || '20', 10)) * 1000;

// Stage 0: Per-source tracking for freshness metadata
let polyTimestamp = 0;
let kalshiTimestamp = 0;
let predictItTimestamp = 0;
let manifoldTimestamp = 0;
let polyMarketCount = 0;
let kalshiMarketCount = 0;
let predictItMarketCount = 0;
let manifoldMarketCount = 0;
let polyError: string | null = null;
let kalshiError: string | null = null;
let predictItError: string | null = null;
let manifoldError: string | null = null;

// In-memory cache for arbitrage opportunities
// Default: 15 seconds (configurable via ARBITRAGE_CACHE_TTL_SECONDS env var)
let cachedArbitrage: ArbitrageOpportunity[] = [];
let arbCacheTimestamp = 0;
const ARB_CACHE_TTL_MS = (parseInt(process.env.ARBITRAGE_CACHE_TTL_SECONDS || '15', 10)) * 1000;

let cachedMultiVenueArbitrage: MultiVenueArbitrageOpportunity[] = [];
let multiVenueArbCacheTimestamp = 0;

const POLYMARKET_TARGET_COUNT = parsePositiveInt(process.env.MUSASHI_POLYMARKET_TARGET_COUNT, 1200);
const POLYMARKET_MAX_PAGES = parsePositiveInt(process.env.MUSASHI_POLYMARKET_MAX_PAGES, 20);
const KALSHI_TARGET_COUNT = parsePositiveInt(process.env.MUSASHI_KALSHI_TARGET_COUNT, 1000);
const KALSHI_MAX_PAGES = parsePositiveInt(process.env.MUSASHI_KALSHI_MAX_PAGES, 20);
const PREDICTIT_TARGET_COUNT = parsePositiveInt(process.env.MUSASHI_PREDICTIT_TARGET_COUNT, 500);
const MANIFOLD_TARGET_COUNT = parsePositiveInt(process.env.MUSASHI_MANIFOLD_TARGET_COUNT, 500);
const MANIFOLD_MAX_PAGES = parsePositiveInt(process.env.MUSASHI_MANIFOLD_MAX_PAGES, 2);
const INCLUDE_PREDICTIT = process.env.MUSASHI_INCLUDE_PREDICTIT !== 'false';
const INCLUDE_MANIFOLD = process.env.MUSASHI_INCLUDE_MANIFOLD !== 'false';

// Stage 0 Session 2: Per-source timeout (5 seconds)
const SOURCE_TIMEOUT_MS = 5000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Stage 0 Session 2: Wrap a promise with a timeout
 * If the promise doesn't resolve within timeoutMs, reject with timeout error
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param sourceName - Name of the source (for error message)
 * @returns Promise that rejects if timeout is exceeded
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  sourceName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${sourceName} request timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Fetch and cache markets from both platforms
 * Shared across all API endpoints to avoid duplicate fetches
 * Stage 0: Tracks per-source timestamps and errors for freshness metadata
 */
export async function getMarkets(): Promise<Market[]> {
  const now = Date.now();

  // Return cached if fresh
  if (cachedMarkets.length > 0 && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.log(`[Market Cache] Using cached ${cachedMarkets.length} markets (TTL: ${CACHE_TTL_MS}ms, age: ${now - cacheTimestamp}ms)`);
    return cachedMarkets;
  }

  // Fetch fresh markets
  console.log(`[Market Cache] Fetching fresh markets... (TTL: ${CACHE_TTL_MS}ms)`);

  try {
    // Stage 0 Session 2: Wrap each source with 5-second timeout
    const [polyResult, kalshiResult, predictItResult, manifoldResult] = await Promise.allSettled([
      withTimeout(
        fetchPolymarkets(POLYMARKET_TARGET_COUNT, POLYMARKET_MAX_PAGES),
        SOURCE_TIMEOUT_MS,
        'Polymarket'
      ),
      withTimeout(
        fetchKalshiMarkets(KALSHI_TARGET_COUNT, KALSHI_MAX_PAGES),
        SOURCE_TIMEOUT_MS,
        'Kalshi'
      ),
      INCLUDE_PREDICTIT
        ? withTimeout(
            fetchPredictItMarkets(PREDICTIT_TARGET_COUNT),
            SOURCE_TIMEOUT_MS,
            'PredictIt'
          )
        : Promise.resolve([]),
      INCLUDE_MANIFOLD
        ? withTimeout(
            fetchManifoldMarkets(MANIFOLD_TARGET_COUNT, MANIFOLD_MAX_PAGES),
            SOURCE_TIMEOUT_MS,
            'Manifold'
          )
        : Promise.resolve([]),
    ]);

    // Stage 0: Track Polymarket fetch
    if (polyResult.status === 'fulfilled') {
      polyTimestamp = now;
      polyMarketCount = polyResult.value.length;
      polyError = null;
    } else {
      polyError = polyResult.reason?.message || 'Failed to fetch Polymarket markets';
      console.error('[Market Cache] Polymarket fetch failed:', polyError);
    }

    // Stage 0: Track Kalshi fetch
    if (kalshiResult.status === 'fulfilled') {
      kalshiTimestamp = now;
      kalshiMarketCount = kalshiResult.value.length;
      kalshiError = null;
    } else {
      kalshiError = kalshiResult.reason?.message || 'Failed to fetch Kalshi markets';
      console.error('[Market Cache] Kalshi fetch failed:', kalshiError);
    }

    if (predictItResult.status === 'fulfilled') {
      predictItTimestamp = now;
      predictItMarketCount = predictItResult.value.length;
      predictItError = null;
    } else {
      predictItError = predictItResult.reason?.message || 'Failed to fetch PredictIt markets';
      console.error('[Market Cache] PredictIt fetch failed:', predictItError);
    }

    if (manifoldResult.status === 'fulfilled') {
      manifoldTimestamp = now;
      manifoldMarketCount = manifoldResult.value.length;
      manifoldError = null;
    } else {
      manifoldError = manifoldResult.reason?.message || 'Failed to fetch Manifold markets';
      console.error('[Market Cache] Manifold fetch failed:', manifoldError);
    }

    const polyMarkets = polyResult.status === 'fulfilled' ? polyResult.value : [];
    const kalshiMarkets = kalshiResult.status === 'fulfilled' ? kalshiResult.value : [];
    const predictItMarkets = predictItResult.status === 'fulfilled' ? predictItResult.value : [];
    const manifoldMarkets = manifoldResult.status === 'fulfilled' ? manifoldResult.value : [];

    cachedMarkets = [...polyMarkets, ...kalshiMarkets, ...predictItMarkets, ...manifoldMarkets];
    cacheTimestamp = now;

    console.log(
      `[Market Cache] Cached ${cachedMarkets.length} markets ` +
      `(${polyMarkets.length} Poly + ${kalshiMarkets.length} Kalshi + ` +
      `${predictItMarkets.length} PredictIt + ${manifoldMarkets.length} Manifold)`
    );
    return cachedMarkets;
  } catch (error) {
    console.error('[Market Cache] Failed to fetch markets:', error);
    // Return stale cache if available
    return cachedMarkets;
  }
}

/**
 * Stage 0: Get freshness metadata for current cached data
 * Tells bots/agents how old the data is and which sources are healthy
 *
 * @returns FreshnessMetadata with data age and source health status
 */
export function getMarketMetadata(): FreshnessMetadata {
  const now = Date.now();

  // Find oldest fetch timestamp (or use cache timestamp if no individual source timestamps)
  const oldestTimestamp = Math.min(
    polyTimestamp || cacheTimestamp,
    kalshiTimestamp || cacheTimestamp,
    predictItTimestamp || cacheTimestamp,
    manifoldTimestamp || cacheTimestamp
  );

  // Calculate data age in seconds
  const dataAgeMs = now - oldestTimestamp;
  const dataAgeSeconds = Math.floor(dataAgeMs / 1000);

  // Build source status
  const polymarketStatus: SourceStatus = {
    available: polyError === null && polyMarketCount > 0,
    last_successful_fetch: polyTimestamp > 0 ? new Date(polyTimestamp).toISOString() : null,
    error: polyError || undefined,
    market_count: polyMarketCount,
  };

  const kalshiStatus: SourceStatus = {
    available: kalshiError === null && kalshiMarketCount > 0,
    last_successful_fetch: kalshiTimestamp > 0 ? new Date(kalshiTimestamp).toISOString() : null,
    error: kalshiError || undefined,
    market_count: kalshiMarketCount,
  };

  const predictItStatus: SourceStatus = {
    available: predictItError === null && predictItMarketCount > 0,
    last_successful_fetch: predictItTimestamp > 0 ? new Date(predictItTimestamp).toISOString() : null,
    error: predictItError || undefined,
    market_count: predictItMarketCount,
  };

  const manifoldStatus: SourceStatus = {
    available: manifoldError === null && manifoldMarketCount > 0,
    last_successful_fetch: manifoldTimestamp > 0 ? new Date(manifoldTimestamp).toISOString() : null,
    error: manifoldError || undefined,
    market_count: manifoldMarketCount,
  };

  return {
    data_age_seconds: dataAgeSeconds,
    fetched_at: new Date(oldestTimestamp).toISOString(),
    sources: {
      polymarket: polymarketStatus,
      kalshi: kalshiStatus,
      predictit: predictItStatus,
      manifold: manifoldStatus,
    },
  };
}

/**
 * Get cached arbitrage opportunities
 *
 * Caches with low minSpread (0.01) and filters client-side.
 * This allows different callers to request different thresholds
 * without recomputing the expensive O(nxm) scan.
 *
 * @param minSpread - Minimum spread threshold (default: 0.03)
 * @returns Arbitrage opportunities filtered by minSpread
 */
export async function getArbitrage(minSpread: number = 0.03): Promise<ArbitrageOpportunity[]> {
  const markets = await getMarkets();
  const now = Date.now();

  // Recompute if cache is stale
  if (cachedArbitrage.length === 0 || (now - arbCacheTimestamp) >= ARB_CACHE_TTL_MS) {
    console.log('[Arbitrage Cache] Computing arbitrage opportunities...');
    // Cache with low threshold (0.01) so we can filter client-side
    cachedArbitrage = detectArbitrage(markets, 0.01);
    arbCacheTimestamp = now;
    console.log(`[Arbitrage Cache] Cached ${cachedArbitrage.length} opportunities (minSpread: 0.01, TTL: ${ARB_CACHE_TTL_MS}ms)`);
  }

  // Filter cached results by requested minSpread
  const filtered = cachedArbitrage.filter(arb => arb.spread >= minSpread);
  console.log(`[Arbitrage Cache] Returning ${filtered.length}/${cachedArbitrage.length} opportunities (minSpread: ${minSpread})`);

  return filtered;
}

/**
 * Get cached covered arbitrage opportunities across all enabled venues.
 *
 * Unlike getArbitrage(), this is not constrained to Polymarket/Kalshi. It is
 * intended for research/discovery endpoints and returns generalized YES/NO
 * bundle legs.
 */
export async function getMultiVenueArbitrage(
  minSpread: number = 0.03
): Promise<MultiVenueArbitrageOpportunity[]> {
  const markets = await getMarkets();
  const now = Date.now();

  if (
    cachedMultiVenueArbitrage.length === 0 ||
    (now - multiVenueArbCacheTimestamp) >= ARB_CACHE_TTL_MS
  ) {
    console.log('[Arbitrage Cache] Computing multi-venue arbitrage opportunities...');
    cachedMultiVenueArbitrage = detectMultiVenueArbitrage(markets, 0.01);
    multiVenueArbCacheTimestamp = now;
    console.log(
      `[Arbitrage Cache] Cached ${cachedMultiVenueArbitrage.length} multi-venue opportunities ` +
      `(minSpread: 0.01, TTL: ${ARB_CACHE_TTL_MS}ms)`
    );
  }

  const filtered = cachedMultiVenueArbitrage.filter(arb => arb.spread >= minSpread);
  console.log(
    `[Arbitrage Cache] Returning ${filtered.length}/${cachedMultiVenueArbitrage.length} ` +
    `multi-venue opportunities (minSpread: ${minSpread})`
  );

  return filtered;
}
