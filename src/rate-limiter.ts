// ============================================================
// AI Gateway ΓÇö Provider-Level Rate Limiting (Optimized)
// ============================================================

import type { Provider } from './types';
import { getKeyHash } from './key-pool';

export interface RateLimitConfig {
  requestsPerWindow: number;
  windowMs: number;
  maxConcurrent?: number; // Per-key concurrency limit (default: 4)
  providerMaxConcurrent?: number; // Provider-wide concurrency limit (default: Infinity)
  /** Provider-level shared rate limit (total across all keys). Default: 0 (disabled) */
  providerRequestsPerWindow?: number;
  /** Provider-level shared rate limit window. Default: same as windowMs */
  providerWindowMs?: number;
}

export interface ParsedRateLimitInfo {
  limit?: number;
  remaining?: number;
  resetMs?: number;
  retryAfterMs?: number;
}

// Per-key rate limit state
export interface KeyRateLimitState {
  tokens: number;
  lastRefill: number;
  queuedRequests: Array<() => void>;
  isProcessing: boolean;
  // Concurrency tracking
  inFlight: number; // Currently in-flight requests
  maxConcurrent: number; // Max allowed in-flight per key
}

export interface ProviderRateLimitState {
  keys: Map<string, KeyRateLimitState>;
  globalConfig: RateLimitConfig;
  inFlight: number; // Total in-flight across all keys
  providerMaxConcurrent: number; // Provider-wide max concurrent
  // Provider-level shared token bucket (total across all keys)
  providerTokens: number;
  providerLastRefill: number;
  providerRequestsPerWindow: number;
  providerWindowMs: number;
  providerQueue: Array<() => void>;
  providerQueueProcessing: boolean;
}

/**
 * Parse standard and provider-specific rate limit headers from upstream response
 */
export function parseRateLimitHeaders(headers: Headers): ParsedRateLimitInfo {
  const info: ParsedRateLimitInfo = {};

  // Standard headers (RFC 6585)
  const limit = headers.get('x-ratelimit-limit') || headers.get('x-rate-limit-limit');
  const remaining = headers.get('x-ratelimit-remaining') || headers.get('x-rate-limit-remaining');
  const reset = headers.get('x-ratelimit-reset') || headers.get('x-rate-limit-reset');
  const retryAfter = headers.get('retry-after');

  // Anthropic-specific
  const anthropicLimit = headers.get('anthropic-ratelimit-requests-limit');
  const anthropicRemaining = headers.get('anthropic-ratelimit-requests-remaining');
  const anthropicReset = headers.get('anthropic-ratelimit-requests-reset');

  // OpenAI-specific (new format)
  const openaiLimit = headers.get('x-ratelimit-limit-requests');
  const openaiRemaining = headers.get('x-ratelimit-remaining-requests');
  const openaiReset = headers.get('x-ratelimit-reset-requests');

  // Google-specific
  const googleLimit = headers.get('x-ratelimit-limit');
  const googleRemaining = headers.get('x-ratelimit-remaining');
  const googleReset = headers.get('x-ratelimit-reset');

  // Prefer provider-specific headers over generic ones
  if (anthropicLimit) info.limit = parseInt(anthropicLimit, 10);
  else if (openaiLimit) info.limit = parseInt(openaiLimit, 10);
  else if (limit) info.limit = parseInt(limit, 10);
  else if (googleLimit) info.limit = parseInt(googleLimit, 10);

  if (anthropicRemaining) info.remaining = parseInt(anthropicRemaining, 10);
  else if (openaiRemaining) info.remaining = parseInt(openaiRemaining, 10);
  else if (remaining) info.remaining = parseInt(remaining, 10);
  else if (googleRemaining) info.remaining = parseInt(googleRemaining, 10);

  // Parse reset time - could be seconds (Unix timestamp) or milliseconds
  const resetValue = anthropicReset || openaiReset || reset || googleReset;
  if (resetValue) {
    const val = parseInt(resetValue, 10);
    if (val > 1e12) {
      // Looks like milliseconds
      info.resetMs = val;
    } else {
      // Unix timestamp in seconds
      info.resetMs = val * 1000;
    }
  }

  // Parse Retry-After (seconds)
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      info.retryAfterMs = seconds * 1000;
    }
  }

  return info;
}

