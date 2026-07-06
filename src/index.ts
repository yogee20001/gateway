// ============================================================
// AI Gateway — Main HTTP Handler
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadConfig, saveConfig, validateConfig, createDefaultConfig, maskApiKey, getProviderKeys } from './config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { findProvidersForModel } from './router';
import { initializeKeyStates, startHealthCheckTimer, stopHealthCheckTimer, getKeyHealthSummary, setProviders } from './key-pool';
import { forwardWithRetry } from './forwarder';
import { logRequest, getRecentLogs, clearLogs, getStats, resetStats } from './logger';
import { initializeRateLimiters } from './rate-limiter';
import { responseCache } from './cache';
import { requestHedger } from './hedging';
import { modelWarmer } from './warmup';
import type { AppConfig, ChatCompletionRequest, LogEntry } from './types';

// ============================================================
// State
// ============================================================
let config: AppConfig;

// ============================================================
// Request Body Parsing
// ============================================================
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ============================================================
// JSON Response Helper
// ============================================================
function jsonResponse(data: any, status: number = 200, headers: Record<string, string> = {}): { status: number; data: string; headers: Record<string, string> } {
  return {
    status,
    data: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers,
    },
  };
}

// ============================================================
// HTML Response Helper
// ============================================================
function htmlResponse(html: string, status: number = 200): { status: number; data: string; headers: Record<string, string> } {
  return {
    status,
    data: html,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  };
}

// ============================================================
// CORS Preflight
// ============================================================
function corsPreflightResponse(): { status: number; data: string; headers: Record<string, string> } {
  return {
    status: 204,
    data: '',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  };
}

// ============================================================
// Serve Dashboard
// ============================================================
function serveDashboard(): { status: number; data: string; headers: Record<string, string> } {
  const dashboardPath = join(__dirname, 'dashboard', 'index.html');
  if (!existsSync(dashboardPath)) {
    return htmlResponse('<h1>Dashboard not found</h1><p>Run the gateway from the project root directory.</p>', 404);
  }
  const html = readFileSync(dashboardPath, 'utf-8');
  return htmlResponse(html);
}

// ============================================================
// Serve Static Files
// ============================================================
function serveStatic(urlPath: string): { status: number; data: any; headers: Record<string, string> } | null {
  if (!urlPath.startsWith('/dashboard/')) return null;

  const filePath = join(__dirname, 'dashboard', urlPath.replace('/dashboard/', ''));
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  const content = readFileSync(filePath);
  return {
    status: 200,
    data: content,
    headers: {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    },
  };
}

