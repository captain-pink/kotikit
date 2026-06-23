import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../../../config/load.js";
import { readCurrentWorkflowSession } from "../../../workflow/workflow-store.js";
import type { ToolContext } from "../../context.js";
import type { ToolRegistry } from "../../server.js";
import { registerWorkflowTools } from "../workflow.js";

const tmpDirs: string[] = [];

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-workflow-tool-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

const makeRegistry = (): ToolRegistry => ({ tools: [] as Tool[], handlers: new Map() });

const makeCtx = (root: string): ToolContext => ({
  root,
  loadConfig: () => loadConfig(root),
});

const callTool = async (registry: ToolRegistry, name: string, args: unknown) => {
  const handler = registry.handlers.get(name);
  if (handler === undefined) throw new Error(`missing handler ${name}`);
  return handler(args);
};

const detailOf = (text: string): Record<string, unknown> => {
  const [, json] = text.split("\n\n");
  if (json === undefined) throw new Error(`missing detail JSON in ${text}`);
  return JSON.parse(json) as Record<string, unknown>;
};

describe("workflow tools", () => {
  it("starts a compact workflow and stores it as current", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerWorkflowTools(registry, makeCtx(root));

    const result = await callTool(registry, "kotikit_workflow_start", {
      intent: "sync-design-system",
    });
    const detail = detailOf(result.content[0]?.text ?? "");
    const next = detail.next as Record<string, unknown>;
    const session = await readCurrentWorkflowSession(root);

    expect(result.isError).toBeFalsy();
    expect(session?.intent).toBe("sync-design-system");
    expect(next.phase).toBe("setup");
    expect(JSON.stringify(detail)).not.toContain("history");
  });

  it("returns the next action for the current workflow", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerWorkflowTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_workflow_start", {
      intent: "create-design",
      scope: "members",
    });

    const result = await callTool(registry, "kotikit_workflow_next", {});
    const detail = detailOf(result.content[0]?.text ?? "");
    const next = detail.next as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(next.phase).toBe("setup");
    expect(next.allowedTools).toEqual(["kotikit_config_init"]);
  });

  it("records only the latest workflow event", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerWorkflowTools(registry, makeCtx(root));
    await callTool(registry, "kotikit_workflow_start", {
      intent: "create-design",
      scope: "members",
    });

    await callTool(registry, "kotikit_workflow_event", {
      event: "user-approved-literal-fallback",
      summary: "Designer approved literals.",
    });
    const result = await callTool(registry, "kotikit_workflow_event", {
      event: "user-selected-component-mode",
      summary: "Designer chose reusable components.",
    });
    const detail = detailOf(result.content[0]?.text ?? "");
    const session = detail.session as Record<string, unknown>;
    const lastEvent = session.lastEvent as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(lastEvent.event).toBe("user-selected-component-mode");
    expect(JSON.stringify(detail)).not.toContain("Designer approved literals");
  });
});