/**
 * Optimized token bucket rate limiter with per-key tracking
 * Allows parallel requests across multiple API keys
 * Respects upstream rate limit headers when available
 */
export class ProviderRateLimiter {
  private states: Map<string, ProviderRateLimitState> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();

  /**
   * Configure rate limit for a provider
   * Can be overridden by upstream headers at runtime
   */
  configure(providerId: string, config: RateLimitConfig): void {
    this.configs.set(providerId, config);
    if (!this.states.has(providerId)) {
      this.states.set(providerId, {
        keys: new Map(),
        globalConfig: config,
        inFlight: 0,
        providerMaxConcurrent: config.providerMaxConcurrent ?? Infinity,
      providerTokens: config.providerRequestsPerWindow ?? 0,
      providerLastRefill: Date.now(),
      providerRequestsPerWindow: config.providerRequestsPerWindow ?? 0,
      providerWindowMs: config.providerWindowMs ?? config.windowMs,
      providerQueue: [],
      providerQueueProcessing: false,
      });
    }
  }

  /**
   * Initialize or get per-key rate limit state
   */
  private getKeyState(providerId: string, keyHash: string, config: RateLimitConfig): KeyRateLimitState {
    const providerState = this.states.get(providerId);
    if (!providerState) {
      throw new Error(`Provider ${providerId} not configured`);
    }
    
    let keyState = providerState.keys.get(keyHash);
    if (!keyState) {
      keyState = {
        tokens: config.requestsPerWindow,
        lastRefill: Date.now(),
        queuedRequests: [],
        isProcessing: false,
        inFlight: 0,
        maxConcurrent: config.maxConcurrent ?? 4,
      };
      providerState.keys.set(keyHash, keyState);
    }
    return keyState;
  }

