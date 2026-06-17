import type { FileCheckpoint } from "./checkpoint.js";

export type Stage = FileCheckpoint["stage"];

export interface StageProgress {
  processed: number;
  total: number;
  /** Optional human-readable label appended to the line, e.g. "47.1s" or "library not published". */
  label?: string;
}

export interface FileContext {
  /** 1-based file index. */
  index: number;
  /** Total file count for this sync. */
  total: number;
  /** Short display name shown in brackets. */
  name: string;
}

/** A progress emitter writes one line per significant event. */
export interface ProgressEmitter {
  syncStart(fileCount: number): void;
  fileStart(ctx: FileContext): void;
  /** Stage transition with no counts. */
  stage(ctx: FileContext, stage: Stage | "writes", label?: string): void;
  /** Stage progress with counts (for batched stages). */
  stageProgress(ctx: FileContext, stage: Stage, progress: StageProgress): void;
  /** Stage end with optional duration label. */
  stageDone(ctx: FileContext, stage: Stage | "writes", label?: string): void;
  fileDone(ctx: FileContext, summary: { componentCount: number; iconCount: number; elapsedMs: number }): void;
  syncDone(summary: { fileCount: number; componentTotal: number; iconTotal: number; conflictCount: number; elapsedMs: number }): void;
}

/** Default stderr emitter — one line per event, prefixed with [kotikit]. */
export const stderrProgressEmitter: ProgressEmitter = {
  syncStart(fileCount) {
    process.stderr.write(`[kotikit] sync start: ${fileCount} file(s)\n`);
  },
  fileStart(ctx) {
    process.stderr.write(`[kotikit] [${ctx.index}/${ctx.total} ${ctx.name}] starting...\n`);
  },
  stage(ctx, stage, label) {
    const suffix = label ? ` (${label})` : "";
    process.stderr.write(`[kotikit] [${ctx.index}/${ctx.total} ${ctx.name}] ${stage}${suffix}\n`);
  },
  stageProgress(ctx, stage, p) {
    const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
    const labelSuffix = p.label ? `, ${p.label}` : "";
    process.stderr.write(`[kotikit] [${ctx.index}/${ctx.total} ${ctx.name}] ${stage}: ${p.processed}/${p.total} (${pct}%${labelSuffix})\n`);
  },
  stageDone(ctx, stage, label) {
    const suffix = label ? ` (${label})` : "";
    process.stderr.write(`[kotikit] [${ctx.index}/${ctx.total} ${ctx.name}] ${stage} done${suffix}\n`);
  },
  fileDone(ctx, summary) {
    process.stderr.write(`[kotikit] [${ctx.index}/${ctx.total} ${ctx.name}] done (${formatMs(summary.elapsedMs)}): ${summary.componentCount} components, ${summary.iconCount} icons\n`);
  },
  syncDone(summary) {
    process.stderr.write(`[kotikit] sync complete (${formatMs(summary.elapsedMs)}): ${summary.fileCount} file(s), ${summary.componentTotal} components, ${summary.iconTotal} icons, ${summary.conflictCount} conflict(s)\n`);
  },
};

/** Silent emitter used by tests to avoid noisy stderr output. */
export function nullProgressEmitter(): ProgressEmitter {
  return {
    syncStart: () => {},
    fileStart: () => {},
    stage: () => {},
    stageProgress: () => {},
    stageDone: () => {},
    fileDone: () => {},
    syncDone: () => {},
  };
}

/** Capturing emitter for unit tests — records every call into a flat array. */
export function recordingProgressEmitter(): { emitter: ProgressEmitter; events: { kind: string; payload?: unknown }[] } {
  const events: { kind: string; payload?: unknown }[] = [];
  return {
    events,
    emitter: {
      syncStart: (fileCount) => events.push({ kind: "syncStart", payload: { fileCount } }),
      fileStart: (ctx) => events.push({ kind: "fileStart", payload: ctx }),
      stage: (ctx, stage, label) => events.push({ kind: "stage", payload: { ctx, stage, label } }),
      stageProgress: (ctx, stage, p) => events.push({ kind: "stageProgress", payload: { ctx, stage, p } }),
      stageDone: (ctx, stage, label) => events.push({ kind: "stageDone", payload: { ctx, stage, label } }),
      fileDone: (ctx, summary) => events.push({ kind: "fileDone", payload: { ctx, summary } }),
      syncDone: (summary) => events.push({ kind: "syncDone", payload: summary }),
    },
  };
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
