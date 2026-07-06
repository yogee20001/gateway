# Backend Schema Document — AI Gateway

> **Version:** 1.0  
> **Status:** Draft  
> **Author:** AI Gateway Team  
> **Storage:** In-memory only (no database). Config persisted as JSON file.

---

## 1. Architecture Overview

The AI Gateway has **no database dependency**. All runtime state is stored in memory. Configuration is persisted as a single `config.json` file. This document describes:

1. **Config file schema** — persisted on disk
2. **Runtime state schema** — in-memory data structures
3. **Log schema** — in-memory ring buffer
4. **API request/response schemas** — wire formats
5. **Provider translation schemas** — Anthropic & Google format mappings

---

## 2. Config File Schema (`config.json`)

### 2.1 Root Object

```json
{
  "$schema": "The JSON schema for this config file",
  "port": 8787,
  "logLevel": "info",
  "maxLogEntries": 1000,
  "defaultMaxRetries": 3,
  "defaultCooldownMs": 60000,
  "providers": []
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `port` | number | No | `8787` | HTTP server port |
| `logLevel` | string | No | `"info"` | One of: `"debug"`, `"info"`, `"warn"`, `"error"` |
| `maxLogEntries` | number | No | `1000` | Max log entries in ring buffer |
| `defaultMaxRetries` | number | No | `3` | Default retry count for all providers |
| `defaultCooldownMs` | number | No | `60000` | Default cooldown in ms for rate-limited keys |
| `providers` | array | Yes | `[]` | Array of provider configurations |

### 2.2 Provider Object

```json
{
  "id": "openai",
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": null,
  "apiKeys": ["sk-proj-xxxxxxxxxxxxxxxxxxxxxxx"],
  "keyStrategy": "round-robin",
  "keyWeights": null,
  "modelPatterns": ["gpt-*", "o1-*", "o3-*", "davinci-*", "text-*"],
  "isActive": true,
  "maxRetries": null,
  "cooldownMs": null
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | **Yes** | — | Unique identifier. Alphanumeric + hyphens. Used in routing. |
| `name` | string | **Yes** | — | Human-readable display name |
| `baseUrl` | string | **Yes** | — | API base URL (e.g., `https://api.openai.com/v1`) |
| `apiKey` | string | No | `null` | Single API key (alternative to `apiKeys` array) |
| `apiKeys` | string[] | No | `[]` | Multiple API keys for key pooling |
| `keyStrategy` | string | No | `"round-robin"` | One of: `"round-robin"`, `"least-used"`, `"random"` |
| `keyWeights` | number[] | No | `null` | Weights for weighted random selection (must match `apiKeys` length) |
| `modelPatterns` | string[] | No | `null` | Glob patterns for model matching. If null, inferred from provider ID. |
| `isActive` | boolean | No | `true` | Whether this provider is active for routing |
| `maxRetries` | number | No | `null` | Per-provider override for max retries (uses default if null) |
| `cooldownMs` | number | No | `null` | Per-provider override for cooldown (uses default if null) |

### 2.3 Validation Rules

| Rule | Description |
|------|-------------|
| Provider ID uniqueness | No two providers can have the same `id` |
| Provider ID format | Must match `/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/` |
| At least one key | Either `apiKey` must be set or `apiKeys` must have at least one entry |
| Base URL format | Must be a valid HTTP/HTTPS URL |
| Key strategy values | Must be one of: `"round-robin"`, `"least-used"`, `"random"` |
| Key weights length | If provided, must equal `apiKeys.length` |
| Model patterns format | Each pattern must be a valid glob (supports `*` wildcard) |
| Port range | Must be 1024–65535 (or use default 8787) |

### 2.4 Default Config (Auto-Created)

When no `config.json` exists, the gateway creates one with default providers (all with empty `apiKeys` arrays):

```json
{
  "port": 8787,
  "logLevel": "info",
  "maxLogEntries": 1000,
  "defaultMaxRetries": 3,
  "defaultCooldownMs": 60000,
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["gpt-*", "o1-*", "o3-*", "davinci-*", "text-*"],
      "isActive": true
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["claude-*"],
      "isActive": true
    },
    {
      "id": "google",
      "name": "Google Gemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["gemini-*", "palm-*"],
      "isActive": true
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["deepseek-*"],
      "isActive": true
    },
    {
      "id": "nvidia",
      "name": "NVIDIA",
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["nvidia/*", "meta/*", "mistralai/*"],
      "isActive": true
    },
    {
      "id": "perplexity",
      "name": "Perplexity",
      "baseUrl": "https://api.perplexity.ai",
      "apiKeys": [],
      "keyStrategy": "round-robin",
      "modelPatterns": ["sonar-*", "llama-*-sonar*"],
      "isActive": true
    }
  ]
}
```

---

## 3. Runtime State Schema (In-Memory)

### 3.1 Key State Map

```typescript
// Map<providerId, Map<keyHash, KeyState>>
// Stored in: key-pool.ts module scope
const keyStates: Map<string, Map<string, KeyState>> = new Map();
```

**KeyState Object:**

```typescript
interface KeyState {
  key: string;                    // The actual API key (masked in logs)
  keyHash: string;                // SHA-256 hash of the key (for lookup)
  health: 'healthy' | 'rate-limited' | 'error';
  lastUsed: number;               // Unix timestamp of last use
  usageCount: number;             // Total requests sent with this key
  errorCount: number;             // Total errors with this key
  cooldownUntil: number | null;   // Unix timestamp when cooldown expires
  lastError: string | null;       // Last error message
  lastErrorTime: number | null;   // Unix timestamp of last error
  consecutiveErrors: number;      // Consecutive error count (for escalating cooldown)
}
```

**Initialization:** On startup, for each provider's keys, create a `KeyState` with:
- `health`: `"healthy"`
- `lastUsed`: `0`
- `usageCount`: `0`
- `errorCount`: `0`
- `cooldownUntil`: `null`
- `lastError`: `null`
- `lastErrorTime`: `null`
- `consecutiveErrors`: `0`

### 3.2 Round-Robin Index Map

```typescript
// Map<providerId, lastUsedIndex>
// Tracks the last used key index for round-robin strategy
const roundRobinIndices: Map<string, number> = new Map();
```

### 3.3 Log Ring Buffer

```typescript
// Fixed-size circular buffer
// Stored in: logger.ts module scope
class LogRingBuffer {
  private buffer: LogEntry[];
  private maxSize: number;
  private head: number;  // Write position
  private count: number; // Number of entries

  constructor(maxSize: number = 1000) {
    this.buffer = new Array(maxSize);
    this.maxSize = maxSize;
    this.head = 0;
    this.count = 0;
  }

  push(entry: LogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.maxSize;
    this.count = Math.min(this.count + 1, this.maxSize);
  }

  getAll(): LogEntry[] {
    // Returns entries in chronological order (oldest first)
    if (this.count < this.maxSize) {
      return this.buffer.slice(0, this.count);
    }
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  getRecent(n: number): LogEntry[] {
    return this.getAll().slice(-n);
  }

  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }
}
```

**LogEntry Object:**

```typescript
interface LogEntry {
  id: string;                    // UUID v4
  timestamp: number;             // Unix timestamp (ms)
  method: string;                // HTTP method (e.g., "POST")
  path: string;                  // Request path (e.g., "/v1/chat/completions")
  model: string;                 // Requested model name
  provider: string;              // Selected provider ID
  providerName: string;          // Selected provider display name
  keyHash: string;               // Hash of the key used (for lookup, not display)
  keyMasked: string;             // Masked key for display (e.g., "sk-…x2")
  status: number;                // HTTP status code returned
  duration: number;              // Request duration in ms
  retries: number;               // Number of retries performed
  streamed: boolean;             // Whether response was streamed
  error: string | null;          // Error message if failed
  requestPreview: string | null; // Truncated request body (first 200 chars)
  responsePreview: string | null;// Truncated response body (first 200 chars)
}
```

### 3.4 Stats Accumulator

```typescript
// Stored in: logger.ts module scope
interface GatewayStats {
  totalRequests: number;
  todayRequests: number;
  todayDate: string;             // ISO date string for tracking "today"
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  totalDuration: number;         // Sum of all request durations (ms)
  providerStats: Map<string, {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalDuration: number;
  }>;
  lastResetTimestamp: number;    // When stats were last reset
}

const stats: GatewayStats = {
  totalRequests: 0,
  todayRequests: 0,
  todayDate: new Date().toISOString().split('T')[0],
  successfulRequests: 0,
  failedRequests: 0,
  retriedRequests: 0,
  totalDuration: 0,
  providerStats: new Map(),
  lastResetTimestamp: Date.now(),
};
```

---

## 4. API Request/Response Schemas

### 4.1 POST /v1/chat/completions

**Request Body (OpenAI-Compatible):**

```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What's in this image?"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/image.jpg",
            "detail": "auto"
          }
        }
      ]
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "top_p": 1,
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "stop": ["\n"],
  "stream": false,
  "n": 1,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" }
          }
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Validation Rules:**

| Field | Rule |
|-------|------|
| `model` | Required, non-empty string |
| `messages` | Required, non-empty array |
| `messages[].role` | Required, one of: `"system"`, `"user"`, `"assistant"`, `"tool"` |
| `messages[].content` | Required, string or array of content parts |
| `stream` | Optional boolean, default `false` |
| `temperature` | Optional number, 0–2, default `1` |
| `max_tokens` | Optional positive integer |
| `top_p` | Optional number, 0–1, default `1` |

**Success Response (Non-Streaming, 200):**

```json
{
  "id": "chatcmpl-9a8b7c6d5e4f3g2h1i0j",
  "object": "chat.completion",
  "created": 1719876543,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?",
        "tool_calls": null
      },
      "finish_reason": "stop",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  },
  "system_fingerprint": "fp_abc123"
}
```

**Success Response (Streaming, 200 — SSE):**

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1719876543,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1719876543,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1719876543,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1719876543,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Error Response (4xx/5xx):**

```json
{
  "error": {
    "message": "No healthy API keys available for OpenAI",
    "type": "gateway_error",
    "code": "no_healthy_keys",
    "param": null,
    "details": {
      "provider": "openai",
      "totalKeys": 3,
      "healthyKeys": 0,
      "retriesAttempted": 3
    }
  }
}
```

### 4.2 GET /v1/models

**Response (200):**

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1719876543,
      "owned_by": "openai"
    },
    {
      "id": "gpt-4-turbo",
      "object": "model",
      "created": 1719876543,
      "owned_by": "openai"
    },
    {
      "id": "claude-3-5-sonnet",
      "object": "model",
      "created": 1719876543,
      "owned_by": "anthropic"
    }
  ]
}
```