  /**
   * Acquire a token for a specific key, queue if necessary
   * Returns a promise that resolves when a token is available
   */
  async acquire(providerId: string, keyHash: string): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config) {
      console.warn('[rate-limiter] No config for provider "' + providerId + '" - rate limiting BYPASSED');
      return;
    }

    const keyState = this.getKeyState(providerId, keyHash, config);
    const providerState = this.states.get(providerId);
    this.refillIfNeeded(config, keyState);

    // Check provider-level concurrency first
    if (providerState && providerState.inFlight >= providerState.providerMaxConcurrent) {
      return new Promise<void>((resolve) => {
        keyState.queuedRequests.push(resolve);
        this.processQueue(providerId, keyHash, config);
      });
    }

    // Then check per-key concurrency
    if (keyState.inFlight >= keyState.maxConcurrent) {
      return new Promise<void>((resolve) => {
        keyState.queuedRequests.push(resolve);
        this.processQueue(providerId, keyHash, config);
      });
    }

    // Check provider-level shared token bucket
    if (providerState && providerState.providerRequestsPerWindow > 0) {
      this.refillProviderIfNeeded(providerState);
      if (providerState.providerTokens <= 0) {
        return new Promise<void>((resolve) => {
          providerState.providerQueue.push(resolve);
          this.processProviderQueue(providerId);
        });
      }
      providerState.providerTokens--;
    }

    if (keyState.tokens > 0) {
      keyState.tokens--;
      keyState.inFlight++;
      if (providerState) providerState.inFlight++;
      return;
    }

    // No tokens available - queue the request
    return new Promise<void>((resolve) => {
      keyState.queuedRequests.push(resolve);
      this.processQueue(providerId, keyHash, config);
    });
  }
  /**
   * Release a slot after request completes
   */
  release(providerId: string, keyHash: string): void {
    const config = this.configs.get(providerId);
    if (!config) return;
    const providerState = this.states.get(providerId);
    if (!providerState) return;
    const keyState = providerState.keys.get(keyHash);
    if (keyState) {
      if (keyState.inFlight > 0) keyState.inFlight--;
      if (providerState.inFlight > 0) providerState.inFlight--;
      this.processQueue(providerId, keyHash, config);
    }
    this.processProviderQueue(providerId);
  }

  async waitForSlot(providerId: string, keyHash?: string): Promise<void> {
    if (!keyHash) {
      // Fallback to global limiting if no key provided
      return this.acquireGlobal(providerId);
    }
    return this.acquire(providerId, keyHash);
  }

  /**
   * Legacy global acquire for backward compatibility
   */
  private async acquireGlobal(providerId: string): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config) {
      console.warn('[rate-limiter] No config for provider "' + providerId + '" - rate limiting BYPASSED');
      return;
    }

    let state = this.states.get(providerId);
    if (!state) {
      state = {
        keys: new Map(),
        globalConfig: config,
        inFlight: 0,
        providerMaxConcurrent: config.providerMaxConcurrent ?? Infinity,
        providerTokens: config.providerRequestsPerWindow ?? 0,
        providerLastRefill: Date.now(),
        providerRequestsPerWindow: config.providerRequestsPerWindow ?? 0,
        providerWindowMs: config.providerWindowMs ?? config.windowMs,
        providerQueue: [],
        providerQueueProcessing: false,
      };
      this.states.set(providerId, state);
    }

    // Use a special "global" key
    const keyState = this.getKeyState(providerId, '__global__', config);
    
    this.refillIfNeeded(config, keyState);

    // Check provider-level concurrency
    if (state && state.inFlight >= state.providerMaxConcurrent) {
      return new Promise<void>((resolve) => {
        keyState.queuedRequests.push(resolve);
        this.processQueue(providerId, '__global__', config);
      });
    }

    // Check provider-level shared token bucket
    if (state && state.providerRequestsPerWindow > 0) {
      this.refillProviderIfNeeded(state);
      if (state.providerTokens <= 0) {
        return new Promise<void>((resolve) => {
          state.providerQueue.push(resolve);
          this.processProviderQueue(providerId);
        });
      }
      state.providerTokens--;
    }

    if (keyState.tokens > 0) {
      keyState.tokens--;
      state.inFlight++;
      return;
    }

    return new Promise<void>((resolve) => {
      keyState.queuedRequests.push(resolve);
      this.processQueue(providerId, '__global__', config);
    });
  }

  /**
   * Update rate limit state from upstream parsed rate limit info
   * Called after receiving a response from the upstream API
   */
  updateFromUpstream(providerId: string, keyHash: string, info: { limit?: number; remaining?: number; resetMs?: number; retryAfterMs?: number }): void {
    const config = this.configs.get(providerId);
    if (!config) return;

    const keyState = this.getKeyState(providerId, keyHash, config);

    // If upstream provides limit, update our config
    if (info.limit && info.limit !== config.requestsPerWindow) {
      config.requestsPerWindow = info.limit;
    }

    // If upstream provides remaining, use that as our current tokens
    if (info.remaining !== undefined) {
      keyState.tokens = info.remaining;
    }

    // If upstream provides reset time, schedule refill
    if (info.resetMs) {
      const now = Date.now();
      const delay = Math.max(0, info.resetMs - now);
      setTimeout(() => this.refillKey(providerId, keyHash), delay);
    }

    // If Retry-After present, force wait
    if (info.retryAfterMs && info.retryAfterMs > 0) {
      keyState.tokens = 0;
      setTimeout(() => this.refillKey(providerId, keyHash), info.retryAfterMs);
    }
  }

  /**
   * Update rate limit state from full upstream headers
   * Parses standard and provider-specific rate limit headers
   */
  updateFromHeaders(providerId: string, keyHash: string, headers: Headers): void {
    const info = parseRateLimitHeaders(headers);
    if (info.limit || info.remaining !== undefined || info.resetMs || info.retryAfterMs) {
      this.updateFromUpstream(providerId, keyHash, info);
    }
  }

  private refillIfNeeded(config: RateLimitConfig, keyState: KeyRateLimitState): void {
    const now = Date.now();
    const elapsed = now - keyState.lastRefill;

    if (elapsed >= config.windowMs) {
      // Full refill
      keyState.tokens = config.requestsPerWindow;
      keyState.lastRefill = now;
    }
  }

  private refillProviderIfNeeded(state: ProviderRateLimitState): void {
    if (state.providerRequestsPerWindow <= 0) return;
    const now = Date.now();
    const elapsed = now - state.providerLastRefill;

    if (elapsed >= state.providerWindowMs) {
      state.providerTokens = state.providerRequestsPerWindow;
      state.providerLastRefill = now;
    }
  }

  private refillKey(providerId: string, keyHash: string): void {
    const config = this.configs.get(providerId);
    const providerState = this.states.get(providerId);
    if (!config || !providerState) return;

    const keyState = providerState.keys.get(keyHash);
    if (!keyState) return;

    if (keyState.tokens < config.requestsPerWindow) {
      keyState.tokens = config.requestsPerWindow;
      keyState.lastRefill = Date.now();
    }
    this.processQueue(providerId, keyHash, config);
  }

  private processQueue(providerId: string, keyHash: string, config: RateLimitConfig): void {
    const providerState = this.states.get(providerId);
    if (!providerState) return;
    
    const keyState = providerState.keys.get(keyHash);
    if (!keyState || keyState.isProcessing) return;

    keyState.isProcessing = true;

    while (keyState.tokens > 0 && keyState.inFlight < keyState.maxConcurrent && providerState.inFlight < providerState.providerMaxConcurrent && keyState.queuedRequests.length > 0) {
      keyState.tokens--;
      keyState.inFlight++;
      providerState.inFlight++;
      const resolve = keyState.queuedRequests.shift();
      if (resolve) resolve();
    }

    keyState.isProcessing = false;

    // If queue still has requests and no tokens, schedule refill
    if (keyState.queuedRequests.length > 0 && keyState.tokens === 0) {
      const nextRefill = keyState.lastRefill + config.windowMs;
      const delay = Math.max(0, nextRefill - Date.now());
      if (delay > 10) {
        setTimeout(() => {
          this.refillKey(providerId, keyHash);
        }, delay);
      }
    }
  }

  private processProviderQueue(providerId: string): void {
    const providerState = this.states.get(providerId);
    if (!providerState) return;

    this.refillProviderIfNeeded(providerState);
    if (providerState.providerQueueProcessing) return;
    providerState.providerQueueProcessing = true;

    while (providerState.providerTokens > 0 && providerState.providerQueue.length > 0) {
      providerState.providerTokens--;
      const resolve = providerState.providerQueue.shift();
      if (resolve) resolve();
    }

    providerState.providerQueueProcessing = false;

    if (providerState.providerQueue.length > 0 && providerState.providerTokens <= 0) {
      const nextRefill = providerState.providerLastRefill + providerState.providerWindowMs;
      const delay = Math.max(0, nextRefill - Date.now());
      if (delay > 10) {
        setTimeout(() => {
          this.processProviderQueue(providerId);
        }, delay);
      }
    }
  }

  /**
   * Get current rate limit status for a provider
   */
  getStatus(providerId: string): { tokens: number; limit: number; windowMs: number; keyCount: number; providerTokens?: number; providerLimit?: number } | null {
    const config = this.configs.get(providerId);
    const providerState = this.states.get(providerId);
    if (!config || !providerState) return null;

    // Sum tokens across all keys
    let totalTokens = 0;
    for (const [, keyState] of providerState.keys.entries()) {
      this.refillIfNeeded(config, keyState);
      totalTokens += keyState.tokens;
    }

    const result: { tokens: number; limit: number; windowMs: number; keyCount: number; providerTokens?: number; providerLimit?: number } = {
      tokens: totalTokens,
      limit: config.requestsPerWindow * providerState.keys.size,
      windowMs: config.windowMs,
      keyCount: providerState.keys.size,
    };

    if (providerState.providerRequestsPerWindow > 0) {
      this.refillProviderIfNeeded(providerState);
      result.providerTokens = providerState.providerTokens;
      result.providerLimit = providerState.providerRequestsPerWindow;
    }

    return result;
  }

  /**
   * Get rate limit status for a specific key
   */
  getKeyStatus(providerId: string, keyHash: string): { tokens: number; limit: number; windowMs: number } | null {
    const config = this.configs.get(providerId);
    const providerState = this.states.get(providerId);
    if (!config || !providerState) return null;

    const keyState = providerState.keys.get(keyHash);
    if (!keyState) return null;

    this.refillIfNeeded(config, keyState);

    return {
      tokens: keyState.tokens,
      limit: config.requestsPerWindow,
      windowMs: config.windowMs,
    };
  }

  /**
   * Reset rate limit state for a provider (useful for testing or config changes)
   */
  reset(providerId: string): void {
    const config = this.configs.get(providerId);
    if (config) {
      this.states.set(providerId, {
        keys: new Map(),
        globalConfig: config,
        inFlight: 0,
        providerMaxConcurrent: config.providerMaxConcurrent ?? Infinity,
      providerTokens: config.providerRequestsPerWindow ?? 0,
      providerLastRefill: Date.now(),
      providerRequestsPerWindow: config.providerRequestsPerWindow ?? 0,
      providerWindowMs: config.providerWindowMs ?? config.windowMs,
      providerQueue: [],
      providerQueueProcessing: false,
      });
    }
  }
}

