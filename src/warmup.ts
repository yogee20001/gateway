// ============================================================
// AI Gateway — Model Warmup & Connection Pooling
// Keeps connections alive and models warm for faster first response
// ============================================================

import type { Provider, AppConfig } from './types';
import { getProviderKeys } from './config';
import { getKeyHash } from './key-pool';

export interface WarmupConfig {
  enabled: boolean;
  intervalMs: number;              // How often to send warmup requests
  warmupModels: string[];          // Models to keep warm (empty = all active)
  warmupPrompt: string;            // Minimal prompt for warmup
  maxTokens: number;               // Tokens for warmup (minimal)
  timeoutMs: number;               // Timeout for warmup requests
  concurrency: number;             // Max concurrent warmup requests
  skipIfRecentRequest: boolean;    // Skip if real request was recent
  recentRequestWindowMs: number;   // Window to check for recent requests
  // Smart warming options
  smartWarming: boolean;           // Enable smart warming for recently used models
  priorityIntervalMs: number;      // How often to warm priority models (more frequent)
  maxPriorityModels: number;       // Max number of recent models to prioritize
  priorityWindowMs: number;        // Time window to consider a model "recently used"
}

const DEFAULT_WARMUP_CONFIG: Required<WarmupConfig> = {
  enabled: true,
  intervalMs: 60000,              // Every 60 seconds
  warmupModels: [],               // Empty = all active models
  warmupPrompt: 'ping',           // Minimal prompt
  maxTokens: 1,                   // Just 1 token
  timeoutMs: 5000,                // 5 second timeout
  concurrency: 2,                 // Max 2 concurrent warmups
  skipIfRecentRequest: true,      // Skip if real request recently
  recentRequestWindowMs: 30000,   // 30 seconds
  // Smart warming defaults
  smartWarming: true,             // Enable smart warming by default
  priorityIntervalMs: 15000,      // Warm priority models every 15 seconds
  maxPriorityModels: 5,           // Track top 5 recently used models
  priorityWindowMs: 300000,       // 5 minutes - models used in last 5 min are priority
};

export interface WarmupStats {
  totalWarmed: number;
  successful: number;
  failed: number;
  lastWarmupAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  averageLatencyMs: number;
  skippedCount: number;
  priorityWarmed: number;         // Number of priority warmups performed
}

export interface ProviderConnectionState {
  providerId: string;
  keepAlive: boolean;
  activeConnections: number;
  lastActivity: number;
  lastWarmup: number | null;
  warmupStats: WarmupStats;
  connectionPool: Map<string, number>; // keyHash -> connection count
}

export interface ModelUsageInfo {
  model: string;
  providerId: string;
  lastUsed: number;
  useCount: number;
  isPriority: boolean;
}

export class ModelWarmer {
  private config: Required<WarmupConfig>;
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private priorityTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private states: Map<string, ProviderConnectionState> = new Map();
  private recentRequests: Map<string, number> = new Map(); // model -> timestamp
  private modelUsage: Map<string, ModelUsageInfo> = new Map(); // model -> usage info
  private running: boolean = false;

  constructor(config: Partial<WarmupConfig> = {}) {
    this.config = { ...DEFAULT_WARMUP_CONFIG, ...config };
  }

