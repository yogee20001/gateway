# Product Requirements Document — AI Gateway

> **Version:** 1.0  
> **Status:** Draft  
> **Author:** AI Gateway Team

---

## 1. Product Overview

### 1.1 Product Name
AI Gateway

### 1.2 Tagline
One endpoint. Any provider. Maximum reliability.

### 1.3 Elevator Pitch
AI Gateway is a lightweight, local-first API proxy that exposes a single OpenAI-compatible endpoint while intelligently routing requests across multiple API keys and AI providers. It automatically selects the best available key, distributes load to avoid rate limits, retries failures, and removes unhealthy keys from rotation — all with zero cloud dependencies.

### 1.4 Target User
A single developer running the gateway locally on their machine. No multi-user support, no cloud services, no subscriptions, no accounts.

### 1.5 Core Value Proposition
- **One endpoint to rule them all** — Point any OpenAI-compatible client at `http://localhost:8787/v1` and never think about which provider or key to use.
- **Automatic failover** — If one key is rate-limited or a provider is down, the gateway transparently retries with the next available key/provider.
- **Rate-limit awareness** — Keys that hit rate limits are temporarily removed from rotation and restored when healthy.
- **Minimal configuration** — Add providers and API keys in a simple UI. Everything else is automatic.

---

## 2. Target Users

| Persona | Description | Needs |
|---------|-------------|-------|
| Solo Developer | Runs AI coding tools (Cursor, Claude Code, etc.) locally | One endpoint, no config hassle, reliable access |
| Power User | Uses multiple AI providers and wants automatic failover | Key rotation, rate-limit handling, health monitoring |
| Tinkerer | Self-hosts AI tools and wants a local proxy | Simple setup, minimal dependencies, easy to modify |

---

## 3. Functional Requirements

### FR-01: OpenAI-Compatible Endpoint
- Expose a single HTTP endpoint at `POST /v1/chat/completions`
- Accept the exact same request body format as OpenAI's API
- Return responses in the exact same format as OpenAI's API
- Support streaming (SSE) responses
- Support all standard parameters: `model`, `messages`, `temperature`, `max_tokens`, `stream`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`, `n`

### FR-02: Multi-Provider Routing
- Route incoming requests to the correct provider based on the requested model name
- Support providers: OpenAI, Anthropic, Google (Gemini), DeepSeek, NVIDIA, Perplexity, and any custom OpenAI-compatible endpoint
- Map model names to providers automatically using pattern matching (e.g., `gpt-*` → OpenAI, `claude-*` → Anthropic)
- Allow user to override routing via configuration

### FR-03: API Key Pool & Rotation
- Support multiple API keys per provider
- Distribute requests across keys using configurable strategy (round-robin, least-used, random)
- Track per-key usage and rate-limit status
- Automatically skip rate-limited or unhealthy keys

### FR-04: Rate-Limit Awareness
- Detect 429 (Rate Limit) and 5xx (Server Error) responses from upstream providers
- Temporarily mark the offending key as "rate-limited" with a configurable cooldown period
- Retry the request with the next available key automatically
- Restore keys to rotation after cooldown expires

### FR-05: Health Monitoring
- Track per-key health status: healthy, rate-limited, error
- Automatically restore keys after cooldown period
- Log key health transitions for debugging

### FR-06: Retry Logic
- Retry on 429 (Rate Limited) and 5xx (Server Error) responses
- Configurable max retries (default: 3)
- Configurable retry delay with exponential backoff
- Retry across different keys/providers, not just the same key

### FR-07: Streaming Support
- Support Server-Sent Events (SSE) streaming responses
- Stream tokens as they arrive from the upstream provider
- Handle stream interruptions gracefully

### FR-08: Configuration UI (Optional but Recommended)
- Web-based dashboard for managing providers and API keys
- View real-time key health and usage statistics
- Add/edit/remove providers and keys
- Toggle providers active/inactive

### FR-09: Logging & Observability
- Log all requests with timestamp, model, provider, key used, status, and duration
- Log key health transitions (healthy → rate-limited → healthy)
- Simple log viewer in the dashboard

---

## 4. Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| **Latency overhead** | < 10ms per request (excluding upstream) | Must not noticeably slow down responses |
| **Memory usage** | < 50MB idle | Runs alongside other developer tools |
| **Startup time** | < 1 second | Should feel instant when starting |
| **Configuration** | Single JSON/YAML file or UI | No database required |
| **Dependencies** | Minimal | Prefer built-in Node.js APIs |
| **Deployment** | Local only | No cloud deployment needed |
| **Platform** | Cross-platform (Windows, macOS, Linux) | Node.js runtime |

---

## 4. User Stories

| ID | Story | Priority |
|----|-------|----------|
| US-01 | As a developer, I want to point my AI coding tool at one endpoint so I don't have to manage multiple API keys. | P0 |
| US-02 | As a developer, I want to add multiple API keys for the same provider so I can stay under rate limits. | P0 |
| US-03 | As a developer, I want the gateway to automatically retry with a different key when one is rate-limited. | P0 |
| US-04 | As a developer, I want to see which providers/keys are configured and their health status. | P1 |
| US-05 | As a developer, I want to add custom providers with custom base URLs. | P1 |
| US-06 | As a developer, I want to see request logs to debug issues. | P1 |
| US-07 | As a developer, I want the gateway to start quickly and use minimal resources. | P1 |
| US-08 | As a developer, I want streaming responses to work transparently through the gateway. | P0 |

---

## 4. Out of Scope (Explicitly Not Building)

- User accounts, authentication, or multi-tenant support
- Cloud deployment or managed hosting
- Usage quotas, billing, or metering
- Request caching or response caching
- Prompt templating or prompt management
- Model fallback chains (e.g., "try GPT-4, then Claude")
- API key encryption at rest (local machine trust model)
- GUI for testing prompts (use any OpenAI-compatible client)
- Mobile app or PWA
- Database dependency (config stored in JSON/YAML)

---

## 5. Assumptions & Decisions

| # | Assumption | Rationale |
|---|------------|-----------|
| 1 | User runs the gateway on localhost only | No authentication needed; trust model for local machine |
| 2 | Node.js runtime (Cloudflare Workers or Node) | Lightweight, cross-platform, excellent HTTP/streaming support |
| 3 | Configuration stored as JSON file | No database dependency; simple to edit manually or via UI |
| 4 | API keys stored in plaintext in config | Local machine trust model; encryption adds complexity without local benefit |
| 5 | Single-user only | No multi-tenant auth, sessions, or user management |
| 6 | Default port 8787 | Standard Cloudflare Workers port; configurable |
| 7 | Streaming is pass-through | Gateway forwards SSE chunks without buffering or modifying |
| 8 | Model routing by pattern matching | Provider declares which models it handles (e.g., `gpt-*`, `claude-*`) |

---

## 4. User Stories (Prioritized)

| ID | Story | Priority | Effort |
|----|-------|----------|--------|
| US-01 | As a developer, I want to point my AI coding tool at `http://localhost:8787/v1` so I don't need to manage multiple API keys. | P0 | S |
| US-02 | As a developer, I want to add multiple API keys for OpenAI so I can stay under rate limits. | P0 | M |
| US-03 | As a developer, I want the gateway to automatically retry with a different key when one is rate-limited. | P0 | M |
| US-04 | As a developer, I want to add multiple AI providers and have requests routed to the correct one automatically. | P0 | M |
| US-05 | As a developer, I want to see which keys are healthy, rate-limited, or errored. | P1 | S |
| US-06 | As a developer, I want to add custom providers with custom base URLs. | P1 | S |
| US-07 | As a developer, I want to see request logs to debug issues. | P1 | M |
| US-08 | As a developer, I want streaming responses to work through the gateway. | P0 | M |
| US-09 | As a developer, I want to configure the gateway through a web UI. | P1 | L |
| US-10 | As a developer, I want the gateway to start in under 1 second. | P1 | S |