// Singleton instance
export const providerRateLimiter = new ProviderRateLimiter();

/**
 * Default rate limit configurations for known providers
 * These are PER-KEY limits. With 4 NVIDIA keys at 30 RPM each = 120 RPM total
 * These are conservative defaults - actual limits from upstream headers will override
 */
export const DEFAULT_PROVIDER_RATE_LIMITS: Record<string, RateLimitConfig> = {
  openai: { requestsPerWindow: 500, windowMs: 60000, maxConcurrent: 8, providerMaxConcurrent: 100 },
  anthropic: { requestsPerWindow: 50, windowMs: 60000, maxConcurrent: 4, providerMaxConcurrent: 50 },
  google: { requestsPerWindow: 60, windowMs: 60000, maxConcurrent: 4, providerMaxConcurrent: 60 },
  deepseek: { requestsPerWindow: 60, windowMs: 60000, maxConcurrent: 4, providerMaxConcurrent: 60 },
  nvidia: { requestsPerWindow: 32, windowMs: 60000, maxConcurrent: 4, providerMaxConcurrent: 32, providerRequestsPerWindow: 32 },
  perplexity: { requestsPerWindow: 50, windowMs: 60000, maxConcurrent: 4, providerMaxConcurrent: 50 },
};

/**
 * Initialize rate limiters from provider configuration
 */
export function initializeRateLimiters(providers: Provider[]): void {
  for (const provider of providers) {
    if (provider.rateLimit) {
      providerRateLimiter.configure(provider.id, provider.rateLimit);
    } else {
      const defaultLimit = DEFAULT_PROVIDER_RATE_LIMITS[provider.id];
      if (defaultLimit) {
        providerRateLimiter.configure(provider.id, defaultLimit);
      }
    }
  }
}
