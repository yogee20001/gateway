// ============================================================
// AI Gateway — Retry Logic with Exponential Backoff
// ============================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export function calculateBackoff(attempt: number, baseDelay: number = 1000, maxDelay: number = 30000): number {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}

export function isRetryableStatus(status: number): boolean {
  return [429, 500, 502, 503, 504].includes(status);
}

export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

export function isServerErrorStatus(status: number): boolean {
  return [500, 502, 503, 504].includes(status);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: any) => boolean,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ result: T; retries: number }> {
  let lastError: any;
  let retries = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retries };
    } catch (error) {
      lastError = error;
      retries = attempt + 1;

      if (attempt < config.maxRetries && shouldRetry(error)) {
        const delay = calculateBackoff(attempt, config.baseDelay, config.maxDelay);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}