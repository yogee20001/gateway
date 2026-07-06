// ============================================================
// AI Gateway — Response Caching System
// ============================================================

import { createHash } from 'crypto';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  key: string;
}

export interface CacheConfig {
  enabled: boolean;
  maxSize: number;           // Maximum number of entries
  defaultTtlMs: number;      // Default TTL in milliseconds
  maxTtlMs: number;          // Maximum TTL
  cacheableStatusCodes: number[];  // Which status codes to cache
  excludePatterns?: string[];      // Request patterns to exclude
  keyPrefix?: string;              // Prefix for cache keys
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  memoryUsage: number;  // approximate bytes
}

/**
 * LRU Response Cache with TTL support
 * Thread-safe for async operations
 */
export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private config: Required<CacheConfig>;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private accessOrder = new Set<string>(); // For LRU tracking

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxSize: config.maxSize ?? 1000,
      defaultTtlMs: config.defaultTtlMs ?? 300000, // 5 minutes
      maxTtlMs: config.maxTtlMs ?? 3600000, // 1 hour
      cacheableStatusCodes: config.cacheableStatusCodes ?? [200],
      excludePatterns: config.excludePatterns ?? [],
      keyPrefix: config.keyPrefix ?? 'gateway:cache:',
    };
  }

  /**
   * Generate cache key from request
   */
  generateKey(request: CacheableRequest): string {
    // Create deterministic hash of cacheable request parts
    const cacheableParts = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 1.0,
      max_tokens: request.max_tokens,
      top_p: request.top_p ?? 1.0,
      frequency_penalty: request.frequency_penalty ?? 0,
      presence_penalty: request.presence_penalty ?? 0,
      stream: false, // Never cache streaming responses
    };

    const hash = createHash('sha256')
      .update(JSON.stringify(cacheableParts))
      .digest('hex')
      .substring(0, 32);

    return `${this.config.keyPrefix}${hash}`;
  }

  /**
   * Check if request should be cached
   */
  shouldCache(request: CacheableRequest): boolean {
    if (!this.config.enabled) return false;
    if (request.stream) return false; // Never cache streaming

    // Check exclude patterns
    const requestStr = JSON.stringify(request);
    for (const pattern of this.config.excludePatterns) {
      if (requestStr.includes(pattern)) return false;
    }

    return true;
  }

  /**
   * Get cached response if valid
   */
  get(key: string): CacheEntry | null {
    if (!this.config.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.misses++;
      return null;
    }

    // Update LRU
    this.accessOrder.delete(key);
    this.accessOrder.add(key);
    
    entry.hits++;
    this.hits++;
    return entry;
  }

  /**
   * Store response in cache
   */
  set(key: string, data: any, status: number, customTtlMs?: number): void {
    if (!this.config.enabled) return;
    if (!this.config.cacheableStatusCodes.includes(status)) return;

    const now = Date.now();
    const ttl = Math.min(
      customTtlMs ?? this.config.defaultTtlMs,
      this.config.maxTtlMs
    );

    // Evict if at capacity
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      data,
      timestamp: now,
      ttl,
      hits: 0,
      key,
    };

    this.cache.set(key, entry);
    this.accessOrder.add(key);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    const lruKey = this.accessOrder.values().next().value;
    if (lruKey) {
      this.cache.delete(lruKey);
      this.accessOrder.delete(lruKey);
      this.evictions++;
    }
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidate(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let memoryUsage = 0;
    for (const entry of this.cache.values()) {
      memoryUsage += JSON.stringify(entry.data).length * 2; // rough estimate
      memoryUsage += entry.key.length * 2;
    }

    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
      memoryUsage,
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

/**
 * Request type for caching (subset of ChatCompletionRequest)
 */
export interface CacheableRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
}

/**
 * Global cache instance
 */
export const responseCache = new ResponseCache({
  enabled: true,
  maxSize: 1000,
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxTtlMs: 60 * 60 * 1000, // 1 hour
  cacheableStatusCodes: [200],
  excludePatterns: ['stream', 'temperature: 0'], // Don't cache deterministic requests
});