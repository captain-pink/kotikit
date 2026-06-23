import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRegistry, initRegistryDb, upsertRegistry } from "../db/registry-db.js";
import { openDb } from "../db/sqlite.js";
import {
  checkpointPath,
  componentJsonPath,
  manifestPath,
  registryDbPath,
  syncReportPath,
  variablesJsonPath,
} from "../util/paths.js";
import { SyncPausedError } from "./errors.js";
import { FigmaClient } from "./figma-client.js";
import { SyncManifestSchema } from "./manifest.js";
import { syncAllFiles } from "./multi-file.js";
import { nullProgressEmitter, recordingProgressEmitter } from "./progress.js";
import { createLimiter } from "./rate-limit.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-multifile-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const FAST = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 };

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Builds a fetch stub from a per-file URL handler map. */
function makeFetch(
  fileResponses: Record<string, Record<string, () => unknown>>
): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    for (const [fileKey, handlers] of Object.entries(fileResponses)) {
      if (u.includes(`/v1/files/${fileKey}/components`))
        return jsonRes(handlers.components?.() ?? { meta: { components: [] } });
      if (u.includes(`/v1/files/${fileKey}/component_sets`))
        return jsonRes(handlers.component_sets?.() ?? { meta: { component_sets: [] } });
      if (u.includes(`/v1/files/${fileKey}/styles`))
        return jsonRes(handlers.styles?.() ?? { meta: { styles: [] } });
      if (u.includes(`/v1/files/${fileKey}/variables/local`)) {
        const body = handlers.variables?.() ?? { meta: { variables: {}, variableCollections: {} } };
        return jsonRes(body);
      }
      if (u.includes(`/v1/files/${fileKey}/nodes`))
        return jsonRes(handlers.nodes?.() ?? { nodes: {} });
      if (u.includes(`/v1/files/${fileKey}`) && !u.includes(`/v1/files/${fileKey}/`))
        return jsonRes(handlers.file?.() ?? { name: fileKey, document: { children: [] } });
    }
    throw new Error(`no fixture for ${u}`);
  }) as unknown as typeof globalThis.fetch;
}

