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

interface Task<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function createLimiter(opts: { minTime: number; maxConcurrent: number }): {
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const { minTime, maxConcurrent } = opts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queue: Task<any>[] = [];
  let lastStartAt = 0;
  let inFlight = 0;

  function drain(): void {
    while (inFlight < maxConcurrent && queue.length > 0) {
      const task = queue.shift()!;
      const now = Date.now();
      const nextStart = Math.max(now, lastStartAt + minTime);
      // Reserve both the time slot AND the concurrency slot immediately,
      // before the timeout fires, so the while-loop check is accurate for
      // subsequent iterations in the same drain() call.
      lastStartAt = nextStart;
      inFlight++;
      const delay = nextStart - now;

      setTimeout(() => {
        task.fn().then(
          (value) => {
            inFlight--;
            task.resolve(value);
            drain();
          },
          (err: unknown) => {
            inFlight--;
            task.reject(err);
            drain();
          }
        );
      }, delay);
    }
  }

  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({ fn, resolve, reject } as Task<T>);
      drain();
    });
  }

  return { schedule };
}