// ============================================================
// Route Handler
// ============================================================
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';
  const startTime = Date.now();

  try {
    // CORS preflight
    if (method === 'OPTIONS') {
      const r = corsPreflightResponse();
      writeResponse(res, r.status, r.data, r.headers);
      return;
    }

    let result: { status: number; data: any; headers: Record<string, string> } | null = null;

    // Route matching
    if (path === '/' && method === 'GET') {
      result = serveDashboard();
    }
    else if (path.startsWith('/dashboard/') && method === 'GET') {
      const staticResult = serveStatic(path);
      if (staticResult) result = staticResult;
    }
    else if (path === '/api/config' && method === 'GET') {
      // Return config with keys masked for display only
      // Each key gets a unique mask showing first 4 and last 4 chars so frontend can distinguish them
      const maskedConfig = {
        ...config,
        providers: config.providers.map(p => ({
          ...p,
          apiKey: p.apiKey ? maskApiKey(p.apiKey) : null,
          apiKeys: p.apiKeys?.length ? p.apiKeys.map(k => maskApiKey(k)) : [],
        })),
      };
      result = jsonResponse(maskedConfig);
    }
    else if (path === '/api/config' && method === 'PUT') {
      try {
        const newConfig = await parseBody(req) as AppConfig;

        // Merge incoming config with existing config to preserve masked keys
        // If a provider ID matches an existing provider, keep only the keys that are
        // explicitly sent back (either as masked keys matching existing ones, or new real keys).
        // This allows deletion of keys by simply not including them in the request.
        for (let i = 0; i < (newConfig.providers || []).length; i++) {
          const incoming = newConfig.providers[i];
          const existing = config.providers.find(p => p.id === incoming.id);

          if (existing) {
            // Get all existing keys (from both apiKey and apiKeys)
            const existingKeys = [
              ...(existing.apiKey ? [existing.apiKey] : []),
              ...(existing.apiKeys || [])
            ];

            // Helper: check if a key looks like a masked key (contains ellipsis …)
            const isMaskedKey = (key: string) => key.includes('…');

            // Helper: find the original key that matches a masked key
            const findOriginalKey = (maskedKey: string) => {
              return existingKeys.find(orig => maskApiKey(orig) === maskedKey);
            };

            // Build the new apiKeys array from scratch based on what's sent
            // Only keep keys that are explicitly in the incoming request
            if (incoming.apiKeys && incoming.apiKeys.length > 0) {
              const newKeys: string[] = [];
              for (const incomingKey of incoming.apiKeys) {
                if (isMaskedKey(incomingKey)) {
                  // This is a masked key from the GET response - find and preserve the original
                  const originalKey = findOriginalKey(incomingKey);
                  if (originalKey && !newKeys.includes(originalKey)) {
                    newKeys.push(originalKey);
                  }
                  // If no match found, skip (key was deleted or invalid)
                } else {
                  // Real new key - add if not already present
                  if (!newKeys.includes(incomingKey)) {
                    newKeys.push(incomingKey);
                  }
                }
              }
              incoming.apiKeys = newKeys;
            } else if (incoming.apiKeys !== undefined) {
              // Explicitly set to empty array - user deleted all keys
              incoming.apiKeys = [];
            }
            
            // Handle single apiKey field
            if (incoming.apiKey) {
              if (isMaskedKey(incoming.apiKey)) {
                // Masked key - find and preserve the original
                const originalKey = findOriginalKey(incoming.apiKey);
                if (originalKey) {
                  incoming.apiKey = originalKey;
                } else {
                  // Masked key not found in existing - remove it
                  incoming.apiKey = null;
                }
              }
              // If it's a real key, keep it as-is (new key being added)
            } else if (incoming.apiKey !== undefined) {
              // Explicitly set to null/undefined - user deleted the single key
              incoming.apiKey = null;
            }
          }
        }

        const validation = validateConfig(newConfig);
        if (!validation.valid) {
          result = jsonResponse({ error: { message: 'Invalid configuration', details: validation.errors } }, 400);
        } else {
          config = newConfig;
          saveConfig(config);
          setProviders(config.providers);
          initializeKeyStates(config);
          result = jsonResponse({ success: true, message: 'Configuration saved' });
        }
      } catch (err) {
        result = jsonResponse({ error: { message: 'Failed to parse request body' } }, 400);
      }
    }
    else if (path === '/api/health' && method === 'GET') {
      const healthSummary = getKeyHealthSummary();
      // Add rate limit status to health response
      const rateLimitStatus: Record<string, any> = {};
      const { providerRateLimiter } = await import('./rate-limiter');
      for (const providerId of Object.keys(healthSummary.providers)) {
        const status = providerRateLimiter.getStatus(providerId);
        if (status) {
          rateLimitStatus[providerId] = status;
        }
      }
      result = jsonResponse({ ...healthSummary, rateLimits: rateLimitStatus });
    }
    else if (path === '/api/logs' && method === 'GET') {
      result = jsonResponse(getRecentLogs(100));
    }
    else if (path === '/api/logs' && method === 'DELETE') {
      clearLogs();
      result = jsonResponse({ success: true });
    }
    else if (path === '/api/stats' && method === 'GET') {
      result = jsonResponse(getStats());
    }
    else if (path === '/api/stats' && method === 'DELETE') {
      resetStats();
      result = jsonResponse({ success: true });
    }
    else if (path === '/api/warmup/stats' && method === 'GET') {
      const warmupStats: Record<string, any> = {};
      for (const [providerId, stats] of modelWarmer.getAllStats()) {
        warmupStats[providerId] = stats;
      }
      const warmupConfig = modelWarmer.getConfig();
      result = jsonResponse({
        providers: warmupStats,
        modelUsage: modelWarmer.getModelUsage(),
        priorityModels: modelWarmer.getPriorityModelsAll(),
        config: {
          smartWarmingEnabled: warmupConfig.smartWarming,
          priorityIntervalMs: warmupConfig.priorityIntervalMs,
          maxPriorityModels: warmupConfig.maxPriorityModels,
          priorityWindowMs: warmupConfig.priorityWindowMs,
        }
      });
    }
    else if (path === '/api/warmup/config' && method === 'GET') {
      const warmupConfig = modelWarmer.getConfig();
      result = jsonResponse({
        enabled: warmupConfig.enabled,
        intervalMs: warmupConfig.intervalMs,
        warmupModels: warmupConfig.warmupModels,
        warmupPrompt: warmupConfig.warmupPrompt,
        maxTokens: warmupConfig.maxTokens,
        timeoutMs: warmupConfig.timeoutMs,
        concurrency: warmupConfig.concurrency,
        skipIfRecentRequest: warmupConfig.skipIfRecentRequest,
        recentRequestWindowMs: warmupConfig.recentRequestWindowMs,
        smartWarmingEnabled: warmupConfig.smartWarming,
        priorityIntervalMs: warmupConfig.priorityIntervalMs,
        maxPriorityModels: warmupConfig.maxPriorityModels,
        priorityWindowMs: warmupConfig.priorityWindowMs,
      });
    }
    else if (path === '/api/warmup/config' && method === 'PUT') {
      try {
        const newConfig = await parseBody(req);
        modelWarmer.updateConfig(newConfig);
        result = jsonResponse({ success: true, message: 'Warmup configuration updated' });
      } catch (err: any) {
        result = jsonResponse({ error: { message: 'Failed to parse request body' } }, 400);
      }
    }
    else if (path === '/api/warmup/priority' && method === 'GET') {
      result = jsonResponse({
        priorityModels: modelWarmer.getPriorityModelsAll(),
        allModelUsage: modelWarmer.getModelUsage(),
      });
    }
    else if (path === '/api/warmup/force' && method === 'POST') {
      try {
        const body = await parseBody(req) as { providerId: string; model: string; priority?: boolean };
        const provider = config.providers.find(p => p.id === body.providerId);
        if (!provider) {
          result = jsonResponse({ error: { message: `Provider '${body.providerId}' not found` } }, 404);
        } else if (body.priority) {
          await modelWarmer.forcePriorityWarmup(provider, body.model);
          result = jsonResponse({ success: true, message: `Priority warmup triggered for ${body.model}` });
        } else {
          await modelWarmer.forceWarmup(provider, body.model);
          result = jsonResponse({ success: true, message: `Warmup triggered for ${body.model}` });
        }
      } catch (err: any) {
        result = jsonResponse({ error: { message: err.message } }, 500);
      }
    }
    else if (path === '/api/ping' && method === 'GET') {
      result = jsonResponse({
        status: 'ok',
        timestamp: Date.now(),
        uptime: Date.now() - (getStats().uptime || 0),
        providers: config.providers.length,
        models: config.providers.filter(p => p.isActive).length,
      });
    }
    else if (path === '/api/test' && method === 'POST') {
      try {
        const body = await parseBody(req);
        const model = body.model || 'test-model';
        const matches = findProvidersForModel(model, config);

        result = jsonResponse({
          success: true,
          message: 'Request received by gateway',
          requestedModel: model,
          timestamp: new Date().toISOString(),
          matchedProviders: matches.map(m => ({
            provider: m.provider.id,
            name: m.provider.name,
            pattern: m.pattern,
            specificity: m.specificity,
            hasKeys: getProviderKeys(m.provider).length > 0,
          })),
          requestBody: {
            model: body.model,
            messages: body.messages ? body.messages.length : 0,
            stream: body.stream || false,
            temperature: body.temperature,
            max_tokens: body.max_tokens,
          },
        });

        const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
          method: 'POST',
          path: '/api/test',
          model: model,
          provider: 'gateway',
          providerName: 'Gateway Test',
          keyHash: 'test',
          keyMasked: 'test',
          status: 200,
          duration: Date.now() - startTime,
          retries: 0,
          streamed: false,
          error: null,
          requestPreview: JSON.stringify(body).substring(0, 200),
          responsePreview: JSON.stringify(result).substring(0, 200),
        };
        logRequest(logEntry);
      } catch (err: any) {
        result = jsonResponse({ error: { message: err.message } }, 500);
      }
    }
    else if (path === '/v1/models' && method === 'GET') {
      const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
      const now = Math.floor(Date.now() / 1000);
      for (const p of config.providers) {
        if (!p.isActive) continue;
        const patterns = p.modelPatterns || [`${p.id}-*`];
        for (const pattern of patterns) {
          const modelId = pattern.replace('*', 'latest');
          models.push({
            id: modelId,
            object: 'model',
            created: now,
            owned_by: p.id,
          });
        }
      }
      result = jsonResponse({ object: 'list', data: models });
    }
    else if (path === '/v1/chat/completions' && method === 'POST') {
      try {
        const body = await parseBody(req) as ChatCompletionRequest;

        if (!body.model || !body.messages) {
          result = jsonResponse({ error: { message: 'Invalid request: model and messages are required', code: 'invalid_request' } }, 400);
        } else {
          console.log(`[request] POST /v1/chat/completions model=${body.model} messages=${body.messages.length} stream=${body.stream}`);

          const matches = findProvidersForModel(body.model, config);
          if (matches.length === 0) {
            result = jsonResponse({
              error: { message: `No provider found for model '${body.model}'`, code: 'unknown_model' }
            }, 404);

            const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
              method: 'POST', path: '/v1/chat/completions', model: body.model,
              provider: 'none', providerName: 'none', keyHash: 'none', keyMasked: 'none',
              status: 404, duration: Date.now() - startTime, retries: 0,
              streamed: body.stream === true, error: `No provider found for model '${body.model}'`,
              requestPreview: JSON.stringify(body).substring(0, 200), responsePreview: null,
            };
            logRequest(logEntry);
          } else {
            const provider = matches[0].provider;
            const hasKeys = getProviderKeys(provider).length > 0;

            if (!hasKeys) {
              result = jsonResponse({
                error: { message: `Provider '${provider.name}' has no API keys configured. Add keys via the dashboard.`, code: 'no_keys' }
              }, 503);

              const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
                method: 'POST', path: '/v1/chat/completions', model: body.model,
                provider: provider.id, providerName: provider.name, keyHash: 'none', keyMasked: 'none',
                status: 503, duration: Date.now() - startTime, retries: 0,
                streamed: body.stream === true, error: `No API keys for ${provider.name}`,
                requestPreview: JSON.stringify(body).substring(0, 200), responsePreview: null,
              };
              logRequest(logEntry);
            } else {
              // Record request for warmup tracking (with provider for smart warming)
              modelWarmer.recordRequest(body.model, provider.id);

              // Try cache first (non-streaming only)
              let cachedResponse = null;
              if (!body.stream && responseCache.shouldCache(body)) {
                const cacheKey = responseCache.generateKey(body);
                cachedResponse = responseCache.get(cacheKey);
              }

              if (cachedResponse) {
                console.log(`[cache] HIT for model=${body.model}`);
                const duration = Date.now() - startTime;
                
                const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
                  method: 'POST', path: '/v1/chat/completions', model: body.model,
                  provider: provider.id, providerName: provider.name,
                  keyHash: 'cache', keyMasked: 'cache',
                  status: 200, duration, retries: 0, streamed: false,
                  error: null, requestPreview: JSON.stringify(body).substring(0, 200),
                  responsePreview: '[cached response]',
                };
                logRequest(logEntry);

                const responseBody = JSON.stringify(cachedResponse.data);
                const responseHeaders: Record<string, string> = {
                  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
                  'X-Cache': 'HIT',
                };
                writeResponse(res, 200, responseBody, responseHeaders);
                return;
              }

              // Use hedging for non-streaming, low-temperature requests
              const hedgingResult = await requestHedger.executeWithHedging(provider, body, config);
              const forwardResult = hedgingResult.response;
              const duration = Date.now() - startTime;

              // Cache successful non-streaming responses
              if (!body.stream && forwardResult.status === 200 && responseCache.shouldCache(body)) {
                const cacheKey = responseCache.generateKey(body);
                responseCache.set(cacheKey, forwardResult.body, forwardResult.status);
                console.log(`[cache] SET for model=${body.model}`);
              }

              if (forwardResult.streamResponse) {
                const responseHeaders: Record<string, string> = {
                  'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
                };
                res.writeHead(200, responseHeaders);

                const reader = forwardResult.streamResponse.body!.getReader();
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                  }
                } catch (err: any) {
                  console.error(`[stream] Pipe error: ${err.message}`);
                } finally {
                  res.end();
                }

                const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
                  method: 'POST', path: '/v1/chat/completions', model: body.model,
                  provider: provider.id, providerName: provider.name,
                  keyHash: forwardResult.keyIndex >= 0 ? `key-${forwardResult.keyIndex}` : 'none',
                  keyMasked: forwardResult.keyIndex >= 0 ? `key-${forwardResult.keyIndex}` : 'none',
                  status: 200, duration, retries: forwardResult.retries, streamed: true,
                  error: null, requestPreview: JSON.stringify(body).substring(0, 200),
                  responsePreview: '[streaming response]',
                };
                logRequest(logEntry);
                return;
              }

              const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
                method: 'POST', path: '/v1/chat/completions', model: body.model,
                provider: provider.id, providerName: provider.name,
                keyHash: forwardResult.keyIndex >= 0 ? `key-${forwardResult.keyIndex}` : 'none',
                keyMasked: forwardResult.keyIndex >= 0 ? `key-${forwardResult.keyIndex}` : 'none',
                status: forwardResult.status, duration, retries: forwardResult.retries,
                streamed: false,
                error: forwardResult.status >= 400 ? (forwardResult.body?.error?.message || `HTTP ${forwardResult.status}`) : null,
                requestPreview: JSON.stringify(body).substring(0, 200),
                responsePreview: JSON.stringify(forwardResult.body).substring(0, 200),
              };
              logRequest(logEntry);

              const responseBody = JSON.stringify(forwardResult.body);
              const responseHeaders: Record<string, string> = {
                'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
                ...forwardResult.headers,
              };
              writeResponse(res, forwardResult.status, responseBody, responseHeaders);
              return;
            }
          }
        }
      } catch (err: any) {
        console.error(`[error] POST /v1/chat/completions failed:`, err.message);
        const duration = Date.now() - startTime;
        const logEntry: Omit<LogEntry, 'id' | 'timestamp'> = {
          method: 'POST', path: '/v1/chat/completions', model: 'unknown',
          provider: 'error', providerName: 'Error', keyHash: 'none', keyMasked: 'none',
          status: 500, duration, retries: 0, streamed: false, error: err.message,
          requestPreview: null, responsePreview: null,
        };
        logRequest(logEntry);
        result = jsonResponse({ error: { message: err.message, code: 'internal_error' } }, 500);
      }
    }
    else {
      result = jsonResponse({ error: { message: 'Not Found' } }, 404);
    }

    if (result) {
      writeResponse(res, result.status, result.data, result.headers);
    }
  } catch (err: any) {
    console.error('Unhandled error:', err.message);
    writeResponse(res, 500, JSON.stringify({ error: { message: 'Internal server error' } }), {
      'Content-Type': 'application/json',
    });
  }
}

