import { describe, it, expect } from "bun:test";
import { FigmaClient, figmaRateLimitFromEnv } from "./figma-client.js";
import { KotikitError } from "../util/result.js";
import { createAdaptiveLimiter, createLimiter } from "./rate-limit.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function errorResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ status, err: "x" }), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

const FAST_BACKOFF = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 6 };
const FAST_LIMITER = createLimiter({ minTime: 0, maxConcurrent: 5 });

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
}

describe("FigmaClient", () => {
  it("uses adaptive rate limit defaults", () => {
    expect(figmaRateLimitFromEnv({})).toEqual({
      initialMinTime: 1_000,
      minMinTime: 100,
      maxMinTime: 60_000,
      maxConcurrent: 3,
    });
  });

  it("allows adaptive Figma rate limit overrides from env", () => {
    expect(
      figmaRateLimitFromEnv({
        KOTIKIT_FIGMA_INITIAL_MIN_TIME_MS: "2000",
        KOTIKIT_FIGMA_MIN_TIME_FLOOR_MS: "500",
        KOTIKIT_FIGMA_MIN_TIME_CEILING_MS: "30000",
        KOTIKIT_FIGMA_MAX_CONCURRENT: "3",
      })
    ).toEqual({
      initialMinTime: 2_000,
      minMinTime: 500,
      maxMinTime: 30_000,
      maxConcurrent: 3,
    });
  });

  it("ignores invalid adaptive Figma rate limit env overrides", () => {
    expect(
      figmaRateLimitFromEnv({
        KOTIKIT_FIGMA_INITIAL_MIN_TIME_MS: "-1",
        KOTIKIT_FIGMA_MIN_TIME_FLOOR_MS: "-5",
        KOTIKIT_FIGMA_MIN_TIME_CEILING_MS: "-10",
        KOTIKIT_FIGMA_MAX_CONCURRENT: "0",
      })
    ).toEqual({
      initialMinTime: 1_000,
      minMinTime: 100,
      maxMinTime: 60_000,
      maxConcurrent: 3,
    });
  });

  it("sends X-Figma-Token on every request", async () => {
    let seen: string | undefined;
    const fetch = async (_url: string | URL, init?: RequestInit) => {
      seen = (init?.headers as Record<string, string> | undefined)?.["X-Figma-Token"];
      return jsonResponse({ name: "f", document: { children: [] } });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });
    await client.getFile("k1");
    expect(seen).toBe("tkn");
  });

  it("getFile returns parsed file data", async () => {
    const fetch = async () => jsonResponse({ name: "MyFile", document: { children: [] } });
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    const f = await client.getFile("k1");
    expect(f.name).toBe("MyFile");
  });

  it("retries on 429 with Retry-After header", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (calls === 1) return errorResponse(429, { "Retry-After": "0" });
      return jsonResponse({ meta: { components: [] } });
    };
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    const result = await client.getComponents("k1");
    expect(result).toEqual([]);
    expect(calls).toBe(2);
  });

  it("reports 429s and successes to an adaptive limiter", async () => {
    let calls = 0;
    let reportedRetryAfterMs: number | undefined;
    let successCount = 0;
    const limiter = {
      schedule: <T>(fn: () => Promise<T>) => fn(),
      recordRateLimit: (retryAfterMs?: number) => {
        reportedRetryAfterMs = retryAfterMs;
      },
      recordSuccess: () => {
        successCount++;
      },
    };
    const fetch = async () => {
      calls++;
      if (calls === 1) return errorResponse(429, { "Retry-After": "0.002" });
      return jsonResponse({ meta: { components: [] } });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter,
      backoffOpts: FAST_BACKOFF,
    });

    const result = await client.getComponents("k1");

    expect(result).toEqual([]);
    expect(reportedRetryAfterMs).toBe(2);
    expect(successCount).toBe(1);
  });

  it("releases the adaptive limiter slot while a retry is waiting", async () => {
    const limiter = createAdaptiveLimiter({
      initialMinTime: 0,
      minMinTime: 0,
      maxMinTime: 100,
      maxConcurrent: 1,
    });
    const firstAttemptStarted = deferred();
    const allowFirst429 = deferred();
    const retryStarted = deferred();
    const finishRetry = deferred();
    let componentCalls = 0;

    const fetch = async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/components")) {
        componentCalls++;
        if (componentCalls === 1) {
          firstAttemptStarted.resolve();
          await allowFirst429.promise;
          return errorResponse(429, { "Retry-After": "0" });
        }
        retryStarted.resolve();
        await finishRetry.promise;
        return jsonResponse({ meta: { components: [] } });
      }
      if (u.includes("/styles")) return jsonResponse({ meta: { styles: [] } });
      return jsonResponse({ name: "f", document: { children: [] } });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter,
      backoffOpts: FAST_BACKOFF,
    });

    const first = client.getComponents("k1");
    await firstAttemptStarted.promise;
    const second = client.getStyles("k1");
    allowFirst429.resolve();

    await expect(Promise.race([second, timeout(50)])).resolves.toEqual([]);
    expect(componentCalls).toBe(1);

    await retryStarted.promise;
    finishRetry.resolve();
    await expect(first).resolves.toEqual([]);
  });

  it("retries on 500 and eventually succeeds", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (calls < 3) return errorResponse(500);
      return jsonResponse({ meta: { component_sets: [] } });
    };
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    const result = await client.getComponentSets("k1");
    expect(result).toEqual([]);
    expect(calls).toBe(3);
  });

  it("getLocalVariables returns null on 403, no throw", async () => {
    const fetch = async () => errorResponse(403);
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    const v = await client.getLocalVariables("k1");
    expect(v).toBeNull();
  });

  it("getFile maps 403 to KotikitError with access remediation", async () => {
    const fetch = async () => errorResponse(403);
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    await expect(client.getFile("k1")).rejects.toMatchObject({
      userMessage: expect.stringContaining("doesn't have access"),
    });
  });

  it("getFile maps 401 to KotikitError with token-invalid message", async () => {
    const fetch = async () => errorResponse(401);
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    await expect(client.getFile("k1")).rejects.toBeInstanceOf(KotikitError);
  });

  it("getFile maps 404 to KotikitError with file-not-found message", async () => {
    const fetch = async () => errorResponse(404);
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    await expect(client.getFile("k1")).rejects.toMatchObject({
      userMessage: expect.stringContaining("can't find file"),
    });
  });

  it("getNodes batches 250 ids into 3 calls (100, 100, 50)", async () => {
    const callsBy: number[] = [];
    const fetch = async (url: string | URL) => {
      const u = url.toString();
      const idsParam = new URL(u, "http://x").searchParams.get("ids") ?? "";
      callsBy.push(idsParam.split(",").length);
      const nodes: Record<string, unknown> = {};
      for (const id of idsParam.split(",")) nodes[id] = { document: { id } };
      return jsonResponse({ nodes });
    };
    const client = new FigmaClient({
      token: "tkn", fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER, backoffOpts: FAST_BACKOFF,
    });
    const ids = Array.from({ length: 250 }, (_, i) => `n${i}`);
    const got = await client.getNodes("k1", ids);
    expect(callsBy).toEqual([100, 100, 50]);
    expect(Object.keys(got).length).toBe(250);
  });

  it("getNodes schedules internal batches without waiting for each previous batch response", async () => {
    const allBatchesStarted = deferred();
    const releaseBatches = deferred();
    let callCount = 0;
    const fetch = async (url: string | URL) => {
      const u = url.toString();
      callCount++;
      if (callCount === 3) allBatchesStarted.resolve();
      await releaseBatches.promise;
      const idsParam = new URL(u, "http://x").searchParams.get("ids") ?? "";
      const nodes: Record<string, unknown> = Object.fromEntries(
        idsParam.split(",").map((id) => [id, { document: { id } }])
      );
      return jsonResponse({ nodes });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST_BACKOFF,
    });

    const got = client.getNodes("k1", Array.from({ length: 250 }, (_, i) => `n${i}`));

    await expect(Promise.race([allBatchesStarted.promise, timeout(50)])).resolves.toBeUndefined();
    expect(callCount).toBe(3);

    releaseBatches.resolve();
    await expect(got).resolves.toHaveProperty("n249");
  });

  it("getPageTree fetches /nodes?ids={pageId}&depth={depth} and returns root node", async () => {
    let seenUrl = "";
    const fetch = async (url: string | URL) => {
      seenUrl = url.toString();
      return jsonResponse({
        nodes: {
          "p1": {
            document: {
              id: "p1",
              name: "Icons",
              type: "CANVAS",
              children: [
                { id: "c1", name: "ic/arrow-right", type: "COMPONENT" },
                { id: "c2", name: "ic/arrow-left", type: "COMPONENT" },
              ],
            },
          },
        },
      });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });
    const root = await client.getPageTree("k1", "p1", 4);
    expect(seenUrl).toContain("/v1/files/k1/nodes");
    expect(seenUrl).toContain("ids=p1");
    expect(seenUrl).toContain("depth=4");
    expect(root?.name).toBe("Icons");
    expect(root?.type).toBe("CANVAS");
    // children preserved via passthrough
    const children = (root as unknown as { children?: unknown[] })?.children;
    expect(children).toHaveLength(2);
  });

  it("getPageTree returns null when the node entry is null", async () => {
    const fetch = async () => jsonResponse({ nodes: { "p1": null } });
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });
    const root = await client.getPageTree("k1", "p1");
    expect(root).toBeNull();
  });

  it("getPageTree returns null when document is absent", async () => {
    const fetch = async () => jsonResponse({ nodes: { "p1": {} } });
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });
    const root = await client.getPageTree("k1", "p1");
    expect(root).toBeNull();
  });

  it("getComments fetches comments as markdown and parses the response", async () => {
    let seenUrl = "";
    const fetch = async (url: string | URL) => {
      seenUrl = url.toString();
      return jsonResponse({
        comments: [
          {
            id: "comment-1",
            file_key: "k1",
            message: "**Use primary button**",
            created_at: "2026-06-17T00:00:00Z",
            user: { id: "user-1", handle: "Reviewer" },
            client_meta: { node_id: "node-1" },
          },
        ],
      });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });

    const comments = await client.getComments("k1", { asMarkdown: true });

    expect(seenUrl).toContain("/v1/files/k1/comments");
    expect(seenUrl).toContain("as_md=true");
    expect(comments[0]?.message).toBe("**Use primary button**");
    expect(comments[0]?.client_meta?.node_id).toBe("node-1");
  });

  it("getComments maps 403 to a file_comments scope hint", async () => {
    const fetch = async () => errorResponse(403);
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });

    await expect(client.getComments("k1")).rejects.toMatchObject({
      hint: expect.stringContaining("file_comments:read"),
    });
  });

  it("postComment replies to a root comment through the comments endpoint", async () => {
    let seenUrl = "";
    let seenMethod = "";
    let seenBody = "";
    const fetch = async (url: string | URL, init?: RequestInit) => {
      seenUrl = url.toString();
      seenMethod = init?.method ?? "GET";
      seenBody = String(init?.body ?? "");
      return jsonResponse({
        id: "reply-1",
        file_key: "k1",
        parent_id: "comment-1",
        message: "Fixed in this pass.",
      });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });

    const reply = await client.postComment("k1", {
      message: "Fixed in this pass.",
      commentId: "comment-1",
    });

    expect(seenUrl).toContain("/v1/files/k1/comments");
    expect(seenMethod).toBe("POST");
    expect(JSON.parse(seenBody)).toEqual({
      message: "Fixed in this pass.",
      comment_id: "comment-1",
    });
    expect(reply.id).toBe("reply-1");
  });

  it("getDocument returns parsed file with depth query param", async () => {
    let seenUrl = "";
    const fetch = async (url: string | URL) => {
      seenUrl = url.toString();
      return jsonResponse({
        name: "Mat3",
        document: {
          children: [
            {
              id: "p1",
              name: "Components",
              type: "CANVAS",
              children: [
                { id: "c1", name: "Button", type: "COMPONENT" },
              ],
            },
          ],
        },
      });
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: fetch as unknown as typeof globalThis.fetch,
      limiter: FAST_LIMITER,
      backoffOpts: FAST_BACKOFF,
    });
    const result = await client.getDocument("k1", 4);
    expect(seenUrl).toContain("depth=4");
    expect(result.document?.children?.[0]?.name).toBe("Components");
  });
});
