# Technical Requirements Document — AI Gateway

> **Version:** 1.0  
> **Status:** Draft  
> **Author:** AI Gateway Team  
> **Runtime:** Node.js 18+  
> **Framework:** Cloudflare Workers (via `wrangler`), with local dev server

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Application                       │
│  (Cursor, Claude Code, VS Code Extensions, Custom Scripts)  │
│              POST http://localhost:8787/v1/chat/completions  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI Gateway (Worker)                       │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Request  │  │ Provider │  │ Key Pool │  │ Retry &  │   │
│  │ Parser   │→ │ Router   │→ │ Selector │→ │ Forwarder│   │
│  └──────────┘  └──────────┘  └──────────┘  └─────┬────┘   │
│                                                    │        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │        │
│  │ Logger   │  │ Health   │  │ Config   │         │        │
│  │ (Ring    │← │ Monitor  │← │ Loader   │         │        │
│  │  Buffer) │  │          │  │          │         │        │
│  └──────────┘  └──────────┘  └──────────┘         │        │
│                                                    │        │
└────────────────────────────────────────────────────┼────────┘
                                                     │
                           ┌─────────────────────────┼─────────────────────────┐
                           │                         │                         │
                           ▼                         ▼                         ▼
              ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
              │   OpenAI API       │  │  Anthropic API     │  │  Google Gemini API │
              │  api.openai.com    │  │  api.anthropic.com │  │  generativelanguage│
              └────────────────────┘  └────────────────────┘  └────────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Runtime** | Node.js 18+ (Cloudflare Workers-compatible) | Cross-platform, excellent HTTP/streaming, minimal deps |
| **HTTP Server** | `itty-router` or built-in `fetch` handler | Lightweight, Workers-compatible routing |
| **Config** | JSON file (`config.json`) | No DB needed, human-editable, machine-parseable |
| **Frontend** | Vanilla HTML/CSS/JS (SPA) | Zero build step, no framework overhead, served from worker |
| **Streaming** | Web Streams API / ReadableStream | Native Node.js, no extra deps, SSE-compatible |
| **Testing** | Vitest | Fast, Workers-compatible, familiar API |
| **Build** | esbuild (via wrangler) | Fast bundling, tree-shaking, TypeScript support |
| **Deployment** | Local `wrangler dev` or `node server.js` | No cloud needed |

### 1.3 Project Structure

```
ai-gateway/
├── src/
│   ├── index.ts                  # Entry point — HTTP handler
│   ├── config.ts                 # Config loader & validation
│   ├── router.ts                 # Provider routing engine
│   ├── key-pool.ts               # Key selection & health tracking
│   ├── forwarder.ts              # Request forwarding & response handling
│   ├── retry.ts                  # Retry logic with backoff
│   ├── logger.ts                 # In-memory ring buffer logger
│   ├── providers/
│   │   ├── openai.ts             # OpenAI adapter
│   │   ├── anthropic.ts          # Anthropic adapter (translation layer)
│   │   ├── google.ts             # Google Gemini adapter
│   │   └── generic.ts            # Generic OpenAI-compatible adapter
│   ├── dashboard/
│   │   ├── index.html            # Dashboard HTML
│   │   ├── styles.css            # Dashboard CSS
│   │   └── app.js                # Dashboard JS (SPA)
│   └── types.ts                  # TypeScript interfaces
├── config.json                   # User configuration (auto-created)
├── package.json
├── tsconfig.json
├── wrangler.jsonc                # Wrangler config (for Cloudflare deploy option)
└── README.md
```

---

## 2. Data Types & Interfaces

### 2.1 Configuration Types

```typescript
// ============================================================
// Provider Configuration
// ============================================================
interface Provider {
  id: string;                    // Unique identifier (e.g., "openai", "my-custom")
  name: string;                  // Display name (e.g., "OpenAI", "My Custom Provider")
  baseUrl: string;               // API base URL (e.g., "https://api.openai.com/v1")
  apiKey?: string;               // Single API key
  apiKeys?: string[];            // Multiple API keys for key pooling
  keyStrategy?: 'round-robin' | 'least-used' | 'random';  // Key selection strategy
  keyWeights?: number[];         // Weights for weighted random selection
  modelPatterns?: string[];      // Glob patterns for model matching (e.g., ["gpt-*", "o1-*"])
  isActive: boolean;             // Whether this provider is active
  maxRetries?: number;           // Max retries for this provider (default: 3)
  cooldownMs?: number;           // Cooldown period for rate-limited keys (default: 60000)
}

// ============================================================
// App Configuration
// ============================================================
interface AppConfig {
  port?: number;                 // HTTP server port (default: 8787)
  logLevel?: 'debug' | 'info' | 'warn' | 'error';  // Log level
  maxLogEntries?: number;        // Max log entries in ring buffer (default: 1000)
  defaultMaxRetries?: number;    // Default max retries across all providers (default: 3)
  defaultCooldownMs?: number;    // Default cooldown for rate-limited keys (default: 60000)
  providers: Provider[];         // List of configured providers
}
```

