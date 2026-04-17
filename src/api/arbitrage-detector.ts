// Cross-platform arbitrage detector
// Matches equivalent Polymarket/Kalshi contracts and prices covered YES/NO bundles.

import { Market, ArbitrageOpportunity, MultiVenueArbitrageOpportunity, Platform } from '../types/market';

const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'in', 'on', 'at', 'by', 'for', 'to', 'of',
  'and', 'or', 'is', 'be', 'has', 'have', 'are', 'was', 'were', 'been',
  'do', 'does', 'did', 'before', 'after', 'end', 'yes', 'no', 'than',
  'major', 'us', 'use', 'its', 'their', 'any', 'all', 'into', 'out',
  'as', 'from', 'with', 'this', 'that', 'not', 'new', 'more', 'most',
  'least', 'how', 'what', 'when', 'where', 'who', 'get', 'got', 'put',
  'set', 'per', 'via', 'if', 'whether', 'each', 'such', 'also',
]);

const OUTCOME_PHRASES = [
  'win', 'wins', 'won', 'nominee', 'nomination', 'elected', 'election',
  'above', 'below', 'over', 'under', 'reach', 'reaches', 'hit', 'hits',
  'pass', 'passes', 'rate hike', 'rate cut', 'cut rates', 'raise rates',
  'shutdown', 'resign', 'indicted', 'approved', 'land', 'launch',
];

interface ContractSignature {
  terms: Set<string>;
  specificTerms: Set<string>;
  years: Set<string>;
  dates: Set<string>;
  numbers: Set<string>;
  outcomes: Set<string>;
  outcomeFamilies: Set<string>;
  scopes: Set<string>;
  parties: Set<string>;
}

interface MatchResult {
  isSimilar: boolean;
  confidence: number;
  reason: string;
}

interface BundleCandidate {
  direction: ArbitrageOpportunity['direction'];
  yesPlatform: Platform;
  noPlatform: Platform;
  yesPrice: number;
  noPrice: number;
  costPerBundle: number;
  edge: number;
}

const DEFAULT_FEES_AND_SLIPPAGE = Number.parseFloat(
  process.env.MUSASHI_ARB_COST_BUFFER ?? '0.02',
);

const GENERIC_CONTRACT_TERMS = new Set([
  'will', 'win', 'wins', 'won', 'winner', 'nominee', 'nomination',
  'presidential', 'president', 'election', 'elected', 'market',
  'resolve', 'named', 'individual', 'accepts', 'party', 'u.s',
  'yes', 'no', 'contract', 'who', 'which', 'democratic', 'democrat',
  'democrats', 'republican', 'republicans', 'gop', 'april', 'january',
  'february', 'march', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
]);

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[$,]/g, '')
    .replace(/[^a-z0-9.%\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(title: string): string[] {
  return normalizeTitle(title)
    .split(' ')
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

function extractTerms(title: string): Set<string> {
  return new Set(tokens(title).filter(word => word.length >= 3));
}

function extractSpecificTerms(title: string): Set<string> {
  return new Set(
    tokens(title)
      .filter(word => word.length >= 3)
      .filter(word => !GENERIC_CONTRACT_TERMS.has(word))
      .filter(word => !/^20\d{2}$/.test(word))
  );
}

function extractYears(title: string, endDate?: string): Set<string> {
  const years = new Set<string>();
  for (const match of normalizeTitle(title).matchAll(/\b20\d{2}\b/g)) {
    years.add(match[0]);
  }
  if (endDate) {
    const year = new Date(endDate).getUTCFullYear();
    if (Number.isFinite(year)) years.add(String(year));
  }
  return years;
}

function extractDates(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const dates = new Set<string>();
  const monthPattern = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}\b/g;
  for (const match of normalized.matchAll(monthPattern)) dates.add(match[0]);
  for (const match of normalized.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)) dates.add(match[0]);
  return dates;
}

function extractNumbers(title: string): Set<string> {
  const numbers = new Set<string>();
  for (const match of normalizeTitle(title).matchAll(/\b\d+(?:\.\d+)?\s?(?:k|m|b|%|percent|bps)?\b/g)) {
    numbers.add(match[0].replace(/\s+/g, ''));
  }
  return numbers;
}

function extractOutcomes(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const outcomes = new Set<string>();
  for (const phrase of OUTCOME_PHRASES) {
    if (normalized.includes(phrase)) outcomes.add(phrase);
  }
  return outcomes;
}

function extractOutcomeFamilies(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const families = new Set<string>();

  if (/\bnominee\b|\bnomination\b/.test(normalized)) families.add('nomination');
  if (/\belection\b|\belected\b/.test(normalized)) families.add('election');
  if (/\brate hike\b|\brate cut\b|\bcut rates\b|\braise rates\b/.test(normalized)) families.add('rate_policy');
  if (/\babove\b|\bbelow\b|\bover\b|\bunder\b|\breach(?:es)?\b|\bhit(?:s)?\b|\bpass(?:es)?\b/.test(normalized)) families.add('threshold');
  if (/\bvisit\b|\bvisits\b/.test(normalized)) families.add('visit');
  if (/\bannounce(?:s|d)?\b|\bannouncement\b/.test(normalized)) families.add('announcement');
  if (/\bblockade\b|\blift(?:ed)?\b|\bend(?:ed)?\b/.test(normalized)) families.add('geopolitical_action');
  if (/\bresign\b|\bindicted\b|\bapproved\b|\bland\b|\blaunch\b/.test(normalized)) families.add('event_action');

  return families;
}

function hasOutcomeFamilyConflict(a: Set<string>, b: Set<string>): boolean {
  const materialA = new Set([...a].filter(family => family !== 'announcement'));
  const materialB = new Set([...b].filter(family => family !== 'announcement'));
  return hasConflict(materialA, materialB);
}

function extractScopes(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const scopes = new Set<string>();

  if (/\bmatch\b|\bvs\b|\bversus\b/.test(normalized)) scopes.add('single_match');
  if (/\bseason\b|\bplayoffs?\b|\bchampionship\b|\btournament\b|\bseries\b|\bwinner\b/.test(normalized)) scopes.add('season_or_tournament');
  if (/\belection\b|\bnominee\b|\bnomination\b/.test(normalized)) scopes.add('election');
  if (/\bby\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)|before|after/.test(normalized)) scopes.add('deadline');

  return scopes;
}

