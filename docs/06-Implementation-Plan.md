# Implementation Plan — AI Gateway

> **Version:** 1.0  
> **Status:** Draft  
> **Author:** AI Gateway Team  
> **Total Estimated Time:** ~6-8 hours  
> **Total Files:** ~18 files  
> **Total Lines:** ~2,500

---

## 1. Build Phases Overview

| Phase | Description | Est. Time | Files |
|-------|-------------|-----------|-------|
| **0** | Project scaffolding | 15 min | 4 |
| **1** | Core types & config | 30 min | 2 |
| **2** | Pattern routing engine | 30 min | 1 |
| **3** | Key pool & health monitoring | 45 min | 1 |
| **4** | Request forwarding & retry | 45 min | 1 |
| **5** | Provider adapters | 60 min | 4 |
| **6** | Logger & stats | 20 min | 1 |
| **7** | Main HTTP handler | 45 min | 1 |
| **8** | Dashboard (HTML/CSS/JS) | 90 min | 3 |
| **9** | Testing | 60 min | 3+ |
| **10** | Polish & README | 30 min | 2 |

---

## 2. Phase 0: Project Scaffolding

**Goal:** Initialize the project with package.json, tsconfig, and directory structure.

### Files to Create

#### 0.1 `package.json`

```json
{
  "name": "ai-gateway",
  "version": "1.0.0",
  "description": "Local-first AI API gateway with multi-provider routing, key pooling, and automatic failover",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.ts",
    "start": "node dist/index.js",
    "build": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "itty-router": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "esbuild": "^0.20.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.0.0"
  }
}
```

**Assumption:** Using `itty-router` for lightweight routing. If the AI coding tool prefers a different approach (e.g., raw `fetch` handler), that's fine — the router is minimal.

#### 0.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

#### 0.3 Directory Structure

```
ai-gateway/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── config.ts
│   ├── router.ts
│   ├── key-pool.ts
│   ├── forwarder.ts
│   ├── retry.ts
│   ├── logger.ts
│   ├── providers/
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   ├── google.ts
│   │   └── generic.ts
│   └── dashboard/
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── config.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 3. Phase 1: Core Types & Config

**Goal:** Define all TypeScript interfaces and implement config loading/validation.

### File: `src/types.ts`

**What to implement:**
- `Provider` interface (all fields from Backend Schema §2.2)
- `AppConfig` interface (all fields from Backend Schema §2.1)
- `KeyState` interface (all fields from Backend Schema §3.1)
- `LogEntry` interface (all fields from Backend Schema §3.3)
- `GatewayStats` interface (all fields from Backend Schema §3.4)
- `ProviderMatch` interface
- `ChatCompletionRequest` interface
- `ChatCompletionResponse` interface
- `HealthResponse` interface
- `StatsResponse` interface
- `ErrorResponse` interface
- `KeyHealth` type: `'healthy' | 'rate-limited' | 'error'`
- `KeyStrategy` type: `'round-robin' | 'least-used' | 'random'`
- `LogLevel` type: `'debug' | 'info' | 'warn' | 'error'`

**Estimated lines:** ~150

### File: `src/config.ts`

**What to implement:**
- `loadConfig(filePath: string): AppConfig` — Read and parse config.json
- `createDefaultConfig(): AppConfig` — Generate default config with all 6 providers
- `validateConfig(config: AppConfig): ValidationResult` — Validate all rules from Backend Schema §2.3
- `saveConfig(config: AppConfig, filePath: string): void` — Write config.json
- `maskApiKey(key: string): string` — Mask key for display (e.g., "sk-…x2")
- `DEFAULT_PROVIDERS` — Array of 6 default provider configs
- `inferProviderPatternsFromId(providerId: string): string[]` — Fallback pattern inference

**Key behaviors:**
- If config.json doesn't exist on startup, create default and log a warning
- On validation failure, log specific errors and exit
- API keys are masked when returned to the dashboard (never expose full key in API responses)

**Estimated lines:** ~120

---

## 4. Phase 2: Pattern Routing Engine

**Goal:** Implement model-to-provider matching using glob patterns.

### File: `src/router.ts`

**What to implement:**

```typescript
// Core matching function
function matchModelPattern(modelName: string, pattern: string): boolean

