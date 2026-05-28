import { describe, it, expect } from "bun:test";
import { createLimiter } from "./rate-limit.js";

describe("createLimiter", () => {
  it("enforces minTime between starts", async () => {
    const limiter = createLimiter({ minTime: 50, maxConcurrent: 1 });
    const starts: number[] = [];
    const start = Date.now();
    await Promise.all([
      limiter.schedule(async () => { starts.push(Date.now() - start); }),
      limiter.schedule(async () => { starts.push(Date.now() - start); }),
      limiter.schedule(async () => { starts.push(Date.now() - start); }),
    ]);
    expect(starts).toHaveLength(3);
    // Each subsequent start at least ~50ms after the previous
    for (let i = 1; i < starts.length; i++) {
      const a = starts[i - 1] ?? 0;
      const b = starts[i] ?? 0;
      expect(b - a).toBeGreaterThanOrEqual(40);  // allow 10ms slack
    }
  });

  it("respects maxConcurrent", async () => {
    const limiter = createLimiter({ minTime: 0, maxConcurrent: 2 });
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () =>
      limiter.schedule(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 20));
        inFlight--;
      })
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("propagates errors", async () => {
    const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
    await expect(
      limiter.schedule(async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
  });

  it("returns the function's resolved value", async () => {
    const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
    const result = await limiter.schedule(async () => 42);
    expect(result).toBe(42);
  });

  it("recovers concurrency after an error", async () => {
    const limiter = createLimiter({ minTime: 0, maxConcurrent: 1 });
    await limiter.schedule(async () => { throw new Error("first"); }).catch(() => {});
    const ok = await limiter.schedule(async () => "ok");
    expect(ok).toBe("ok");
  });
});