// ============================================================
// Response Writer
// ============================================================
function writeResponse(res: ServerResponse, status: number, data: any, headers: Record<string, string>): void {
  res.writeHead(status, headers);
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    res.end(data);
  } else {
    res.end(JSON.stringify(data));
  }
}

// ============================================================
// Server Startup
// ============================================================
async function main() {
  const configPath = join(process.cwd(), 'config.json');

  const loadedConfig = loadConfig(configPath);
  if (!loadedConfig) {
    config = createDefaultConfig();
    saveConfig(config, configPath);
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   🚀 AI Gateway v1.0.0                                     ║');
    console.log('║                                                              ║');
    console.log('║   ⚠ No config.json found — created default config.          ║');
    console.log('║   Add your API keys via the dashboard to get started.       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  } else {
    config = loadedConfig;
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('❌ Invalid configuration:');
    validation.errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  setProviders(config.providers);
  initializeKeyStates(config);
  initializeRateLimiters(config.providers);
  startHealthCheckTimer();

  // Start model warmup with config from config.json
  const warmupConfig = (config as any).warmup || {};
  modelWarmer.updateConfig(warmupConfig);
  await modelWarmer.start(config);

  const hasKeys = config.providers.some(p =>
    (p.apiKey && p.apiKey.length > 0) ||
    (p.apiKeys && p.apiKeys.length > 0)
  );

  const port = config.port || 8787;
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer(handleRequest);

  server.listen(port, host, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   🚀 AI Gateway v1.0.0                                     ║');
    console.log('║                                                              ║');
    console.log(`║   Dashboard:  http://localhost:${port}                        ║`);
    console.log(`║   API:        http://localhost:${port}/v1                     ║`);
    console.log('║                                                              ║');
    if (hasKeys) {
      const totalKeys = config.providers.reduce((sum, p) =>
        sum + (p.apiKey ? 1 : 0) + (p.apiKeys?.length || 0), 0
      );
      const activeProviders = config.providers.filter(p => p.isActive).length;
      console.log(`║   ${activeProviders} providers active, ${totalKeys} keys configured       ║`);
    } else {
      console.log('║   ⚠ No API keys configured!                                ║');
      console.log('║   Open the dashboard to add your API keys.                 ║');
    }
    console.log('║                                                              ║');
    console.log(`║   Test:  curl http://localhost:${port}/api/ping               ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopHealthCheckTimer();
    modelWarmer.stop();
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    stopHealthCheckTimer();
    modelWarmer.stop();
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});