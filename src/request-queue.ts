// ============================================================
// AI Gateway — Request Queue
// Queues requests when all keys are busy, processes them
// as soon as a key becomes available
// ============================================================

import type { Provider, ChatCompletionRequest, AppConfig, ForwardResult, QueueConfig } from './types';
import { getProviderKeys } from './config';
import { getKeyHash, selectBestApiKey } from './key-pool';
import { forwardWithRetry } from './forwarder';
import { providerRateLimiter } from './rate-limiter';

// ============================================================
// Types
// ============================================================
export interface QueuedRequest {
  id: string;
  provider: Provider;
  body: ChatCompletionRequest;
  config: AppConfig;
  resolve: (result: ForwardResult) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timeoutMs: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

export interface QueueStats {
  size: number;
  totalEnqueued: number;
  totalDequeued: number;
  totalTimedOut: number;
  totalDrained: number;
  averageWaitMs: number;
}

// ============================================================
// Request Queue Class
// ============================================================
class RequestQueue {
  private queues: Map<string, QueuedRequest[]> = new Map();
  private config: Required<QueueConfig>;
  private totalEnqueued = 0;
  private totalDequeued = 0;
  private totalTimedOut = 0;
  private totalDrained = 0;
  private totalWaitMs = 0;
  private waitCount = 0;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxSize: config.maxSize ?? 100,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
    };
  }

  /**
   * Enqueue a request for a provider. Returns a promise that resolves
   * when the request is processed (a key becomes available).
   * If the queue is full, returns null immediately.
   */
  enqueue(
    provider: Provider,
    body: ChatCompletionRequest,
    config: AppConfig
  ): Promise<ForwardResult> | null {
    if (!this.config.enabled) return null;

    const providerId = provider.id;
    if (!this.queues.has(providerId)) {
      this.queues.set(providerId, []);
    }

    const queue = this.queues.get(providerId)!;
    if (queue.length >= this.config.maxSize) {
      console.log(`[queue] Queue full for ${providerId} (${queue.length}/${this.config.maxSize})`);
      return null;
    }

    return new Promise<ForwardResult>((resolve, reject) => {
      const id = `${providerId}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const timeoutMs = this.config.defaultTimeoutMs;

      const timeoutTimer = setTimeout(() => {
        this.removeFromQueue(providerId, id);
        this.totalTimedOut++;
        console.log(`[queue] Request ${id} timed out after ${timeoutMs}ms`);
        reject(new Error(`Request queued for ${providerId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const queued: QueuedRequest = {
        id,
        provider,
        body,
        config,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timeoutMs,
        timeoutTimer,
      };

      queue.push(queued);
      this.totalEnqueued++;
      console.log(`[queue] Enqueued request ${id} for ${providerId} (queue size: ${queue.length})`);
    });
  }

  /**
   * Dequeue the next request for a provider
   */
  dequeue(providerId: string): QueuedRequest | null {
    const queue = this.queues.get(providerId);
    if (!queue || queue.length === 0) return null;

    const request = queue.shift()!;
    clearTimeout(request.timeoutTimer);
    this.totalDequeued++;
    const waitMs = Date.now() - request.enqueuedAt;
    this.totalWaitMs += waitMs;
    this.waitCount++;
    console.log(`[queue] Dequeued request ${request.id} for ${providerId} (waited ${waitMs}ms, queue size: ${queue.length})`);
    return request;
  }

  /**
   * Remove a specific request from the queue by ID
   */
  private removeFromQueue(providerId: string, id: string): void {
    const queue = this.queues.get(providerId);
    if (!queue) return;

    const idx = queue.findIndex(r => r.id === id);
    if (idx >= 0) {
      queue.splice(idx, 1);
    }
  }

  /**
   * Drain the queue for a provider — process as many queued requests
   * as there are healthy keys available
   */
  async drain(providerId: string): Promise<void> {
    const queue = this.queues.get(providerId);
    if (!queue || queue.length === 0) return;

    console.log(`[queue] Draining queue for ${providerId} (${queue.length} requests)`);

    let processed = 0;
    while (queue.length > 0) {
      // Check if there's a healthy key available
      const keyResult = selectBestApiKey(queue[0].provider);
      if (!keyResult) {
        // No healthy keys — stop draining for now
        break;
      }

      const request = this.dequeue(providerId);
      if (!request) break;

      processed++;
      this.totalDrained++;

      // Process the request in the background
      this.processQueuedRequest(request);
    }

    if (processed > 0) {
      console.log(`[queue] Drained ${processed} requests for ${providerId}`);
    }
  }

  /**
   * Process a single queued request
   */
  private async processQueuedRequest(request: QueuedRequest): Promise<void> {
    try {
      const result = await forwardWithRetry(request.provider, request.body, request.config);
      request.resolve(result);
    } catch (err: any) {
      request.reject(err);
    }
  }

  /**
   * Get the queue size for a provider
   */
  size(providerId: string): number {
    return this.queues.get(providerId)?.length || 0;
  }

  /**
   * Check if a provider has queued requests
   */
  hasQueued(providerId: string): boolean {
    return this.size(providerId) > 0;
  }

  /**
   * Get queue statistics
   */
  getStats(): Record<string, QueueStats> {
    const stats: Record<string, QueueStats> = {};
    for (const [providerId, queue] of this.queues.entries()) {
      stats[providerId] = {
        size: queue.length,
        totalEnqueued: this.totalEnqueued,
        totalDequeued: this.totalDequeued,
        totalTimedOut: this.totalTimedOut,
        totalDrained: this.totalDrained,
        averageWaitMs: this.waitCount > 0 ? Math.round(this.totalWaitMs / this.waitCount) : 0,
      };
    }
    return stats;
  }

  /**
   * Get overall queue stats
   */
  getOverallStats(): { totalQueued: number; totalDequeued: number; totalTimedOut: number; totalDrained: number; averageWaitMs: number } {
    return {
      totalQueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      totalTimedOut: this.totalTimedOut,
      totalDrained: this.totalDrained,
      averageWaitMs: this.waitCount > 0 ? Math.round(this.totalWaitMs / this.waitCount) : 0,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[queue] Config updated:', this.config);
  }

  /**
   * Get current config
   */
  getConfig(): Required<QueueConfig> {
    return { ...this.config };
  }
}

// Singleton instance
export const requestQueue = new RequestQueue();