function extractParties(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const parties = new Set<string>();

  if (/\bdemocrat(?:ic|s)?\b/.test(normalized)) parties.add('democratic');
  if (/\brepublican(?:s)?\b|\bgop\b/.test(normalized)) parties.add('republican');

  return parties;
}

function signature(market: Market): ContractSignature {
  return {
    terms: extractTerms(market.title),
    specificTerms: extractSpecificTerms(market.title),
    years: extractYears(market.title, market.endDate),
    dates: extractDates(market.title),
    numbers: extractNumbers(market.title),
    outcomes: extractOutcomes(market.title),
    outcomeFamilies: extractOutcomeFamilies(market.title),
    scopes: extractScopes(market.title),
    parties: extractParties(`${market.title} ${market.description ?? ''}`),
  };
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) shared++;
  }
  return shared;
}

function hasConflict(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && b.size > 0 && intersectionSize(a, b) === 0;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = intersectionSize(a, b);
  const union = a.size + b.size - shared;
  return union > 0 ? shared / union : 0;
}

function calculateKeywordOverlap(market1: Market, market2: Market): number {
  return intersectionSize(new Set(market1.keywords), new Set(market2.keywords));
}

function areMarketsSimilar(poly: Market, kalshi: Market): MatchResult {
  const strictCategoryMatch =
    poly.category === kalshi.category &&
    poly.category !== 'other' &&
    kalshi.category !== 'other';
  const categoryUnknown = poly.category === 'other' || kalshi.category === 'other';

  if (!strictCategoryMatch && !categoryUnknown) {
    return { isSimilar: false, confidence: 0, reason: 'Different categories' };
  }

  const polySig = signature(poly);
  const kalshiSig = signature(kalshi);

  if (hasConflict(polySig.years, kalshiSig.years)) {
    return { isSimilar: false, confidence: 0, reason: 'Different contract years' };
  }

  if (hasConflict(polySig.dates, kalshiSig.dates)) {
    return { isSimilar: false, confidence: 0, reason: 'Different contract dates' };
  }

  if (hasConflict(polySig.numbers, kalshiSig.numbers)) {
    return { isSimilar: false, confidence: 0, reason: 'Different numeric thresholds' };
  }

  if (hasConflict(polySig.outcomes, kalshiSig.outcomes)) {
    return { isSimilar: false, confidence: 0, reason: 'Different outcome wording' };
  }

  if (hasOutcomeFamilyConflict(polySig.outcomeFamilies, kalshiSig.outcomeFamilies)) {
    return { isSimilar: false, confidence: 0, reason: 'Different outcome type' };
  }

  if (hasConflict(polySig.scopes, kalshiSig.scopes)) {
    return { isSimilar: false, confidence: 0, reason: 'Different contract scope' };
  }

  if (hasConflict(polySig.parties, kalshiSig.parties)) {
    return { isSimilar: false, confidence: 0, reason: 'Different political parties' };
  }

  if (
    polySig.specificTerms.size > 0 &&
    kalshiSig.specificTerms.size > 0 &&
    intersectionSize(polySig.specificTerms, kalshiSig.specificTerms) === 0
  ) {
    return { isSimilar: false, confidence: 0, reason: 'Different named entity' };
  }

  const titleSim = jaccard(polySig.terms, kalshiSig.terms);
  const specificSim = jaccard(polySig.specificTerms, kalshiSig.specificTerms);
  const keywordOverlap = calculateKeywordOverlap(poly, kalshi);
  const sharedTerms = intersectionSize(polySig.terms, kalshiSig.terms);

  if (
    polySig.specificTerms.size > 0 &&
    kalshiSig.specificTerms.size > 0 &&
    titleSim < 0.75 &&
    specificSim < 0.45
  ) {
    return { isSimilar: false, confidence: 0, reason: 'Different named entity or context' };
  }

  let confidence = Math.max(titleSim, Math.min(keywordOverlap / 8, 0.85));
  const blockersMatched =
    (polySig.years.size === 0 || kalshiSig.years.size === 0 || intersectionSize(polySig.years, kalshiSig.years) > 0) &&
    (polySig.numbers.size === 0 || kalshiSig.numbers.size === 0 || intersectionSize(polySig.numbers, kalshiSig.numbers) > 0);

  if (strictCategoryMatch && blockersMatched && titleSim >= 0.45) {
    confidence = Math.max(confidence, 0.75);
    return {
      isSimilar: true,
      confidence,
      reason: `Strict category + contract fields + title similarity (${(titleSim * 100).toFixed(0)}%)`,
    };
  }

  if (strictCategoryMatch && blockersMatched && keywordOverlap >= 4 && sharedTerms >= 2) {
    confidence = Math.max(confidence, 0.65);
    return {
      isSimilar: true,
      confidence,
      reason: `${keywordOverlap} shared keywords with matching contract fields`,
    };
  }

  if (categoryUnknown && blockersMatched && titleSim >= 0.85 && sharedTerms >= 4) {
    confidence = Math.max(confidence, 0.7);
    return {
      isSimilar: true,
      confidence,
      reason: `Unknown category but strong title similarity (${(titleSim * 100).toFixed(0)}%)`,
    };
  }

  return { isSimilar: false, confidence: 0, reason: 'Insufficient contract equivalence' };
}

