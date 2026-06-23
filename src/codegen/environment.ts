import type { Adapter, GateKind } from "./adapter.js";

export interface MissingGate {
  gate: GateKind;
  /** A one-line install command + brief explanation the user can paste. */
  hint: string;
}

export interface EnvironmentReport {
  ok: boolean;
  missing: MissingGate[];
}

const INSTALL_HINTS: Record<GateKind, string> = {
  tsc: "Add typescript: `bun add -d typescript` — kotikit runs `tsc --noEmit` to enforce strict types.",
  eslint:
    "Add eslint with jsx-a11y: `bun add -d eslint eslint-plugin-jsx-a11y` — used to enforce the §7 accessibility lint rules.",
  prettier:
    "Add prettier: `bun add -d prettier` — kotikit runs `prettier --check` to enforce formatting.",
  vitest:
    "Add vitest with React Testing Library: `bun add -d vitest @testing-library/react @testing-library/jest-dom jsdom` — used to run generated unit tests.",
};

/**
 * Probe the user's project for required gate binaries.
 * Delegates the detection to the adapter, then attaches install hints
 * per missing tool so the UI can show pasteable commands.
 */
export async function verifyGateEnvironment(opts: {
  root: string;
  adapter: Adapter;
  testFramework: "vitest" | "none";
}): Promise<EnvironmentReport> {
  const probe = await opts.adapter.verifyEnvironment(opts.root, opts.testFramework);
  if (probe.ok) {
    return { ok: true, missing: [] };
  }
  const missing = probe.missing.map((gate) => ({
    gate,
    hint: INSTALL_HINTS[gate] ?? `Install ${gate}.`,
  }));
  return { ok: false, missing };
}
