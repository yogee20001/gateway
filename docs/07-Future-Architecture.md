# AI Gateway — Future Architecture & Follow-up Plan

> **Version:** 1.0  
> **Status:** Planning  
> **Author:** AI Gateway Team

---

## 1. Current State Summary

The AI Gateway is fully functional with:

- ✅ OpenAI-compatible endpoint (`POST /v1/chat/completions`)
- ✅ Multi-provider routing via glob pattern matching
- ✅ Key pooling with 3 strategies (round-robin, least-used, random)
- ✅ Automatic retry on 429/5xx with exponential backoff
- ✅ Health monitoring with auto-restore
- ✅ Streaming SSE passthrough
- ✅ Provider adapters (Anthropic, Google Gemini)
- ✅ Web dashboard with tag-based UI
- ✅ 25 passing tests
- ✅ API keys persist permanently

---

## 2. Suggested Follow-up Features (Priority Order)

### P0 — Critical Improvements

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| 1 | **Model catalog endpoint** | `GET /v1/models` should return real model names from each provider's API instead of synthetic names | 2h |
| 2 | **Request/response logging to file** | Optional file-based logging for debugging (currently in-memory only) | 1h |
| 3 | **Config backup on save** | Auto-backup `config.json` to `config.json.bak` before overwriting | 30min |

### P1 — Quality of Life

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| 4 | **Per-model rate limit tracking** | Track rate limits per model, not just per key | 3h |
| 5 | **Dashboard dark/light theme toggle** | Add theme switcher to dashboard | 1h |
| 6 | **Export/import config** | Download/upload config.json from dashboard | 1h |
| 7 | **Request history search/filter** | Filter logs by model, provider, status, date range | 2h |

### P2 — Advanced Features

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| 8 | **Model fallback chains** | Try provider A, if fails try provider B (e.g., "try GPT-4o, then Claude") | 4h |
| 9 | **Cost tracking** | Track token usage and estimate costs per provider | 3h |
| 10 | **Multi-user support** | Basic auth + per-user config isolation | 8h |
| 11 | **Docker support** | Dockerfile + docker-compose for easy deployment | 2h |
| 12 | **CLI tool** | `ai-gateway` CLI for starting/stopping/managing from terminal | 3h |

### P3 — Nice to Have

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| 13 | **Prompt caching** | Cache identical requests to reduce API costs | 5h |
| 14 | **WebSocket support** | Real-time streaming via WebSocket instead of SSE | 4h |
| 15 | **Plugin system** | Allow custom provider adapters as plugins | 6h |
| 16 | **Prometheus metrics** | Export metrics for monitoring with Grafana | 3h |

---

## 3. Architecture for Next Major Feature: Model Fallback Chains

### Problem
Currently, if a model isn't available on the first matched provider, the gateway returns an error. Users want to say "try GPT-4o on OpenAI first, if that fails try Claude 3.5 on Anthropic."

### Proposed Config Change

```json
{
  "id": "openai",
  "name": "OpenAI",
  "apiKeys": ["sk-..."],
  "modelPatterns": ["gpt-*"],
  "isActive": true,
  "fallback": {
    "gpt-4o": ["anthropic:claude-3-5-sonnet", "google:gemini-1.5-pro"]
  }
}
```

### Data Flow

```
Request: model=gpt-4o
  → Try OpenAI (gpt-4o)
  → If 429/5xx:
    → Try Anthropic (claude-3-5-sonnet)  [fallback 1]
    → If 429/5xx:
      → Try Google (gemini-1.5-pro)      [fallback 2]
      → If 429/5xx:
        → Return error
```

### Files to Modify
- `src/types.ts` — Add `fallback` field to Provider
- `src/router.ts` — Add fallback resolution
- `src/forwarder.ts` — Add fallback chain logic
- `src/index.ts` — Handle fallback in request flow
- `src/dashboard/app.js` — Add fallback UI

---

## 4. Architecture for: File-Based Logging

### Problem
Currently logs are in-memory only (last 1000 entries). They're lost on restart.

### Solution
Add optional file logging alongside the in-memory ring buffer.

### Config
```json
{
  "logToFile": true,
  "logFilePath": "./gateway.log",
  "logMaxSize": 10485760  // 10MB
}
```

### Implementation
- New file: `src/file-logger.ts`
- Writes to a rotating log file
- Format: `[2026-07-02 12:34:56] ✓ POST /v1/chat/completions model=gpt-4o → openai → 200 (1234ms)`
- Rotates when file exceeds `logMaxSize`

---

## 5. Architecture for: Cost Tracking

### Problem
Users don't know how much they're spending across providers.

### Solution
Track token usage and estimate costs based on provider pricing.

### Data Model
```typescript
interface CostEntry {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;  // in USD
  timestamp: number;
}
```

### Provider Pricing Table
```typescript
const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  openai: {
    'gpt-4o': { input: 0.0025, output: 0.01 },     // per 1K tokens
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  },
  anthropic: {
    'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  },
};
```

### Dashboard Addition
- New "Cost" tab showing daily/weekly/monthly spending
- Per-provider cost breakdown
- Cost alerts (optional)

---

## 6. Architecture for: Docker Support

### Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8787
CMD ["node", "dist/index.js"]
```

### docker-compose.yml
```yaml
version: '3.8'
services:
  gateway:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - ./config.json:/app/config.json
      - ./gateway.log:/app/gateway.log
    restart: unless-stopped
```

---

## 7. Known Issues to Address

| Issue | Status | Fix |
|-------|--------|-----|
| `z-ai/glm-5.1` returns 410 (Gone) from NVIDIA | 🔴 Not a gateway bug | Model removed from NVIDIA's catalog |
| `deepseek-ai/deepseek-v4-flash` times out (504) | 🟡 Needs investigation | Model may not exist on NVIDIA |
| Dashboard shows "No providers" briefly on load | 🟡 Minor | Add loading skeleton |
| Console warnings for missing keys on every config save | 🟢 Cosmetic | Already fixed — warnings only on startup |

---

## 8. Testing Gaps

| Area | Current Coverage | Target |
|------|-----------------|--------|
| Pattern matching | ✅ 18 tests | 18 |
| Config validation | ✅ 7 tests | 7 |
| Key pool logic | ❌ 0 tests | 10+ |
| Forwarder/retry | ❌ 0 tests | 10+ |
| Provider adapters | ❌ 0 tests | 10+ |
| Dashboard API | ❌ 0 tests | 5+ |
| E2E flow | ❌ 0 tests | 3+ |

---

*End of Future Architecture Document*