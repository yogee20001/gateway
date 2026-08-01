// ============================================================
// AI Gateway — Request Hedging
// Sends requests to multiple keys simultaneously, returns first success
// ============================================================

import type { Provider, ChatCompletionRequest, AppConfig } from './types';
import { getProviderKeys } from './config';
import { getKeyHash, selectBestApiKey, getKeyHealthSummary, markKeySuccess, markKeyError } from './key-pool';
import { providerRateLimiter, parseRateLimitHeaders } from './rate-limiter';
import { buildUpstreamUrl, buildUpstreamHeaders, forwardWithRetry } from './forwarder';

export interface HedgingConfig {
  enabled: boolean;
  maxHedgedRequests: number;    // How many keys to try simultaneously (2 = original + 1 hedge)
  hedgeDelayMs: number;         // Delay before sending hedged request
  cancelOnFirstSuccess: boolean; // Cancel remaining when first succeeds
  excludeStreaming: boolean;     // Don't hedge streaming requests
  excludeHighTemperature: boolean; // Don't hedge high-temp (non-deterministic) requests
  temperatureThreshold: number;  // Threshold for high temperature
}

const DEFAULT_HEDGING_CONFIG: Required<HedgingConfig> = {
  enabled: false,
  maxHedgedRequests: 2,
  hedgeDelayMs: 500,
  cancelOnFirstSuccess: true,
  excludeStreaming: true,
  excludeHighTemperature: true,
  temperatureThreshold: 0.5,
};

export interface HedgedResponse {
  status: number;
  body: any;
  keyIndex: number;
  retries: number;
  headers: Record<string, string>;
  streamResponse: Response | null;
}

export interface HedgeInfo {
  hedged: boolean;
  attempts: number;
  firstSuccessAt: number;
  cancelled: number;
}

export interface HedgingResult {
  response: HedgedResponse;
  hedgeInfo: HedgeInfo;
}

export class RequestHedger {
  private config: Required<HedgingConfig>;

  constructor(config: Partial<HedgingConfig> = {}) {
    this.config = { ...DEFAULT_HEDGING_CONFIG, ...config };
  }

  /**
   * Execute request with hedging - sends to multiple keys, returns first success
   */
  async executeWithHedging(
    provider: Provider,
    request: ChatCompletionRequest,
    config: AppConfig,
    rawBody?: string
  ): Promise<HedgingResult> {
    // Check if hedging should be applied
    if (!this.shouldHedge(request)) {
      // Fall back to normal single-key execution
      // Note: forwardWithRetry already carries streamResponse (raw SSE Response)
      const result = await forwardWithRetry(provider, request, config);
      return {
        response: result,
        hedgeInfo: { hedged: false, attempts: 1, firstSuccessAt: 0, cancelled: 0 },
      };
    }

    const keys = getProviderKeys(provider);
    if (keys.length < 2) {
      // Not enough keys for hedging
      const result = await forwardWithRetry(provider, request, config);
      return {
        response: result,
        hedgeInfo: { hedged: false, attempts: 1, firstSuccessAt: 0, cancelled: 0 },
      };
    }

    const maxAttempts = Math.min(this.config.maxHedgedRequests, keys.length);
    const startTime = Date.now();
    const abortController = new AbortController();

    // Track which keys we've attempted
    const attemptedKeys = new Set<number>();

    // First-success race bookkeeping:
    // - expectedCount: primary + every scheduled hedge timer
    // - settledCount:  attempts that have completed (or were skipped after abort)
    // - sentCount:     requests actually dispatched upstream
    // A 2xx resolves the race immediately; if every attempt settles without a
    // success, the failure path rejects with the last error.
    let expectedCount = 0;
    let settledCount = 0;
    let sentCount = 0;
    let hasSuccess = false;

    let resolveFirstSuccess!: (response: HedgedResponse) => void;
    let rejectAllFailed!: (error: unknown) => void;
    const firstSuccessPromise = new Promise<HedgedResponse>((resolve, reject) => {
      resolveFirstSuccess = resolve;
      rejectAllFailed = reject;
    });

    const onSettled = (): void => {
      settledCount++;
      if (!hasSuccess && settledCount >= expectedCount) {
        rejectAllFailed(new Error('All hedged requests failed'));
      }
    };

    const handleResult = (result: HedgedResponse): void => {
      settledCount++;
      if (hasSuccess) return;
      if (result.status >= 200 && result.status < 300) {
        hasSuccess = true;
        if (this.config.cancelOnFirstSuccess) {
          abortController.abort('First request succeeded');
        }
        resolveFirstSuccess(result);
      } else if (settledCount >= expectedCount) {
        // Every attempt settled without success - surface the last failure
        rejectAllFailed(new Error(`HTTP ${result.status}`));
      }
    };

    const handleError = (error: unknown): void => {
      settledCount++;
      if (!hasSuccess && settledCount >= expectedCount) {
        rejectAllFailed(error);
      }
    };

    // Send first request immediately
    const firstKeyIndex = await this.selectBestKey(provider);
    if (firstKeyIndex === -1) {
      const result = await forwardWithRetry(provider, request, config);
      return {
        response: result,
        hedgeInfo: { hedged: false, attempts: 1, firstSuccessAt: 0, cancelled: 0 },
      };
    }

    attemptedKeys.add(firstKeyIndex);
    expectedCount++;
    sentCount++;
    this.executeSingleRequest(provider, request, config, firstKeyIndex, abortController.signal, rawBody)
      .then(handleResult, handleError);

    // Schedule hedged requests. The delay timers are NOT awaited - the first
    // success resolves immediately and aborts any pending hedges.
    for (let i = 1; i < maxAttempts; i++) {
      const keyIndex = await this.selectBestKey(provider, attemptedKeys);
      if (keyIndex === -1) break;

      attemptedKeys.add(keyIndex);
      expectedCount++;

      // Delay before sending hedged request
      const delay = this.config.hedgeDelayMs * i;
      setTimeout(() => {
        if (abortController.signal.aborted) {
          // Cancelled before this hedge fired - count it as settled
          onSettled();
          return;
        }
        sentCount++;
        this.executeSingleRequest(provider, request, config, keyIndex, abortController.signal, rawBody)
          .then(handleResult, handleError);
      }, delay);
    }

    // Wait for the first success - resolves the moment a 2xx arrives
    try {
      const firstSuccess = await firstSuccessPromise;

      const firstSuccessAt = Date.now() - startTime;
      const cancelled = sentCount - 1;

      return {
        response: firstSuccess,
        hedgeInfo: {
          hedged: true,
          attempts: sentCount,
          firstSuccessAt,
          cancelled,
        },
      };
    } catch (error) {
      abortController.abort();
      throw error;
    }
  }

