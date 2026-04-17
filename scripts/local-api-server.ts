import http, { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import arbitrageHandler from '../api/markets/arbitrage';
import multiArbitrageHandler from '../api/markets/multi-arbitrage';
import feedHandler from '../api/feed';
import healthHandler from '../api/health';

type LocalHandler = (req: LocalRequest, res: LocalResponse) => Promise<void> | void;

interface LocalRequest {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  query: Record<string, string | string[]>;
  body?: unknown;
}

interface LocalResponse {
  setHeader(name: string, value: number | string | readonly string[]): void;
  status(code: number): LocalResponse;
  json(payload: unknown): void;
  end(body?: string): void;
}

const routes = new Map<string, LocalHandler>([
  ['/api/health', healthHandler as unknown as LocalHandler],
  ['/api/feed', feedHandler as unknown as LocalHandler],
  ['/api/markets/arbitrage', arbitrageHandler as unknown as LocalHandler],
  ['/api/markets/multi-arbitrage', multiArbitrageHandler as unknown as LocalHandler],
]);

function toQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (typeof existing === 'string') {
      query[key] = [existing, value];
    } else {
      query[key] = value;
    }
  }

  return query;
}

function makeResponse(res: ServerResponse): LocalResponse {
  let statusCode = 200;

  const localRes: LocalResponse = {
    setHeader(name, value) {
      res.setHeader(name, value);
    },

    status(code) {
      statusCode = code;
      return localRes;
    },

    json(payload) {
      res.statusCode = statusCode;
      if (!res.hasHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify(payload));
    },

    end(body) {
      res.statusCode = statusCode;
      res.end(body);
    },
  };

  return localRes;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '127.0.0.1';

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  const handler = routes.get(requestUrl.pathname);

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: `No local route for ${requestUrl.pathname}`,
    }));
    return;
  }

  const localReq: LocalRequest = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: toQuery(requestUrl.searchParams),
    body: await readBody(req),
  };

  try {
    await handler(localReq, makeResponse(res));
  } catch (error) {
    console.error('[Local API] Unhandled route error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }));
    } else {
      res.end();
    }
  }
});

server.listen(port, host, () => {
  console.log(`[Local API] Musashi API listening on http://${host}:${port}`);
  console.log('[Local API] Routes: /api/health, /api/feed, /api/markets/arbitrage, /api/markets/multi-arbitrage');
});
