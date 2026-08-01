// ============================================================
// AI Gateway — In-Memory Logger & Stats
// ============================================================

import type { LogEntry, LogLevel, StatsResponse, ProviderStats } from './types';

// ============================================================
// Log Ring Buffer
// ============================================================
class LogRingBuffer {
  private buffer: (LogEntry | null)[];
  private maxSize: number;
  private head: number = 0;
  private count: number = 0;

  constructor(maxSize: number = 1000) {
    this.buffer = new Array(maxSize);
    this.maxSize = maxSize;
  }

  push(entry: LogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.maxSize;
    this.count = Math.min(this.count + 1, this.maxSize);
  }

  getAll(): LogEntry[] {
    if (this.count < this.maxSize) {
      return this.buffer.slice(0, this.count).filter((e): e is LogEntry => e !== null);
    }
    const entries: LogEntry[] = [];
    for (let i = this.head; i < this.maxSize; i++) {
      if (this.buffer[i]) entries.push(this.buffer[i]!);
    }
    for (let i = 0; i < this.head; i++) {
      if (this.buffer[i]) entries.push(this.buffer[i]!);
    }
    return entries;
  }

  getRecent(n: number): LogEntry[] {
    return this.getAll().slice(-n);
  }

  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}

// ============================================================
// Stats Accumulator
// ============================================================
class StatsAccumulator {
  totalRequests = 0;
  todayRequests = 0;
  todayDate = new Date().toISOString().split('T')[0];
  successfulRequests = 0;
  failedRequests = 0;
  retriedRequests = 0;
  totalDuration = 0;
  providerStats = new Map<string, { totalRequests: number; successfulRequests: number; failedRequests: number; totalDuration: number }>();
  startTime = Date.now();

  recordRequest(entry: LogEntry): void {
    this.totalRequests++;

    const today = new Date().toISOString().split('T')[0];
    if (today !== this.todayDate) {
      this.todayRequests = 0;
      this.todayDate = today;
    }
    this.todayRequests++;

    if (entry.status >= 200 && entry.status < 300) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }

    this.retriedRequests += entry.retries;
    this.totalDuration += entry.duration;

    // Per-provider stats
    let pStats = this.providerStats.get(entry.provider);
    if (!pStats) {
      pStats = { totalRequests: 0, successfulRequests: 0, failedRequests: 0, totalDuration: 0 };
      this.providerStats.set(entry.provider, pStats);
    }
    pStats.totalRequests++;
    if (entry.status >= 200 && entry.status < 300) {
      pStats.successfulRequests++;
    } else {
      pStats.failedRequests++;
    }
    pStats.totalDuration += entry.duration;
  }

  getStats(): StatsResponse {
    const providers: Record<string, ProviderStats> = {};
    for (const [id, pStats] of this.providerStats.entries()) {
      providers[id] = {
        totalRequests: pStats.totalRequests,
        successfulRequests: pStats.successfulRequests,
        failedRequests: pStats.failedRequests,
        averageDuration: pStats.totalRequests > 0 ? Math.round(pStats.totalDuration / pStats.totalRequests) : 0,
      };
    }

    return {
      totalRequests: this.totalRequests,
      todayRequests: this.todayRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      retriedRequests: this.retriedRequests,
      averageDuration: this.totalRequests > 0 ? Math.round(this.totalDuration / this.totalRequests) : 0,
      uptime: Date.now() - this.startTime,
      providers,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.todayRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.retriedRequests = 0;
    this.totalDuration = 0;
    this.providerStats.clear();
    this.startTime = Date.now();
  }
}

// ============================================================
// Singleton Instances
// ============================================================
let logBuffer = new LogRingBuffer(1000);
const stats = new StatsAccumulator();
let currentLogLevel: LogLevel = 'info';

/**
 * Configure the logger buffer size (call during startup with config.maxLogEntries)
 * Reduces memory usage on mobile devices
 */
export function configureLogger(maxEntries: number = 1000, logLevel?: LogLevel): void {
  const effectiveMax = Math.max(50, Math.min(maxEntries, 10000));
  logBuffer = new LogRingBuffer(effectiveMax);
  if (logLevel) currentLogLevel = logLevel;
}

// ============================================================
// Logging Functions
// ============================================================
let idCounter = 0;

function generateId(): string {
  return `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

export function logRequest(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
  const fullEntry: LogEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
  };

  logBuffer.push(fullEntry);
  stats.recordRequest(fullEntry);

  // Console log — gated: per-request lines print only at 'debug' level to
  // avoid blocking console writes on the hot path. Errors stay visible at
  // 'error'/'warn' levels.
  const isWarn = entry.status >= 400 && entry.status < 500;
  const isError = entry.status >= 500;
  const printEntry =
    currentLogLevel === 'debug' ||
    (currentLogLevel === 'warn' && (isWarn || isError)) ||
    (currentLogLevel === 'error' && isError);

  if (printEntry) {
    const time = new Date(fullEntry.timestamp).toISOString().slice(11, 23);
    const statusColor = entry.status >= 200 && entry.status < 300 ? '✓' :
                        entry.status >= 400 && entry.status < 500 ? '⚠' : '✗';
    console.log(
      `[${time}] ${statusColor} ${entry.method} ${entry.path}  ` +
      `model=${entry.model}  → ${entry.provider}  → ${entry.status} (${entry.duration}ms)` +
      (entry.retries > 0 ? ` ⚠ retry ${entry.retries}` : '')
    );
  }
}

export function getRecentLogs(count: number = 100): LogEntry[] {
  return logBuffer.getRecent(count);
}

export function getAllLogs(): LogEntry[] {
  return logBuffer.getAll();
}

export function clearLogs(): void {
  logBuffer.clear();
}

export function getStats(): StatsResponse {
  return stats.getStats();
}

export function resetStats(): void {
  stats.reset();
}

// ============================================================
// Console Logging
// ============================================================
const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',    // Gray
  info: '\x1b[37m',     // White
  warn: '\x1b[33m',     // Yellow
  error: '\x1b[31m',    // Red
};

const LOG_RESET = '\x1b[0m';

export function consoleLog(level: LogLevel, message: string, data?: any): void {
  const time = new Date().toISOString().slice(11, 23);
  const color = LOG_COLORS[level] || LOG_COLORS.info;
  const prefix = level.toUpperCase().padEnd(5);
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`${color}[${time}] ${prefix} ${message}${dataStr}${LOG_RESET}`);
}