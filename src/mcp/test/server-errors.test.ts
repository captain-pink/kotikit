import { describe, expect, it } from "bun:test";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
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
});
