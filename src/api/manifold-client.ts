// Manifold public API client
// Fetches read-only binary markets from https://api.manifold.markets/v0/markets

import { Market } from '../types/market';
import { generateKeywords } from './keyword-generator';

const MANIFOLD_API = 'https://api.manifold.markets/v0';
const FETCH_TIMEOUT_MS = 10000;

interface ManifoldMarket {
  id: string;
  question: string;
  slug?: string;
  url?: string;
  outcomeType: string;
  probability?: number;
  isResolved?: boolean;
  closeTime?: number;
  volume?: number;
  volume24Hours?: number;
  creatorUsername?: string;
  groupSlugs?: string[];
}

export async function fetchManifoldMarkets(
  targetCount = 500,
  maxPages = 3,
): Promise<Market[]> {
  const PAGE_SIZE = Math.min(targetCount, 1000);
  const markets: Market[] = [];
  let before: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${MANIFOLD_API}/markets`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (before) url.searchParams.set('before', before);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const resp = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`Manifold API responded with ${resp.status}`);
      }

      const data = await resp.json() as ManifoldMarket[];
      if (!Array.isArray(data)) {
        throw new Error('Unexpected Manifold API response shape');
      }

      const pageMarkets = data
        .filter(isBinaryOpenMarket)
        .map(toMarket)
        .filter(m => m.yesPrice > 0 && m.yesPrice < 1);

      markets.push(...pageMarkets);
      console.log(
        `[Musashi] Manifold page ${page + 1}: ${data.length} raw → ` +
        `${pageMarkets.length} binary (total: ${markets.length})`
      );

      if (markets.length >= targetCount || data.length === 0) break;
      before = data[data.length - 1]?.id;
      if (!before) break;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Manifold API request timed out after ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }

  console.log(`[Musashi] Fetched ${markets.length} live markets from Manifold`);
  return markets.slice(0, targetCount);
}

function isBinaryOpenMarket(market: ManifoldMarket): boolean {
  if (!market.id || !market.question) return false;
  if (market.outcomeType !== 'BINARY') return false;
  if (market.isResolved) return false;
  if (market.closeTime && market.closeTime < Date.now()) return false;
  return typeof market.probability === 'number';
}

function toMarket(market: ManifoldMarket): Market {
  const yesPrice = Math.min(Math.max(market.probability ?? 0.5, 0.01), 0.99);
  const noPrice = +((1 - yesPrice).toFixed(2));
  const url = market.url || buildUrl(market);

  return {
    id: `manifold-${market.id}`,
    platform: 'manifold',
    title: market.question,
    description: '',
    keywords: generateKeywords(market.question),
    yesPrice: +yesPrice.toFixed(2),
    noPrice,
    // Manifold's public market list gives an AMM probability, not a
    // cross-venue cash-settled order book. Treat as indicative only.
    yesAsk: +yesPrice.toFixed(2),
    noAsk: noPrice,
    volume24h: market.volume24Hours ?? market.volume ?? 0,
    url,
    category: inferCategory(market),
    lastUpdated: new Date().toISOString(),
    numericId: market.id,
    endDate: market.closeTime ? new Date(market.closeTime).toISOString() : undefined,
  };
}

function buildUrl(market: ManifoldMarket): string {
  if (market.creatorUsername && market.slug) {
    return `https://manifold.markets/${market.creatorUsername}/${market.slug}`;
  }
  return `https://manifold.markets/market/${market.id}`;
}

function inferCategory(market: ManifoldMarket): string {
  const text = `${market.question} ${(market.groupSlugs ?? []).join(' ')}`.toUpperCase();
  if (/PRESIDENT|TRUMP|BIDEN|HARRIS|ELECTION|SENATE|HOUSE|GOP|DEM|NOMINEE/.test(text)) return 'us_politics';
  if (/FED|CPI|GDP|INFLATION|RATE|UNEMP|JOBS|RECESSION/.test(text)) return 'economics';
  if (/BTC|BITCOIN|ETH|CRYPTO|SOLANA|DOGE/.test(text)) return 'crypto';
  if (/\bAI\b|OPENAI|ANTHROPIC|GOOGLE|META|TESLA|NVIDIA|TECH/.test(text)) return 'technology';
  if (/NFL|NBA|MLB|NHL|SOCCER|FOOTBALL|TENNIS|GOLF|SPORT/.test(text)) return 'sports';
  if (/UKRAINE|RUSSIA|CHINA|NATO|ISRAEL|GAZA|IRAN/.test(text)) return 'geopolitics';
  return 'other';
}
