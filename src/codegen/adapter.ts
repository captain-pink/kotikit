import type { Config } from "../config/schema.js";
import type { FlowManifest, ScreenSpec } from "../spec/schema.js";
import type { ComponentJson } from "../sync/component-shape.js";

export type GateKind = "tsc" | "eslint" | "prettier" | "vitest";

export interface AdapterContext {
  /** User's project root (NOT kotikit's). */
  root: string;
  config: Config;
  spec: ScreenSpec;
  flowManifest?: FlowManifest;
  /** DS component JSONs keyed by spec.components[].name. */
  dsComponents: Record<string, ComponentJson>;
}

export interface GateCommand {
  gate: GateKind;
  /** The command to spawn, e.g. ["bunx", "--no-install", "tsc", "--noEmit"]. */
  cmd: string[];
  /** Optional file path arguments appended after `cmd`. tsc typically omits this. */
  filesArg?: string[];
  /** If false, the gate is informational and does not cause overall failure. */
  required: boolean;
}

export interface Adapter {
  /** "react", "vue", etc. */
  name: string;

  /** Quality-bar-encoded instructions the agent uses to write code. */
  systemPrompt(ctx: AdapterContext): string;

  /** "import { Button } from '@/components/ui/button';" */
  importStatement(componentName: string, dsKey?: string): string;

  /** Convert ("Cart", "component") → "Cart.tsx"; ("Cart", "test") → "Cart.test.tsx". */
  fileNameFor(componentName: string, kind: "component" | "test"): string;

  /** Returns the contents of the test file template for the screen. */
  testScaffold(ctx: AdapterContext): string;

  /** Ordered list of gate commands to run for a fresh implementation. */
  qualityGates(ctx: AdapterContext): GateCommand[];

  /**
   * Probe the user's project for required binaries before generation starts.
   * Returns `{ok: true}` when all are found, otherwise `{ok: false, missing: [...]}`
   * naming the gate kinds whose binary is absent.
   */
  verifyEnvironment(
    root: string,
    testFramework: "vitest" | "none"
  ): Promise<{ ok: true } | { ok: false; missing: GateKind[] }>;

  /**
   * Parse a gate's raw stderr+stdout into structured failures
   * (file path + optional line/column + message). Unknown lines are dropped silently;
   * the caller still retains the raw output.
   */
  transformGateOutput(
    gate: GateKind,
    raw: string
  ): {
    failures: { file: string; line?: number; column?: number; rule?: string; message: string }[];
  };
}

export type { GateResult, GateRunReport } from "./gate-output.js";
