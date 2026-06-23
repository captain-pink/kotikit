import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRegistryDb, upsertRegistry } from "../../db/registry-db.js";
import { runAudit } from "../engine.js";
import { AuditReportSchema } from "../schema.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-audit-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function seedDsJson(root: string, name: string, axes: string[]): void {
  const slug = name.toLowerCase();
  const dir = `${root}/design-system/components`;
  mkdirSync(dir, { recursive: true });
  const json = {
    name,
    key: `k-${slug}`,
    fileKey: "f",
    path: `components/${slug}.json`,
    variants: axes.map((a) => ({ propertyName: a, values: ["a"] })),
    properties: {},
    updatedAt: "2026-05-29T00:00:00.000Z",
  };
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(json, null, 2));
}

function seedCodeFile(root: string, codePath: string, cvaAxes: string[]): void {
  const abs = join(root, codePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  const variantsObj = cvaAxes.map((a) => `${a}: { primary: "" }`).join(", ");
  const content = `import { cva } from "class-variance-authority";\n\nconst x = cva("", { variants: { ${variantsObj} }, defaultVariants: {} });\n`;
  writeFileSync(abs, content);
}

describe("runAudit", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    initRegistryDb(db);
  });

  it("registry with matching variants → synced-ok", async () => {
    const root = mkTmp();
    seedDsJson(root, "Button", ["Variant", "Size"]);
    seedCodeFile(root, "src/components/ui/button.tsx", ["variant", "size"]);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: "src/components/ui/button.tsx",
      status: "synced",
    });

    const report = await runAudit({ root, registryDb: db });
    expect(report.summary.syncedOk).toBe(1);
    expect(report.entries[0]?.outcome).toBe("synced-ok");
  });

  it("registry where DS has [Variant, Size] and code has [Variant] → synced-mismatched", async () => {
    const root = mkTmp();
    seedDsJson(root, "Button", ["Variant", "Size"]);
    seedCodeFile(root, "src/components/ui/button.tsx", ["variant"]);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: "src/components/ui/button.tsx",
      status: "synced",
    });

    const report = await runAudit({ root, registryDb: db });
    expect(report.summary.syncedMismatched).toBe(1);
    const entry = report.entries[0];
    if (entry === undefined) throw new Error("Expected one audit entry.");
    expect(entry.outcome).toBe("synced-mismatched");
    expect(entry.variantDelta?.dsOnly).toEqual(["size"]);
    expect(entry.variantDelta?.codeOnly).toEqual([]);
  });

  it("design-only row stays design-only", async () => {
    const root = mkTmp();
    upsertRegistry(db, {
      kind: "component",
      name: "Card",
      dsPath: "components/card.json",
      codePath: null,
      status: "design-only",
    });
    const report = await runAudit({ root, registryDb: db });
    expect(report.summary.designOnly).toBe(1);
    expect(report.entries[0]?.outcome).toBe("design-only");
  });

  it("code-only row stays code-only", async () => {
    const root = mkTmp();
    upsertRegistry(db, {
      kind: "component",
      name: "Header",
      dsPath: null,
      codePath: "src/components/Header.tsx",
      status: "code-only",
    });
    const report = await runAudit({ root, registryDb: db });
    expect(report.summary.codeOnly).toBe(1);
    expect(report.entries[0]?.outcome).toBe("code-only");
  });

  it("missing DS JSON on a synced row → reclassified as code-only", async () => {
    const root = mkTmp();
    seedCodeFile(root, "src/components/ui/button.tsx", ["variant"]);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: "src/components/ui/button.tsx",
      status: "synced",
    });
    const report = await runAudit({ root, registryDb: db });
    expect(report.summary.codeOnly).toBe(1);
    expect(report.entries[0]?.outcome).toBe("code-only");
  });

  it("missing code file on a synced row → reclassified as design-only", async () => {
    const root = mkTmp();
    seedDsJson(root, "Button", ["Variant"]);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: "src/components/ui/button.tsx",
      status: "synced",
    });
    const report = await runAudit({ root, registryDb: db });
    expect(report.summary.designOnly).toBe(1);
    expect(report.entries[0]?.outcome).toBe("design-only");
  });

  it("mixed fixture: 4 outcomes counted correctly", async () => {
    const root = mkTmp();
    // synced-ok
    seedDsJson(root, "Button", ["Variant"]);
    seedCodeFile(root, "src/components/ui/button.tsx", ["variant"]);
    upsertRegistry(db, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: "src/components/ui/button.tsx",
      status: "synced",
    });
    // synced-mismatched
    seedDsJson(root, "Card", ["Variant", "Size"]);
    seedCodeFile(root, "src/components/ui/card.tsx", ["variant"]);
    upsertRegistry(db, {
      kind: "component",
      name: "Card",
      dsPath: "components/card.json",
      codePath: "src/components/ui/card.tsx",
      status: "synced",
    });
    // design-only
    upsertRegistry(db, {
      kind: "component",
      name: "Input",
      dsPath: "components/input.json",
      codePath: null,
      status: "design-only",
    });
    // code-only
    upsertRegistry(db, {
      kind: "component",
      name: "Header",
      dsPath: null,
      codePath: "src/components/Header.tsx",
      status: "code-only",
    });
    // screen kind should NOT appear in the audit
    upsertRegistry(db, {
      kind: "screen",
      name: "ProfilePage",
      dsPath: null,
      codePath: "src/components/profile-page/ProfilePage.tsx",
      status: "code-only",
    });

    const report = await runAudit({ root, registryDb: db });
    expect(report.entries).toHaveLength(4); // screen row excluded
    expect(report.summary).toEqual({
      syncedOk: 1,
      syncedMismatched: 1,
      designOnly: 1,
      codeOnly: 1,
    });
    expect(AuditReportSchema.parse(report)).toBeDefined();
  });

  it("empty registry produces empty report", async () => {
    const root = mkTmp();
    const report = await runAudit({ root, registryDb: db });
    expect(report.entries).toEqual([]);
    expect(report.summary).toEqual({
      syncedOk: 0,
      syncedMismatched: 0,
      designOnly: 0,
      codeOnly: 0,
    });
  });
});
