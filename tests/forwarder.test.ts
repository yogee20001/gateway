// ============================================================
// AI Gateway — Forwarder Empty-Stream Fail-Fast Tests
// ============================================================
// NOTE ON API: src/forwarder.ts has no injection point for fetch,
// so these tests stub the global fetch (vi.stubGlobal) and mock the
// key-pool / rate-limiter modules to keep the flow network-free and
// deterministic. Retry logic (./retry) is REAL: 504 is retryable, so
// forwardWithRetry performs one automatic retry with real backoff.
// ============================================================

import { forwardWithRetry } from '../src/forwarder';
import type { AppConfig, ChatCompletionRequest, Provider } from '../src/types';

const forwarderMocks = vi.hoisted(() => ({
  selectBestApiKey: vi.fn(),
  getKeyHash: vi.fn(),
  markKeyRateLimited: vi.fn(),
  markKeyError: vi.fn(),
  markKeySuccess: vi.fn(),
}));

vi.mock('../src/key-pool', () => ({
  selectBestApiKey: forwarderMocks.selectBestApiKey,
  getKeyHash: forwarderMocks.getKeyHash,
  markKeyRateLimited: forwarderMocks.markKeyRateLimited,
  markKeyError: forwarderMocks.markKeyError,
  markKeySuccess: forwarderMocks.markKeySuccess,
}));

vi.mock('../src/rate-limiter', () => ({
  providerRateLimiter: {
    waitForSlot: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    updateFromHeaders: vi.fn(),
  },
  parseRateLimitHeaders: vi.fn().mockReturnValue({}),
}));

const makeProvider = (): Provider => ({
  id: 'nvidia',
  name: 'NVIDIA',
  baseUrl: 'https://example.test/v1',
  apiKeys: ['key-1'],
  keyStrategy: 'round-robin',
  isActive: true,
  modelPatterns: ['*'],
});

const makeBody = (): ChatCompletionRequest => ({
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
});

const makeConfig = (streamFirstTokenTimeoutMs: number): AppConfig => ({
  defaultMaxRetries: 1,
  defaultCooldownMs: 1000,
  streamFirstTokenTimeoutMs,
  providers: [],
});

const emptyStreamResponse = (): Response =>
  new Response(new ReadableStream({ start(c) { c.close(); } }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

const healthyStreamResponse = (): Response =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: ok\n\n'));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );

const neverEndingStreamResponse = (): Response =>
  new Response(new ReadableStream({ start() {} }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

beforeEach(() => {
  forwarderMocks.selectBestApiKey.mockReset().mockReturnValue({ key: 'key-1', index: 0 });
  forwarderMocks.getKeyHash.mockReset().mockReturnValue('hash-key-1');
  forwarderMocks.markKeyRateLimited.mockReset();
  forwarderMocks.markKeyError.mockReset();
  forwarderMocks.markKeySuccess.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('forwardWithRetry streaming empty-stream fail-fast', () => {
  it('returns 504 upstream_empty_stream when upstream body ends immediately', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(emptyStreamResponse()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await forwardWithRetry(makeProvider(), makeBody(), makeConfig(500));

    expect(result.status).toBe(504);
    expect(result.streamResponse).toBeNull();
    expect(result.retries).toBe(1); // retry fired because 504 is retryable
    expect(result.body.error.code).toBe('upstream_empty_stream');
  });

  it('retries once then succeeds when second upstream stream is healthy', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(emptyStreamResponse()))
      .mockImplementation(() => Promise.resolve(healthyStreamResponse()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await forwardWithRetry(makeProvider(), makeBody(), makeConfig(500));

    expect(result.streamResponse).not.toBeNull();
    expect(result.retries).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Read the re-wrapped stream fully and verify the payload survived the peek
    const reader = result.streamResponse!.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const text = chunks.map(c => new TextDecoder().decode(c)).join('');
    expect(text).toContain('data: ok');
  });

  it('returns 504 upstream_stream_timeout when no data arrives within firstTokenTimeoutMs', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(neverEndingStreamResponse()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await forwardWithRetry(makeProvider(), makeBody(), makeConfig(100));

    expect(result.status).toBe(504);
    expect(result.streamResponse).toBeNull();
    expect(result.body.error.code).toBe('upstream_stream_timeout');
  });
});
