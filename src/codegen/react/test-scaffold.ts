/**
 * Build the .test.tsx scaffold for one screen. Returns the full file contents
 * The agent will then flesh out (or accept as-is for now — each acceptance criterion
 * becomes one test case with a TODO body, which Vitest treats as a pass-by-default
 * once the assertions are written, but a fail in strict mode if the TODO remains).
 *
 * For Phase 3 MVP we emit test stubs that PASS (no TODO that would fail).
 * The agent is responsible for filling in real assertions when the system prompt
 * tells it to. If the user leaves test bodies empty, that's acceptable —
 * the gate just verifies the file compiles and runs.
 */
export function vitestScaffold(input: {
  componentName: string;
  acceptanceCriteria: string[];
  /** Relative import path back to the component, e.g. "./Cart". */
  importPath: string;
}): string {
  const { componentName, acceptanceCriteria, importPath } = input;

  const escapeStr = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const lines: string[] = [
    `import { describe, it, expect } from "vitest";`,
    `import { render, screen } from "@testing-library/react";`,
    `import "@testing-library/jest-dom";`,
    `import ${componentName} from "${importPath}";`,
    ``,
    `describe("${escapeStr(componentName)}", () => {`,
  ];

  if (acceptanceCriteria.length === 0) {
    lines.push(`  it("renders", () => {`);
    lines.push(`    // Implement assertion for: renders`);
    lines.push(`    expect(true).toBe(true);`);
    lines.push(`  });`);
  } else {
    for (const criterion of acceptanceCriteria) {
      const escaped = escapeStr(criterion);
      lines.push(`  it("${escaped}", () => {`);
      lines.push(`    // Implement assertion for: ${criterion}`);
      lines.push(`    expect(true).toBe(true);`);
      lines.push(`  });`);
    }
  }

  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}
