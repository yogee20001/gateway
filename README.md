# AI Gateway

> One endpoint. Any provider. Maximum reliability.

A lightweight, local-first API gateway that exposes a single OpenAI-compatible endpoint while intelligently routing requests across multiple API keys and AI providers.

## Features

- **Single endpoint** — Point any OpenAI-compatible client at `http://localhost:8787/v1`
- **Multi-provider** — OpenAI, Anthropic, Google Gemini, DeepSeek, NVIDIA, Perplexity, and custom providers
- **Key pooling** — Multiple API keys per provider with automatic rotation (round-robin, least-used, random)
- **Rate-limit handling** — Automatically retries with different keys on 429 responses
- **Health monitoring** — Unhealthy keys are cooled down and restored automatically
- **Streaming** — Full SSE streaming support
- **Dashboard** — Web UI for configuration and monitoring at `http://localhost:8787`
- **Zero dependencies** — No database, no cloud services, no accounts

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/ai-gateway.git
cd ai-gateway
npm install

# Start the gateway
npm start
```

Open [http://localhost:8787](http://localhost:8787) to access the dashboard and add your API keys.

## Usage

Point any OpenAI-compatible client at the gateway:

```bash
# Using curl
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

```python
# Using the OpenAI Python SDK
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="not-needed"  # Gateway handles key selection
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Configuration

Edit `config.json` or use the dashboard at `http://localhost:8787`.

### Default Providers

| Provider | ID | Model Patterns |
|----------|----|----------------|
| OpenAI | `openai` | `gpt-*`, `o1-*`, `o3-*`, `davinci-*`, `text-*` |
| Anthropic | `anthropic` | `claude-*` |
| Google Gemini | `google` | `gemini-*`, `palm-*` |
| DeepSeek | `deepseek` | `deepseek-*` |
| NVIDIA | `nvidia` | `nvidia/*`, `meta/*`, `mistralai/*` |
| Perplexity | `perplexity` | `sonar-*`, `llama-*-sonar*` |

### Adding Custom Providers

You can add any OpenAI-compatible provider by specifying:
- A unique provider ID
- The base URL of the API
- Model patterns for routing (e.g., `my-model-*`)
- One or more API keys

## API

### POST /v1/chat/completions

Accepts the exact same format as [OpenAI's Chat Completions API](https://platform.openai.com/docs/api-reference/chat). Supports all parameters including `stream`, `temperature`, `max_tokens`, `tools`, etc.

### GET /v1/models

Returns a list of available models from all active providers.

## Architecture

```
Client → AI Gateway → Provider Router → Key Pool → Upstream API
                        ↓
                   Health Monitor
                        ↓
                   Logger & Stats
```

The gateway:
1. Receives a request at `/v1/chat/completions`
2. Routes to the correct provider based on model name pattern matching
3. Selects the best available API key (round-robin, least-used, or random)
4. Forwards the request to the upstream provider
5. On failure (429/5xx), retries with the next available key
6. Logs the request and updates key health status
7. Automatically restores cooled-down keys

## Development

```bash
npm run dev       # Watch mode (requires tsx)
npm run build     # Production build
npm test          # Run tests
npm run test:watch # Watch tests
```

## Project Structure

```
ai-gateway/
├── src/
│   ├── index.ts           # HTTP server & route handler
│   ├── types.ts           # TypeScript interfaces
│   ├── config.ts          # Config loader & validation
│   ├── router.ts          # Pattern-based provider routing
│   ├── key-pool.ts        # Key selection & health monitoring
│   ├── forwarder.ts       # Request forwarding & retry
│   ├── retry.ts           # Exponential backoff retry logic
│   ├── logger.ts          # In-memory ring buffer logger
│   ├── providers/         # Provider adapters
│   │   ├── generic.ts     # OpenAI-compatible passthrough
│   │   ├── openai.ts      # OpenAI (re-exports generic)
│   │   ├── anthropic.ts   # Anthropic format translation
│   │   └── google.ts      # Google Gemini format translation
│   └── dashboard/         # Web UI
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── tests/                 # Test files
├── config.json            # User configuration
├── package.json
└── README.md
```

## License

MIT