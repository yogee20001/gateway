// ============================================================
// AI Gateway — Provider Rate Limiter Regression Tests
// ============================================================
// NOTE ON API: src/rate-limiter.ts keeps MODULE-LEVEL state in the
// `providerRateLimiter` singleton (no full clear). Each test therefore
// uses a UNIQUE provider id and calls configure() + reset() to get
// fresh counters, then releases every acquired slot in `finally`.
//
// Timing: REAL timers only (no vi.useFakeTimers). Queue drains are
// driven by short real windows (60ms) so the suite stays fast and
// deterministic. The public status APIs do not expose `inFlight`, so
// queueing behavior (a later acquire staying pending) is used as the
// observable proxy for in-flight accounting.
//
// These tests regress the provider-queue closure fix: requests admitted
// from providerQueue must run the FULL accounting (keyState.tokens--,
// keyState.inFlight++, providerState.inFlight++); pushing a raw resolve
// callback (the old bug) leaves tokens and inFlight under-counted.
// ============================================================

import { describe, it, expect } from 'vitest';
import { providerRateLimiter } from '../src/rate-limiter';
import type { RateLimitConfig } from '../src/rate-limiter';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for ${label}`)), ms);
    }),
  ]);
}

/** Configure a provider from scratch — unique id per test + reset for fresh counters. */
function freshLimiter(providerId: string, cfg: RateLimitConfig): void {
  providerRateLimiter.configure(providerId, cfg);
  providerRateLimiter.reset(providerId);
}

describe('provider-queue closure accounting', () => {
  it(
    'fully accounts requests admitted from the provider queue (tokens + inFlight)',
    async () => {
      const pid = 'closure-accounting';
      // Single provider token refilled every 60ms. maxConcurrent: 1 makes
      // in-flight accounting observable: an admitted request must block a
      // second one on the per-key queue.
      freshLimiter(pid, {
        requestsPerWindow: 100,
        windowMs: 60_000,
        maxConcurrent: 1,
        providerRequestsPerWindow: 1,
        providerWindowMs: 60,
      });

      try {
        // First request consumes the only provider token immediately.
        await providerRateLimiter.waitForSlot(pid, 'k1');
        expect(providerRateLimiter.getKeyStatus(pid, 'k1')?.tokens).toBe(99);
        expect(providerRateLimiter.getStatus(pid)?.providerTokens).toBe(0);

        // Two more requests must queue on the provider queue (token exhausted).
        let p2Resolved = false;
        let p3Resolved = false;
        const p2 = providerRateLimiter.waitForSlot(pid, 'k1').then(() => { p2Resolved = true; });
        const p3 = providerRateLimiter.waitForSlot(pid, 'k1').then(() => { p3Resolved = true; });
        await sleep(20);
        expect(p2Resolved).toBe(false);
        expect(p3Resolved).toBe(false);
        // While queued, only the direct request is accounted on the key.
        expect(providerRateLimiter.getKeyStatus(pid, 'k1')?.tokens).toBe(99);

        // Wait past the first provider window refill (60ms). The closure for
        // the first queued request runs: with correct accounting it sees
        // inFlight === maxConcurrent (1) and re-queues the request on the key
        // queue instead of admitting it. If the closure skipped inFlight++ it
        // would resolve immediately — caught by the pending assertions below.
        await sleep(100);
        expect(p2Resolved).toBe(false);
        expect(p3Resolved).toBe(false);

        // Free the direct slot: the key queue drains FIFO, one at a time.
        providerRateLimiter.release(pid, 'k1');
        await withTimeout(p2, 2000, 'p2 (provider-queued request)');
        expect(p2Resolved).toBe(true);
        expect(providerRateLimiter.getKeyStatus(pid, 'k1')?.tokens).toBe(98);

        providerRateLimiter.release(pid, 'k1');
        await withTimeout(p3, 2000, 'p3 (provider-queued request)');
        expect(p3Resolved).toBe(true);
        expect(providerRateLimiter.getKeyStatus(pid, 'k1')?.tokens).toBe(97);

        providerRateLimiter.release(pid, 'k1');

        // All three admitted requests are fully accounted: 100 - 3 key tokens,
        // the single provider token consumed, no extra keys created.
        const status = providerRateLimiter.getStatus(pid);
        expect(status?.tokens).toBe(97);
        expect(status?.keyCount).toBe(1);
        expect(status?.providerTokens).toBe(0);
        expect(status?.providerLimit).toBe(1);
        expect(providerRateLimiter.getKeyStatus(pid, 'k1')?.tokens).toBe(97);
      } finally {
        for (let i = 0; i < 3; i++) providerRateLimiter.release(pid, 'k1');
      }
    },
    10_000
  );
});

describe('per-key inFlight tracks the global key', () => {
  it(
    'serializes __global__ acquisitions on maxConcurrent and resets to zero after release',
    async () => {
      const pid = 'global-key-inflight';
      freshLimiter(pid, {
        requestsPerWindow: 10,
        windowMs: 60_000,
        maxConcurrent: 1,
        providerRequestsPerWindow: 10,
        providerWindowMs: 60_000,
      });

      try {
        // First acquisition is admitted; inFlight becomes 1 (== maxConcurrent).
        await providerRateLimiter.waitForSlot(pid, '__global__');
        expect(providerRateLimiter.getKeyStatus(pid, '__global__')?.tokens).toBe(9);

        // Second acquisition must queue: while the first slot is held the
        // per-key inFlight is 1, never 0 — a pending second acquisition is the
        // observable proof.
        let g2Resolved = false;
        const g2 = providerRateLimiter.waitForSlot(pid, '__global__').then(() => { g2Resolved = true; });
        await sleep(20);
        expect(g2Resolved).toBe(false);
        expect(providerRateLimiter.getKeyStatus(pid, '__global__')?.tokens).toBe(9);

        // Release the first: the queued second acquisition is admitted.
        providerRateLimiter.release(pid, '__global__');
        await withTimeout(g2, 2000, 'queued __global__ slot');
        expect(g2Resolved).toBe(true);
        expect(providerRateLimiter.getKeyStatus(pid, '__global__')?.tokens).toBe(8);

        // Release the second: inFlight returns to 0, so a third acquisition is
        // admitted immediately instead of queueing.
        providerRateLimiter.release(pid, '__global__');
        let g3Resolved = false;
        const g3 = providerRateLimiter.waitForSlot(pid, '__global__').then(() => { g3Resolved = true; });
        await sleep(20);
        expect(g3Resolved).toBe(true);
        await g3;
        expect(providerRateLimiter.getKeyStatus(pid, '__global__')?.tokens).toBe(7);

        providerRateLimiter.release(pid, '__global__');

        // 3 acquisitions consumed exactly 3 provider tokens; one key exists.
        const status = providerRateLimiter.getStatus(pid);
        expect(status?.providerTokens).toBe(7);
        expect(status?.keyCount).toBe(1);
      } finally {
        for (let i = 0; i < 3; i++) providerRateLimiter.release(pid, '__global__');
      }
    },
    10_000
  );
});

describe('provider bucket accounting across key-queued requests', () => {
  it(
    'consumes exactly one provider token per admitted acquire — not double, not for key-queued requests',
    async () => {
      const pid = 'provider-token-accounting';
      // Short key window (60ms) drives the per-key queue drain so B and C
      // resolve deterministically. Provider window stays long so the provider
      // bucket is only drained by acquires, never refilled mid-test.
      freshLimiter(pid, {
        requestsPerWindow: 1,
        windowMs: 60,
        maxConcurrent: 1,
        providerRequestsPerWindow: 3,
        providerWindowMs: 60_000,
      });

      try {
        // A: consumes the single key token AND one provider token.
        await providerRateLimiter.waitForSlot(pid, 'k1');
        // Exactly one provider token consumed — a double-drain (e.g. at
        // acquire AND at admission) would leave providerTokens at 1 here.
        expect(providerRateLimiter.getStatus(pid)?.providerTokens).toBe(2);

        // B and C: key tokens exhausted + maxConcurrent 1, so they queue
        // per-key. They must NOT drain the shared provider bucket while queued
        // (the bucket is only consumed when a request actually passes the
        // concurrency gates) — a regression draining it here would drop
        // providerTokens from 2 toward 0.
        let bResolved = false;
        let cResolved = false;
        const b = providerRateLimiter.waitForSlot(pid, 'k1').then(() => { bResolved = true; });
        const c = providerRateLimiter.waitForSlot(pid, 'k1').then(() => { cResolved = true; });
        await sleep(20);
        expect(bResolved).toBe(false);
        expect(cResolved).toBe(false);
        expect(providerRateLimiter.getStatus(pid)?.providerTokens).toBe(2);
        expect(providerRateLimiter.getStatus(pid)?.providerLimit).toBe(3);

        // A done; key window refill (60ms) admits B, then C.
        providerRateLimiter.release(pid, 'k1');
        await withTimeout(b, 2000, 'B after key window refill');
        expect(bResolved).toBe(true);
        providerRateLimiter.release(pid, 'k1'); // B done

        await withTimeout(c, 2000, 'C after B released');
        expect(cResolved).toBe(true);
        providerRateLimiter.release(pid, 'k1'); // C done

// Provider bucket state stays consistent: A, B, and C each consumed
  // exactly one provider token on admission (3 total), so bucket is empty.
  const status = providerRateLimiter.getStatus(pid);
  expect(status?.providerTokens).toBe(0);
  expect(status?.providerLimit).toBe(3);
        expect(status?.providerTokens!).toBeGreaterThanOrEqual(0);
        expect(status?.keyCount).toBe(1);
      } finally {
        for (let i = 0; i < 3; i++) providerRateLimiter.release(pid, 'k1');
      }
    },
    10_000
  );
});

describe('counter integrity under bursts', () => {
  it(
    'never leaves negative counters after 20 concurrent acquire/release pairs',
    async () => {
      const pid = 'burst-integrity';
      freshLimiter(pid, {
        requestsPerWindow: 100,
        windowMs: 60_000,
        maxConcurrent: 3,
        providerRequestsPerWindow: 50,
        providerWindowMs: 60_000,
      });

      const workers: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        workers.push(
          (async () => {
            await providerRateLimiter.waitForSlot(pid, 'k1');
            await sleep(5);
            providerRateLimiter.release(pid, 'k1');
          })()
        );
      }
      await withTimeout(Promise.all(workers), 5000, 'burst of 20 acquire/release pairs');

      // Extra releases must be safe (guarded) and must not drive counters negative.
      providerRateLimiter.release(pid, 'k1');
      providerRateLimiter.release(pid, 'k1');

      const status = providerRateLimiter.getStatus(pid);
      const keyStatus = providerRateLimiter.getKeyStatus(pid, 'k1');
      expect(status?.tokens).toBe(80); // 100 - 20
      expect(status?.providerTokens).toBe(30); // 50 - 20
      expect(status?.keyCount).toBe(1);
      // No counter may go negative.
      expect(status?.tokens).toBeGreaterThanOrEqual(0);
      expect(status?.providerTokens!).toBeGreaterThanOrEqual(0);
      expect(status?.keyCount).toBeGreaterThanOrEqual(0);
      expect(status?.limit).toBeGreaterThanOrEqual(0);
      expect(keyStatus?.tokens).toBe(80);
      expect(keyStatus?.tokens).toBeGreaterThanOrEqual(0);
      expect(keyStatus?.limit).toBe(100);
      expect(keyStatus?.windowMs).toBe(60_000);
    },
    10_000
  );
});
