// ============================================================
// AI Gateway — Global Concurrency Guard
// Prevents thundering herd and enforces a global concurrency
// limit to avoid exceeding NVIDIA's per-worker limits.
//
// Waiter acquisition uses a FIFO release-triggered queue: waiters
// are parked as promises and woken directly by releaseGlobalSlot()
// — no polling/setInterval, so no event-loop pressure. Each waiter
// has its own timeout timer (cleared on resolution) and the global
// limits are configurable at runtime via configureGlobalGuard().
// ============================================================
let globalInFlight = 0;
let globalQueued = 0;
let maxConcurrent = 50; // Adjust based on your NVIDIA account tier
let maxQueued = 100; // Max requests allowed to queue globally
let queueTimeoutMs = 30000; // Max time a queued waiter stays pending

// FIFO queue of waiter release callbacks. Each entry resolves its
// promise, clears its own timeout, and moves itself to in-flight.
const waiters: Array<() => void> = [];

export function configureGlobalGuard(opts: {
  maxConcurrent?: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
}): void {
  if (opts.maxConcurrent !== undefined && Number.isInteger(opts.maxConcurrent) && opts.maxConcurrent > 0) {
    maxConcurrent = opts.maxConcurrent;
  }
  if (opts.maxQueued !== undefined && Number.isInteger(opts.maxQueued) && opts.maxQueued > 0) {
    maxQueued = opts.maxQueued;
  }
  if (opts.queueTimeoutMs !== undefined && Number.isInteger(opts.queueTimeoutMs) && opts.queueTimeoutMs > 0) {
    queueTimeoutMs = opts.queueTimeoutMs;
  }
}

export function getGlobalInFlight(): number {
  return globalInFlight;
}

export function getGlobalQueued(): number {
  return globalQueued;
}

export function acquireGlobalSlot(): Promise<void> {
  if (globalInFlight < maxConcurrent) {
    globalInFlight++;
    return Promise.resolve();
  }
  if (globalQueued >= maxQueued) {
    throw new Error(
      `Global concurrency limit reached (${maxConcurrent} in-flight, ${maxQueued} queued max)`
    );
  }
  globalQueued++;
  return new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const waiter = () => {
      if (timeoutId) clearTimeout(timeoutId);
      globalQueued = Math.max(0, globalQueued - 1);
      globalInFlight++;
      resolve();
    };

    timeoutId = setTimeout(() => {
      const idx = waiters.indexOf(waiter);
      if (idx !== -1) {
        waiters.splice(idx, 1);
        globalQueued = Math.max(0, globalQueued - 1);
      }
      reject(new Error('Global concurrency queue timeout (30s)'));
    }, queueTimeoutMs);

    waiters.push(waiter);
  });
}

export function releaseGlobalSlot(): void {
  globalInFlight = Math.max(0, globalInFlight - 1);
  if (waiters.length > 0) {
    // Hand the freed slot to the longest-waiting waiter, which
    // re-increments inFlight (net: stays at maxConcurrent).
    const waiter = waiters.shift()!;
    waiter();
  }
}

export function getGlobalStats(): {
  inFlight: number;
  queued: number;
  maxConcurrent: number;
  maxQueued: number;
} {
  return {
    inFlight: globalInFlight,
    queued: globalQueued,
    maxConcurrent: maxConcurrent,
    maxQueued: maxQueued,
  };
}