// Provider resolution
function findProvidersForModel(requestedModel: string, config: AppConfig): ProviderMatch[]

// Specificity calculation
function calculateSpecificity(pattern: string): number
  // exact match = 100
  // prefix glob (gpt-*) = pattern.length - 1
  // suffix glob (*-v2) = pattern.length - 1
  // wildcard (nvidia/*) = pattern.length - 2
  // catch-all (*) = 0

// Pattern inference fallback
function inferProviderPatternsFromId(providerId: string): string[]
  // openai → ["gpt-*", "o1-*", "o3-*", "davinci-*", "text-*"]
  // anthropic → ["claude-*"]
  // google → ["gemini-*", "palm-*"]
  // deepseek → ["deepseek-*"]
  // nvidia → ["nvidia/*", "meta/*", "mistralai/*"]
  // perplexity → ["sonar-*", "llama-*-sonar*"]
  // default → ["*"] (catch-all)
```

**Edge cases to handle:**
- Empty modelPatterns array → use inferred patterns
- Case-insensitive matching (normalize to lowercase)
- Pattern with only `*` → matches everything (catch-all)
- Multiple providers matching the same model → sort by specificity
- No providers match → return empty array

**Estimated lines:** ~80

---

## 5. Phase 3: Key Pool & Health Monitoring

**Goal:** Implement key selection strategies and automatic health tracking.

### File: `src/key-pool.ts`

**What to implement:**

```typescript
// Module-level state
const keyStates: Map<string, Map<string, KeyState>> = new Map()
const roundRobinIndices: Map<string, number> = new Map()
let healthCheckTimer: ReturnType<typeof setInterval> | null = null

// Initialization
function initializeKeyStates(config: AppConfig): void
  // For each provider, for each key, create a KeyState entry

// Key selection
function selectBestApiKey(provider: Provider): { key: string; index: number } | null
  // Filter healthy keys
  // Apply strategy (round-robin / least-used / random)
  // Update usage stats
  // Return null if no healthy keys

// Health management
function markKeyRateLimited(providerId: string, keyIndex: number, cooldownMs: number): void
function markKeyError(providerId: string, keyIndex: number, errorMessage: string): void
function markKeySuccess(providerId: string, keyIndex: number): void
function checkAndRestoreKeys(): void
function getKeyHealthSummary(): HealthResponse

// Timer management
function startHealthCheckTimer(intervalMs?: number): void
function stopHealthCheckTimer(): void

// Helper
function getKeyHash(key: string): string
function maskKey(key: string): string
```

**Key behaviors:**
- Round-robin: Track `roundRobinIndices` per provider, wrap around
- Least-used: Find key with minimum `usageCount`
- Random: Use `Math.random()`, weighted if `keyWeights` provided
- Cooldown: `consecutiveErrors` × `cooldownMs` (escalating cooldown)
- Health check timer runs every 5 seconds
- On restore: reset `consecutiveErrors` to 0

**Estimated lines:** ~150

---

## 6. Phase 4: Request Forwarding & Retry

**Goal:** Forward requests to upstream providers with automatic retry on failure.

### File: `src/forwarder.ts`

**What to implement:**

```typescript
// Main forwarding function
async function forwardRequest(
  request: Request,
  provider: Provider,
  body: ChatCompletionRequest
): Promise<Response>

// Forward with retry logic
async function forwardWithRetry(
  request: Request,
  provider: Provider,
  body: ChatCompletionRequest,
  config: AppConfig
): Promise<Response>

// Streaming forward
async function forwardStreaming(
  request: Request,
  provider: Provider,
  body: ChatCompletionRequest
): Promise<Response>

