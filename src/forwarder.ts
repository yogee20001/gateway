// ============================================================
// AI Gateway — Request Forwarding & Retry
// ============================================================

import type { Provider, ChatCompletionRequest, AppConfig } from './types';
import { getKeyHash, selectBestApiKey, markKeyRateLimited, markKeyError, markKeySuccess } from './key-pool';
import { calculateBackoff, isRetryableStatus, isRateLimitStatus, isServerErrorStatus } from './retry';
import { providerRateLimiter, parseRateLimitHeaders, type ParsedRateLimitInfo } from './rate-limiter';

// Note: Node's built-in fetch (undici) already pools connections with
// keep-alive via its global dispatcher — no custom agent needed.

// ============================================================
// Upstream URL Builder
// ============================================================
export function buildUpstreamUrl(provider: Provider, path: string = '/chat/completions'): string {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const route = path.startsWith('/') ? path : '/' + path;
  return `${base}${route}`;
}

// ============================================================
// Upstream Headers Builder
// ============================================================
export function buildUpstreamHeaders(provider: Provider, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider.id === 'openai' || provider.id === 'deepseek' || provider.id === 'perplexity' || provider.id === 'nvidia') {
    headers['Authorization'] = `Bearer ${key}`;
  }
  else if (provider.id === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  }
  else if (provider.id === 'google') {
    headers['x-goog-api-key'] = key;
  }
  else {
    headers['Authorization'] = `Bearer ${key}`;
  }

  return headers;
}

// ============================================================
// Forward Non-Streaming Request
// ============================================================
export async function forwardNonStreaming(
  provider: Provider,
  body: ChatCompletionRequest,
  rawBody?: string
): Promise<{ status: number; body: any; keyIndex: number; headers: Record<string, string> }> {
  const keyResult = selectBestApiKey(provider);
  if (!keyResult) {
    return {
      status: 503,
      body: { error: { message: `No healthy API keys available for ${provider.name}`, code: 'no_healthy_keys' } },
      keyIndex: -1,
      headers: { 'Content-Type': 'application/json' },
    };
  }

  // Wait for per-key rate limiter
  const keyHash = getKeyHash(keyResult.key);
  await providerRateLimiter.waitForSlot(provider.id, keyHash);

try {
  const url = buildUpstreamUrl(provider);
  const headers = buildUpstreamHeaders(provider, keyResult.key);

  try {
    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody ?? JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const status = upstreamResponse.status;
    let responseBody: any;

    // Parse rate limit info from headers
    const rateLimitInfo = parseRateLimitHeaders(upstreamResponse.headers);
    
    // Update provider rate limiter with actual upstream limits (per key)
    if (rateLimitInfo.limit || rateLimitInfo.remaining !== undefined || rateLimitInfo.resetMs || rateLimitInfo.retryAfterMs) {
      providerRateLimiter.updateFromHeaders(provider.id, keyHash, upstreamResponse.headers);
    }

    try {
      responseBody = await upstreamResponse.text();
      try {
        responseBody = JSON.parse(responseBody);
      } catch {
        // Keep as text
      }
    } catch {
      responseBody = { error: { message: 'Failed to read upstream response' } };
    }

 if (status >= 200 && status < 300) {
        // Check for provider-specific errors embedded in 200 responses (e.g. NVIDIA ResourceExhausted)
        const isResourceExhausted = responseBody?.error?.code === 'ResourceExhausted'
          || (typeof responseBody?.error?.message === 'string' && responseBody.error.message.includes('ResourceExhausted'))
          || (typeof responseBody?.error?.message === 'string' && responseBody.error.message.includes('Worker local total request limit reached'));
        if (isResourceExhausted) {
          console.log('[forwarder] Provider returned ResourceExhausted in 200 response for ' + provider.id + ' key ' + keyResult.index + ' — treating as 429');
          return {
            status: 429,
            body: responseBody,
            keyIndex: keyResult.index,
            headers: Object.fromEntries(upstreamResponse.headers.entries()),
          };
        }
        markKeySuccess(provider.id, keyResult.index);
      }

    return {
      status,
      body: responseBody,
      keyIndex: keyResult.index,
      headers: Object.fromEntries(upstreamResponse.headers.entries()),
    };
  } catch (err: any) {
    const errorMessage = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'Upstream request timed out'
      : `Upstream request failed: ${err.message}`;

    markKeyError(provider.id, keyResult.index, errorMessage);

    return {
      status: 504,
      body: { error: { message: errorMessage, code: 'upstream_timeout' } },
      keyIndex: keyResult.index,
      headers: { 'Content-Type': 'application/json' },
    };
  }
} finally {
  providerRateLimiter.release(provider.id, keyHash);
}
}

