import { describe, expect, it } from "bun:test";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KotikitError } from "../../util/result.js";
import { toMcpRequestError } from "../server.js";

describe("toMcpRequestError", () => {
  it("preserves friendly KotikitError messages and hints", () => {
    const err = toMcpRequestError(new KotikitError("Unknown kotikit resource.", "List templates."));

    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain("Unknown kotikit resource.");
    expect(err.data).toEqual({ hint: "List templates." });
  });

  it("hides system errors behind a generic MCP internal error", () => {
    const err = toMcpRequestError(new Error("ENOENT secret path"));

    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(ErrorCode.InternalError);
    expect(err.message).not.toContain("ENOENT");
  });

  it("maps Zod validation errors to invalid params with the failing field path", () => {
    const schema = z.strictObject({
      input: z.strictObject({
        existingDesignInventory: z.strictObject({ schemaVersion: z.string() }),
      }),
    });
    const result = schema.safeParse({ input: { existingDesignInventory: "bad-shape" } });
    if (result.success) throw new Error("expected schema failure");

    const err = toMcpRequestError(result.error);

    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain("input.existingDesignInventory");
    expect(err.message).toContain("expected object");
  });
});