// Non-streaming forward
async function forwardNonStreaming(
  request: Request,
  provider: Provider,
  body: ChatCompletionRequest
): Promise<Response>

// Build upstream URL
function buildUpstreamUrl(provider: Provider, path: string): string

// Build upstream headers
function buildUpstreamHeaders(provider: Provider, key: string): Headers
```

**Retry logic (from TRD §4.4):**
1. Select best key
2. Forward request
3. If 2xx → return success
4. If 429 → mark key rate-limited, retry with backoff
5. If 5xx → mark key error, retry with backoff
6. If other → return as-is
7. Max retries exhausted → return last error

**Backoff formula:** `1000 * 2^retryCount` ms (1s, 2s, 4s, 8s...)

**Estimated lines:** ~120

### File: `src/retry.ts`

**What to implement:**

```typescript
// Retry configuration
interface RetryConfig {
  maxRetries: number
  baseDelay: number      // Base delay in ms (default: 1000)
  maxDelay: number       // Max delay in ms (default: 30000)
}

// Retry wrapper
async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: any) => boolean,
  config: RetryConfig
): Promise<T>

// Exponential backoff
function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number

// Default retry conditions
function isRetryableStatus(status: number): boolean
  // 429, 500, 502, 503, 504
```

**Estimated lines:** ~60

---

## 7. Phase 5: Provider Adapters

**Goal:** Implement provider-specific request/response translation.

### File: `src/providers/generic.ts`

**What to implement:**
- Passthrough adapter for OpenAI-compatible providers
- No translation needed — forward request as-is
- Used by: OpenAI, DeepSeek, Perplexity, NVIDIA, custom providers

```typescript
function adaptRequest(body: ChatCompletionRequest): object
  // Return body as-is (no changes needed)

function adaptResponse(response: any): ChatCompletionResponse
  // Return response as-is (already OpenAI format)

function adaptStreamChunk(chunk: string): string
  // Return chunk as-is (already OpenAI SSE format)
```

**Estimated lines:** ~20

### File: `src/providers/openai.ts`

**What to implement:**
- Thin wrapper around generic adapter
- Provider-specific model name mapping (if needed)
- Currently just re-exports generic adapter

```typescript
export const adaptRequest = genericAdapter.adaptRequest
export const adaptResponse = genericAdapter.adaptResponse
export const adaptStreamChunk = genericAdapter.adaptStreamChunk
```

**Estimated lines:** ~10

### File: `src/providers/anthropic.ts`

**What to implement:**

```typescript
// Request translation: OpenAI → Anthropic
function adaptRequest(body: ChatCompletionRequest): object
  // Extract system message from messages array
  // Map roles: "user" → "user", "assistant" → "assistant"
  // Remove unsupported params: top_p, frequency_penalty, presence_penalty, logit_bias, n
  // Map model name (strip version if needed)

// Response translation: Anthropic → OpenAI
function adaptResponse(anthropicResponse: any): ChatCompletionResponse
  // Map content blocks to message.content
  // Map stop_reason to finish_reason
  // Map usage

// Streaming chunk translation: Anthropic SSE → OpenAI SSE
function adaptStreamChunk(chunk: string): string
  // Parse Anthropic SSE event
  // Convert to OpenAI SSE format
  // Handle content_block_delta, content_block_stop, message_stop events
```

**Estimated lines:** ~100

### File: `src/providers/google.ts`

**What to implement:**

```typescript
// Request translation: OpenAI → Google Gemini
function adaptRequest(body: ChatCompletionRequest): object
  // Map system message to system_instruction
  // Map messages to contents array
  // Map max_tokens → generationConfig.maxOutputTokens
  // Map temperature → generationConfig.temperature
  // Map top_p → generationConfig.topP
  // Map stop → generationConfig.stopSequences
  // Remove unsupported params

