import type { Adapter, AdapterContext, GateKind } from "./adapter.js";
import type { GateResult, GateRunReport } from "./gate-output.js";
import { nowIso } from "../util/ids.js";

/** Sub-interface used by the gate runner; allows injecting a stub spawn in tests. */
export type SpawnFn = (
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string> }
) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>;

export interface RunGatesOpts {
  /** User's project root (cwd for spawns). */
  root: string;
  adapter: Adapter;
  ctx: AdapterContext;
  /** Generated file absolute paths to pass as filesArg where applicable. */
  files: string[];
  /** Restrict to specific gates (used by _gate re-runs). Default: all required from adapter. */
  only?: GateKind[];
  /** Timeout per gate in ms. Default: 60_000. */
  timeoutMs?: number;
  /** Injectable spawn for tests. */
  spawn?: SpawnFn;
}

/** Default spawn using Bun.spawn with a timeout. */
const defaultSpawn: SpawnFn = async (cmd, opts) => {
  const proc = Bun.spawn({
    cmd,
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: (opts.env ?? { ...process.env, FORCE_COLOR: "0" }) as Record<string, string>,
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode, timedOut: false };
};

/** Race a spawn against a timeout; on timeout return synthetic result. */
async function spawnWithTimeout(
  base: SpawnFn,
  cmd: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ stdout: "", stderr: `Timed out after ${timeoutMs}ms`, exitCode: -1, timedOut: true });
    }, timeoutMs);
  });

  const runPromise = base(cmd, { cwd }).then((res) => {
    if (timer) clearTimeout(timer);
    return res;
  });

  return Promise.race([runPromise, timeoutPromise]).then((res) => {
    if (timer) clearTimeout(timer);
    return res;
  });
}

/**
 * Run the gate commands from the adapter and return a structured report.
 * - tsc is always passed without file args (project-wide).
 * - other gates receive opts.files as positional args.
 * - Each gate runs sequentially; all results are aggregated.
 */
export async function runGates(opts: RunGatesOpts): Promise<GateRunReport> {
  const spawn = opts.spawn ?? defaultSpawn;
  const timeout = opts.timeoutMs ?? 60_000;
  const allGates = opts.adapter.qualityGates(opts.ctx);
  const filtered = opts.only
    ? allGates.filter((g) => opts.only!.includes(g.gate))
    : allGates.filter((g) => g.required);

  const ranAt = nowIso();
  const startedAt = performance.now();
  const results: GateResult[] = [];

  for (const gate of filtered) {
    // tsc never gets file args; all other gates receive the full file list
    const fullCmd =
      gate.gate === "tsc"
        ? [...gate.cmd]
        : [...gate.cmd, ...opts.files];

    const t0 = performance.now();
    const spawnResult = await spawnWithTimeout(spawn, fullCmd, opts.root, timeout);
    const durationMs = Math.round(performance.now() - t0);

    const raw = `${spawnResult.stdout}\n${spawnResult.stderr}`.trim();
    const passed = spawnResult.exitCode === 0;
    const parsed = passed ? { failures: [] } : opts.adapter.transformGateOutput(gate.gate, raw);

    results.push({
      gate: gate.gate,
      passed,
      exitCode: spawnResult.exitCode,
      durationMs,
      failures: spawnResult.timedOut
        ? [{ file: "", message: `Timed out after ${timeout}ms` }]
        : parsed.failures,
      raw,
    });
  }

  const totalDurationMs = Math.round(performance.now() - startedAt);
  const passed = results.every((r) => r.passed);

  return { ranAt, totalDurationMs, results, passed };
}
