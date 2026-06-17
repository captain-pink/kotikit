import { describe, it, expect } from "bun:test";
import { createAdaptiveLimiter, createLimiter } from "./rate-limit.js";

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

describe("createAdaptiveLimiter", () => {
  it("starts at the configured initial pace", () => {
    const limiter = createAdaptiveLimiter({
      initialMinTime: 100,
      minMinTime: 50,
      maxMinTime: 1_000,
      maxConcurrent: 1,
    });

    expect(limiter.currentMinTime()).toBe(100);
  });

  it("slows down after rate limits and clamps to the ceiling", () => {
    const limiter = createAdaptiveLimiter({
      initialMinTime: 100,
      minMinTime: 50,
      maxMinTime: 350,
      maxConcurrent: 1,
      backoffFactor: 2,
    });

    limiter.recordRateLimit();
    expect(limiter.currentMinTime()).toBe(200);

    limiter.recordRateLimit();
    expect(limiter.currentMinTime()).toBe(350);
  });

  it("recovers gradually after a sustained success streak", () => {
    const limiter = createAdaptiveLimiter({
      initialMinTime: 100,
      minMinTime: 50,
      maxMinTime: 1_000,
      maxConcurrent: 1,
      backoffFactor: 2,
      recoveryFactor: 0.5,
      recoveryAfterSuccesses: 2,
    });

    limiter.recordRateLimit();
    expect(limiter.currentMinTime()).toBe(200);

    limiter.recordSuccess();
    expect(limiter.currentMinTime()).toBe(200);

    limiter.recordSuccess();
    expect(limiter.currentMinTime()).toBe(100);
  });

  it("clamps the initial pace between floor and ceiling", () => {
    expect(
      createAdaptiveLimiter({
        initialMinTime: 10,
        minMinTime: 50,
        maxMinTime: 1_000,
        maxConcurrent: 1,
      }).currentMinTime()
    ).toBe(50);

    expect(
      createAdaptiveLimiter({
        initialMinTime: 2_000,
        minMinTime: 50,
        maxMinTime: 1_000,
        maxConcurrent: 1,
      }).currentMinTime()
    ).toBe(1_000);
  });
});
