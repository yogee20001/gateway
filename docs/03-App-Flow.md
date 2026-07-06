# App Flow Document — AI Gateway

> **Version:** 1.0  
> **Status:** Draft  
> **Author:** AI Gateway Team

---

## 1. User Onboarding Flow

### 1.1 First-Time Setup

```
User downloads / clones the gateway
           │
           ▼
    Runs: npm install
           │
           ▼
    Runs: npm start
           │
           ▼
    Gateway checks for config.json
           │
           ├── EXISTS? → Load and validate config
           │
           └── NOT FOUND? → Create default config.json
                              │
                              ▼
                        Print to console:
                        ┌─────────────────────────────────────┐
                        │  🚀 AI Gateway running on           │
                        │  http://localhost:8787               │
                        │                                     │
                        │  Dashboard: http://localhost:8787    │
                        │  API:       http://localhost:8787/v1 │
                        │                                     │
                        │  ⚠ No API keys configured!          │
                        │  Open the dashboard to add keys.    │
                        └─────────────────────────────────────┘
```

### 1.2 Configuration Flow

```
User opens http://localhost:8787 in browser
           │
           ▼
    Dashboard loads with empty provider list
           │
           ▼
    User clicks "Add Provider"
           │
           ▼
    Modal/Form appears:
    ┌─────────────────────────────────────┐
    │  Provider ID:   [openai           ] │
    │  Display Name:  [OpenAI           ] │
    │  Base URL:      [https://api.opena] │
    │  Model Patterns:[gpt-*, o1-*      ] │
    │  API Keys:      [sk-xxx1          ] │
    │                 [sk-xxx2          ] │
    │                 [+ Add Key]        │
    │  Key Strategy:  [Round Robin ▼]    │
    │  Active:        [✓]                │
    │                                     │
    │  [Save]  [Cancel]                   │
    └─────────────────────────────────────┘
           │
           ▼
    Provider added to config
           │
           ▼
    Dashboard updates with new provider card
           │
           ▼
    User can now send requests to /v1/chat/completions
```

---

## 2. Request Processing Flow

### 2.1 Standard Request (Non-Streaming)

```
Client sends:
POST http://localhost:8787/v1/chat/completions
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Hello!"}],
  "temperature": 0.7,
  "max_tokens": 100
}
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Request Parsing                                    │
│  - Parse JSON body                                          │
│  - Validate required fields (model, messages)               │
│  - Extract model name: "gpt-4o"                             │
│  - Check if streaming: false                                │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Provider Routing                                   │
│  - Call findProvidersForModel("gpt-4o", config)             │
│  - Check OpenAI patterns: ["gpt-*", "o1-*", "o3-*", ...]   │
│  - "gpt-4o" matches "gpt-*" → specificity: 1 (prefix glob) │
│  - Check Anthropic patterns: ["claude-*"] → no match       │
│  - Check Google patterns: ["gemini-*", "palm-*"] → no match│
│  - Result: [OpenAI (specificity: 1)]                        │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Key Selection                                      │
│  - Provider: OpenAI                                         │
│  - Keys: [sk-xxx1, sk-xxx2, sk-xxx3]                       │
│  - Key states: all healthy                                  │
│  - Strategy: round-robin                                    │
│  - Last used index: 1                                       │
│  - Selected: sk-xxx2 (index 1)                              │
│  - Update lastUsedIndex to 2                                │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Request Forwarding                                 │
│  - Target: https://api.openai.com/v1/chat/completions       │
│  - Headers:                                                 │
│    Authorization: Bearer sk-xxx2                            │
│    Content-Type: application/json                           │
│  - Body: (passthrough, unchanged)                           │
│  - Method: POST                                             │
│  - Send request via fetch()                                 │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Response Handling                                  │
│  - Receive response from upstream                           │
│  - Status: 200 OK                                           │
│  - Parse response body                                      │
│  - Log entry: {model: "gpt-4o", provider: "openai",        │
│                keyIndex: 1, status: 200, duration: 1234ms}  │
│  - Return response to client (passthrough)                  │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
Client receives:
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1719876543,
  "model": "gpt-4o",
  "choices": [...],
  "usage": {...}
}
```

### 2.2 Streaming Request

```
Client sends:
POST http://localhost:8787/v1/chat/completions
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Write a poem"}],
  "stream": true
}
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEPS 1-3: Same as standard request                        │
│  (Parse → Route → Select Key)                               │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Streaming Forward                                  │
│  - Forward request with stream: true                        │
│  - Set response headers:                                    │
│    Content-Type: text/event-stream                          │
│    Cache-Control: no-cache                                  │
│    Connection: keep-alive                                   │
│  - Pipe upstream SSE stream directly to client              │
│  - Each chunk forwarded as-is                               │
│  - On stream end: close connection, log entry               │
│  - On stream error: close connection, log error             │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
Client receives SSE stream:
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk",...}
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk",...}
data: [DONE]
```