**Implementation:** Returns a synthetic list of models derived from all active providers' `modelPatterns`. Each pattern is expanded to representative model names.

### 4.3 Dashboard API Endpoints

**GET /api/config → AppConfig (200)**

Returns the current configuration object (with API keys masked).

```json
{
  "port": 8787,
  "logLevel": "info",
  "maxLogEntries": 1000,
  "defaultMaxRetries": 3,
  "defaultCooldownMs": 60000,
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeys": ["sk-…x2", "sk-…y3", "sk-…z4"],
      "keyStrategy": "round-robin",
      "modelPatterns": ["gpt-*", "o1-*"],
      "isActive": true
    }
  ]
}
```

**PUT /api/config → { success: true } (200)**

Accepts the same shape as `GET /api/config`. Validates, writes to disk, updates in-memory state.

**GET /api/health → HealthResponse (200)**

```json
{
  "providers": {
    "openai": {
      "name": "OpenAI",
      "isActive": true,
      "keys": [
        {
          "index": 0,
          "masked": "sk-…x2",
          "health": "healthy",
          "usageCount": 45,
          "errorCount": 0,
          "cooldownRemaining": null
        },
        {
          "index": 1,
          "masked": "sk-…y3",
          "health": "rate-limited",
          "usageCount": 120,
          "errorCount": 3,
          "cooldownRemaining": 45000
        }
      ],
      "healthyKeyCount": 1,
      "totalKeyCount": 2
    }
  },
  "summary": {
    "totalProviders": 4,
    "activeProviders": 3,
    "totalKeys": 8,
    "healthyKeys": 6,
    "rateLimitedKeys": 1,
    "errorKeys": 1
  }
}
```

