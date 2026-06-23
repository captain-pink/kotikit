import { describe, expect, it } from "bun:test";
import type { Adapter } from "./adapter.js";

describe("Adapter interface", () => {
  it("a stub implementation type-checks", () => {
    const stub: Adapter = {
      name: "stub",
      systemPrompt: () => "",
      importStatement: (name) => `import { ${name} } from "stub";`,
      fileNameFor: (name, kind) => (kind === "component" ? `${name}.tsx` : `${name}.test.tsx`),
      testScaffold: () => "",
      qualityGates: () => [],
      verifyEnvironment: async () => ({ ok: true }),
      transformGateOutput: () => ({ failures: [] }),
    };
    expect(stub.name).toBe("stub");
    expect(stub.fileNameFor("Cart", "component")).toBe("Cart.tsx");
    expect(stub.fileNameFor("Cart", "test")).toBe("Cart.test.tsx");
  });
});
