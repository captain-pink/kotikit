import { describe, expect, it } from "bun:test";
import { type RetryableError, withBackoff } from "./backoff.js";

describe("withBackoff", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls++;
        return "ok";
      },
      () => null
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on retryable errors and eventually succeeds", async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls++;
        if (calls < 3) throw { status: 429 };
        return "ok";
      },
      (err) => {
        const e = err as { status?: number };
        return e.status === 429 ? { status: 429 } : null;
      },
      { initialMs: 5, maxMs: 50, jitterMs: 0 }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws the last error after maxAttempts", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw { status: 500, n: calls };
        },
        (err) => {
          const e = err as { status?: number };
          return e.status === 500 ? { status: 500 } : null;
        },
        { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 }
      )
    ).rejects.toMatchObject({ status: 500, n: 3 });
    expect(calls).toBe(3);
  });

  it("propagates non-retryable errors immediately", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw new Error("bad");
        },
        () => null
      )
    ).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });

  it("honors retryAfterMs from the retryable hint", async () => {
    let calls = 0;
    const tStart = Date.now();
    await withBackoff(
      async () => {
        calls++;
        if (calls < 2) throw { status: 429 };
        return "ok";
      },
      (err) => {
        const e = err as { status?: number };
        return e.status === 429
          ? ({ status: 429, retryAfterMs: 100 } satisfies RetryableError)
          : null;
      },
      { initialMs: 1, maxMs: 5, jitterMs: 0 }
    );
    const elapsed = Date.now() - tStart;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it("introduces jitter so consecutive delays are not identical", async () => {
    let calls = 0;
    const startsAt: number[] = [];
    await withBackoff(
      async () => {
        startsAt.push(Date.now());
        calls++;
        if (calls < 5) throw { status: 500 };
        return "ok";
      },
      () => ({ status: 500 }),
      { initialMs: 10, maxMs: 50, jitterMs: 100 }
    );
    // Compute deltas; with jitter, not all consecutive deltas should be equal
    const deltas: number[] = [];
    for (let i = 1; i < startsAt.length; i++) {
      const a = startsAt[i - 1] ?? 0;
      const b = startsAt[i] ?? 0;
      deltas.push(b - a);
    }
    const allEqual = deltas.every((d) => d === deltas[0]);
    expect(allEqual).toBe(false);
  });
});
