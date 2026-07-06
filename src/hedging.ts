// ============================================================
// AI Gateway — Request Hedging
// Sends requests to multiple keys simultaneously, returns first success
// ============================================================

import type { Provider, ChatCompletionRequest, AppConfig } from './types';
import { getProviderKeys } from './config';
import { getKeyHash } from './key-pool';
import { providerRateLimiter } from './rate-limiter';

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
  enabled: true,
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
    config: AppConfig
  ): Promise<HedgingResult> {
    // Check if hedging should be applied
    if (!this.shouldHedge(request)) {
      // Fall back to normal single-key execution
      const { forwardWithRetry } = await import('./forwarder');
      const result = await forwardWithRetry(provider, request, config);
      return {
        response: result,
        hedgeInfo: { hedged: false, attempts: 1, firstSuccessAt: 0, cancelled: 0 },
      };
    }

    const keys = getProviderKeys(provider);
    if (keys.length < 2) {
      // Not enough keys for hedging
      const { forwardWithRetry } = await import('./forwarder');
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
    const results: Promise<HedgedResponse>[] = [];
    
    // Send first request immediately
    const firstKeyIndex = await this.selectBestKey(provider);
    attemptedKeys.add(firstKeyIndex);
    results.push(this.executeSingleRequest(
      provider, request, config, firstKeyIndex, abortController.signal
    ));

    // Schedule hedged requests
    const hedgePromises: Promise<void>[] = [];
    for (let i = 1; i < maxAttempts; i++) {
      const keyIndex = await this.selectBestKey(provider, attemptedKeys);
      if (keyIndex === -1) break;
      
      attemptedKeys.add(keyIndex);
      
      // Delay before sending hedged request
      const delay = this.config.hedgeDelayMs * i;
      hedgePromises.push(
        new Promise<void>(resolve => setTimeout(resolve, delay)).then(() => {
          if (!abortController.signal.aborted) {
            results.push(this.executeSingleRequest(
              provider, request, config, keyIndex, abortController.signal
            ));
          }
        })
      );
    }

    // Wait for all hedge delays to be scheduled
    await Promise.all(hedgePromises);

    // Race all requests - return first success
    try {
      const firstSuccess = await this.waitForFirstSuccess(results, abortController);
      
      const firstSuccessAt = Date.now() - startTime;
      const cancelled = results.length - 1;
      
      if (this.config.cancelOnFirstSuccess) {
        abortController.abort('First request succeeded');
      }

      return {
        response: firstSuccess,
        hedgeInfo: {
          hedged: true,
          attempts: results.length,
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
   * Wait for first successful response from any request
   */
  private async waitForFirstSuccess(
    promises: Promise<HedgedResponse>[],
    abortSignal: AbortSignal
  ): Promise<HedgedResponse> {
    // Create a promise that resolves on first success
    const racePromise = Promise.race(
      promises.map(p => p.then(
        result => {
          if (result.status >= 200 && result.status < 300) {
            return result;
          }
          // Treat non-success as rejection for racing
          throw new Error(`HTTP ${result.status}`);
        },
        err => { throw err; }
      ))
    );

    try {
      return await racePromise;
    } catch {
      // All failed - wait for all to complete to get the last error
      const allResults = await Promise.allSettled(promises);
      const lastError = allResults.find(r => r.status === 'rejected')?.reason;
      throw lastError || new Error('All hedged requests failed');
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
    signal: AbortSignal
  ): Promise<HedgedResponse> {
    const keys = getProviderKeys(provider);
    const key = keys[keyIndex];
    const keyHash = getKeyHash(key);

    // Wait for rate limiter for this specific key
    await providerRateLimiter.waitForSlot(provider.id, keyHash);

    const { buildUpstreamUrl, buildUpstreamHeaders } = await import('./forwarder');
    const { markKeySuccess, markKeyError } = await import('./key-pool');
    const { parseRateLimitHeaders } = await import('./rate-limiter');

    const url = buildUpstreamUrl(provider);
    const headers = buildUpstreamHeaders(provider, key);

    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
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
    };
  }

  /**
   * Select the best available key (least used, healthy)
   */
  private async selectBestKey(provider: Provider, exclude: Set<number> = new Set()): Promise<number> {
    const { selectBestApiKey, getKeyHealthSummary } = await import('./key-pool');
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
  enabled: true,
  maxHedgedRequests: 2,
  hedgeDelayMs: 500,
  cancelOnFirstSuccess: true,
  excludeStreaming: true,
  excludeHighTemperature: true,
  temperatureThreshold: 0.5,
});