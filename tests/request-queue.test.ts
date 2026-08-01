// ============================================================
// AI Gateway — Request Queue Tests
// ============================================================
// NOTE ON API: src/request-queue.ts exports only the singleton
// `requestQueue` (class RequestQueue is not exported). The queue
// processes items through the REAL `forwardWithRetry`/`selectBestApiKey`
// imports (no injection point), so this file mocks those modules to
// keep the drain flow deterministic and network-free.
// ============================================================

import { requestQueue } from '../src/request-queue';
import type { AppConfig, ChatCompletionRequest, ForwardResult, Provider } from '../src/types';

const queueMocks = vi.hoisted(() => ({
  forwardWithRetry: vi.fn(),
  selectBestApiKey: vi.fn(),
}));

vi.mock('../src/forwarder', () => ({
  forwardWithRetry: queueMocks.forwardWithRetry,
}));

vi.mock('../src/key-pool', () => ({
  selectBestApiKey: queueMocks.selectBestApiKey,
}));

const makeProvider = (id: string): Provider => ({
  id,
  name: `Test ${id}`,
  baseUrl: 'https://example.test/v1',
  apiKeys: ['test-key'],
  isActive: true,
});

const makeBody = (): ChatCompletionRequest => ({
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
});

const makeAppConfig = (): AppConfig => ({ providers: [] });

const makeForwardResult = (): ForwardResult => ({
  status: 200,
  body: { id: 'chatcmpl-test', choices: [] },
  keyIndex: 0,
  retries: 0,
  headers: { 'content-type': 'application/json' },
  streamResponse: null,
});