### 2.2 Runtime Types

```typescript
// ============================================================
// Key Health State
// ============================================================
type KeyHealth = 'healthy' | 'rate-limited' | 'error';

interface KeyState {
  key: string;                   // The actual API key (or masked for display)
  health: KeyHealth;             // Current health status
  lastUsed: number;              // Timestamp of last use
  usageCount: number;            // Total requests sent with this key
  errorCount: number;            // Total errors with this key
  cooldownUntil: number | null;  // Timestamp when cooldown expires (null if healthy)
  lastError: string | null;      // Last error message
  lastErrorTime: number | null;  // Timestamp of last error
}

// ============================================================
// Request Log Entry
// ============================================================
interface LogEntry {
  id: string;                    // Unique log entry ID
  timestamp: number;             // Unix timestamp
  method: string;                // HTTP method
  path: string;                  // Request path
  model: string;                 // Requested model
  provider: string;              // Selected provider
  keyIndex: number;              // Index of key used
  status: number;                // HTTP status code
  duration: number;              // Request duration in ms
  retries: number;               // Number of retries
  error?: string;                // Error message if failed
  streamed: boolean;             // Whether response was streamed
}

// ============================================================
// Provider Match Result
// ============================================================
interface ProviderMatch {
  provider: Provider;
  specificity: number;           // Match specificity (higher = more specific)
  pattern: string;               // The pattern that matched
}
```

### 2.3 API Request/Response Types

```typescript
// ============================================================
// OpenAI-Compatible Chat Completion Request
// ============================================================
interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
    }>;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
  }>;
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

// ============================================================
// OpenAI-Compatible Chat Completion Response
// ============================================================
interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

---

## 3. API Endpoints

### 3.1 Proxy Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Main proxy endpoint — forwards to upstream provider |
| `GET` | `/v1/models` | Returns list of available models (from all active providers) |

### 3.2 Dashboard Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Dashboard HTML page |
| `GET` | `/api/config` | Get current configuration |
| `PUT` | `/api/config` | Update configuration |
| `GET` | `/api/health` | Get key health status for all providers |
| `GET` | `/api/logs` | Get recent request logs |
| `GET` | `/api/stats` | Get aggregate usage statistics |

---

## 4. Core Algorithms

### 4.1 Provider Routing Algorithm

```
function findProvidersForModel(requestedModel: string, config: AppConfig): Provider[]

1. Filter to active providers only
2. For each active provider:
   a. If provider has modelPatterns:
      - For each pattern, check if requestedModel matches
      - Use matchModelPattern() for glob matching
      - Calculate specificity: exact match > prefix glob > suffix glob > wildcard
   b. If provider has no modelPatterns:
      - Use inferProviderPatternsFromId() to get default patterns
      - Check match as above
3. Sort matches by specificity (descending)
4. Return sorted providers (first is best match)
```

### 4.2 Pattern Matching Algorithm

```
function matchModelPattern(modelName: string, pattern: string): boolean

1. Normalize both to lowercase
2. If pattern === "*": return true (catch-all)
3. If pattern ends with "*" (prefix glob, e.g., "gpt-*"):
   - Return modelName.startsWith(pattern.slice(0, -1))
4. If pattern starts with "*" (suffix glob, e.g., "*-v2"):
   - Return modelName.endsWith(pattern.slice(1))
5. If pattern contains "*" (wildcard, e.g., "nvidia/*"):
   - Convert to regex: escape special chars, replace "*" with ".*"
   - Return regex.test(modelName)
6. Otherwise: exact match
```

### 4.3 Key Selection Algorithm

```
function selectBestApiKey(provider: Provider, keyStates: Map<string, KeyState>): string | null

1. Get all keys for provider (apiKeys[] or [apiKey])
2. Filter out unhealthy keys (rate-limited or errored, still in cooldown)
3. If no healthy keys: return null
4. Apply selection strategy:
   a. "round-robin": Track lastUsedIndex, return next in sequence
   b. "least-used": Return key with lowest usageCount
   c. "random": Return random key (weighted if keyWeights provided)
5. Update key state (lastUsed, usageCount)
6. Return selected key
```

### 4.4 Retry Algorithm

```
async function forwardWithRetry(request, provider, keyStates, config): Response

1. Set retryCount = 0
2. Set maxRetries = provider.maxRetries || config.defaultMaxRetries
3. Loop:
   a. Select best key via selectBestApiKey()
   b. If no key available: return 503 Service Unavailable
   c. Forward request to provider with selected key
   d. If response status is 2xx: return response (success)
   e. If response status is 429 (rate-limited):
      - Mark key as rate-limited with cooldown
      - retryCount++
      - If retryCount > maxRetries: return last error response
      - Wait with exponential backoff: 1000 * 2^retryCount ms
      - Continue loop
   f. If response status is 5xx (server error):
      - Mark key as error
      - retryCount++
      - If retryCount > maxRetries: return last error response
      - Wait with exponential backoff
      - Continue loop
   g. If other error: return response as-is (pass through)
