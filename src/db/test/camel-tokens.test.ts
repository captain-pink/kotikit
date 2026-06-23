import { describe, expect, it } from "bun:test";
import { buildNameTokens } from "../camel-tokens.js";

describe("buildNameTokens", () => {
  it("splits CamelCase: IconArrowLeft", () => {
    expect(buildNameTokens("IconArrowLeft")).toBe("IconArrowLeft Icon Arrow Left");
  });

  it("preserves single word: Button", () => {
    expect(buildNameTokens("Button")).toBe("Button");
  });

  it("handles space + digit cluster: PieChart 3D", () => {
    expect(buildNameTokens("PieChart 3D")).toBe("PieChart 3D Pie Chart 3 D");
  });

  it("splits TextField", () => {
    expect(buildNameTokens("TextField")).toBe("TextField Text Field");
  });

  it("splits snake_case: ic_arrow", () => {
    expect(buildNameTokens("ic_arrow")).toBe("ic_arrow ic arrow");
  });

  it("keeps acronyms grouped: HTTPSConfig", () => {
    expect(buildNameTokens("HTTPSConfig")).toBe("HTTPSConfig HTTPS Config");
  });

  it("handles kebab-case: text-field", () => {
    expect(buildNameTokens("text-field")).toBe("text-field text field");
  });

  it("handles forward slash: Icon/Arrow/Left", () => {
    // Original includes the slashes; tokens are split
    const result = buildNameTokens("Icon/Arrow/Left");
    expect(result).toContain("Icon/Arrow/Left");
    expect(result).toContain("Icon");
    expect(result).toContain("Arrow");
    expect(result).toContain("Left");
  });

  it("does not produce empty tokens", () => {
    const result = buildNameTokens("__leading--trailing__");
    expect(result.split(/\s+/).every((t) => t.length > 0)).toBe(true);
  });

  it("deduplicates: Button Button", () => {
    expect(buildNameTokens("Button Button")).toBe("Button");
  });
});