beforeEach(() => {
  requestQueue.updateConfig({ enabled: true, maxSize: 100, defaultTimeoutMs: 30000 });
  queueMocks.forwardWithRetry.mockReset().mockResolvedValue(makeForwardResult());
  queueMocks.selectBestApiKey.mockReset().mockReturnValue({ key: 'test-key', index: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestQueue config', () => {
  it('getConfig returns the full config with defaults when no partial is supplied', () => {
    requestQueue.updateConfig({});
    expect(requestQueue.getConfig()).toEqual({
      enabled: true,
      maxSize: 100,
      defaultTimeoutMs: 30000,
    });
  });

  it('updateConfig merges a partial config over the defaults', () => {
    requestQueue.updateConfig({ enabled: false, maxSize: 5 });
    expect(requestQueue.getConfig()).toEqual({
      enabled: false,
      maxSize: 5,
      defaultTimeoutMs: 30000,
    });
  });

  it('updateConfig can override every field', () => {
    requestQueue.updateConfig({ enabled: true, maxSize: 7, defaultTimeoutMs: 1234 });
    expect(requestQueue.getConfig()).toEqual({
      enabled: true,
      maxSize: 7,
      defaultTimeoutMs: 1234,
    });
  });
});

describe('RequestQueue enqueue', () => {
  it('returns null when the queue is disabled', () => {
    requestQueue.updateConfig({ enabled: false });
    const result = requestQueue.enqueue(makeProvider('disabled-provider'), makeBody(), makeAppConfig());
    expect(result).toBeNull();
    expect(requestQueue.size('disabled-provider')).toBe(0);
    expect(requestQueue.hasQueued('disabled-provider')).toBe(false);
  });

  it('returns null when the provider queue is full', () => {
    requestQueue.updateConfig({ maxSize: 1 });
    const first = requestQueue.enqueue(makeProvider('full-provider'), makeBody(), makeAppConfig());
    expect(first).not.toBeNull();
    first!.catch(() => {}); // never drained here — silence any later rejection

    const second = requestQueue.enqueue(makeProvider('full-provider'), makeBody(), makeAppConfig());
    expect(second).toBeNull();
    expect(requestQueue.size('full-provider')).toBe(1);

    // clean up the pending entry and its timeout timer
    requestQueue.dequeue('full-provider');
  });

  it('tracks the queue size and pending flag', () => {
    const provider = makeProvider('size-provider');
    const queued = requestQueue.enqueue(provider, makeBody(), makeAppConfig());
    expect(queued).not.toBeNull();
    queued!.catch(() => {});

    expect(requestQueue.size('size-provider')).toBe(1);
    expect(requestQueue.hasQueued('size-provider')).toBe(true);

    requestQueue.dequeue('size-provider');
    expect(requestQueue.size('size-provider')).toBe(0);
    expect(requestQueue.hasQueued('size-provider')).toBe(false);
  });
});

describe('RequestQueue dequeue', () => {
  it('dequeue returns the next request and empties the queue', () => {
    const provider = makeProvider('dequeue-provider');
    const queued = requestQueue.enqueue(provider, makeBody(), makeAppConfig());
    expect(queued).not.toBeNull();
    queued!.catch(() => {});

    const request = requestQueue.dequeue('dequeue-provider');
    expect(request).not.toBeNull();
    expect(request!.provider.id).toBe('dequeue-provider');
    expect(request!.body.model).toBe('test-model');
    expect(requestQueue.size('dequeue-provider')).toBe(0);
  });

  it('dequeue returns null for an unknown or empty provider queue', () => {
    expect(requestQueue.dequeue('never-enqueued-provider')).toBeNull();
  });
});

describe('RequestQueue drain flow', () => {
  it('drains a queued request and resolves with the forward result', async () => {
    const provider = makeProvider('drain-provider');
    const body = makeBody();
    const appConfig = makeAppConfig();
    const expected = makeForwardResult();

    const queued = requestQueue.enqueue(provider, body, appConfig);
    expect(queued).not.toBeNull();
    expect(requestQueue.size('drain-provider')).toBe(1);

    await requestQueue.drain('drain-provider');

    await expect(queued!).resolves.toEqual(expected);
    expect(queueMocks.forwardWithRetry).toHaveBeenCalledWith(provider, body, appConfig);
    expect(requestQueue.size('drain-provider')).toBe(0);
  });

  it('drains a batch of queued requests in order', async () => {
    const provider = makeProvider('batch-provider');
    const results = [makeForwardResult(), { ...makeForwardResult(), status: 201 }, makeForwardResult()];
    queueMocks.forwardWithRetry.mockReset();
    queueMocks.forwardWithRetry
      .mockResolvedValueOnce(results[0])
      .mockResolvedValueOnce(results[1])
      .mockResolvedValueOnce(results[2]);

    const promises = [
      requestQueue.enqueue(provider, makeBody(), makeAppConfig()),
      requestQueue.enqueue(provider, makeBody(), makeAppConfig()),
      requestQueue.enqueue(provider, makeBody(), makeAppConfig()),
    ];
    expect(promises.every((p) => p !== null)).toBe(true);
    expect(requestQueue.size('batch-provider')).toBe(3);

    await requestQueue.drain('batch-provider');

    await expect(promises[0]!).resolves.toEqual(results[0]);
    await expect(promises[1]!).resolves.toEqual(results[1]);
    await expect(promises[2]!).resolves.toEqual(results[2]);
    expect(requestQueue.size('batch-provider')).toBe(0);
    expect(queueMocks.forwardWithRetry).toHaveBeenCalledTimes(3);
  });

  it('rejects the queued promise when forwarding throws', async () => {
    queueMocks.forwardWithRetry.mockReset().mockRejectedValue(new Error('upstream exploded'));
    const provider = makeProvider('fail-provider');

    const queued = requestQueue.enqueue(provider, makeBody(), makeAppConfig());
    expect(queued).not.toBeNull();

    await requestQueue.drain('fail-provider');

    await expect(queued!).rejects.toThrow('upstream exploded');
    expect(requestQueue.size('fail-provider')).toBe(0);
  });

  it('drain is a no-op for a provider with no queued requests', async () => {
    await expect(requestQueue.drain('empty-provider')).resolves.toBeUndefined();
    expect(queueMocks.forwardWithRetry).not.toHaveBeenCalled();
  });
});

describe('RequestQueue timeout', () => {
  it('rejects a queued request that is never drained after defaultTimeoutMs', async () => {
    vi.useFakeTimers();
    requestQueue.updateConfig({ defaultTimeoutMs: 1000 });
    const before = requestQueue.getOverallStats().totalTimedOut;

    const provider = makeProvider('timeout-provider');
    const queued = requestQueue.enqueue(provider, makeBody(), makeAppConfig());
    expect(queued).not.toBeNull();

    // Attach the rejection handler BEFORE the timer fires so the rejection
    // is considered handled the moment it is produced.
    const rejection = expect(queued!).rejects.toThrow(/timed out after 1000ms/);
    await vi.advanceTimersByTimeAsync(1001);
    await rejection;

    expect(requestQueue.size('timeout-provider')).toBe(0);
    expect(requestQueue.getOverallStats().totalTimedOut).toBe(before + 1);
  });
});

describe('RequestQueue stats', () => {
  it('tracks enqueue/dequeue/drain counters', async () => {
    const before = requestQueue.getOverallStats();
    const provider = makeProvider('stats-provider');

    const queued = requestQueue.enqueue(provider, makeBody(), makeAppConfig());
    expect(queued).not.toBeNull();
    await requestQueue.drain('stats-provider');
    await queued;

    const after = requestQueue.getOverallStats();
    expect(after.totalQueued).toBe(before.totalQueued + 1);
    expect(after.totalDequeued).toBe(before.totalDequeued + 1);
    expect(after.totalDrained).toBe(before.totalDrained + 1);
    expect(after.averageWaitMs).toBeGreaterThanOrEqual(0);
  });
});