// ============================================================
// Forward Streaming Request — returns raw Response for SSE piping
// ============================================================
export async function forwardStreaming(
  provider: Provider,
  body: ChatCompletionRequest,
  rawBody?: string
): Promise<{ response: Response | null; status: number; body: any; keyIndex: number; headers: Record<string, string> }> {
  const keyResult = selectBestApiKey(provider);
  if (!keyResult) {
    return {
      response: null,
      status: 503,
      body: { error: { message: `No healthy API keys available for ${provider.name}`, code: 'no_healthy_keys' } },
      keyIndex: -1,
      headers: { 'Content-Type': 'application/json' },
    };
  }

  // Wait for per-key rate limiter
  const keyHash = getKeyHash(keyResult.key);
  await providerRateLimiter.waitForSlot(provider.id, keyHash);

  try {
  const url = buildUpstreamUrl(provider);
  const headers = buildUpstreamHeaders(provider, keyResult.key);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    // Timeout after 120s for initial response, but allow streaming to continue
    timeoutId = setTimeout(() => controller.abort(), 120000);

    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody && /"stream"\s*:\s*true/.test(rawBody) ? rawBody : JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const status = upstreamResponse.status;

    // Parse rate limit headers from upstream
    if (status >= 200 && status < 300) {
      markKeySuccess(provider.id, keyResult.index);
      return {
        response: upstreamResponse,
        status,
        body: null,
        keyIndex: keyResult.index,
        headers: Object.fromEntries(upstreamResponse.headers.entries()),
      };
    }

    // Error response — read body
    let responseBody: any;
    try {
      responseBody = await upstreamResponse.text();
      try { responseBody = JSON.parse(responseBody); } catch {}
    } catch {
      responseBody = { error: { message: 'Upstream error' } };
    }

    // Update rate limiter from error response headers
    providerRateLimiter.updateFromHeaders(provider.id, keyHash, upstreamResponse.headers);
    
    markKeyError(provider.id, keyResult.index, typeof responseBody === 'object' ? responseBody?.error?.message || `HTTP ${status}` : `HTTP ${status}`);

    return {
      response: null,
      status,
      body: responseBody,
      keyIndex: keyResult.index,
      headers: Object.fromEntries(upstreamResponse.headers.entries()),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const errorMessage = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'Upstream request timed out'
      : `Upstream request failed: ${err.message}`;

    // Don't permanently mark as error for timeouts — just return the error
    // The key can be retried immediately for a different model
    return {
      response: null,
      status: 504,
      body: { error: { message: errorMessage, code: 'upstream_timeout' } },
      keyIndex: keyResult.index,
      headers: { 'Content-Type': 'application/json' },
    };
  }
} finally {
  providerRateLimiter.release(provider.id, keyHash);
}
}

// ============================================================
// Forward with Retry Logic
// ============================================================
export async function forwardWithRetry(
  provider: Provider,
  body: ChatCompletionRequest,
  config: AppConfig,
  rawBody?: string
): Promise<{
  status: number;
  body: any;
  keyIndex: number;
  retries: number;
  headers: Record<string, string>;
  streamResponse: Response | null;
}> {
  const isStreaming = body.stream === true;
  const maxRetries = provider.maxRetries ?? config.defaultMaxRetries ?? 1;
  const cooldownMs = provider.cooldownMs ?? config.defaultCooldownMs ?? 60000;

  if (isStreaming) {
    const result = await forwardStreaming(provider, body, rawBody);
    if (result.response) {
      return {
        status: result.status,
        body: null,
        keyIndex: result.keyIndex,
        retries: 0,
        headers: result.headers,
        streamResponse: result.response,
      };
    }
    // Streaming error — retry once if it was a timeout/server error
    if (isRetryableStatus(result.status)) {
      const delay = calculateBackoff(0, 1000, 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
      const retryResult = await forwardStreaming(provider, body, rawBody);
      if (retryResult.response) {
        return {
          status: retryResult.status,
          body: null,
          keyIndex: retryResult.keyIndex,
          retries: 1,
          headers: retryResult.headers,
          streamResponse: retryResult.response,
        };
      }
      return {
        status: retryResult.status,
        body: retryResult.body,
        keyIndex: retryResult.keyIndex,
        retries: 1,
        headers: retryResult.headers,
        streamResponse: null,
      };
    }
    return {
      status: result.status,
      body: result.body,
      keyIndex: result.keyIndex,
      retries: 0,
      headers: result.headers,
      streamResponse: null,
    };
  }

  // Non-streaming with retry
  let lastResult: { status: number; body: any; keyIndex: number; headers: Record<string, string> } | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await forwardNonStreaming(provider, body, rawBody);
    lastResult = result;

    if (result.status >= 200 && result.status < 300) {
      return { ...result, retries, streamResponse: null };
    }

    if (isRetryableStatus(result.status)) {
      let delay = 0;
      
      if (isRateLimitStatus(result.status) && result.keyIndex >= 0) {
        markKeyRateLimited(provider.id, result.keyIndex, cooldownMs);
        
        // Check for Retry-After header in the response
        const retryAfter = result.headers?.['retry-after'];
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds) && seconds > 0) {
            delay = seconds * 1000;
          }
        }
        
        // If no Retry-After, use exponential backoff with jitter
        if (delay === 0) {
          delay = calculateBackoff(attempt, 2000, 30000);
        }
      } else if (isServerErrorStatus(result.status) && result.keyIndex >= 0) {
        delay = calculateBackoff(attempt, 1000, 10000);
      }

      retries = attempt + 1;

      if (attempt < maxRetries) {
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } else {
      return { ...result, retries, streamResponse: null };
    }
  }

  return {
    ...lastResult!,
    status: lastResult?.status || 529,
    body: lastResult?.body || { error: { message: 'All retries exhausted', code: 'retries_exhausted' } },
    retries,
    streamResponse: null,
  };
}