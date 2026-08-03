// ============================================================
// AI Gateway — Type Definitions
// ============================================================

// ============================================================
// Provider Configuration
// ============================================================
export interface RateLimitConfig {
  requestsPerWindow: number;
  windowMs: number;
  maxConcurrent?: number;
  providerMaxConcurrent?: number;
}

export interface QueueConfig {
  enabled: boolean;
  maxSize: number;
  defaultTimeoutMs: number;
}

/** Hedging settings (mirrors src/hedging.ts HedgingConfig, kept here to avoid circular imports) */
export interface HedgingSettings {
  enabled?: boolean;
  maxHedgedRequests?: number;
  hedgeDelayMs?: number;
  cancelOnFirstSuccess?: boolean;
  excludeStreaming?: boolean;
  excludeHighTemperature?: boolean;
  temperatureThreshold?: number;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  apiKeys?: string[];
  keyStrategy?: KeyStrategy;
  keyWeights?: number[] | null;
  modelPatterns?: string[] | null;
  isActive: boolean;
  maxRetries?: number | null;
  cooldownMs?: number | null;
  rateLimit?: RateLimitConfig | null;
}

// ============================================================
// App Configuration
// ============================================================
export interface AppConfig {
  port?: number;
  /** Host address to bind to (default: '0.0.0.0' for all interfaces, use '127.0.0.1' for localhost only) */
  host?: string;
  logLevel?: LogLevel;
  maxLogEntries?: number;
  defaultMaxRetries?: number;
  defaultCooldownMs?: number;
  /** Health check interval in milliseconds (default: 60000, mobile: 30000) */
  healthCheckIntervalMs?: number;
  /** Global max concurrent in-flight requests (default: 50) */
  maxConcurrentRequests?: number;
  /** Global max queued requests while at the concurrency limit (default: 100) */
  maxQueuedRequests?: number;
  /** Timeout for requests waiting in the global queue, ms (default: 30000) */
  queueTimeoutMs?: number;
  /** Max request body size in bytes for /v1/chat/completions (default: 10 MB) */
  maxBodyBytes?: number;
  /** Max time (ms) to wait for the FIRST SSE chunk from upstream before failing (default: 180000) */
  streamFirstTokenTimeoutMs?: number;
  /** Max idle time (ms) between SSE chunks during streaming before aborting (default: 120000) */
  streamIdleTimeoutMs?: number;
  /** Hedging behavior (default: disabled) */
  hedging?: HedgingSettings;
  providers: Provider[];
}

// ============================================================
// Runtime State Types
// ============================================================
export type KeyHealth = 'healthy' | 'rate-limited' | 'error';
export type KeyStrategy = 'round-robin' | 'least-used' | 'random';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface KeyState {
  key: string;
  keyHash: string;
  health: KeyHealth;
  lastUsed: number;
  usageCount: number;
  errorCount: number;
  cooldownUntil: number | null;
  lastError: string | null;
  lastErrorTime: number | null;
  consecutiveErrors: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  model: string;
  provider: string;
  providerName: string;
  keyHash: string;
  keyMasked: string;
  status: number;
  duration: number;
  retries: number;
  streamed: boolean;
  error: string | null;
  requestPreview: string | null;
  responsePreview: string | null;
}

export interface ProviderMatch {
  provider: Provider;
  specificity: number;
  pattern: string;
}

// ============================================================
// API Request/Response Types
// ============================================================
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}

// ============================================================
// Dashboard API Response Types
// ============================================================
export interface HealthResponse {
  providers: Record<string, ProviderHealth>;
  summary: HealthSummary;
}

export interface ProviderHealth {
  name: string;
  isActive: boolean;
  keys: KeyHealthEntry[];
  healthyKeyCount: number;
  totalKeyCount: number;
}

export interface KeyHealthEntry {
  index: number;
  masked: string;
  health: KeyHealth;
  usageCount: number;
  errorCount: number;
  cooldownRemaining: number | null;
}

export interface HealthSummary {
  totalProviders: number;
  activeProviders: number;
  totalKeys: number;
  healthyKeys: number;
  rateLimitedKeys: number;
  errorKeys: number;
}

export interface StatsResponse {
  totalRequests: number;
  todayRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  averageDuration: number;
  uptime: number;
  providers: Record<string, ProviderStats>;
}

export interface ProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageDuration: number;
}

export interface ErrorResponse {
  error: {
    message: string;
    type?: string;
    code?: string;
    param?: string | null;
    details?: Record<string, unknown>;
  };
}

export interface ForwardResult {
  status: number;
  body: any;
  keyIndex: number;
  retries: number;
  headers: Record<string, string>;
  streamResponse: Response | null;
}

// ============================================================
// Validation
// ============================================================
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}