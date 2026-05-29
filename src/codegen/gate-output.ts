/** Result of running one quality gate (tsc, eslint, prettier, or vitest). */
export interface GateResult {
  gate: "tsc" | "eslint" | "prettier" | "vitest";
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** Parsed structured failures (file path + optional line/column + message). */
  failures: {
    file: string;
    line?: number;
    column?: number;
    rule?: string;
    message: string;
  }[];
  /** Raw stdout+stderr for the user to read verbatim if the parser missed something. */
  raw: string;
}

/** Aggregate report from running multiple gates in sequence. */
export interface GateRunReport {
  /** ISO-8601 timestamp when the run started. */
  ranAt: string;
  /** Total wall-clock duration across all gates, in ms. */
  totalDurationMs: number;
  results: GateResult[];
  /** True iff every required gate passed. Informational (required: false) gates do not affect this. */
  passed: boolean;
}