**GET /api/logs → LogEntry[] (200)**

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": 1719876543000,
    "method": "POST",
    "path": "/v1/chat/completions",
    "model": "gpt-4o",
    "provider": "openai",
    "providerName": "OpenAI",
    "keyMasked": "sk-…x2",
    "status": 200,
    "duration": 1234,
    "retries": 0,
    "streamed": false,
    "error": null,
    "requestPreview": "{\"model\":\"gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],...}",
    "responsePreview": "{\"id\":\"chatcmpl-xxx\",\"object\":\"chat.completion\",\"choices\":[...]}"
  }
]
```

**GET /api/stats → GatewayStatsResponse (200)**

```json
{
  "totalRequests": 1234,
  "todayRequests": 56,
  "successfulRequests": 1200,
  "failedRequests": 34,
  "retriedRequests": 12,
  "averageDuration": 1234,
  "uptime": 3600000,
  "providers": {
    "openai": {
      "totalRequests": 800,
      "successfulRequests": 790,
      "failedRequests": 10,
      "averageDuration": 1100
    },
    "anthropic": {
      "totalRequests": 434,
      "successfulRequests": 410,
      "failedRequests": 24,
      "averageDuration": 1500
    }
  }
}
```

---

## 5. Provider Translation Schemas

### 5.1 Anthropic Translation

**Request Translation (OpenAI → Anthropic):**

```json
// OpenAI format (incoming)
{
  "model": "claude-3-5-sonnet",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 1000,
  "temperature": 0.7,
  "stream": true
}

