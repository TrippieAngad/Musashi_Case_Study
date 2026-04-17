import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);

  res.status(200).json({
    success: true,
    data: {
      tweets: [],
      count: 0,
      timestamp: new Date().toISOString(),
      filters: {
        limit,
        minUrgency: req.query.minUrgency ?? null,
      },
      metadata: {
        processing_time_ms: 0,
        total_in_kv: 0,
        local_stub: true,
      },
    },
  });
}