// Response translation: Google → OpenAI
function adaptResponse(googleResponse: any): ChatCompletionResponse
  // Map candidates → choices
  // Map finishReason → finish_reason
  // Map usageMetadata → usage

// Streaming chunk translation: Google SSE → OpenAI SSE
function adaptStreamChunk(chunk: string): string
  // Parse Google SSE event
  // Convert to OpenAI SSE format
```

**Estimated lines:** ~100

---

## 8. Phase 6: Logger & Stats

**Goal:** Implement in-memory logging and statistics tracking.

### File: `src/logger.ts`

**What to implement:**

```typescript
// Log ring buffer
class LogRingBuffer {
  constructor(maxSize: number)
  push(entry: LogEntry): void
  getAll(): LogEntry[]
  getRecent(n: number): LogEntry[]
  clear(): void
  get size(): number
}

// Stats accumulator
class StatsAccumulator {
  recordRequest(entry: LogEntry): void
  getStats(): GatewayStatsResponse
  reset(): void
}

// Singleton instances
const logBuffer: LogRingBuffer
const stats: StatsAccumulator

// Logging functions
function logRequest(entry: Omit<LogEntry, 'id' | 'timestamp'>): void
function getRecentLogs(count?: number): LogEntry[]
function clearLogs(): void
function getStats(): GatewayStatsResponse

// Console logging
function consoleLog(level: LogLevel, message: string, data?: any): void
  // Format: [HH:MM:SS] LEVEL message {data}
  // Color-coded: debug=gray, info=white, warn=yellow, error=red
```

**Estimated lines:** ~100

---

## 9. Phase 7: Main HTTP Handler

**Goal:** Wire everything together into the HTTP server.

### File: `src/index.ts`

**What to implement:**

```typescript
import { Router } from 'itty-router'
import { loadConfig, saveConfig, validateConfig, createDefaultConfig } from './config'
import { findProvidersForModel } from './router'
import { initializeKeyStates, startHealthCheckTimer, getKeyHealthSummary } from './key-pool'
import { forwardWithRetry } from './forwarder'
import { logRequest, getRecentLogs, clearLogs, getStats } from './logger'
import { adaptRequest, adaptResponse } from './providers/generic'
import { adaptRequest as adaptAnthropic, adaptResponse as adaptAnthropicResponse } from './providers/anthropic'
import { adaptRequest as adaptGoogle, adaptResponse as adaptGoogleResponse } from './providers/google'

// Router setup
const router = Router()

// CORS headers for dashboard
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Routes
router.get('/', () => serveDashboard())
router.get('/api/config', () => getConfig())
router.put('/api/config', (request) => updateConfig(request))
router.get('/api/health', () => getHealth())
router.get('/api/logs', () => getLogs())
router.get('/api/stats', () => getStats())
router.get('/v1/models', () => listModels())
router.post('/v1/chat/completions', (request) => handleChatCompletion(request))
router.all('*', () => new Response('Not Found', { status: 404 }))

// Main handler
async function handleChatCompletion(request: Request): Promise<Response> {
  const startTime = Date.now()
  
  // 1. Parse request body
  const body = await request.json() as ChatCompletionRequest
  if (!body.model || !body.messages) {
    return jsonResponse({ error: { message: 'Invalid request', type: 'invalid_request' } }, 400)
  }
  
  // 2. Find provider
  const matches = findProvidersForModel(body.model, config)
  if (matches.length === 0) {
    return jsonResponse({ error: { message: `No provider found for model '${body.model}'`, code: 'unknown_model' } }, 404)
  }
  
  const provider = matches[0].provider
  
  // 3. Select adapter based on provider
  const adapter = getAdapter(provider.id)
  
  // 4. Adapt request if needed
  const adaptedBody = adapter.adaptRequest(body)
  
  // 5. Forward with retry
  const response = await forwardWithRetry(request, provider, adaptedBody, config)
  
  // 6. Adapt response if needed
  const adaptedResponse = adapter.adaptResponse(response)
  
  // 7. Log
  logRequest({ ... })
  
  return adaptedResponse
}

