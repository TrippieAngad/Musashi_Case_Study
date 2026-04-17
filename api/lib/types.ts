/**
 * Shared types for API responses
 * Stage 0: Freshness tracking and source health monitoring
 */

/**
 * Source health status for each data platform
 */
export interface SourceStatus {
  available: boolean;
  last_successful_fetch: string | null;  // ISO 8601 timestamp
  error?: string;                         // Present if available: false
  market_count: number;
}

/**
 * Freshness metadata included in all API responses
 * Tells bots/agents how old the data is and which sources are healthy
 */
export interface FreshnessMetadata {
  data_age_seconds: number;               // Time since oldest data was fetched
  fetched_at: string;                     // ISO 8601 timestamp of oldest fetch
  sources: {
    polymarket: SourceStatus;
    kalshi: SourceStatus;
    predictit?: SourceStatus;
    manifold?: SourceStatus;
  };
}

/**
 * Standard API response envelope (matches existing pattern)
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;                     // ISO 8601 - when request was processed
  metadata: FreshnessMetadata;
}
