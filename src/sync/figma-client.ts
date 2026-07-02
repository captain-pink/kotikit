import type { z } from "zod";
import { KotikitError } from "../util/result.js";
import { type BackoffOpts, type RetryableError, withBackoff } from "./backoff.js";
import {
  type FigmaComment,
  FigmaCommentsResponseSchema,
  type FigmaComponentSet,
  FigmaComponentSetsResponseSchema,
  FigmaComponentsResponseSchema,
  type FigmaFile,
  FigmaFileSchema,
  type FigmaLocalVariables,
  type FigmaNode,
  FigmaNodesResponseSchema,
  type FigmaPublishedComponent,
  type FigmaStyle,
  FigmaStylesResponseSchema,
  type FigmaTreeNode,
  FigmaVariablesResponseSchema,
} from "./figma-types.js";
import { type AdaptiveLimiter, createAdaptiveLimiter } from "./rate-limit.js";

export type FetchFn = typeof globalThis.fetch;

export interface FigmaRateLimitOptions {
  initialMinTime: number;
  minMinTime: number;
  maxMinTime: number;
  maxConcurrent: number;
}

type FigmaLimiter = Pick<AdaptiveLimiter, "schedule"> &
  Partial<Pick<AdaptiveLimiter, "recordRateLimit" | "recordSuccess" | "currentMinTime">>;

const DEFAULT_INITIAL_MIN_TIME_MS = 1_000;
const DEFAULT_MIN_TIME_FLOOR_MS = 100;
const DEFAULT_MIN_TIME_CEILING_MS = 60_000;
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_BACKOFF: BackoffOpts = {
  initialMs: 5_000,
  maxMs: 60_000,
  jitterMs: 1_000,
  maxAttempts: 6,
};