describe("syncAllFiles", () => {
  it("two files publishing Button: only one Button row, conflict recorded, later file wins", async () => {
    const root = mkTmp();

    const fileResponses = {
      FA: {
        file: () => ({
          name: "FileA",
          document: {
            children: [
              { id: "p1", name: "Components", children: [{ id: "btnA", name: "Button" }] },
            ],
          },
        }),
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "btnA", name: "Button" }] },
        }),
      },
      FB: {
        file: () => ({
          name: "FileB",
          document: {
            children: [
              { id: "p1", name: "Components", children: [{ id: "btnB", name: "Button" }] },
            ],
          },
        }),
        components: () => ({
          meta: { components: [{ key: "ckB", node_id: "btnB", name: "Button" }] },
        }),
      },
    };

    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    const report = await syncAllFiles({
      root,
      files: [
        { key: "FA", name: "FileA" },
        { key: "FB", name: "FileB" },
      ],
      client,
      progress: nullProgressEmitter(),
    });

    // Manifest exists and validates
    const manifestRaw = JSON.parse(readFileSync(manifestPath(root), "utf-8"));
    const manifest = SyncManifestSchema.parse(manifestRaw);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.conflicts).toHaveLength(1);
    expect(manifest.conflicts[0]?.name).toBe("Button");
    expect(manifest.conflicts[0]?.winnerFileKey).toBe("FB");

    // The button.json reflects the winner
    const buttonJson = JSON.parse(readFileSync(componentJsonPath(root, "button"), "utf-8"));
    expect(buttonJson.fileKey).toBe("FB");
    expect(buttonJson.key).toBe("ckB");

    // Report says the same
    expect(report.conflicts).toHaveLength(1);
    // Report includes registry update counts
    expect(report.registryUpdates).toBeDefined();
    expect(typeof report.registryUpdates.added).toBe("number");
    expect(typeof report.registryUpdates.updated).toBe("number");
  });

  it("writes variables.json (possibly empty) and a sync-report.json", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({ FX: {} }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    await syncAllFiles({
      root,
      files: [{ key: "FX", name: "FX" }],
      client,
      progress: nullProgressEmitter(),
    });
    expect(existsSync(variablesJsonPath(root))).toBe(true);
    expect(existsSync(syncReportPath(root))).toBe(true);
  });

  it("writes normalization diagnostics to the sync report", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({
        FX: {
          file: () => ({
            name: "FX",
            document: {
              children: [
                { id: "p1", name: "Components", children: [{ id: "button-1", name: "Button" }] },
              ],
            },
          }),
          components: () => ({
            meta: {
              components: [
                {
                  key: "button-key",
                  node_id: "button-1",
                  name: "Size=Medium, Variant=Filled",
                  containing_frame: {
                    pageName: "Components",
                    containingComponentSet: { nodeId: "button-set", name: "Button" },
                  },
                },
              ],
            },
          }),
        },
      }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    const report = await syncAllFiles({
      root,
      files: [{ key: "FX", name: "FX" }],
      client,
      progress: nullProgressEmitter(),
    });
    const reportOnDisk = JSON.parse(readFileSync(syncReportPath(root), "utf-8"));

    expect(report.normalizationDiagnostics[0]).toMatchObject({
      fileKey: "FX",
      publishedComponentCount: 1,
      componentCount: 1,
      iconCount: 0,
    });
    expect(reportOnDisk.normalizationDiagnostics[0].warnings[0]).toMatchObject({
      code: "inferred-variants",
      count: 1,
    });
  });

  it("clears the checkpoint on successful completion", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({ FX: {} }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    await syncAllFiles({
      root,
      files: [{ key: "FX", name: "FX" }],
      client,
      progress: nullProgressEmitter(),
    });
    expect(existsSync(`${root}/design-system/.sync-checkpoint.json`)).toBe(false);
  });

  it("pauses near the soft deadline after a node-details batch checkpoint is written", async () => {
    const root = mkTmp();
    const components = Array.from({ length: 101 }, (_, index) => ({
      key: `component-key-${index}`,
      node_id: `component-node-${index}`,
      name: `Component ${index}`,
    }));
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({
        FX: {
          file: () => ({
            name: "FX",
            document: {
              children: [
                {
                  id: "page-1",
                  name: "Components",
                  children: components.map((component) => ({
                    id: component.node_id,
                    name: component.name,
                  })),
                },
              ],
            },
          }),
          components: () => ({ meta: { components } }),
          nodes: () => {
            now = 1_001;
            return { nodes: {} };
          },
        },
      }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    try {
      await expect(
        syncAllFiles({
          root,
          files: [{ key: "FX", name: "FX" }],
          client,
          progress: nullProgressEmitter(),
          softDeadlineMs: 1,
        })
      ).rejects.toBeInstanceOf(SyncPausedError);

      const checkpoint = JSON.parse(readFileSync(checkpointPath(root), "utf-8"));
      expect(checkpoint.files[0]).toMatchObject({
        fileKey: "FX",
        stage: "node_details",
        cursor: { processed: 100, batchSize: 100 },
      });
      expect(existsSync(manifestPath(root))).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it("clears the checkpoint after a non-pause sync crash", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({
        FX: {
          components: () => ({ meta: { components: [] } }),
          component_sets: () => ({ meta: { component_sets: [] } }),
          styles: () => {
            throw new Error("network failed");
          },
        },
      }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    await expect(
      syncAllFiles({
        root,
        files: [{ key: "FX", name: "FX" }],
        client,
        progress: nullProgressEmitter(),
      })
    ).rejects.toThrow("network failed");

    expect(existsSync(checkpointPath(root))).toBe(false);
  });

  it("with no files: returns an empty report and writes empty artifacts", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({}),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const report = await syncAllFiles({ root, files: [], client, progress: nullProgressEmitter() });
    expect(report.files).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(report.registryUpdates).toEqual({ added: 0, updated: 0 });
  });

  it("fresh sync populates registry with design-only rows", async () => {
    const root = mkTmp();

    const fileResponses = {
      FA: {
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "nA", name: "Button" }] },
        }),
        file: () => ({
          name: "FileA",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nA", name: "Button" }] }],
          },
        }),
      },
      FB: {
        components: () => ({ meta: { components: [{ key: "ckB", node_id: "nB", name: "Card" }] } }),
        file: () => ({
          name: "FileB",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nB", name: "Card" }] }],
          },
        }),
      },
    };

    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    const report = await syncAllFiles({
      root,
      files: [
        { key: "FA", name: "FileA" },
        { key: "FB", name: "FileB" },
      ],
      client,
      progress: nullProgressEmitter(),
    });

    // Open the registry and assert two design-only component rows
    const regDb = new Database(registryDbPath(root), { readonly: true });
    const button = getRegistry(regDb, "component", "Button");
    const card = getRegistry(regDb, "component", "Card");
    regDb.close();

    expect(button?.status).toBe("design-only");
    expect(button?.dsPath).toBe("components/button.json");
    expect(card?.status).toBe("design-only");
    expect(card?.dsPath).toBe("components/card.json");

    // Report counts should reflect adds
    expect(report.registryUpdates.added).toBe(2);
    expect(report.registryUpdates.updated).toBe(0);
  });

  it("persists registry rows before fileDone is emitted", async () => {
    const root = mkTmp();
    let sawRegistryAtFileDone = false;

    const fileResponses = {
      FA: {
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "nA", name: "Button" }] },
        }),
        file: () => ({
          name: "FileA",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nA", name: "Button" }] }],
          },
        }),
      },
    };

    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    const progress = {
      ...nullProgressEmitter(),
      fileDone() {
        const regDb = new Database(registryDbPath(root), { readonly: true });
        const button = getRegistry(regDb, "component", "Button");
        regDb.close();
        expect(button?.status).toBe("design-only");
        expect(button?.dsPath).toBe("components/button.json");
        sawRegistryAtFileDone = true;
      },
    };

    await syncAllFiles({
      root,
      files: [{ key: "FA", name: "FileA" }],
      client,
      progress,
    });

    expect(sawRegistryAtFileDone).toBe(true);
  });

  it("re-sync preserves synced rows (does not downgrade or clobber code_path)", async () => {
    const root = mkTmp();

    // First, manually seed the registry with a synced row for Button
    // (simulating a prior scaffold run)
    const regDb = openDb(registryDbPath(root));
    initRegistryDb(regDb);
    upsertRegistry(regDb, {
      kind: "component",
      name: "Button",
      dsPath: "components/button.json",
      codePath: "src/components/ui/button.tsx",
      status: "synced",
    });
    regDb.close();

    // Now run sync with Button as a DS component
    const fileResponses = {
      FA: {
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "nA", name: "Button" }] },
        }),
        file: () => ({
          name: "FileA",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nA", name: "Button" }] }],
          },
        }),
      },
    };

    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    await syncAllFiles({
      root,
      files: [{ key: "FA", name: "FileA" }],
      client,
      progress: nullProgressEmitter(),
    });

    // Assert: Button is still synced, code_path unchanged
    const regDb2 = new Database(registryDbPath(root), { readonly: true });
    const button = getRegistry(regDb2, "component", "Button");
    regDb2.close();

    expect(button?.status).toBe("synced");
    expect(button?.codePath).toBe("src/components/ui/button.tsx");
  });

  it("re-sync of a screen-kind code-only row does not affect component kind rows", async () => {
    const root = mkTmp();

    // Seed the registry with a screen-kind code-only row named "Button"
    // (shouldn't happen in practice but tests kind separation)
    const regDb = openDb(registryDbPath(root));
    initRegistryDb(regDb);
    upsertRegistry(regDb, {
      kind: "screen",
      name: "Button",
      dsPath: null,
      codePath: "src/screens/Button.tsx",
      status: "code-only",
    });
    regDb.close();

    // Run sync with a DS Button component
    const fileResponses = {
      FA: {
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "nA", name: "Button" }] },
        }),
        file: () => ({
          name: "FileA",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nA", name: "Button" }] }],
          },
        }),
      },
    };

    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    await syncAllFiles({
      root,
      files: [{ key: "FA", name: "FileA" }],
      client,
      progress: nullProgressEmitter(),
    });

    // Assert: the screen row is untouched (different kind)
    const regDb2 = new Database(registryDbPath(root), { readonly: true });
    const screenRow = getRegistry(regDb2, "screen", "Button");
    const componentRow = getRegistry(regDb2, "component", "Button");
    regDb2.close();

    expect(screenRow?.status).toBe("code-only");
    expect(screenRow?.codePath).toBe("src/screens/Button.tsx");
    // A new component row was inserted
    expect(componentRow?.status).toBe("design-only");
  });

  it("registryUpdates report counts adds vs updates correctly", async () => {
    const root = mkTmp();

    const fileResponses = {
      FA: {
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "nA", name: "Button" }] },
        }),
        file: () => ({
          name: "FileA",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nA", name: "Button" }] }],
          },
        }),
      },
    };

    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    // First run — expect added: 1, updated: 0
    const report1 = await syncAllFiles({
      root,
      files: [{ key: "FA", name: "FileA" }],
      client,
      progress: nullProgressEmitter(),
    });
    expect(report1.registryUpdates.added).toBe(1);
    expect(report1.registryUpdates.updated).toBe(0);

    // Second run — expect added: 0, updated: 1
    const report2 = await syncAllFiles({
      root,
      files: [{ key: "FA", name: "FileA" }],
      client,
      progress: nullProgressEmitter(),
    });
    expect(report2.registryUpdates.added).toBe(0);
    expect(report2.registryUpdates.updated).toBe(1);
  });

  it("recording emitter: syncStart → fileStart → ... → fileDone → syncDone fires once per file", async () => {
    const root = mkTmp();
    const fileResponses = {
      FA: {
        components: () => ({
          meta: { components: [{ key: "ckA", node_id: "nA", name: "Button" }] },
        }),
        file: () => ({
          name: "FileA",
          document: {
            children: [{ id: "p1", name: "Components", children: [{ id: "nA", name: "Button" }] }],
          },
        }),
      },
    };
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch(fileResponses),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });

    const { emitter, events } = recordingProgressEmitter();
    await syncAllFiles({
      root,
      files: [{ key: "FA", name: "FileA" }],
      client,
      progress: emitter,
    });

    const kinds = events.map((e) => e.kind);
    // Overall shape: syncStart comes first, syncDone comes last
    expect(kinds[0]).toBe("syncStart");
    expect(kinds[kinds.length - 1]).toBe("syncDone");
    // fileStart and fileDone each appear exactly once (one file)
    expect(kinds.filter((k) => k === "fileStart")).toHaveLength(1);
    expect(kinds.filter((k) => k === "fileDone")).toHaveLength(1);
    // fileStart precedes fileDone
    expect(kinds.indexOf("fileStart")).toBeLessThan(kinds.lastIndexOf("fileDone"));
    // fileDone precedes syncDone
    expect(kinds.lastIndexOf("fileDone")).toBeLessThan(kinds.lastIndexOf("syncDone"));
  });
});
