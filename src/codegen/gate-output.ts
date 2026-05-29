// TODO(P3-A5): finalize — this placeholder will be replaced with the full version in P3-A5.

export interface GateResult {
  gate: "tsc" | "eslint" | "prettier" | "vitest";
  passed: boolean;
  exitCode: number;
  durationMs: number;
  failures: { file: string; line?: number; column?: number; rule?: string; message: string }[];
  raw: string;
}

export interface GateRunReport {
  ranAt: string;
  totalDurationMs: number;
  results: GateResult[];
  passed: boolean;
}
