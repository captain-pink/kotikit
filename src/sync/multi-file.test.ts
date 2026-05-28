import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { syncAllFiles } from "./multi-file.js";
import { FigmaClient } from "./figma-client.js";
import { createLimiter } from "./rate-limit.js";
import { SyncManifestSchema } from "./manifest.js";
import { manifestPath, componentJsonPath, variablesJsonPath, syncReportPath } from "../util/paths.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-multifile-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

const FAST = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 };

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Builds a fetch stub from a per-file URL handler map. */
function makeFetch(fileResponses: Record<string, Record<string, () => unknown>>): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    for (const [fileKey, handlers] of Object.entries(fileResponses)) {
      if (u.includes(`/v1/files/${fileKey}/components`)) return jsonRes(handlers.components?.() ?? { meta: { components: [] } });
      if (u.includes(`/v1/files/${fileKey}/component_sets`)) return jsonRes(handlers.component_sets?.() ?? { meta: { component_sets: [] } });
      if (u.includes(`/v1/files/${fileKey}/styles`)) return jsonRes(handlers.styles?.() ?? { meta: { styles: [] } });
      if (u.includes(`/v1/files/${fileKey}/variables/local`)) {
        const body = handlers.variables?.() ?? { meta: { variables: {}, variableCollections: {} } };
        return jsonRes(body);
      }
      if (u.includes(`/v1/files/${fileKey}/nodes`)) return jsonRes(handlers.nodes?.() ?? { nodes: {} });
      if (u.endsWith(`/v1/files/${fileKey}`)) return jsonRes(handlers.file?.() ?? { name: fileKey, document: { children: [] } });
    }
    throw new Error("no fixture for " + u);
  }) as unknown as typeof globalThis.fetch;
}

describe("syncAllFiles", () => {
  it("two files publishing Button: only one Button row, conflict recorded, later file wins", async () => {
    const root = mkTmp();

    const fileResponses = {
      FA: {
        file: () => ({ name: "FileA", document: { children: [{ id: "p1", name: "Components", children: [{ id: "btnA", name: "Button" }] }] } }),
        components: () => ({ meta: { components: [{ key: "ckA", node_id: "btnA", name: "Button" }] } }),
      },
      FB: {
        file: () => ({ name: "FileB", document: { children: [{ id: "p1", name: "Components", children: [{ id: "btnB", name: "Button" }] }] } }),
        components: () => ({ meta: { components: [{ key: "ckB", node_id: "btnB", name: "Button" }] } }),
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
      files: [{ key: "FA", name: "FileA" }, { key: "FB", name: "FileB" }],
      client,
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
  });

  it("writes variables.json (possibly empty) and a sync-report.json", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({ FX: {} }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    await syncAllFiles({ root, files: [{ key: "FX", name: "FX" }], client });
    expect(existsSync(variablesJsonPath(root))).toBe(true);
    expect(existsSync(syncReportPath(root))).toBe(true);
  });

  it("clears the checkpoint on successful completion", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({ FX: {} }),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    await syncAllFiles({ root, files: [{ key: "FX", name: "FX" }], client });
    expect(existsSync(`${root}/design-system/.sync-checkpoint.json`)).toBe(false);
  });

  it("with no files: returns an empty report and writes empty artifacts", async () => {
    const root = mkTmp();
    const client = new FigmaClient({
      token: "tkn",
      fetch: makeFetch({}),
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const report = await syncAllFiles({ root, files: [], client });
    expect(report.files).toEqual([]);
    expect(report.conflicts).toEqual([]);
  });
});