  /**
   * Execute a single request with a specific key
   */
  private async executeSingleRequest(
    provider: Provider,
    request: ChatCompletionRequest,
    config: AppConfig,
    keyIndex: number,
    signal: AbortSignal,
    rawBody?: string
  ): Promise<HedgedResponse> {
  const keys = getProviderKeys(provider);
  const key = keys[keyIndex];
  const keyHash = getKeyHash(key);

  // Check if already cancelled before consuming rate limiter slot
  if (signal.aborted) {
    throw new Error('Request cancelled before execution');
  }

  // Wait for rate limiter for this specific key
  await providerRateLimiter.waitForSlot(provider.id, keyHash);
  try {

  const url = buildUpstreamUrl(provider);
    const headers = buildUpstreamHeaders(provider, key);

    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody ?? JSON.stringify(request),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });

    const status = upstreamResponse.status;

    // Parse rate limit headers
    const rateLimitInfo = parseRateLimitHeaders(upstreamResponse.headers);
    if (rateLimitInfo.limit || rateLimitInfo.remaining !== undefined || 
        rateLimitInfo.resetMs || rateLimitInfo.retryAfterMs) {
      providerRateLimiter.updateFromHeaders(provider.id, keyHash, upstreamResponse.headers);
    }

    let responseBody: any;
    try {
      const text = await upstreamResponse.text();
      try { responseBody = JSON.parse(text); } catch { responseBody = text; }
    } catch {
      responseBody = { error: { message: 'Failed to read response' } };
    }

  if (status >= 200 && status < 300) {
    markKeySuccess(provider.id, keyIndex);
  } else {
    markKeyError(provider.id, keyIndex, `HTTP ${status}`);
  }

  return {
    status,
    body: responseBody,
    keyIndex,
    retries: 0,
    headers: Object.fromEntries(upstreamResponse.headers.entries()),
    streamResponse: null,
  };
} finally {
      providerRateLimiter.release(provider.id, keyHash);
    }
  }

  /**
   * Select the best available key (least used, healthy)
   */
private async selectBestKey(provider: Provider, exclude: Set<number> = new Set()): Promise<number> {
  const keyResult = selectBestApiKey(provider);
    if (!keyResult) return -1;
    
    // If excluded, try to find another
    if (exclude.has(keyResult.index)) {
      const keys = getProviderKeys(provider);
      const health = getKeyHealthSummary();
      for (let i = 0; i < keys.length; i++) {
        if (!exclude.has(i)) {
          // Check if key is healthy
          const keyHealth = health.providers[provider.id]?.keys[i];
          if (keyHealth?.health === 'healthy') {
            return i;
          }
        }
      }
      return -1;
    }
    
    return keyResult.index;
  }

  /**
   * Determine if request should be hedged
   */
  private shouldHedge(request: ChatCompletionRequest): boolean {
    if (!this.config.enabled) return false;
    if (this.config.excludeStreaming && request.stream) return false;
    if (this.config.excludeHighTemperature && 
        request.temperature !== undefined && 
        request.temperature > this.config.temperatureThreshold) return false;
    return true;
  }

  /**
   * Update hedging configuration
   */
  updateConfig(config: Partial<HedgingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<HedgingConfig> {
    return { ...this.config };
  }
}

/**
 * Global hedger instance
 */
export const requestHedger = new RequestHedger({
  enabled: false,
  maxHedgedRequests: 2,
  hedgeDelayMs: 500,
  cancelOnFirstSuccess: true,
  excludeStreaming: true,
  excludeHighTemperature: true,
  temperatureThreshold: 0.5,
});