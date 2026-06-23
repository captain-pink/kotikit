import { afterAll, describe, expect, it } from "bun:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AuditReportSchema } from "../../audit/schema.js";
import { initRegistryDb, upsertRegistry } from "../../db/registry-db.js";
import { openDb } from "../../db/sqlite.js";
import { registryDbPath } from "../../util/paths.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { registerAuditTools } from "./audit.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-audit-tool-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeRegistry(): ToolRegistry {
  return { tools: [] as Tool[], handlers: new Map() };
}
function makeCtx(root: string): ToolContext {
  return { root, loadConfig: async () => null };
}
async function callTool(registry: ToolRegistry, name: string, args: unknown) {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error("missing handler " + name);
  return handler(args);
}
function parseDetail(text: string): unknown {
  const i = text.indexOf("\n\n");
  if (i === -1) return {};
  return JSON.parse(text.slice(i + 2));
}

describe("kotikit_audit", () => {
  it("empty registry: friendly error 'No registry yet'", async () => {
    const root = mkTmp();
    const registry = makeRegistry();
    registerAuditTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_audit", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("No registry");
  });

  it("registry with 4 different rows produces correct summary + writes report file", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Input",
      dsPath: "components/input.json",
      codePath: null,
      status: "design-only",
    });
    upsertRegistry(db, {
      kind: "component",
      name: "Header",
      dsPath: null,
      codePath: "src/components/Header.tsx",
      status: "code-only",
    });
    upsertRegistry(db, {
      kind: "screen",
      name: "ProfilePage",
      dsPath: null,
      codePath: "src/components/profile-page/ProfilePage.tsx",
      status: "code-only",
    });
    db.close();

    const registry = makeRegistry();
    registerAuditTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_audit", {});
    expect(result.isError).toBeFalsy();

    // Report on disk
    const reportPath = join(root, ".kotikit/audit-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(() => AuditReportSchema.parse(parsed)).not.toThrow();

    // Summary in text
    expect(result.content[0]?.text).toContain("2 entries"); // screen excluded
    expect(result.content[0]?.text).toContain("1 design-only");
    expect(result.content[0]?.text).toContain("1 code-only");
  });

  it("report includes the entries", async () => {
    const root = mkTmp();
    const db = openDb(registryDbPath(root));
    initRegistryDb(db);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: null,
      status: "design-only",
    });
    db.close();

    const registry = makeRegistry();
    registerAuditTools(registry, makeCtx(root));
    const result = await callTool(registry, "kotikit_audit", {});
    const detail = parseDetail(result.content[0]!.text) as {
      report: { entries: { name: string }[] };
    };
    expect(detail.report.entries[0]?.name).toBe("Button");
  });
});
