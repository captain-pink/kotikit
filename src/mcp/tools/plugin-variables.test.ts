import { afterEach, describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeConfig } from "../../config/load.js";
import { defaultConfig } from "../../config/schema.js";
import { variablesJsonPath } from "../../util/paths.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerPluginVariableTools } from "./plugin-variables.js";

const roots: string[] = [];

const mkRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "kotikit-plugin-vars-tool-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const callTool = async (registry: ToolRegistry, name: string, args: unknown) => {
  const handler = registry.handlers.get(name);
  if (handler === undefined) throw new Error(`missing handler ${name}`);
  return handler(args);
};

describe("kotikit_sync_plugin_variables", () => {
  it("imports plugin-exported variables through the MCP bridge tool", async () => {
    const root = mkRoot();
    const cfg = defaultConfig();
    await writeConfig(root, cfg);

    const registry = makeRegistry();
    const ctx: ToolContext = { root, loadConfig: async () => cfg };
    registerPluginVariableTools(registry, ctx);

    const result = await callTool(registry, "kotikit_sync_plugin_variables", {
      payload: {
        version: 1,
        source: { fileName: "Design System" },
        collections: [{ id: "c1", name: "Theme", modes: [{ modeId: "m1", name: "Default" }] }],
        variables: [
          {
            id: "v1",
            name: "color/brand",
            resolvedType: "COLOR",
            variableCollectionId: "c1",
            valuesByMode: { m1: { r: 0, g: 0.2, b: 1, a: 1 } },
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain("Imported 1 Figma variable");
    expect(result.content[0]?.text).toContain("design-system/variables.json");

    const saved = JSON.parse(readFileSync(variablesJsonPath(root), "utf-8")) as {
      entries: Array<{ name: string; source: string }>;
    };
    expect(saved.entries).toContainEqual(
      expect.objectContaining({ name: "color/brand", source: "variable" })
    );
  });

  it("asks users to initialize kotikit before importing plugin variables", async () => {
    const root = mkRoot();
    const registry = makeRegistry();
    const ctx: ToolContext = { root, loadConfig: async () => null };
    registerPluginVariableTools(registry, ctx);

    const result = await callTool(registry, "kotikit_sync_plugin_variables", {
      payload: { version: 1, collections: [], variables: [] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Kotikit isn't set up");
  });
});