```

### 4.5 Health Restoration Algorithm

```
function checkAndRestoreKeys(keyStates: Map<string, KeyState>): void

1. For each key in keyStates:
   a. If key.health !== 'healthy' AND key.cooldownUntil !== null:
      - If Date.now() >= key.cooldownUntil:
        - Set key.health = 'healthy'
        - Set key.cooldownUntil = null
        - Log health transition
2. Run this check on a timer (every 5 seconds)
```

---

## 5. Provider Adapters

### 5.1 OpenAI Adapter (Generic OpenAI-Compatible)

```
Provider: OpenAI, DeepSeek, Perplexity, NVIDIA, Custom
Format: Direct passthrough (already OpenAI-compatible)
Base URL: configurable
Auth: Bearer token in Authorization header
Streaming: SSE passthrough
```

### 5.2 Anthropic Adapter

```
Provider: Anthropic (Claude)
Format: Requires translation from OpenAI format to Anthropic format
Base URL: https://api.anthropic.com/v1
Auth: x-api-key header
Streaming: SSE passthrough (different event format)

Translation:
  Request:
    - Map model: "claude-3-5-sonnet" → "claude-3-5-sonnet-20241022"
    - Map messages: system role → system param, rest → messages array
    - Map max_tokens → max_tokens
    - Remove unsupported params (top_p, frequency_penalty, presence_penalty, logit_bias)
  Response:
    - Map content blocks → OpenAI message format
    - Map stop_reason → finish_reason
    - Map usage → OpenAI usage format
```

### 5.3 Google Gemini Adapter

```
Provider: Google (Gemini)
Format: Requires translation from OpenAI format to Google format
Base URL: https://generativelanguage.googleapis.com/v1beta
Auth: API key in query string (?key=xxx)
Streaming: SSE passthrough (different event format)

Translation:
  Request:
    - Map model: "gemini-1.5-pro" → "models/gemini-1.5-pro"
    - Map messages: system → system_instruction, rest → contents array
    - Map max_tokens → generationConfig.maxOutputTokens
    - Map temperature → generationConfig.temperature
    - Map top_p → generationConfig.topP
    - Map stop → generationConfig.stopSequences
  Response:
    - Map candidates → choices
    - Map finishReason → finish_reason
    - Map usageMetadata → usage
```

---

## 6. Configuration File Format

### 6.1 Default `config.json`

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

## 7. Error Handling

| Scenario | HTTP Status | Response Body | Action |
|----------|-------------|---------------|--------|
| No healthy keys available | 503 | `{"error": "No healthy API keys available for provider {provider}"}` | Log error, return 503 |
| All providers exhausted | 503 | `{"error": "No providers available for model {model}"}` | Log error, return 503 |
| Invalid request format | 400 | `{"error": "Invalid request: {details}"}` | Return 400 |
| Unknown model | 404 | `{"error": "No provider found for model {model}"}` | Return 404 |
| Upstream timeout | 504 | `{"error": "Upstream request timed out"}` | Retry, then return 504 |
| Upstream auth error | 502 | `{"error": "Upstream authentication failed"}` | Mark key as error, return 502 |
| Config parse error | 500 | `{"error": "Invalid configuration: {details}"}` | Log error, return 500 |

---

## 8. Performance Targets

| Metric | Target | Implementation Strategy |
|--------|--------|------------------------|
| Request parsing | < 1ms | Minimal validation, no heavy parsing libs |
| Provider routing | < 0.1ms | Simple array iteration, no DB queries |
| Key selection | < 0.1ms | In-memory Map, O(1) lookup |
| Request forwarding | < 5ms overhead | Direct fetch(), no buffering |
| Response streaming | < 2ms overhead | Pipe-through ReadableStream |
| Memory per request | < 10KB | No request body buffering for streaming |
| Concurrent requests | 100+ | Async I/O, no thread blocking |

---

## 9. Security Considerations

| Concern | Mitigation |
|---------|------------|
| API key exposure | Keys stored in local config file only; never exposed in logs (masked) |
| Localhost only | Server binds to 127.0.0.1 by default; no external access |
| Request validation | Validate request body structure before forwarding |
| Response validation | Validate upstream response before returning to client |
| Header injection | Sanitize headers before forwarding |
| SSRF protection | Only forward to configured base URLs; no arbitrary URL forwarding |

---

## 10. Testing Strategy

| Test Type | Scope | Tool |
|-----------|-------|------|
| Unit tests | Pattern matching, key selection, config validation | Vitest |
| Integration tests | Provider routing, retry logic, health monitoring | Vitest + mock HTTP |
| E2E tests | Full request flow with mock upstream | Vitest + test server |
| Streaming tests | SSE passthrough, stream interruption | Vitest + async iterators |
| Error scenario tests | Rate limits, timeouts, auth failures | Vitest + mock responses |

---

*End of TRD*