import { describe, expect, it } from "bun:test";
import { KotikitError, toolError, toolText } from "./result";

describe("result helpers", () => {
  describe("toolText", () => {
    it("returns a single text block starting with the summary", () => {
      const r = toolText("Saved.");
      expect(r.content).toHaveLength(1);
      expect(r.content[0].type).toBe("text");
      expect(r.content[0].text).toBe("Saved.");
    });

    it("includes pretty-printed detail JSON after the summary", () => {
      const r = toolText("Saved.", { ok: true });
      expect(r.content[0].text).toContain("Saved.");
      expect(r.content[0].text).toContain('"ok": true');
    });
  });

  describe("toolError", () => {
    it("surfaces KotikitError.userMessage", () => {
      const r = toolError(new KotikitError("No screen named 'cart'"));
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("No screen named 'cart'");
    });

    it("includes hint on second line", () => {
      const r = toolError(new KotikitError("No screen named 'cart'", "Try: shipping, payment"));
      expect(r.content[0].text).toContain("No screen named 'cart'");
      expect(r.content[0].text).toContain("Try: shipping, payment");
    });

    it("does not leak ENOENT from system errors", () => {
      const r = toolError(new Error("ENOENT: no such file or directory"));
      expect(r.isError).toBe(true);
      expect(r.content[0].text).not.toContain("ENOENT");
    });

    it("returns a friendly generic message for unknown errors", () => {
      const r = toolError(new Error("something internal"));
      expect(r.content[0].text).toContain("Something went wrong");
    });
  });
});
