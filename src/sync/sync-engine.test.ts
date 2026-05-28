import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { syncOneFile } from "./sync-engine.js";
import { initComponentsDb } from "../db/components-db.js";
import { initIconsDb } from "../db/icons-db.js";
import { FigmaClient } from "./figma-client.js";
import { createLimiter } from "./rate-limit.js";

const FAST = { initialMs: 1, maxMs: 5, jitterMs: 0, maxAttempts: 3 };

function makeDbs() {
  const componentsDb = new Database(":memory:");
  const iconsDb = new Database(":memory:");
  initComponentsDb(componentsDb);
  initIconsDb(iconsDb);
  return { componentsDb, iconsDb };
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("syncOneFile", () => {
  it("happy path: 3 components + 2 icons", async () => {
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      // Most specific first
      if (u.includes("/v1/files/F1/components")) {
        return jsonRes({
          meta: {
            components: [
              { key: "ck1", node_id: "nButton", name: "Button" },
              { key: "ck2", node_id: "nCard", name: "Card" },
              { key: "ck3", node_id: "nInput", name: "Input" },
              { key: "ck4", node_id: "nArr", name: "arrow-right" },
              { key: "ck5", node_id: "nArl", name: "arrow-left" },
            ],
          },
        });
      }
      if (u.includes("/v1/files/F1/component_sets")) {
        return jsonRes({ meta: { component_sets: [] } });
      }
      if (u.includes("/v1/files/F1/styles")) {
        return jsonRes({ meta: { styles: [] } });
      }
      if (u.includes("/v1/files/F1/variables/local")) {
        return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      }
      if (u.includes("/v1/files/F1/nodes")) {
        return jsonRes({ nodes: {} });
      }
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "TestFile",
          document: {
            children: [
              {
                id: "page1",
                name: "Components",
                children: [
                  { id: "nButton", name: "Button" },
                  { id: "nCard", name: "Card" },
                  { id: "nInput", name: "Input" },
                ],
              },
              {
                id: "page2",
                name: "Icons",
                children: [
                  { id: "nArr", name: "arrow-right" },
                  { id: "nArl", name: "arrow-left" },
                ],
              },
            ],
          },
        });
      }
      throw new Error("no match: " + u);
    }) as unknown as typeof globalThis.fetch;

    const client = new FigmaClient({
      token: "tkn",
      fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const { componentsDb, iconsDb } = makeDbs();
    const result = await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "TestFile",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(3);
    expect(result.iconCount).toBe(2);
    expect(result.componentJsons.map((c) => c.name).sort()).toEqual(["Button", "Card", "Input"]);
  });

  it("resume: a checkpoint at 'styles' stage skips earlier stages", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calls.push(u);
      if (u.includes("/styles")) {
        return new Response(JSON.stringify({ meta: { styles: [] } }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (u.includes("/variables/local")) {
        return new Response(
          JSON.stringify({ meta: { variables: {}, variableCollections: {} } }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      }
      if (u.includes("/nodes")) {
        return new Response(JSON.stringify({ nodes: {} }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      throw new Error("Unexpected call before resume point: " + u);
    }) as unknown as typeof globalThis.fetch;

    const client = new FigmaClient({
      token: "tkn",
      fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const { componentsDb, iconsDb } = makeDbs();
    await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "TestFile",
      componentsDb,
      iconsDb,
      resumeFrom: { fileKey: "F1", stage: "styles" },
    });
    // Should have called /styles and /variables/local
    expect(calls.some((c) => c.includes("/styles"))).toBe(true);
    // Should NOT have called base file, /components, or /component_sets
    expect(
      calls.every(
        (c) =>
          !c.match(/\/v1\/files\/F1$/) &&
          !c.includes("/components") &&
          !c.includes("/component_sets")
      )
    ).toBe(true);
  });

  it("variables 403 surfaces as a skipped stage", async () => {
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/variables/local")) {
        return new Response(JSON.stringify({}), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/styles")) {
        return new Response(JSON.stringify({ meta: { styles: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/nodes")) {
        return new Response(JSON.stringify({ nodes: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/components")) {
        return new Response(JSON.stringify({ meta: { components: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/component_sets")) {
        return new Response(JSON.stringify({ meta: { component_sets: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // root file
      return new Response(
        JSON.stringify({ name: "x", document: { children: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof globalThis.fetch;

    const client = new FigmaClient({
      token: "tkn",
      fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const { componentsDb, iconsDb } = makeDbs();
    const result = await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "x",
      componentsDb,
      iconsDb,
    });
    expect(result.skipped.some((s) => s.stage === "variables")).toBe(true);
  });

  it("onStage receives a callback per completed stage", async () => {
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/components")) {
        return jsonRes({ meta: { components: [] } });
      }
      if (u.includes("/component_sets")) {
        return jsonRes({ meta: { component_sets: [] } });
      }
      if (u.includes("/styles")) {
        return jsonRes({ meta: { styles: [] } });
      }
      if (u.includes("/variables/local")) {
        return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      }
      if (u.includes("/nodes")) {
        return jsonRes({ nodes: {} });
      }
      // root file — most general, matched last
      if (u.includes("/v1/files/F1")) {
        return jsonRes({ name: "x", document: { children: [] } });
      }
      throw new Error("no match: " + u);
    }) as unknown as typeof globalThis.fetch;

    const client = new FigmaClient({
      token: "tkn",
      fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const { componentsDb, iconsDb } = makeDbs();
    const stages: string[] = [];
    await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "x",
      componentsDb,
      iconsDb,
      onStage: (stage) => {
        stages.push(stage);
      },
    });
    expect(stages).toContain("metadata");
    expect(stages).toContain("components");
    expect(stages).toContain("component_sets");
    expect(stages).toContain("styles");
    expect(stages).toContain("variables");
    expect(stages).toContain("done");
  });
});
