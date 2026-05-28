export interface BackoffOpts {
  initialMs?: number;   // default 500
  maxMs?: number;       // default 30000
  jitterMs?: number;    // default 250
  maxAttempts?: number; // default 6
}

export interface RetryableError {
  status: number;        // 429 or 5xx
  retryAfterMs?: number; // if present, use this instead of the computed delay
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying on retryable errors with exponential growth + jitter.
 *
 * `isRetryable(err)` returns:
 *   - a RetryableError (with optional retryAfterMs) → retry
 *   - null → propagate
 *
 * After `maxAttempts` consecutive retryable errors, the LAST error is thrown.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => null | RetryableError,
  opts?: BackoffOpts
): Promise<T> {
  const {
    initialMs = 500,
    maxMs = 30000,
    jitterMs = 250,
    maxAttempts = 6,
  } = opts ?? {};

  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const r = isRetryable(err);
      if (r === null) {
        throw err;
      }

      lastErr = err;

      let delay: number;
      if (r.retryAfterMs !== undefined) {
        delay = r.retryAfterMs;
      } else {
        const base = Math.min(initialMs * Math.pow(2, attempt), maxMs);
        delay = base + Math.random() * jitterMs;
      }

      await sleep(delay);
    }
  }

  throw lastErr;
}