---

## 3. Error Handling Flows

### 3.1 Rate Limit (429) — Automatic Retry

```
Request forwarded to OpenAI with key sk-xxx2
           │
           ▼
Upstream returns: HTTP 429 Too Many Requests
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  RATE LIMIT DETECTED                                        │
│  - Mark key sk-xxx2 as "rate-limited"                       │
│  - Set cooldownUntil: now + 60000ms (1 minute)              │
│  - Log: "Key sk-xxx2 rate-limited, cooling down for 60s"   │
│  - Increment retryCount: 1                                  │
│  - Check: retryCount (1) <= maxRetries (3) → continue      │
│  - Wait: 1000 * 2^1 = 2000ms (exponential backoff)         │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  RETRY #1                                                   │
│  - Select best key (sk-xxx2 is rate-limited, skip)          │
│  - Selected: sk-xxx3 (healthy)                              │
│  - Forward request with sk-xxx3                             │
│  - Upstream returns: 200 OK                                 │
│  - Return response to client                                │
│  - Log: "Request succeeded on retry 1 with key sk-xxx3"     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 All Keys Rate-Limited

```
All keys for a provider are rate-limited
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  ALL KEYS EXHAUSTED                                         │
│  - selectBestApiKey() returns null                          │
│  - Check if other providers match the same model            │
│  - If yes: try next provider                                │
│  - If no: return 503 Service Unavailable                    │
│  - Response:                                                │
│    {                                                         │
│      "error": {                                              │
│        "message": "No healthy API keys available for OpenAI",│
│        "type": "gateway_error",                              │
│        "code": "no_healthy_keys"                             │
│      }                                                       │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Server Error (5xx) — Retry

```
Upstream returns: HTTP 500 Internal Server Error
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVER ERROR DETECTED                                      │
│  - Mark key as "error"                                      │
│  - Set cooldownUntil: now + 30000ms (30 seconds)            │
│  - Log: "Upstream server error for key sk-xxx2"             │
│  - Retry with next key (same as rate-limit flow)            │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 Unknown Model

```
Client requests model "my-custom-model-v1"
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  NO PROVIDER MATCH                                          │
│  - findProvidersForModel() returns []                       │
│  - Return 404 Not Found                                     │
│  - Response:                                                │
│    {                                                         │
│      "error": {                                              │
│        "message": "No provider found for model               │
│                     'my-custom-model-v1'",                   │
│        "type": "gateway_error",                              │
│        "code": "unknown_model"                               │
│      }                                                       │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Health Monitoring Flow

### 4.1 Key Health Lifecycle

```
                    ┌──────────┐
                    │  HEALTHY │◄────────────────────────────┐
                    └────┬─────┘                             │
                         │                                   │
            ┌────────────┼────────────┐                      │
            │            │            │                      │
            ▼            ▼            ▼                      │
    ┌────────────┐ ┌────────────┐ ┌────────┐                │
    │ 429 Error  │ │ 5xx Error  │ │ Timeout│                │
    └──────┬─────┘ └──────┬─────┘ └───┬────┘                │
           │              │           │                      │
           ▼              ▼           ▼                      │
    ┌─────────────────────────────────────┐                  │
    │         RATE-LIMITED / ERROR        │                  │
    │  cooldownUntil = now + cooldownMs   │                  │
    └──────────────┬──────────────────────┘                  │
                   │                                         │
                   │  Timer ticks (every 5s)                 │
                   │  Check: now >= cooldownUntil?           │
                   │                                         │
                   ├── YES ──────────────────────────────────┘
                   │         (restore to healthy)
                   │
                   └── NO → Stay in cooldown
```

### 4.2 Health Check Timer

```
Every 5 seconds:
┌─────────────────────────────────────────────────────────────┐
│  for each (key, state) in keyStates:                        │
│    if state.health !== 'healthy' AND state.cooldownUntil:   │
│      if Date.now() >= state.cooldownUntil:                  │
│        state.health = 'healthy'                             │
│        state.cooldownUntil = null                           │
│        logger.info(`Key ${maskKey(key)} restored to healthy`)│
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Dashboard Flows

### 5.1 Dashboard Page Load

```
User navigates to http://localhost:8787
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Dashboard loads:                                           │
│  - Fetch GET /api/config → populate provider cards          │
│  - Fetch GET /api/health → populate health indicators       │
│  - Fetch GET /api/logs → populate log table                 │
│  - Fetch GET /api/stats → populate stats summary            │
│  - Set up auto-refresh: health every 5s, logs every 2s      │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Add Provider

```
User clicks "Add Provider"
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Modal opens with form fields:                              │
│  - Provider ID (required, unique)                           │
│  - Display Name (required)                                  │
│  - Base URL (required, pre-filled with OpenAI default)      │
│  - Model Patterns (optional, comma-separated)               │
│  - API Keys (at least one required)                         │
│  - Key Strategy (dropdown: round-robin, least-used, random) │
│  - Active (toggle, default: true)                           │
│                                                             │
│  User fills form and clicks "Save"                          │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  PUT /api/config with updated config                        │
│  - Server validates config                                  │
│  - Server writes config.json                                │
│  - Server updates in-memory config                          │
│  - Returns 200 OK                                           │
│  - Dashboard refreshes provider list                        │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Edit Provider

```
User clicks "Edit" on a provider card
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Modal opens pre-filled with existing provider data         │
│  User modifies fields and clicks "Save"                     │
│  Same flow as Add Provider                                  │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 Delete Provider

```
User clicks "Delete" on a provider card
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Confirmation dialog: "Delete provider 'OpenAI'?"           │
│  User confirms                                              │
│  PUT /api/config with provider removed                      │
│  Dashboard refreshes                                        │
└─────────────────────────────────────────────────────────────┘
```

### 5.5 Toggle Provider Active/Inactive

```
User clicks toggle switch on provider card
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  PUT /api/config with isActive toggled                      │
│  Dashboard updates card styling (grayed out if inactive)    │
│  Inactive providers are skipped during routing              │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Log Viewer Flow

### 6.1 Real-Time Log Updates

```
Dashboard log table auto-refreshes every 2 seconds
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  GET /api/logs → returns array of LogEntry objects          │
│  Table columns:                                             │
│  ┌──────┬───────┬────────┬──────────┬──────┬──────────┬──┐ │
│  │ Time │ Model │ Prov.  │ Key      │Status│ Duration │R │ │
│  ├──────┼───────┼────────┼──────────┼──────┼──────────┼──┤ │
│  │12:34 │gpt-4o │openai  │sk-xxx2   │ 200  │ 1,234ms  │0 │ │
│  │12:33 │claude │anthrop │sk-yyy1   │ 429  │ 567ms    │2 │ │
│  │12:33 │gemini │google  │sk-zzz3   │ 200  │ 2,100ms  │0 │ │
│  └──────┴───────┴────────┴──────────┴──────┴──────────┴──┘ │
│  - Color-coded status: green (2xx), yellow (4xx), red (5xx) │
│  - Click row to see details                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Startup & Shutdown Flow

### 7.1 Startup Sequence

```
npm start
   │
   ▼
1. Load config.json (or create default)
   │
   ▼
2. Validate config structure
   │
   ▼
3. Initialize key state map from provider keys
   │
   ▼
4. Start health check timer (every 5s)
   │
   ▼
5. Start HTTP server on configured port
   │
   ▼
6. Print startup banner to console
   │
   ▼
7. Ready to accept requests
```

### 7.2 Shutdown Sequence

```
Ctrl+C / SIGINT
   │
   ▼
1. Stop health check timer
   │
   ▼
2. Close HTTP server (stop accepting new connections)
   │
   ▼
3. Wait for in-flight requests to complete (max 5s)
   │
   ▼
4. Print shutdown message
   │
   ▼
5. Exit process
```

---

## 8. Data Flow Diagram

```
┌──────────────┐     POST /v1/chat/completions     ┌──────────────────┐
│              │ ──────────────────────────────────→│                  │
│   Client     │                                     │   AI Gateway     │
│  (Cursor,    │←──────────────────────────────────│  (Worker)        │
│   Claude,    │     Response / SSE Stream           │                  │
│   etc.)      │                                     │  ┌────────────┐  │
└──────────────┘                                     │  │ Config     │  │
                                                     │  │ (JSON)     │  │
                                                     │  └────────────┘  │
                                                     │         │        │
                                                     │         ▼        │
                                                     │  ┌────────────┐  │
                                                     │  │ Router     │  │
                                                     │  │ (Pattern   │  │
                                                     │  │  Matching) │  │
                                                     │  └──────┬─────┘  │
                                                     │         │        │
                                                     │         ▼        │
                                                     │  ┌────────────┐  │
                                                     │  │ Key Pool   │  │
                                                     │  │ (Selector) │  │
                                                     │  └──────┬─────┘  │
                                                     │         │        │
                                                     │         ▼        │
                                                     │  ┌────────────┐  │
                                                     │  │ Forwarder  │  │
                                                     │  │ + Retry    │  │
                                                     │  └──────┬─────┘  │
                                                     │         │        │
                                                     │         ▼        │
                                                     │  ┌────────────┐  │
                                                     │  │ Logger     │  │
                                                     │  │ (Ring      │  │
                                                     │  │  Buffer)   │  │
                                                     │  └────────────┘  │
                                                     └──────────────────┘
                                                              │
                                    ┌─────────────────────────┼─────────────────────────┐
                                    │                         │                         │
                                    ▼                         ▼                         ▼
                          ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
                          │   OpenAI API     │     │  Anthropic API   │     │  Google Gemini   │
                          │   (Direct)       │     │  (Translated)    │     │  (Translated)    │
                          └──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

*End of App Flow Document*