export interface FigmaClientOpts {
  token: string;
  fetch?: FetchFn; // injectable for tests
  limiter?: FigmaLimiter;
  backoffOpts?: BackoffOpts;
  baseUrl?: string; // default "https://api.figma.com"
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function figmaRateLimitFromEnv(
  env: Record<string, string | undefined> = process.env
): FigmaRateLimitOptions {
  const minMinTime = parseNonNegativeInt(
    env.KOTIKIT_FIGMA_MIN_TIME_FLOOR_MS,
    DEFAULT_MIN_TIME_FLOOR_MS
  );
  const maxMinTime = Math.max(
    minMinTime,
    parseNonNegativeInt(env.KOTIKIT_FIGMA_MIN_TIME_CEILING_MS, DEFAULT_MIN_TIME_CEILING_MS)
  );

  return {
    initialMinTime: parseNonNegativeInt(
      env.KOTIKIT_FIGMA_INITIAL_MIN_TIME_MS,
      DEFAULT_INITIAL_MIN_TIME_MS
    ),
    minMinTime,
    maxMinTime,
    maxConcurrent: parsePositiveInt(env.KOTIKIT_FIGMA_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT),
  };
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
  private readonly limiter: FigmaLimiter;
  private readonly backoffOpts: BackoffOpts;
  private readonly baseUrl: string;

  constructor(opts: FigmaClientOpts) {
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.limiter = opts.limiter ?? createAdaptiveLimiter(figmaRateLimitFromEnv());
    this.backoffOpts = opts.backoffOpts ?? DEFAULT_BACKOFF;
    this.baseUrl = opts.baseUrl ?? "https://api.figma.com";
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return withBackoff(
      () =>
        this.limiter.schedule(async () => {
          const res = await this.fetchImpl(url, {
            ...init,
            headers: {
              ...(init.headers as Record<string, string> | undefined),
              "X-Figma-Token": this.token,
            },
          });
          if (!res.ok) {
            const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
            if (res.status === 429) {
              this.limiter.recordRateLimit?.(retryAfterMs);
            }
            throw new FigmaResponseError(res.status, url, retryAfterMs);
          }
          const data = await res.json();
          const parsed = schema.parse(data);
          this.limiter.recordSuccess?.();
          return parsed;
        }),
      isRetryable,
      this.backoffOpts
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

  /**
   * GET /v1/files/:key?depth=N — full file tree.
   * Kept for diagnostics and future import strategies. The sync engine does
   * not use document trees as a substitute for published library components.
   */
  async getDocument(fileKey: string, depth: number = 4): Promise<FigmaFile> {
    try {
      return await this.request(`/v1/files/${fileKey}?depth=${depth}`, FigmaFileSchema);
    } catch (err) {
      throw this.mapError(err, fileKey, "document");
    }
  }

  /** GET /v1/files/:key/components — published components. */
  async getComponents(fileKey: string): Promise<FigmaPublishedComponent[]> {
    try {
      const res = await this.request(
        `/v1/files/${fileKey}/components`,
        FigmaComponentsResponseSchema
      );
      return res.meta.components;
    } catch (err) {
      throw this.mapError(err, fileKey, "components");
    }
  }

  /** GET /v1/files/:key/component_sets — component sets (variants). */
  async getComponentSets(fileKey: string): Promise<FigmaComponentSet[]> {
    try {
      const res = await this.request(
        `/v1/files/${fileKey}/component_sets`,
        FigmaComponentSetsResponseSchema
      );
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
      const res = await this.request(
        `/v1/files/${fileKey}/variables/local`,
        FigmaVariablesResponseSchema
      );
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
    const BATCH_SIZE = 100;
    const batches = Array.from({ length: Math.ceil(ids.length / BATCH_SIZE) }, (_, index) =>
      ids.slice(index * BATCH_SIZE, index * BATCH_SIZE + BATCH_SIZE)
    );

    try {
      const entriesByBatch = await Promise.all(
        batches.map(async (batch) => {
          const batchIds = batch.join(",");
          const res = await this.request(
            `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(batchIds)}&depth=1`,
            FigmaNodesResponseSchema
          );
          return Object.entries(res.nodes).flatMap(([nodeId, node]) =>
            node === null ? [] : [[nodeId, node] as const]
          );
        })
      );
      return Object.fromEntries(entriesByBatch.flat());
    } catch (err) {
      throw this.mapError(err, fileKey, "nodes");
    }
  }

  /**
   * GET /v1/files/:key/nodes?ids={pageId}&depth=N — deep tree for a single page.
   * Returns the root CANVAS node for that page (with children to the requested depth).
   * Kept for diagnostics and targeted Figma tree inspection.
   */
  async getPageTree(
    fileKey: string,
    pageId: string,
    depth: number = 4
  ): Promise<FigmaTreeNode | null> {
    try {
      const res = await this.request(
        `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(pageId)}&depth=${depth}`,
        FigmaNodesResponseSchema
      );
      const node = res.nodes[pageId];
      if (!node?.document) return null;
      return node.document as unknown as FigmaTreeNode;
    } catch (err) {
      throw this.mapError(err, fileKey, "nodes");
    }
  }

  /** GET /v1/files/:key/comments — comments and replies for lightweight design feedback. */
  async getComments(fileKey: string, opts: { asMarkdown?: boolean } = {}): Promise<FigmaComment[]> {
    try {
      const suffix = opts.asMarkdown === true ? "?as_md=true" : "";
      const res = await this.request(
        `/v1/files/${fileKey}/comments${suffix}`,
        FigmaCommentsResponseSchema
      );
      return res.comments;
    } catch (err) {
      throw this.mapError(err, fileKey, "comments");
    }
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
        const scopeHint =
          kind === "comments"
            ? "Make sure the file is accessible to the token and the token has the file_comments:read scope."
            : "Make sure the file is published to your team and the token has the file_read scope.";
        return new KotikitError(
          `Your Figma token doesn't have access to file ${fileKey}.`,
          scopeHint
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
          "Kotikit adapts its Figma request pace automatically. Wait a minute and try sync again; if this happens repeatedly, raise KOTIKIT_FIGMA_INITIAL_MIN_TIME_MS or KOTIKIT_FIGMA_MIN_TIME_FLOOR_MS."
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
