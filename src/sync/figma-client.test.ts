import { describe, it, expect } from "bun:test";
import { FigmaClient } from "./figma-client.js";
import { KotikitError } from "../util/result.js";
import { createLimiter } from "./rate-limit.js";

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

describe("FigmaClient", () => {
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
});