function buyYesPrice(market: Market): number {
  return market.yesAsk ?? market.yesPrice;
}

function buyNoPrice(market: Market): number {
  return market.noAsk ?? market.noPrice;
}

function priceBundle(poly: Market, kalshi: Market, feesAndSlippage: number): BundleCandidate[] {
  const polyYesKalshiNo = buyYesPrice(poly) + buyNoPrice(kalshi) + feesAndSlippage;
  const kalshiYesPolyNo = buyYesPrice(kalshi) + buyNoPrice(poly) + feesAndSlippage;

  return [
    {
      direction: 'buy_poly_sell_kalshi',
      yesPlatform: 'polymarket',
      noPlatform: 'kalshi',
      yesPrice: buyYesPrice(poly),
      noPrice: buyNoPrice(kalshi),
      costPerBundle: polyYesKalshiNo,
      edge: 1 - polyYesKalshiNo,
    },
    {
      direction: 'buy_kalshi_sell_poly',
      yesPlatform: 'kalshi',
      noPlatform: 'polymarket',
      yesPrice: buyYesPrice(kalshi),
      noPrice: buyNoPrice(poly),
      costPerBundle: kalshiYesPolyNo,
      edge: 1 - kalshiYesPolyNo,
    },
  ];
}

function pricePair(
  yesMarket: Market,
  noMarket: Market,
  feesAndSlippage: number,
): Omit<BundleCandidate, 'direction'> {
  const yesPrice = buyYesPrice(yesMarket);
  const noPrice = buyNoPrice(noMarket);
  const costPerBundle = yesPrice + noPrice + feesAndSlippage;

  return {
    yesPlatform: yesMarket.platform,
    noPlatform: noMarket.platform,
    yesPrice,
    noPrice,
    costPerBundle,
    edge: 1 - costPerBundle,
  };
}

function candidatesFor(poly: Market, kalshiByCategory: Map<string, Market[]>): Market[] {
  if (poly.category === 'other') {
    return kalshiByCategory.get('other') ?? [];
  }

  return [
    ...(kalshiByCategory.get(poly.category) ?? []),
    ...(kalshiByCategory.get('other') ?? []),
  ];
}

/**
 * Detect covered arbitrage opportunities across Polymarket and Kalshi.
 *
 * Real cross-venue arbitrage buys complementary outcomes:
 *   YES on venue A + NO on venue B + fees/slippage < $1 payout.
 *
 * The legacy absolute YES-vs-YES spread is exposed as rawPriceGap only; the
 * spread field now represents net edge after modeled costs.
 */
