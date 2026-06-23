import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../config/schema.js";
import { newScreenSpec } from "../../spec/schema.js";
import type { AdapterContext } from "../adapter.js";
import { REACT_SYSTEM_PROMPT, reactAdapter } from "./adapter.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-react-adapter-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  const config = defaultConfig();
  const spec = newScreenSpec({ title: "Cart", description: "Shows items in the cart." });
  return {
    root: "/tmp/proj",
    config,
    spec,
    dsComponents: {},
    ...overrides,
  };
}

describe("REACT_SYSTEM_PROMPT", () => {
  it("contains the literal quality-bar sentence", () => {
    expect(REACT_SYSTEM_PROMPT.toLowerCase()).toContain(
      "any developer or designer could build this identically from the spec alone"
    );
  });
  it("declares §7 baseline phrases", () => {
    expect(REACT_SYSTEM_PROMPT).toContain("TypeScript strict");
    expect(REACT_SYSTEM_PROMPT).toContain("WCAG-AA");
    expect(REACT_SYSTEM_PROMPT).toContain("Error boundary");
    expect(REACT_SYSTEM_PROMPT.toLowerCase()).toContain("no `console.log`");
  });
});

describe("reactAdapter.systemPrompt", () => {
  it("includes the spec title and acceptance criteria", () => {
    const spec = newScreenSpec({ title: "Cart", description: "Shows items in cart." });
    spec.acceptanceCriteria = ["Updates total in real time", "Empty state when no items"];
    const prompt = reactAdapter.systemPrompt(makeCtx({ spec }));
    expect(prompt).toContain("Cart");
    expect(prompt).toContain("Updates total in real time");
  });
  it("uses effective breakpoints from config when spec inherits", () => {
    const prompt = reactAdapter.systemPrompt(makeCtx());
    // defaultConfig breakpoints: [375, 768, 1024, 1440]
    expect(prompt).toMatch(/375/);
    expect(prompt).toMatch(/1440/);
  });
});

describe("reactAdapter.importStatement", () => {
  it("kebabs PascalCase names", () => {
    expect(reactAdapter.importStatement("TextField", "abc")).toBe(
      'import { TextField } from "@/components/ui/text-field";'
    );
    expect(reactAdapter.importStatement("Button")).toBe(
      'import { Button } from "@/components/ui/button";'
    );
    expect(reactAdapter.importStatement("PieChart")).toBe(
      'import { PieChart } from "@/components/ui/pie-chart";'
    );
  });
});

describe("reactAdapter.fileNameFor", () => {
  it("returns Cart.tsx / Cart.test.tsx", () => {
    expect(reactAdapter.fileNameFor("Cart", "component")).toBe("Cart.tsx");
    expect(reactAdapter.fileNameFor("Cart", "test")).toBe("Cart.test.tsx");
  });
});

describe("reactAdapter.qualityGates", () => {
  it("includes tsc, eslint, prettier; vitest when testFramework=vitest", () => {
    const ctx = makeCtx();
    const gates = reactAdapter.qualityGates(ctx);
    const kinds = gates.map((g) => g.gate);
    expect(kinds).toEqual(["tsc", "eslint", "prettier", "vitest"]);
  });
  it("omits vitest when testFramework=none", () => {
    const cfg = defaultConfig();
    cfg.project.testFramework = "none";
    const gates = reactAdapter.qualityGates(makeCtx({ config: cfg }));
    expect(gates.map((g) => g.gate)).toEqual(["tsc", "eslint", "prettier"]);
  });
  it("omits vitest when tests=false", () => {
    const cfg = defaultConfig();
    cfg.project.tests = false;
    const gates = reactAdapter.qualityGates(makeCtx({ config: cfg }));
    expect(gates.map((g) => g.gate)).not.toContain("vitest");
  });
});

describe("reactAdapter.verifyEnvironment", () => {
  it("returns missing list when binaries don't exist", async () => {
    const root = mkTmp();
    const result = await reactAdapter.verifyEnvironment(root, "vitest");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["tsc", "eslint", "prettier", "vitest"]);
    }
  });
  it("returns ok when all binaries present", async () => {
    const root = mkTmp();
    const bin = join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["tsc", "eslint", "prettier", "vitest"]) {
      writeFileSync(join(bin, tool), "#!/bin/sh\n");
    }
    const result = await reactAdapter.verifyEnvironment(root, "vitest");
    expect(result.ok).toBe(true);
  });
  it("doesn't require vitest when testFramework=none", async () => {
    const root = mkTmp();
    const bin = join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["tsc", "eslint", "prettier"]) {
      writeFileSync(join(bin, tool), "#!/bin/sh\n");
    }
    const result = await reactAdapter.verifyEnvironment(root, "none");
    expect(result.ok).toBe(true);
  });
});

describe("reactAdapter.transformGateOutput", () => {
  it("parses tsc error lines", () => {
    const raw =
      "src/Foo.tsx(10,5): error TS2304: Cannot find name 'Bar'.\n" +
      "src/Baz.tsx(3,1): error TS2322: Type 'string' is not assignable to type 'number'.";
    const { failures } = reactAdapter.transformGateOutput("tsc", raw);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toEqual({
      file: "src/Foo.tsx",
      line: 10,
      column: 5,
      message: "Cannot find name 'Bar'.",
    });
  });
  it("parses eslint default formatter", () => {
    const raw =
      "/proj/src/Cart.tsx\n" +
      "  14:3  error  Form labels must have associated controls  jsx-a11y/label-has-associated-control\n" +
      "  22:9  error  Buttons must have discernible text  jsx-a11y/button-has-name\n";
    const { failures } = reactAdapter.transformGateOutput("eslint", raw);
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(failures[0]?.rule).toBe("jsx-a11y/label-has-associated-control");
    expect(failures[0]?.file).toBe("/proj/src/Cart.tsx");
  });
  it("parses prettier warn lines", () => {
    const raw = "[warn] src/Cart.tsx\n[warn] src/Cart.test.tsx";
    const { failures } = reactAdapter.transformGateOutput("prettier", raw);
    expect(failures).toHaveLength(2);
    expect(failures[0]?.file).toBe("src/Cart.tsx");
  });
});

describe("reactAdapter.testScaffold", () => {
  it("emits one test per acceptance criterion", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.acceptanceCriteria = ["Updates in real time", "Empty when no items"];
    const out = reactAdapter.testScaffold(makeCtx({ spec }));
    expect(out).toContain('describe("Cart"');
    expect(out).toContain("Updates in real time");
    expect(out).toContain("Empty when no items");
    expect(out).toContain("@testing-library/react");
  });
  it("emits a placeholder `renders` test when criteria are empty", () => {
    const spec = newScreenSpec({ title: "Cart", description: "x" });
    spec.acceptanceCriteria = [];
    const out = reactAdapter.testScaffold(makeCtx({ spec }));
    expect(out).toContain('it("renders"');
  });
});
