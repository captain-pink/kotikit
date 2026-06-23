/**
 * createLimiter — schedule async functions with rate and concurrency caps.
 *
 *   minTime: minimum ms between two STARTS (rate cap)
 *   maxConcurrent: maximum in-flight functions at any moment
 *
 * Backpressure: callers `await schedule(() => fetch(...))` and get back the
 * function's resolved value or thrown error. Order of completion is not
 * guaranteed; order of starts is FIFO.
 */

interface QueuedTask {
  run: () => void;
}

export function createLimiter(opts: { minTime: number; maxConcurrent: number }): {
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const { minTime, maxConcurrent } = opts;
  const queue: QueuedTask[] = [];
  let lastStartAt = 0;
  let inFlight = 0;

  function drain(): void {
    while (inFlight < maxConcurrent && queue.length > 0) {
      const task = queue.shift();
      if (task === undefined) return;
      const now = Date.now();
      const nextStart = Math.max(now, lastStartAt + minTime);
      // Reserve both the time slot AND the concurrency slot immediately,
      // before the timeout fires, so the while-loop check is accurate for
      // subsequent iterations in the same drain() call.
      lastStartAt = nextStart;
      inFlight++;
      const delay = nextStart - now;

      setTimeout(() => {
        task.run();
      }, delay);
    }
  }

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        run: () => {
          fn().then(
            (value) => {
              inFlight--;
              resolve(value);
              drain();
            },
            (err: unknown) => {
              inFlight--;
              reject(err);
              drain();
            }
          );
        },
      });
      drain();
    });
  }

  return { schedule };
}

export interface AdaptiveLimiterOptions {
  initialMinTime: number;
  minMinTime: number;
  maxMinTime: number;
  maxConcurrent: number;
  backoffFactor?: number;
  recoveryFactor?: number;
  recoveryAfterSuccesses?: number;
}

export interface AdaptiveLimiter {
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
  recordRateLimit: (retryAfterMs?: number) => void;
  recordSuccess: () => void;
  currentMinTime: () => number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Adaptive limiter for APIs with account-dependent rate limits.
 *
 * It starts at a reasonable pace, slows down whenever callers report a 429,
 * honors Retry-After as a temporary pause, and cautiously speeds back up after
 * sustained success. The scheduler stays FIFO and uses the current learned
 * minTime for future starts.
 */
export function createAdaptiveLimiter(opts: AdaptiveLimiterOptions): AdaptiveLimiter {
  const {
    maxConcurrent,
    backoffFactor = 2,
    recoveryFactor = 0.9,
    recoveryAfterSuccesses = 20,
  } = opts;

  const minMinTime = Math.max(0, opts.minMinTime);
  const maxMinTime = Math.max(minMinTime, opts.maxMinTime);
  let currentMinTime = clamp(opts.initialMinTime, minMinTime, maxMinTime);
  let successStreak = 0;
  let pausedUntil = 0;

  const queue: QueuedTask[] = [];
  let lastStartAt = 0;
  let inFlight = 0;

  function drain(): void {
    while (inFlight < maxConcurrent && queue.length > 0) {
      const task = queue.shift();
      if (task === undefined) return;
      const now = Date.now();
      const nextStart = Math.max(now, lastStartAt + currentMinTime, pausedUntil);
      lastStartAt = nextStart;
      inFlight++;
      const delay = nextStart - now;

      setTimeout(() => {
        task.run();
      }, delay);
    }
  }

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        run: () => {
          fn().then(
            (value) => {
              inFlight--;
              resolve(value);
              drain();
            },
            (err: unknown) => {
              inFlight--;
              reject(err);
              drain();
            }
          );
        },
      });
      drain();
    });
  }

  function recordRateLimit(retryAfterMs?: number): void {
    successStreak = 0;
    currentMinTime = clamp(Math.ceil(currentMinTime * backoffFactor), minMinTime, maxMinTime);
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      pausedUntil = Math.max(pausedUntil, Date.now() + retryAfterMs);
    }
  }

  function recordSuccess(): void {
    successStreak++;
    if (successStreak < recoveryAfterSuccesses) return;

    successStreak = 0;
    currentMinTime = clamp(Math.floor(currentMinTime * recoveryFactor), minMinTime, maxMinTime);
  }

  return {
    schedule,
    recordRateLimit,
    recordSuccess,
    currentMinTime: () => currentMinTime,
  };
}