// Server startup
async function main() {
  const configPath = './config.json'
  let config = loadConfig(configPath)
  if (!config) {
    config = createDefaultConfig()
    saveConfig(config, configPath)
    console.log('⚠ Created default config.json — add your API keys to get started')
  }
  
  const validation = validateConfig(config)
  if (!validation.valid) {
    console.error('❌ Invalid config:', validation.errors)
    process.exit(1)
  }
  
  initializeKeyStates(config)
  startHealthCheckTimer()
  
  // Start server
  const port = config.port || 8787
  Bun.serve({ fetch: router.handle, port })  // or Node.js http.createServer
  console.log(`🚀 AI Gateway running on http://localhost:${port}`)
}

main()
```

**Key behaviors:**
- CORS headers for dashboard access
- Request validation before routing
- Provider adapter selection based on provider ID
- Error handling for all failure modes
- Graceful shutdown on SIGINT

**Estimated lines:** ~200

---

## 10. Phase 8: Dashboard (HTML/CSS/JS)

**Goal:** Build the web-based configuration UI.

### File: `src/dashboard/index.html`

**What to implement:**
- Single HTML file with all structure
- Sections: Header, Stats Bar, Providers Grid, Log Table
- Modal for Add/Edit Provider
- Empty states for no providers / no logs
- Toast notification container
- All interactive elements have IDs for JS targeting

**Estimated lines:** ~200

### File: `src/dashboard/styles.css`

**What to implement:**
- Dark theme (GitHub-inspired color palette from UI/UX Brief §1.2)
- Monospace font stack
- Provider card grid layout (responsive, 2 columns on desktop)
- Log table styling with color-coded status
- Modal overlay with backdrop blur
- Form input styling
- Toggle switch styling
- Toast notification animations
- Skeleton loading states
- Print styles (hide interactive elements)

**Estimated lines:** ~400

### File: `src/dashboard/app.js`

**What to implement:**

```javascript
// State
let config = null
let healthData = null
let logs = []
let refreshIntervals = []

// Initialization
async function init() {
  await loadConfig()
  await loadHealth()
  await loadLogs()
  await loadStats()
  setupAutoRefresh()
  setupEventListeners()
}

// API calls
async function loadConfig() { /* GET /api/config */ }
async function loadHealth() { /* GET /api/health */ }
async function loadLogs() { /* GET /api/logs */ }
async function loadStats() { /* GET /api/stats */ }
async function saveConfig(newConfig) { /* PUT /api/config */ }

// Rendering
function renderProviders() { /* Render provider cards */ }
function renderLogTable() { /* Render log entries */ }
function renderStats() { /* Render stats bar */ }
function renderHealthDots(providerId) { /* Render key health indicators */ }

// Modal
function openAddProviderModal() { /* Show empty form */ }
function openEditProviderModal(providerId) { /* Show pre-filled form */ }
function closeModal() { /* Hide modal */ }
function saveProvider() { /* Validate form, update config, save */ }
function deleteProvider(providerId) { /* Confirm, remove, save */ }

// Form handling
function addKeyField() { /* Add another API key input */ }
function removeKeyField(index) { /* Remove API key input */ }
function validateForm() { /* Client-side validation */ }

// Auto-refresh
function setupAutoRefresh() {
  setInterval(loadHealth, 5000)
  setInterval(loadLogs, 2000)
  setInterval(loadStats, 10000)
}

// Toast notifications
function showToast(message, type) { /* Show and auto-dismiss */ }

