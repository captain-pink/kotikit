import { z } from "zod";
import { KotikitError } from "../util/result.js";
import { createLimiter } from "./rate-limit.js";
import { withBackoff, type RetryableError, type BackoffOpts } from "./backoff.js";
import {
  FigmaFileSchema,
  FigmaComponentsResponseSchema,
  FigmaComponentSetsResponseSchema,
  FigmaStylesResponseSchema,
  FigmaVariablesResponseSchema,
  FigmaNodesResponseSchema,
  type FigmaFile,
  type FigmaPublishedComponent,
  type FigmaComponentSet,
  type FigmaStyle,
  type FigmaLocalVariables,
  type FigmaNode,
} from "./figma-types.js";

export type FetchFn = typeof globalThis.fetch;

export interface FigmaClientOpts {
  token: string;
  fetch?: FetchFn;                  // injectable for tests
  limiter?: ReturnType<typeof createLimiter>;
  backoffOpts?: BackoffOpts;
  baseUrl?: string;                 // default "https://api.figma.com"
}

class FigmaResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly retryAfterMs?: number
  ) {
    super(`Figma ${status} ${url}`);
  }
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  // HTTP date
  const t = Date.parse(headerValue);
  if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  return undefined;
}

function isRetryable(err: unknown): RetryableError | null {
  if (!(err instanceof FigmaResponseError)) return null;
  if (err.status === 429 || err.status >= 500) {
    return { status: err.status, retryAfterMs: err.retryAfterMs };
  }
  return null;
}

export class FigmaClient {
  private readonly token: string;
  private readonly fetchImpl: FetchFn;
  private readonly limiter: ReturnType<typeof createLimiter>;
  private readonly backoffOpts: BackoffOpts;
  private readonly baseUrl: string;

  constructor(opts: FigmaClientOpts) {
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.limiter = opts.limiter ?? createLimiter({ minTime: 100, maxConcurrent: 2 });
    this.backoffOpts = opts.backoffOpts ?? {};
    this.baseUrl = opts.baseUrl ?? "https://api.figma.com";
  }

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.limiter.schedule(() =>
      withBackoff(
        async () => {
          const res = await this.fetchImpl(url, {
            headers: {
              "X-Figma-Token": this.token,
            },
          });
          if (!res.ok) {
            const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
            throw new FigmaResponseError(res.status, url, retryAfterMs);
          }
          const data = await res.json();
          return schema.parse(data);
        },
        isRetryable,
        this.backoffOpts
      )
    );
  }

  /** GET /v1/files/:key — file metadata + page tree (subset). */
  async getFile(fileKey: string): Promise<FigmaFile> {
    try {
      return await this.request(`/v1/files/${fileKey}`, FigmaFileSchema);
    } catch (err) {
      throw this.mapError(err, fileKey, "file");
    }
  }

  /** GET /v1/files/:key/components — published components. */
  async getComponents(fileKey: string): Promise<FigmaPublishedComponent[]> {
    try {
      const res = await this.request(`/v1/files/${fileKey}/components`, FigmaComponentsResponseSchema);
      return res.meta.components;
    } catch (err) {
      throw this.mapError(err, fileKey, "components");
    }
  }

  /** GET /v1/files/:key/component_sets — component sets (variants). */
  async getComponentSets(fileKey: string): Promise<FigmaComponentSet[]> {
    try {
      const res = await this.request(`/v1/files/${fileKey}/component_sets`, FigmaComponentSetsResponseSchema);
      return res.meta.component_sets;
    } catch (err) {
      throw this.mapError(err, fileKey, "component_sets");
    }
  }

  /** GET /v1/files/:key/styles — color/text/effect styles. */
  async getStyles(fileKey: string): Promise<FigmaStyle[]> {
    try {
      const res = await this.request(`/v1/files/${fileKey}/styles`, FigmaStylesResponseSchema);
      return res.meta.styles;
    } catch (err) {
      throw this.mapError(err, fileKey, "styles");
    }
  }

  /**
   * GET /v1/files/:key/variables/local — Enterprise-gated.
   * Returns null on 403 so the caller can warn-and-continue.
   */
  async getLocalVariables(fileKey: string): Promise<FigmaLocalVariables | null> {
    try {
      const res = await this.request(`/v1/files/${fileKey}/variables/local`, FigmaVariablesResponseSchema);
      return res.meta;
    } catch (err) {
      if (err instanceof FigmaResponseError && err.status === 403) return null;
      throw this.mapError(err, fileKey, "variables");
    }
  }

  /**
   * GET /v1/files/:key/nodes?ids=... — batched in chunks of 100.
   */
  async getNodes(fileKey: string, ids: string[]): Promise<Record<string, FigmaNode>> {
    const batches: string[][] = [];
    const BATCH_SIZE = 100;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE));
    }
    const merged: Record<string, FigmaNode> = {};
    for (const batch of batches) {
      const batchIds = batch.join(",");
      try {
        const res = await this.request(
          `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(batchIds)}`,
          FigmaNodesResponseSchema
        );
        for (const [nodeId, node] of Object.entries(res.nodes)) {
          if (node !== null) merged[nodeId] = node;
        }
      } catch (err) {
        throw this.mapError(err, fileKey, "nodes");
      }
    }
    return merged;
  }

  private mapError(err: unknown, fileKey: string, kind: string): Error {
    if (err instanceof FigmaResponseError) {
      if (err.status === 401) {
        return new KotikitError(
          "Your Figma token is missing or invalid.",
          "Check FIGMA_TOKEN in .env or your op:// reference."
        );
      }
      if (err.status === 403) {
        return new KotikitError(
          `Your Figma token doesn't have access to file ${fileKey}.`,
          "Make sure the file is published to your team and the token has the file_read scope."
        );
      }
      if (err.status === 404) {
        return new KotikitError(
          `Figma can't find file ${fileKey}.`,
          "The key may be wrong, or the file may be private."
        );
      }
      if (err.status === 429) {
        return new KotikitError(
          "Figma is rate-limiting us.",
          "Try the sync again in a few minutes."
        );
      }
      return new KotikitError(
        `Figma returned an unexpected ${err.status} when fetching ${kind} for file ${fileKey}.`,
        "Try the sync again later."
      );
    }
    if (err instanceof Error) return err;
    return new Error(String(err));
  }
}

// Re-export FigmaResponseError so tests can construct it if needed
export { FigmaResponseError };
