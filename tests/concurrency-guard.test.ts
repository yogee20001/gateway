// ============================================================
// AI Gateway — Global Concurrency Guard Tests
// ============================================================
// NOTE ON API: src/concurrency-guard.ts keeps MODULE-LEVEL state
// (no reset function) and exports:
//   acquireGlobalSlot(): Promise<void>
//   releaseGlobalSlot(): void
//   getGlobalInFlight(): number
//   getGlobalQueued(): number
//   getGlobalStats(): { inFlight, queued, maxConcurrent, maxQueued }
// Limits: MAX_GLOBAL_CONCURRENT = 50, MAX_GLOBAL_QUEUED = 100.
// Waiting acquisitions poll every 5ms and reject after 30s. The 30s
// timeout timer IS cleared when a waiter resolves (clearTimeout on
// acquire), so stale timers must not fire — but keep fake-timer
// advances below 30000ms while waiters exist to stay safe.
// ============================================================

import {
  acquireGlobalSlot,
  releaseGlobalSlot,
  getGlobalInFlight,
  getGlobalQueued,
  getGlobalStats,
} from '../src/concurrency-guard';

/**
 * Restore module-level counters to zero: release in-flight slots, then
 * let queued acquisitions resolve via the 5ms polling interval, batching
 * the releases so arbitrarily many queued waiters can be flushed.
 */
async function flushGlobalState(): Promise<void> {
  let batches = 0;
  while ((getGlobalInFlight() > 0 || getGlobalQueued() > 0) && batches++ < 10) {
    let guard = 0;
    while (getGlobalInFlight() > 0 && guard++ < 10000) {
      releaseGlobalSlot();
    }
    await vi.advanceTimersByTimeAsync(50);
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  await flushGlobalState();
  expect(getGlobalInFlight()).toBe(0);
  expect(getGlobalQueued()).toBe(0);
});

afterEach(async () => {
  await flushGlobalState();
  expect(getGlobalInFlight()).toBe(0);
  expect(getGlobalQueued()).toBe(0);
  vi.useRealTimers();
});

describe('acquireGlobalSlot', () => {
  it('resolves immediately when under the concurrency limit', async () => {
    await expect(acquireGlobalSlot()).resolves.toBeUndefined();
    expect(getGlobalInFlight()).toBe(1);
    expect(getGlobalQueued()).toBe(0);

    releaseGlobalSlot();
    expect(getGlobalInFlight()).toBe(0);
  });

  it('waits while at the limit and resolves after a slot is released', async () => {
    const { maxConcurrent } = getGlobalStats();
    for (let i = 0; i < maxConcurrent; i++) {
      await acquireGlobalSlot();
    }
    expect(getGlobalInFlight()).toBe(maxConcurrent);

    let resolved = false;
    const waiting = acquireGlobalSlot().then(() => {
      resolved = true;
    });
    expect(getGlobalQueued()).toBe(1);

    // Advance well past several 5ms poll intervals — must still be pending
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);
    expect(getGlobalInFlight()).toBe(maxConcurrent);

    releaseGlobalSlot();
    await vi.advanceTimersByTimeAsync(10);
    await waiting;

    expect(resolved).toBe(true);
    expect(getGlobalInFlight()).toBe(maxConcurrent);
    expect(getGlobalQueued()).toBe(0);
  });

  it('queues multiple waiters and resolves them as slots free up', async () => {
    const { maxConcurrent } = getGlobalStats();
    for (let i = 0; i < maxConcurrent; i++) {
      await acquireGlobalSlot();
    }

    const waiters = [acquireGlobalSlot(), acquireGlobalSlot(), acquireGlobalSlot()];
    waiters.forEach((p) => p.catch(() => {}));
    expect(getGlobalQueued()).toBe(3);

    // Free two slots → exactly two waiters should resolve
    releaseGlobalSlot();
    releaseGlobalSlot();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([waiters[0], waiters[1]]);

    expect(getGlobalQueued()).toBe(1);
    expect(getGlobalInFlight()).toBe(maxConcurrent);
  });

  it('throws when the global queue is full', async () => {
    const { maxConcurrent, maxQueued } = getGlobalStats();
    for (let i = 0; i < maxConcurrent; i++) {
      await acquireGlobalSlot();
    }

    const waiters: Array<Promise<void>> = [];
    for (let i = 0; i < maxQueued; i++) {
      const waiter = acquireGlobalSlot();
      waiters.push(waiter);
      waiter.catch(() => {}); // never drained here — silence later rejections
    }
    expect(getGlobalQueued()).toBe(maxQueued);

    expect(() => acquireGlobalSlot()).toThrow(/Global concurrency limit reached/);

    // The failed acquire must roll back its queued increment
    expect(getGlobalQueued()).toBe(maxQueued);
    expect(waiters).toHaveLength(maxQueued);
  });
});

describe('releaseGlobalSlot', () => {
  it('never drops the in-flight counter below zero', () => {
    releaseGlobalSlot();
    releaseGlobalSlot();
    expect(getGlobalInFlight()).toBe(0);
  });
});

describe('getGlobalStats', () => {
  it('exposes the limits and current counters', () => {
    const stats = getGlobalStats();
    expect(stats.maxConcurrent).toBeGreaterThan(0);
    expect(stats.maxQueued).toBeGreaterThanOrEqual(stats.maxConcurrent);
    expect(stats.inFlight).toBe(0);
    expect(stats.queued).toBe(0);
  });

  it('reflects in-flight and queued values while slots are held', async () => {
    const { maxConcurrent } = getGlobalStats();
    for (let i = 0; i < maxConcurrent; i++) {
      await acquireGlobalSlot();
    }
    const waiting = acquireGlobalSlot();
    waiting.catch(() => {});

    const stats = getGlobalStats();
    expect(stats.inFlight).toBe(maxConcurrent);
    expect(stats.queued).toBe(1);
    expect(stats.maxConcurrent).toBe(maxConcurrent);
  });
});
