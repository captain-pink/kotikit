import { existsSync } from "fs";
import { join } from "path";
import { pascalCase } from "../../util/ids.js";
import type { Adapter, AdapterContext, GateCommand, GateKind } from "../adapter.js";
import { buildReactSystemPrompt, REACT_SYSTEM_PROMPT } from "./system-prompt.js";
import { vitestScaffold } from "./test-scaffold.js";

/** Helper: lowercase-kebab of a component name for shadcn import paths. */
function kebab(name: string): string {
  // "TextField" → "text-field"
  // "Button"    → "button"
  // "PieChart"  → "pie-chart"
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Resolve effective breakpoints from a spec (handles "inherits" + overrides). */
function effectiveBreakpoints(ctx: AdapterContext): number[] {
  const r = ctx.spec.requirements.responsive;
  if (typeof r === "object" && "overrides" in r) {
    return r.overrides.breakpoints;
  }
  return ctx.config.defaults.breakpoints;
}

function effectiveThemes(ctx: AdapterContext): string[] {
  const t = ctx.spec.requirements.themes;
  if (typeof t === "object" && "overrides" in t) {
    return t.overrides.themes;
  }
  return ctx.config.defaults.themes;
}

export const reactAdapter: Adapter = {
  name: "react",

  systemPrompt(ctx) {
    return buildReactSystemPrompt({
      spec: ctx.spec,
      breakpoints: effectiveBreakpoints(ctx),
      themes: effectiveThemes(ctx),
      flowManifest: ctx.flowManifest,
      dsComponentNames: Object.keys(ctx.dsComponents),
      testFramework: ctx.config.project.testFramework,
    });
  },

  importStatement(componentName, _dsKey) {
    return `import { ${componentName} } from "@/components/ui/${kebab(componentName)}";`;
  },

  fileNameFor(componentName, kind) {
    return kind === "component" ? `${componentName}.tsx` : `${componentName}.test.tsx`;
  },

  testScaffold(ctx) {
    const componentName = pascalCase(ctx.spec.title);
    return vitestScaffold({
      componentName,
      acceptanceCriteria: ctx.spec.acceptanceCriteria,
      importPath: `./${componentName}`,
    });
  },

  qualityGates(ctx) {
    const gates: GateCommand[] = [
      { gate: "tsc", cmd: ["bunx", "--no-install", "tsc", "--noEmit"], required: true },
      {
        gate: "eslint",
        cmd: ["bunx", "--no-install", "eslint", "--max-warnings", "0"],
        required: true,
      },
      { gate: "prettier", cmd: ["bunx", "--no-install", "prettier", "--check"], required: true },
    ];
    if (ctx.config.project.testFramework === "vitest" && ctx.config.project.tests) {
      gates.push({
        gate: "vitest",
        cmd: ["bunx", "--no-install", "vitest", "run"],
        required: true,
      });
    }
    return gates;
  },

  async verifyEnvironment(root, testFramework) {
    const required: GateKind[] = ["tsc", "eslint", "prettier"];
    if (testFramework === "vitest") required.push("vitest");
    const missing: GateKind[] = [];
    for (const tool of required) {
      const bin = join(root, "node_modules", ".bin", tool);
      if (!existsSync(bin)) missing.push(tool);
    }
    if (missing.length === 0) return { ok: true };
    return { ok: false, missing };
  },

  transformGateOutput(gate, raw) {
    // tsc: "src/Foo.tsx(10,5): error TS2304: Cannot find name 'Bar'."
    if (gate === "tsc") {
      const failures: {
        file: string;
        line?: number;
        column?: number;
        rule?: string;
        message: string;
      }[] = [];
      const re = /^(.+\.tsx?)\((\d+),(\d+)\): error TS\d+: (.+)$/gm;
      let match = re.exec(raw);
      while (match !== null) {
        const [, file, line, column, message] = match;
        if (
          file !== undefined &&
          line !== undefined &&
          column !== undefined &&
          message !== undefined
        ) {
          failures.push({ file, line: Number(line), column: Number(column), message });
        }
        match = re.exec(raw);
      }
      return { failures };
    }

    // eslint default formatter:
    //   /path/to/file.tsx
    //     10:5  error  Some message  rule/name
    if (gate === "eslint") {
      const failures: {
        file: string;
        line?: number;
        column?: number;
        rule?: string;
        message: string;
      }[] = [];
      const lines = raw.split("\n");
      let currentFile = "";
      for (const ln of lines) {
        // File header: absolute or relative path ending in .ts or .tsx (not indented)
        if (!ln.match(/^\s/) && ln.match(/\.tsx?$/)) {
          currentFile = ln.trim();
          continue;
        }
        // Failure line: "  10:5  error  Message  rule/name"
        const errMatch = ln.match(/^\s+(\d+):(\d+)\s+error\s+(.+?)\s+([\w-]+\/[\w/-]+)\s*$/);
        if (errMatch && currentFile) {
          failures.push({
            file: currentFile,
            line: Number(errMatch[1]),
            column: Number(errMatch[2]),
            message: errMatch[3]!,
            rule: errMatch[4]!,
          });
        }
      }
      return { failures };
    }

    // prettier: "[warn] path/to/file.tsx"
    if (gate === "prettier") {
      const failures: {
        file: string;
        line?: number;
        column?: number;
        rule?: string;
        message: string;
      }[] = [];
      const re = /^\[warn\] (.+)$/gm;
      let match = re.exec(raw);
      while (match !== null) {
        const [, file] = match;
        if (file !== undefined) {
          failures.push({ file, message: "Code style issues found by prettier" });
        }
        match = re.exec(raw);
      }
      return { failures };
    }

    // vitest: look for "FAIL " lines (default reporter)
    if (gate === "vitest") {
      const failures: {
        file: string;
        line?: number;
        column?: number;
        rule?: string;
        message: string;
      }[] = [];
      const re = /^\s*(?:FAIL|×)\s+(.+\.test\.tsx?)\s*>?\s*(.+)?$/gm;
      let match = re.exec(raw);
      while (match !== null) {
        const [, file, message] = match;
        if (file !== undefined) {
          failures.push({ file, message: message ?? "Test failed" });
        }
        match = re.exec(raw);
      }
      return { failures };
    }

    return { failures: [] };
  },
};

// Re-export prompt constant so callers can include it in tool replies if useful
export { REACT_SYSTEM_PROMPT };