---

## 4. User Flow (High-Level)

```
1. User starts the gateway → `npm start` or `node gateway.js`
2. Gateway loads config from `config.json` (or creates default)
3. Gateway starts HTTP server on port 8787
4. User configures their AI tool to use `http://localhost:8787/v1`
5. User sends a chat completion request
6. Gateway matches the requested model to a provider
7. Gateway selects the best available API key for that provider
8. Gateway forwards the request to the upstream provider
9. Gateway returns the response (or streams it) back to the client
10. Gateway logs the request and updates key health/usage stats
11. If a key returns 429 or 5xx, gateway retries with next key
12. Unhealthy keys are cooled down and restored automatically

---

## 4. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Startup time | < 1 second | `time node gateway.js` |
| Memory usage | < 50MB idle | `ps` or Task Manager |
| Request overhead | < 10ms | Compare direct vs. gateway latency |
| Successful failover | 100% of retryable failures | Test with rate-limited keys |
| Config complexity | < 5 minutes to set up | Time from download to first request |
| Streaming latency | < 5ms added | TTFB comparison with/without gateway |

---

## 5. Open Questions & Assumptions

| Question | Assumption Made |
|----------|-----------------|
| Should we support non-OpenAI-compatible providers? | Yes, via a translation layer for Anthropic and Google |
| Should we support streaming for all providers? | Yes, SSE streaming for all |
| What format for config file? | JSON (`config.json`) |
| Should we support environment variables for keys? | Yes, as an alternative to config file |
| What runtime? | Node.js (Cloudflare Workers syntax for portability) |
| Should we persist logs? | In-memory ring buffer (last 1000 requests) |
| Should we support HTTPS? | No, localhost only |
| Should we support custom headers passthrough? | Yes, pass through `Authorization` and `Content-Type` |

---

*End of PRD*