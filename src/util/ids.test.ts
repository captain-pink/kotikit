import { describe, it, expect } from "bun:test";
import { uuid, nowIso, slugify, slugifyComponentName } from "./ids";

describe("ids", () => {
  it("uuid returns a valid v4 UUID", () => {
    const id = uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("uuid is unique on each call", () => {
    expect(uuid()).not.toBe(uuid());
  });

  it("nowIso returns a parseable ISO date", () => {
    const iso = nowIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('slugify("Checkout Flow") === "checkout-flow"', () => {
    expect(slugify("Checkout Flow")).toBe("checkout-flow");
  });

  it('slugify("  A/B  c! ") === "a-b-c"', () => {
    expect(slugify("  A/B  c! ")).toBe("a-b-c");
  });

  it('slugify("My Profile Page!") === "my-profile-page"', () => {
    expect(slugify("My Profile Page!")).toBe("my-profile-page");
  });

  it("slugify strips leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  describe("slugifyComponentName", () => {
    it('"Pie Chart" → "pie-chart"', () => {
      expect(slugifyComponentName("Pie Chart")).toBe("pie-chart");
    });

    it('"TextField" → "text-field"', () => {
      expect(slugifyComponentName("TextField")).toBe("text-field");
    });

    it('"ic_arrow" → "ic-arrow"', () => {
      expect(slugifyComponentName("ic_arrow")).toBe("ic-arrow");
    });

    it('"Button" → "button"', () => {
      expect(slugifyComponentName("Button")).toBe("button");
    });

    it('"HTTPSConfig" → "https-config"', () => {
      expect(slugifyComponentName("HTTPSConfig")).toBe("https-config");
    });

    it('"PieChart3D" → "pie-chart-3d"', () => {
      expect(slugifyComponentName("PieChart3D")).toBe("pie-chart-3d");
    });
  });
});