export function detectArbitrage(
  markets: Market[],
  minSpread: number = 0.03,
  feesAndSlippage: number = DEFAULT_FEES_AND_SLIPPAGE,
): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  const polymarkets = markets.filter(m => m.platform === 'polymarket');
  const kalshiMarkets = markets.filter(m => m.platform === 'kalshi');
  const kalshiByCategory = new Map<string, Market[]>();

  for (const market of kalshiMarkets) {
    const bucket = kalshiByCategory.get(market.category) ?? [];
    bucket.push(market);
    kalshiByCategory.set(market.category, bucket);
  }

  console.log(`[Arbitrage] Checking ${polymarkets.length} Polymarket markets against category-filtered Kalshi buckets`);

  for (const poly of polymarkets) {
    for (const kalshi of candidatesFor(poly, kalshiByCategory)) {
      const similarity = areMarketsSimilar(poly, kalshi);
      if (!similarity.isSimilar) continue;

      const bestBundle = priceBundle(poly, kalshi, feesAndSlippage)
        .sort((a, b) => b.edge - a.edge)[0];

      if (bestBundle.edge < minSpread) continue;

      opportunities.push({
        polymarket: poly,
        kalshi,
        spread: +bestBundle.edge.toFixed(4),
        rawPriceGap: +Math.abs(poly.yesPrice - kalshi.yesPrice).toFixed(4),
        costPerBundle: +bestBundle.costPerBundle.toFixed(4),
        feesAndSlippage,
        profitPotential: +bestBundle.edge.toFixed(4),
        direction: bestBundle.direction,
        legs: {
          yes: { platform: bestBundle.yesPlatform, price: bestBundle.yesPrice },
          no: { platform: bestBundle.noPlatform, price: bestBundle.noPrice },
        },
        confidence: similarity.confidence,
        matchReason: similarity.reason,
      });
    }
  }

  opportunities.sort((a, b) => b.profitPotential - a.profitPotential);
  console.log(`[Arbitrage] Found ${opportunities.length} covered opportunities (min edge: ${minSpread})`);

  return opportunities;
}

/**
 * Get top arbitrage opportunities.
 */
export function getTopArbitrage(
  markets: Market[],
  options: {
    minSpread?: number;
    minConfidence?: number;
    limit?: number;
    category?: string;
  } = {}
): ArbitrageOpportunity[] {
  const {
    minSpread = 0.03,
    minConfidence = 0.5,
    limit = 20,
    category,
  } = options;

  let opportunities = detectArbitrage(markets, minSpread);

  opportunities = opportunities.filter(op => op.confidence >= minConfidence);

  if (category) {
    opportunities = opportunities.filter(
      op => op.polymarket.category === category || op.kalshi.category === category
    );
  }

  return opportunities.slice(0, limit);
}

/**
 * Detect covered arbitrage across every venue in the market array.
 *
 * This does not replace the legacy Polymarket/Kalshi response. It is a
 * generalized scanner for future multi-venue endpoints: find equivalent
 * contracts, then buy the cheapest YES and cheapest complementary NO across
 * any two venues.
 */
export function detectMultiVenueArbitrage(
  markets: Market[],
  minSpread: number = 0.03,
  feesAndSlippage: number = DEFAULT_FEES_AND_SLIPPAGE,
): MultiVenueArbitrageOpportunity[] {
  const opportunities: MultiVenueArbitrageOpportunity[] = [];

  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const first = markets[i];
      const second = markets[j];
      if (first.platform === second.platform) continue;

      const similarity = areMarketsSimilar(first, second);
      if (!similarity.isSimilar) continue;

      const bundles = [
        pricePair(first, second, feesAndSlippage),
        pricePair(second, first, feesAndSlippage),
      ].sort((a, b) => b.edge - a.edge);
      const best = bundles[0];

      if (best.edge < minSpread) continue;

      const yesMarket = best.yesPlatform === first.platform ? first : second;
      const noMarket = best.noPlatform === first.platform ? first : second;

      opportunities.push({
        markets: [first, second],
        yesMarket,
        noMarket,
        spread: +best.edge.toFixed(4),
        profitPotential: +best.edge.toFixed(4),
        costPerBundle: +best.costPerBundle.toFixed(4),
        feesAndSlippage,
        legs: {
          yes: { platform: best.yesPlatform, marketId: yesMarket.id, price: best.yesPrice },
          no: { platform: best.noPlatform, marketId: noMarket.id, price: best.noPrice },
        },
        confidence: similarity.confidence,
        matchReason: similarity.reason,
      });
    }
  }

  opportunities.sort((a, b) => b.profitPotential - a.profitPotential);
  console.log(`[Arbitrage] Found ${opportunities.length} multi-venue covered opportunities (min edge: ${minSpread})`);
  return opportunities;
}
