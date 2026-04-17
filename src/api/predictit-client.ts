// PredictIt public API client
// Fetches public binary contract data from https://www.predictit.org/api/marketdata/all/

import { Market } from '../types/market';
import { generateKeywords } from './keyword-generator';

const PREDICTIT_API = 'https://www.predictit.org/api/marketdata/all/';
const FETCH_TIMEOUT_MS = 10000;

interface PredictItContract {
  id: number;
  name: string;
  shortName?: string;
  status?: string;
  lastTradePrice?: number | string | null;
  bestBuyYesCost?: number | string | null;
  bestBuyNoCost?: number | string | null;
  bestSellYesCost?: number | string | null;
  bestSellNoCost?: number | string | null;
  dateEnd?: string;
}

interface PredictItMarket {
  id: number;
  name: string;
  shortName?: string;
  url?: string;
  contracts: PredictItContract[];
}

interface PredictItResponse {
  markets: PredictItMarket[];
}

export async function fetchPredictItMarkets(targetCount = 500): Promise<Market[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(PREDICTIT_API, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      throw new Error(`PredictIt API responded with ${resp.status}`);
    }

    const data = await resp.json() as PredictItResponse;
    if (!Array.isArray(data.markets)) {
      throw new Error('Unexpected PredictIt API response shape');
    }

    const markets = data.markets
      .flatMap(toMarkets)
      .filter(m => m.yesPrice > 0 && m.yesPrice < 1)
      .slice(0, targetCount);

    console.log(`[Musashi] Fetched ${markets.length} live contracts from PredictIt`);
    return markets;
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error(`PredictIt API request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

function toMarkets(market: PredictItMarket): Market[] {
  if (!Array.isArray(market.contracts)) return [];

  return market.contracts
    .filter(contract => !contract.status || contract.status.toLowerCase() === 'open')
    .map(contract => toMarket(market, contract));
}

function toMarket(market: PredictItMarket, contract: PredictItContract): Market {
  const yesAsk = normalizePrice(contract.bestBuyYesCost);
  const noAsk = normalizePrice(contract.bestBuyNoCost);
  const yesBid = normalizePrice(contract.bestSellYesCost);
  const noBid = normalizePrice(contract.bestSellNoCost);
  const lastPrice = normalizePrice(contract.lastTradePrice);
  const yesPrice = yesAsk ?? lastPrice ?? yesBid ?? 0.5;
  const safeYes = Math.min(Math.max(yesPrice, 0.01), 0.99);
  const safeNo = +((1 - safeYes).toFixed(2));
  const title = `${market.name}: ${contract.name}`;

  return {
    id: `predictit-${market.id}-${contract.id}`,
    platform: 'predictit',
    title,
    description: market.name,
    keywords: generateKeywords(title, market.shortName),
    yesPrice: +safeYes.toFixed(2),
    noPrice: safeNo,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    volume24h: 0,
    url: market.url || `https://www.predictit.org/markets/detail/${market.id}`,
    category: inferCategory(title),
    lastUpdated: new Date().toISOString(),
    numericId: String(contract.id),
    endDate: normalizeDate(contract.dateEnd),
  };
}

function normalizePrice(value: number | string | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return undefined;
  return +parsed.toFixed(2);
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value || value.toUpperCase() === 'NA') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function inferCategory(text: string): string {
  const t = text.toUpperCase();
  if (/PRESIDENT|TRUMP|BIDEN|HARRIS|ELECTION|SENATE|HOUSE|GOP|DEM|NOMINEE/.test(t)) return 'us_politics';
  if (/FED|CPI|GDP|INFLATION|RATE|UNEMP|JOBS|RECESSION/.test(t)) return 'economics';
  if (/BTC|BITCOIN|ETH|CRYPTO/.test(t)) return 'crypto';
  if (/NFL|NBA|MLB|NHL|SOCCER|FOOTBALL|TENNIS|GOLF/.test(t)) return 'sports';
  if (/UKRAINE|RUSSIA|CHINA|NATO|ISRAEL|GAZA|IRAN/.test(t)) return 'geopolitics';
  return 'other';
}