// Utility
function maskKey(key) { /* "sk-...x2" */ }
function formatDuration(ms) { /* "1,234ms" */ }
function formatTime(timestamp) { /* "12:34:56" */ }
function getStatusClass(status) { /* "status-2xx", "status-4xx", "status-5xx" */ }
```

**Estimated lines:** ~400

---

## 11. Phase 9: Testing

**Goal:** Ensure correctness of all core algorithms.

### File: `tests/router.test.ts`

**Test cases:**
- `matchModelPattern` with exact match
- `matchModelPattern` with prefix glob (`gpt-*`)
- `matchModelPattern` with suffix glob (`*-v2`)
- `matchModelPattern` with wildcard (`nvidia/*`)
- `matchModelPattern` with catch-all (`*`)
- `matchModelPattern` case-insensitive
- `findProvidersForModel` with single match
- `findProvidersForModel` with multiple matches (sorted by specificity)
- `findProvidersForModel` with no match
- `findProvidersForModel` with inactive providers
- `inferProviderPatternsFromId` for all known providers
- `inferProviderPatternsFromId` for unknown provider (returns `["*"]`)

### File: `tests/key-pool.test.ts`

**Test cases:**
- Round-robin selection cycles through keys
- Least-used selects key with lowest usage
- Random selection returns valid key
- Rate-limited keys are skipped
- Error keys are skipped
- All keys unhealthy returns null
- Key restored after cooldown
- `markKeySuccess` resets error count
- `markKeyRateLimited` sets cooldown
- `markKeyError` increments error count

### File: `tests/forwarder.test.ts`

**Test cases:**
- Successful request returns 200
- 429 triggers retry with next key
- 5xx triggers retry with next key
- All retries exhausted returns last error
- No healthy keys returns 503
- Streaming request returns SSE response
- Exponential backoff timing

### File: `tests/config.test.ts`

**Test cases:**
- Valid config passes validation
- Missing provider ID fails validation
- Duplicate provider IDs fail validation
- Invalid base URL fails validation
- No API keys fails validation
- Default config is valid
- Config with all fields is valid

### File: `tests/providers/anthropic.test.ts`

**Test cases:**
- System message extracted correctly
- Messages mapped correctly
- Unsupported params removed
- Response mapped correctly
- Streaming chunks mapped correctly

### File: `tests/providers/google.test.ts`

**Test cases:**
- System message mapped to system_instruction
- Messages mapped to contents
- Params mapped to generationConfig
- Response mapped correctly
- Streaming chunks mapped correctly

---

## 12. Phase 10: Polish & README

### File: `README.md`

**What to include:**

```markdown
# AI Gateway

One endpoint. Any provider. Maximum reliability.

## Quick Start

1. Clone and install:
   ```bash
   git clone https://github.com/yourusername/ai-gateway.git
   cd ai-gateway
   npm install
   ```

2. Add your API keys:
   ```bash
   # Edit config.json with your API keys
   # Or open http://localhost:8787 after starting
   ```

3. Start the gateway:
   ```bash
   npm start
   ```

4. Point your AI tool at:
   ```
   http://localhost:8787/v1
   ```

## Features

- **Single endpoint** — Point any OpenAI-compatible client at one URL
- **Multi-provider** — OpenAI, Anthropic, Google, DeepSeek, NVIDIA, Perplexity, and custom
- **Key pooling** — Multiple API keys per provider with automatic rotation
- **Rate-limit handling** — Automatically retries with different keys on 429
- **Health monitoring** — Unhealthy keys are cooled down and restored automatically
- **Streaming** — Full SSE streaming support
- **Dashboard** — Web UI for configuration and monitoring

## Configuration

Edit `config.json` or use the dashboard at http://localhost:8787.

## API

### POST /v1/chat/completions

Accepts the same format as OpenAI's API. See [OpenAI API Reference](https://platform.openai.com/docs/api-reference/chat).

### GET /v1/models

Returns a list of available models from all active providers.

## Architecture

[Diagram and explanation]

## Development

```bash
npm run dev    # Watch mode
npm run build  # Production build
npm test       # Run tests
```
```

### Final Polish

- Add `config.json` to `.gitignore` (contains API keys!)
- Add `dist/` to `.gitignore`
- Add `node_modules/` to `.gitignore`
- Verify all imports are correct
- Run `npm run build` to verify compilation
- Run `npm test` to verify all tests pass
- Manual smoke test: start gateway, send a curl request, verify dashboard

---

## 13. Implementation Order Summary

| Step | File | Est. Lines | Est. Time | Dependencies |
|------|------|-----------|-----------|--------------|
| 0.1 | package.json | 20 | 5 min | None |
| 0.2 | tsconfig.json | 15 | 5 min | None |
| 0.3 | Directory structure | — | 5 min | None |
| 1.1 | src/types.ts | 150 | 20 min | None |
| 1.2 | src/config.ts | 120 | 20 min | types.ts |
| 2.1 | src/router.ts | 80 | 20 min | types.ts, config.ts |
| 3.1 | src/key-pool.ts | 150 | 30 min | types.ts, config.ts |
| 4.1 | src/retry.ts | 60 | 15 min | None |
| 4.2 | src/forwarder.ts | 120 | 30 min | types.ts, key-pool.ts, retry.ts |
| 5.1 | src/providers/generic.ts | 20 | 5 min | types.ts |
| 5.2 | src/providers/openai.ts | 10 | 2 min | generic.ts |
| 5.3 | src/providers/anthropic.ts | 100 | 30 min | types.ts |
| 5.4 | src/providers/google.ts | 100 | 30 min | types.ts |
| 6.1 | src/logger.ts | 100 | 20 min | types.ts |
| 7.1 | src/index.ts | 200 | 45 min | All above |
| 8.1 | src/dashboard/index.html | 200 | 30 min | None |
| 8.2 | src/dashboard/styles.css | 400 | 30 min | index.html |
| 8.3 | src/dashboard/app.js | 400 | 45 min | index.html, styles.css |
| 9.1 | tests/router.test.ts | 80 | 15 min | router.ts |
| 9.2 | tests/key-pool.test.ts | 80 | 15 min | key-pool.ts |
| 9.3 | tests/forwarder.test.ts | 80 | 15 min | forwarder.ts |
| 9.4 | tests/config.test.ts | 60 | 10 min | config.ts |
| 9.5 | tests/providers/*.test.ts | 100 | 20 min | providers/*.ts |
| 10.1 | README.md | 100 | 15 min | None |
| 10.2 | .gitignore | 5 | 2 min | None |

**Totals:** ~2,500 lines, ~8 hours

---

## 14. Risk Assessment & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Provider API format changes | Low | Medium | Adapter pattern isolates changes to one file |
| Streaming implementation bugs | Medium | High | Test with real provider streams early |
| Memory leak in long-running gateway | Low | Medium | Ring buffer has fixed size, no unbounded growth |
| Config file corruption | Low | High | Validate on every write, keep backup |
| API key exposure in logs | Low | High | Mask keys in all log output, never log full key |
| Race condition in key state updates | Medium | Medium | Use atomic operations, single-threaded Node.js |
| Provider adapter translation errors | Medium | Medium | Unit test each adapter with sample requests/responses |

---

## 15. Acceptance Criteria

Before marking the implementation complete, verify:

- [ ] `npm install` completes without errors
- [ ] `npm run build` compiles without errors
- [ ] `npm start` starts the gateway on port 8787
- [ ] Dashboard loads at http://localhost:8787
- [ ] Can add a provider with API keys via dashboard
- [ ] `POST /v1/chat/completions` with a valid model returns a response
- [ ] `POST /v1/chat/completions` with `stream: true` returns SSE
- [ ] Rate-limited key is automatically skipped and retried
- [ ] Unhealthy key is restored after cooldown
- [ ] `GET /v1/models` returns a list of models
- [ ] Dashboard shows real-time logs and health status
- [ ] `npm test` passes all tests
- [ ] README has clear setup instructions

---

*End of Implementation Plan*