// ↓ Translated to Anthropic format
{
  "model": "claude-3-5-sonnet-20241022",
  "system": "You are helpful.",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 1000,
  "temperature": 0.7,
  "stream": true
}
```

**Response Translation (Anthropic → OpenAI):**

```json
// Anthropic format (incoming)
{
  "id": "msg_01abc123",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Hello! How can I help?" }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 10
  }
}

// ↓ Translated to OpenAI format
{
  "id": "msg_01abc123",
  "object": "chat.completion",
  "created": 1719876543,
  "model": "claude-3-5-sonnet",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  }
}
```

**Streaming Chunk Translation (Anthropic → OpenAI SSE):**

```json
// Anthropic SSE chunk
data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}

// ↓ Translated to OpenAI SSE chunk
data: {"id":"msg_01abc123","object":"chat.completion.chunk","created":1719876543,"model":"claude-3-5-sonnet","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
```

### 5.2 Google Gemini Translation

**Request Translation (OpenAI → Google):**

```json
// OpenAI format (incoming)
{
  "model": "gemini-1.5-pro",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 1000,
  "temperature": 0.7,
  "top_p": 0.9,
  "stop": ["\n"],
  "stream": true
}

// ↓ Translated to Google format
{
  "system_instruction": {
    "parts": [{ "text": "You are helpful." }]
  },
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "Hello" }]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 1000,
    "temperature": 0.7,
    "topP": 0.9,
    "stopSequences": ["\n"]
  }
}
```

**Response Translation (Google → OpenAI):**

```json
// Google format (incoming)
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [{ "text": "Hello! How can I help?" }]
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 25,
    "candidatesTokenCount": 10,
    "totalTokenCount": 35
  }
}

// ↓ Translated to OpenAI format
{
  "id": "gemini-abc123",
  "object": "chat.completion",
  "created": 1719876543,
  "model": "gemini-1.5-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  }
}
```

---

## 6. Error Code Reference

| Code | HTTP Status | Description | When |
|------|-------------|-------------|------|
| `unknown_model` | 404 | No provider matches the requested model | Model not in any provider's patterns |
| `no_healthy_keys` | 503 | All keys for the matched provider are unhealthy | All keys rate-limited/errored |
| `no_active_providers` | 503 | No active providers configured | All providers toggled off |
| `invalid_request` | 400 | Request body failed validation | Missing model, empty messages, etc. |
| `upstream_error` | 502 | Upstream provider returned an error | Auth failure, bad request forwarded |
| `upstream_timeout` | 504 | Upstream provider timed out | Request took too long |
| `config_error` | 500 | Configuration is invalid | Corrupt config.json |
| `rate_limited` | 429 | All retries exhausted due to rate limits | After max retries with 429 responses |
| `stream_error` | 500 | Streaming response failed mid-stream | Connection dropped during streaming |

---

## 7. Data Flow Summary

```
                    ┌──────────────────┐
                    │   config.json    │  ← Persisted on disk
                    │   (JSON file)    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Config Loader   │  ← Reads on startup, writes on PUT /api/config
                    │  (config.ts)     │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────┐ ┌──────────┐ ┌──────────────┐
    │  Provider Config │ │ KeyState │ │ Log Ring     │
    │  (immutable     │ │ Map      │ │ Buffer       │
    │   during req)   │ │ (mutable)│ │ (mutable)    │
    └─────────────────┘ └──────────┘ └──────────────┘
              │              │              │
              │              │              │
              ▼              ▼              ▼
    ┌─────────────────────────────────────────────┐
    │           Request Processing                 │
    │  router.ts → key-pool.ts → forwarder.ts     │
    └─────────────────────────────────────────────┘
```

---

*End of Backend Schema Document*