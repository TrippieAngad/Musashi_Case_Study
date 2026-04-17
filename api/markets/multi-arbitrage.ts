import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getMarkets, getMarketMetadata, getMultiVenueArbitrage } from '../lib/market-cache';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.',
    });
    return;
  }

  const startTime = Date.now();

  try {
    const {
      minSpread = '0.03',
      minConfidence = '0.5',
      limit = '20',
      category,
    } = req.query;

    const minSpreadNum = parseFloat(minSpread as string);
    const minConfidenceNum = parseFloat(minConfidence as string);
    const limitNum = parseInt(limit as string, 10);

    if (isNaN(minSpreadNum) || minSpreadNum < 0 || minSpreadNum > 1) {
      res.status(400).json({
        success: false,
        error: 'Invalid minSpread. Must be between 0 and 1.',
      });
      return;
    }

    if (isNaN(minConfidenceNum) || minConfidenceNum < 0 || minConfidenceNum > 1) {
      res.status(400).json({
        success: false,
        error: 'Invalid minConfidence. Must be between 0 and 1.',
      });
      return;
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      res.status(400).json({
        success: false,
        error: 'Invalid limit. Must be between 1 and 100.',
      });
      return;
    }

    const markets = await getMarkets();
    const opportunities = (await getMultiVenueArbitrage(minSpreadNum))
      .filter(arb => arb.confidence >= minConfidenceNum)
      .filter(arb => !category || arb.markets.some(m => m.category === category))
      .slice(0, limitNum);

    const freshnessMetadata = getMarketMetadata();

    res.status(200).json({
      success: true,
      data: {
        opportunities,
        count: opportunities.length,
        timestamp: new Date().toISOString(),
        filters: {
          minSpread: minSpreadNum,
          minConfidence: minConfidenceNum,
          limit: limitNum,
          category: category || null,
        },
        metadata: {
          processing_time_ms: Date.now() - startTime,
          markets_analyzed: markets.length,
          polymarket_count: markets.filter(m => m.platform === 'polymarket').length,
          kalshi_count: markets.filter(m => m.platform === 'kalshi').length,
          predictit_count: markets.filter(m => m.platform === 'predictit').length,
          manifold_count: markets.filter(m => m.platform === 'manifold').length,
          data_age_seconds: freshnessMetadata.data_age_seconds,
          fetched_at: freshnessMetadata.fetched_at,
          sources: freshnessMetadata.sources,
        },
      },
    });
  } catch (error) {
    console.error('[Multi Arbitrage API] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