  /**
   * Start warming models for all active providers
   */
  async start(config: AppConfig): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const provider of config.providers) {
      if (!provider.isActive) continue;
      
      const models = this.getModelsForProvider(provider, config);
      if (models.length === 0) continue;

      await this.initializeProvider(provider, models);
      this.scheduleWarmup(provider, models);
      
      // Schedule priority warmup if smart warming is enabled
      if (this.config.smartWarming) {
        this.schedulePriorityWarmup(provider);
      }
    }

    console.log(`[warmup] Started warming ${this.states.size} providers${this.config.smartWarming ? ' with smart warming' : ''}`);
  }

  /**
   * Stop all warmup timers
   */
  stop(): void {
    this.running = false;
    for (const [providerId, timer] of this.timers) {
      clearInterval(timer);
      console.log(`[warmup] Stopped warmup for ${providerId}`);
    }
    this.timers.clear();
    
    for (const [providerId, timer] of this.priorityTimers) {
      clearInterval(timer);
      console.log(`[warmup] Stopped priority warmup for ${providerId}`);
    }
    this.priorityTimers.clear();
  }

  /**
   * Initialize provider state
   */
  private async initializeProvider(provider: Provider, models: string[]): Promise<void> {
    const keys = getProviderKeys(provider);
    const connectionPool = new Map<string, number>();
    
    for (const key of keys) {
      connectionPool.set(getKeyHash(key), 0);
    }

    this.states.set(provider.id, {
      providerId: provider.id,
      keepAlive: true,
      activeConnections: 0,
      lastActivity: Date.now(),
      lastWarmup: null,
      warmupStats: {
        totalWarmed: 0,
        successful: 0,
        failed: 0,
        lastWarmupAt: null,
        lastSuccessAt: null,
        lastError: null,
        averageLatencyMs: 0,
        skippedCount: 0,
        priorityWarmed: 0,
      },
      connectionPool,
    });

    console.log(`[warmup] Initialized ${provider.id} with ${models.length} models`);
  }

  /**
   * Get models to warm for a provider
   */
  private getModelsForProvider(provider: Provider, config: AppConfig): string[] {
    if (this.config.warmupModels.length > 0) {
      return this.config.warmupModels.filter(m => 
        config.providers.some(p => p.id === provider.id && 
          (p.modelPatterns || []).some(pattern => this.matchModel(m, pattern)))
      );
    }
    
    // Use provider's model patterns
    const patterns = provider.modelPatterns || [`${provider.id}/*`];
    // For now, return patterns as model identifiers
    return patterns;
  }

  /**
   * Schedule periodic warmup for a provider
   */
  private scheduleWarmup(provider: Provider, models: string[]): void {
    const timer = setInterval(async () => {
      if (!this.running) return;
      
      try {
        await this.warmupProvider(provider, models, false);
      } catch (error) {
        console.error(`[warmup] Error warming ${provider.id}:`, error);
      }
    }, this.config.intervalMs);

    this.timers.set(provider.id, timer);
    // Run initial warmup
    this.warmupProvider(provider, models, false).catch(console.error);
  }

  /**
   * Schedule priority warmup for recently used models
   */
  private schedulePriorityWarmup(provider: Provider): void {
    const timer = setInterval(async () => {
      if (!this.running) return;
      
      try {
        await this.warmupPriorityModels(provider);
      } catch (error) {
        console.error(`[warmup] Error in priority warmup for ${provider.id}:`, error);
      }
    }, this.config.priorityIntervalMs);

    this.priorityTimers.set(provider.id, timer);
    // Run initial priority warmup
    this.warmupPriorityModels(provider).catch(console.error);
  }

  /**
   * Warm up all models for a provider (regular warmup)
   */
  private async warmupProvider(provider: Provider, models: string[], isPriority: boolean): Promise<void> {
    const state = this.states.get(provider.id);
    if (!state) return;

    // Check if we should skip due to recent real requests
    if (this.config.skipIfRecentRequest && !isPriority) {
      const now = Date.now();
      let hasRecentRequest = false;
      
      for (const model of models) {
        const lastRequest = this.recentRequests.get(model) || 0;
        if (now - lastRequest < this.config.recentRequestWindowMs) {
          hasRecentRequest = true;
          break;
        }
      }
      
      if (hasRecentRequest) {
        state.warmupStats.skippedCount++;
        console.log(`[warmup] Skipping ${provider.id} - recent real request`);
        return;
      }
    }

    const label = isPriority ? 'priority' : 'regular';
    console.log(`[warmup] ${label} warming ${provider.id} models: ${models.join(', ')}`);
    
    const semaphore = new Semaphore(this.config.concurrency);
    const promises = models.map(model => 
      semaphore.acquire().then(async (release) => {
        try {
          const result = await this.warmupModel(provider, model, isPriority);
          release();
          return result;
        } catch (error) {
          release();
          throw error;
        }
      })
    );

    await Promise.allSettled(promises);
    state.lastWarmup = Date.now();
  }

  /**
   * Warm up priority models (recently used models)
   */
  private async warmupPriorityModels(provider: Provider): Promise<void> {
    const state = this.states.get(provider.id);
    if (!state) return;

    // Get priority models for this provider
    const priorityModels = this.getPriorityModels(provider.id);
    if (priorityModels.length === 0) {
      return; // No priority models to warm
    }

    console.log(`[warmup] Priority warming ${provider.id} models: ${priorityModels.join(', ')}`);
    
    const semaphore = new Semaphore(this.config.concurrency);
    const promises = priorityModels.map(model => 
      semaphore.acquire().then(async (release) => {
        try {
          const result = await this.warmupModel(provider, model, true);
          release();
          return result;
        } catch (error) {
          release();
          throw error;
        }
      })
    );

    await Promise.allSettled(promises);
    state.warmupStats.priorityWarmed += priorityModels.length;
  }

  /**
   * Get priority models for a provider (recently used within priority window)
   */
  private getPriorityModels(providerId: string): string[] {
    const now = Date.now();
    const priorityModels: Array<{ model: string; lastUsed: number }> = [];

    for (const [model, usage] of this.modelUsage) {
      if (usage.providerId === providerId && usage.isPriority) {
        // Check if still within priority window
        if (now - usage.lastUsed < this.config.priorityWindowMs) {
          priorityModels.push({ model, lastUsed: usage.lastUsed });
        } else {
          // No longer priority - update flag
          usage.isPriority = false;
        }
      }
    }

    // Sort by most recently used first
    priorityModels.sort((a, b) => b.lastUsed - a.lastUsed);
    
    // Return top N priority models
    return priorityModels.slice(0, this.config.maxPriorityModels).map(m => m.model);
  }

  /**
   * Warm up a single model
   */
  private async warmupModel(provider: Provider, model: string, isPriority: boolean): Promise<void> {
    const state = this.states.get(provider.id);
    if (!state) return;

    const keys = getProviderKeys(provider);
    if (keys.length === 0) return;

    // Use first available key
    const key = keys[0];
    const keyHash = getKeyHash(key);

    const { buildUpstreamUrl, buildUpstreamHeaders } = await import('./forwarder');
    const { providerRateLimiter } = await import('./rate-limiter');
    const { markKeySuccess, markKeyError } = await import('./key-pool');

    const url = buildUpstreamUrl(provider);
    const headers = buildUpstreamHeaders(provider, key);

    const startTime = Date.now();
    
    try {
      // Wait for rate limiter
      await providerRateLimiter.waitForSlot(provider.id, keyHash);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: this.config.warmupPrompt }],
          max_tokens: this.config.maxTokens,
          temperature: 0,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok) {
        markKeySuccess(provider.id, 0);
        state.warmupStats.successful++;
        state.warmupStats.lastSuccessAt = Date.now();
        state.warmupStats.averageLatencyMs = 
          (state.warmupStats.averageLatencyMs * (state.warmupStats.successful - 1) + latency) 
          / state.warmupStats.successful;
        const label = isPriority ? 'priority' : 'regular';
        console.log(`[warmup] ${provider.id}/${model} ${label} warmed in ${latency}ms`);
      } else {
        markKeyError(provider.id, 0, `HTTP ${response.status}`);
        state.warmupStats.failed++;
        state.warmupStats.lastError = `HTTP ${response.status}`;
        console.warn(`[warmup] ${provider.id}/${model} failed: ${response.status}`);
      }
    } catch (error: any) {
      const latency = Date.now() - startTime;
      state.warmupStats.failed++;
      state.warmupStats.lastError = error.message;
      console.warn(`[warmup] ${provider.id}/${model} error: ${error.message}`);
    } finally {
      providerRateLimiter.release(provider.id, keyHash);
    }

    state.warmupStats.totalWarmed++;
    state.warmupStats.lastWarmupAt = Date.now();
  }

  /**
   * Record a real request - used to skip unnecessary warmups and track model usage
   */
  recordRequest(model: string, providerId?: string): void {
    const now = Date.now();
    this.recentRequests.set(model, now);
    
    // Track model usage for smart warming
    if (this.config.smartWarming) {
      let usage = this.modelUsage.get(model);
      if (!usage) {
        usage = {
          model,
          providerId: providerId || 'unknown',
          lastUsed: now,
          useCount: 0,
          isPriority: false,
        };
        this.modelUsage.set(model, usage);
      }
      
      usage.lastUsed = now;
      usage.useCount++;
      usage.providerId = providerId || usage.providerId;
      
      // Mark as priority if within window
      if (now - usage.lastUsed < this.config.priorityWindowMs) {
        usage.isPriority = true;
      }
      
      console.log(`[warmup] Recorded request for ${model} (provider: ${usage.providerId}, count: ${usage.useCount}, priority: ${usage.isPriority})`);
    }
  }

  /**
   * Get warmup stats for a provider
   */
  getStats(providerId: string): WarmupStats | null {
    return this.states.get(providerId)?.warmupStats || null;
  }

  /**
   * Get all provider stats
   */
  getAllStats(): Map<string, WarmupStats> {
    const stats = new Map<string, WarmupStats>();
    for (const [providerId, state] of this.states) {
      stats.set(providerId, state.warmupStats);
    }
    return stats;
  }

  /**
   * Get model usage info for smart warming
   */
  getModelUsage(): ModelUsageInfo[] {
    const now = Date.now();
    const usage: ModelUsageInfo[] = [];
    
    for (const [model, info] of this.modelUsage) {
      // Update priority status based on current time
      info.isPriority = (now - info.lastUsed) < this.config.priorityWindowMs;
      usage.push({ ...info });
    }
    
    // Sort by last used (most recent first)
    usage.sort((a, b) => b.lastUsed - a.lastUsed);
    return usage;
  }

  /**
   * Get priority models across all providers
   */
  getPriorityModelsAll(): ModelUsageInfo[] {
    return this.getModelUsage().filter(m => m.isPriority);
  }

  /**
   * Get current configuration (read-only)
   */
  getConfig(): Required<WarmupConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WarmupConfig>): void {
    const oldSmartWarming = this.config.smartWarming;
    this.config = { ...this.config, ...config };
    console.log('[warmup] Config updated:', this.config);
    
    // If smart warming was enabled/disabled, we'd need to restart timers
    // For now, just log the change
    if (oldSmartWarming !== this.config.smartWarming) {
      console.log(`[warmup] Smart warming ${this.config.smartWarming ? 'enabled' : 'disabled'} - restart required for timer changes`);
    }
  }

  /**
   * Get connection state for a provider
   */
  getConnectionState(providerId: string): ProviderConnectionState | null {
    return this.states.get(providerId) || null;
  }

  /**
   * Force a warmup for specific provider/model
   */
  async forceWarmup(provider: Provider, model: string): Promise<void> {
    await this.warmupModel(provider, model, false);
  }

  /**
   * Force priority warmup for specific provider/model
   */
  async forcePriorityWarmup(provider: Provider, model: string): Promise<void> {
    await this.warmupModel(provider, model, true);
  }

  private matchModel(model: string, pattern: string): boolean {
    const regexStr = '^' + pattern
      .split('*')
      .map(escapeRegex)
      .join('.*') + '$';
    return new RegExp(regexStr, 'i').test(model);
  }
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve(() => this.release());
      } else {
        this.waitQueue.push(() => {
          this.permits--;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export singleton instance
export const modelWarmer = new ModelWarmer();