import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { syncOneFile } from "./sync-engine.js";
import { initComponentsDb } from "../db/components-db.js";
import { initIconsDb } from "../db/icons-db.js";
import { FigmaClient } from "./figma-client.js";
import { createLimiter } from "./rate-limit.js";
import { recordingProgressEmitter } from "./progress.js";

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

function errorRes(status: number): Response {
  return new Response(JSON.stringify({ status, err: "Rate limit exceeded" }), {
    status,
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

  it("does not tree-sync unpublished libraries as usable design systems", async () => {
    const calledUrls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calledUrls.push(u);

      if (u.includes("/v1/files/F1/components")) return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });

      // Fallback page-tree fetch: /nodes?ids=page1&depth=4
      if (u.includes("/v1/files/F1/nodes") && u.includes("depth=4")) {
        return jsonRes({
          nodes: {
            "page1": {
              document: {
                id: "page1",
                name: "Components",
                type: "CANVAS",
                children: [
                  { id: "cBtn", name: "Button", type: "COMPONENT" },
                  { id: "cCard", name: "Card", type: "COMPONENT" },
                ],
              },
            },
          },
        });
      }
      // Node-details fetch (no depth param)
      if (u.includes("/v1/files/F1/nodes")) return jsonRes({ nodes: {} });
      // Metadata: shallow page list, no component children
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "Mat3",
          document: {
            children: [
              { id: "page1", name: "Components", type: "CANVAS", children: [] },
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
      fileName: "Mat3",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(0);
    expect(result.componentJsons).toEqual([]);
    expect(result.skipped.some((s) => s.reason.includes("not published as a library"))).toBe(true);

    // Unpublished files are not page-tree scraped for usable Figma DS output.
    expect(calledUrls.some((u) => u.includes("/nodes") && u.includes("depth=4"))).toBe(false);
    expect(calledUrls.every((u) => !/\/v1\/files\/F1\?/.test(u))).toBe(true);
  });

  it("does not fetch every page when published endpoints are empty", async () => {
    const calledUrls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calledUrls.push(u);

      if (u.includes("/v1/files/F1/components")) return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });

      if (u.includes("/v1/files/F1/nodes") && u.includes("depth=4")) {
        const ids = new URL(u, "http://x").searchParams.get("ids") ?? "";
        if (ids.includes("p1")) {
          return jsonRes({
            nodes: {
              "p1": {
                document: {
                  id: "p1", name: "Components", type: "CANVAS",
                  children: [{ id: "cBtn", name: "Button", type: "COMPONENT" }],
                },
              },
            },
          });
        }
        if (ids.includes("p2")) {
          return jsonRes({
            nodes: {
              "p2": {
                document: {
                  id: "p2", name: "Icons", type: "CANVAS",
                  children: [
                    { id: "ic1", name: "ic/arrow-right", type: "COMPONENT" },
                    { id: "ic2", name: "ic/arrow-left", type: "COMPONENT" },
                  ],
                },
              },
            },
          });
        }
      }
      if (u.includes("/v1/files/F1/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "Mat3",
          document: {
            children: [
              { id: "p1", name: "Components", type: "CANVAS", children: [] },
              { id: "p2", name: "Icons", type: "CANVAS", children: [] },
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
      fileName: "Mat3",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(0);
    expect(result.iconCount).toBe(0);
    expect(calledUrls.filter((u) => u.includes("depth=4")).length).toBe(0);
    expect(result.skipped.some((s) => s.reason.includes("not published as a library"))).toBe(true);
  });

  it("does not retry deeper page trees for unpublished libraries", async () => {
    const calledUrls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calledUrls.push(u);

      if (u.includes("/v1/files/F1/components")) return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });

      if (u.includes("/v1/files/F1/nodes") && u.includes("depth=4")) {
        return jsonRes({
          nodes: {
            "page1": {
              document: {
                id: "page1",
                name: "Buttons",
                type: "CANVAS",
                children: [{ id: "frame1", name: "Nested", type: "FRAME", children: [] }],
              },
            },
          },
        });
      }

      if (u.includes("/v1/files/F1/nodes") && u.includes("depth=8")) {
        return jsonRes({
          nodes: {
            "page1": {
              document: {
                id: "page1",
                name: "Buttons",
                type: "CANVAS",
                children: [
                  {
                    id: "frame1",
                    name: "Nested",
                    type: "FRAME",
                    children: [
                      {
                        id: "frame2",
                        name: "More nested",
                        type: "FRAME",
                        children: [
                          {
                            id: "csButton",
                            name: "Button",
                            type: "COMPONENT_SET",
                            children: [
                              { id: "vButton", name: "Button/Variant=Filled", type: "COMPONENT" },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        });
      }

      if (u.includes("/v1/files/F1/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "MUI",
          document: { children: [{ id: "page1", name: "Buttons", type: "CANVAS", children: [] }] },
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
      fileName: "MUI",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(0);
    expect(calledUrls.some((u) => u.includes("depth=4"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("depth=8"))).toBe(false);
    expect(result.skipped.some((s) => s.reason.includes("not published as a library"))).toBe(true);
  });

  it("does not call page-tree nodes for unpublished libraries", async () => {
    const calledUrls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calledUrls.push(u);
      if (u.includes("/v1/files/F1/components")) return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      if (u.includes("/v1/files/F1/nodes")) return errorRes(429);
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "MUI",
          document: { children: [{ id: "page1", name: "Buttons", type: "CANVAS", children: [] }] },
        });
      }
      throw new Error("no match: " + u);
    }) as unknown as typeof globalThis.fetch;

    const client = new FigmaClient({
      token: "tkn",
      fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 1 }),
      backoffOpts: FAST,
    });
    const { componentsDb, iconsDb } = makeDbs();

    const result = await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "MUI",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(0);
    expect(calledUrls.some((u) => u.includes("/nodes"))).toBe(false);
    expect(result.skipped.some((s) => s.reason.includes("not published as a library"))).toBe(true);
  });

  it("reports unpublished component-set trees as not usable for Figma draft generation", async () => {
    // Unpublished copied libraries can still contain real component-set trees, but
    // those local node IDs are not importable in generated Figma drafts.
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/v1/files/F1/components")) return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      if (u.includes("/v1/files/F1/nodes") && u.includes("depth=4")) {
        return jsonRes({
          nodes: {
            "page1": {
              document: {
                id: "page1", name: "Components", type: "CANVAS",
                children: [
                  {
                    id: "cs1", name: "Button", type: "COMPONENT_SET",
                    children: [
                      { id: "v1", name: "Button/Size=Small/Variant=Filled", type: "COMPONENT" },
                      { id: "v2", name: "Button/Size=Large/Variant=Filled", type: "COMPONENT" },
                    ],
                  },
                  {
                    id: "cs2", name: "TextField", type: "COMPONENT_SET",
                    children: [
                      { id: "v3", name: "TextField/State=Default", type: "COMPONENT" },
                    ],
                  },
                ],
              },
            },
          },
        });
      }
      if (u.includes("/v1/files/F1/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "MUI3",
          document: { children: [{ id: "page1", name: "Components", type: "CANVAS", children: [] }] },
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
      fileName: "MUI3",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(0);
    expect(result.componentJsons).toEqual([]);
    expect(result.skipped.some((s) => s.reason.includes("not published as a library"))).toBe(true);
  });

  it("uses the published endpoint when /components returns components", async () => {
    const calledUrls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calledUrls.push(u);

      if (u.includes("/v1/files/F1/components")) {
        return jsonRes({
          meta: {
            components: [
              { key: "ckBtn", node_id: "nBtn", name: "Button" },
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
        return jsonRes({ name: "F1", document: { children: [] } });
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
      fileName: "F1",
      componentsDb,
      iconsDb,
    });

    // Normal path: 1 component found via /components
    expect(result.componentCount).toBe(1);

    // The diagnostic tree endpoint is not part of the normal published sync path.
    expect(calledUrls.some((u) => u.includes("depth=4"))).toBe(false);

    // No document-tree extraction warning is reported.
    expect(result.skipped.some((s) => s.reason.includes("document tree"))).toBe(false);
  });

  it("normalizes published flattened variants into logical components and icons", async () => {
    const calledUrls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      calledUrls.push(u);

      if (u.includes("/v1/files/F1/components")) {
        return jsonRes({
          meta: {
            components: [
              {
                key: "button-md-fill",
                node_id: "buttonVariant1",
                name: "Size=md, Type=Fill, State=rest",
                containing_frame: {
                  pageName: "Button",
                  containingComponentSet: {
                    nodeId: "buttonSetNode",
                    name: "MDS-Public-TW-Button",
                  },
                },
              },
              {
                key: "button-lg-outline",
                node_id: "buttonVariant2",
                name: "Size=lg, Type=Outline, State=hover",
                containing_frame: {
                  pageName: "Button",
                  containingComponentSet: {
                    nodeId: "buttonSetNode",
                    name: "MDS-Public-TW-Button",
                  },
                },
              },
              {
                key: "arrowDown24",
                node_id: "arrowDown24Node",
                name: "Arrows=down, Type=stroke, Size=24px",
                containing_frame: {
                  pageName: "    ↪️  Icons",
                  containingComponentSet: {
                    nodeId: "arrowsSetNode",
                    name: "Arrows",
                  },
                },
              },
              {
                key: "arrowUp24",
                node_id: "arrowUp24Node",
                name: "Arrows=up, Type=stroke, Size=24px",
                containing_frame: {
                  pageName: "    ↪️  Icons",
                  containingComponentSet: {
                    nodeId: "arrowsSetNode",
                    name: "Arrows",
                  },
                },
              },
            ],
          },
        });
      }

      if (u.includes("/v1/files/F1/component_sets")) {
        return jsonRes({
          meta: {
            component_sets: [
              { key: "buttonSetKey", node_id: "buttonSetNode", name: "MDS-Public-TW-Button" },
              { key: "arrowsSetKey", node_id: "arrowsSetNode", name: "Arrows" },
            ],
          },
        });
      }

      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) {
        return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      }
      if (u.includes("/v1/files/F1/nodes")) {
        return jsonRes({
          nodes: {
            buttonSetNode: {
              document: {
                id: "buttonSetNode",
                name: "MDS-Public-TW-Button",
                type: "COMPONENT_SET",
                componentPropertyDefinitions: {
                  Size: { type: "VARIANT", variantOptions: ["md", "lg"] },
                  Type: { type: "VARIANT", variantOptions: ["Fill", "Outline"] },
                  State: { type: "VARIANT", variantOptions: ["rest", "hover"] },
                },
              },
            },
            arrowsSetNode: {
              document: { id: "arrowsSetNode", name: "Arrows", type: "COMPONENT_SET" },
            },
          },
        });
      }
      if (u.includes("/v1/files/F1")) {
        return jsonRes({ name: "Kotiko", document: { children: [] } });
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
      fileName: "Kotiko",
      componentsDb,
      iconsDb,
    });

    expect(result.componentCount).toBe(1);
    expect(result.iconCount).toBe(2);
    expect(result.componentJsons[0]?.name).toBe("MDS-Public-TW-Button");
    expect(result.componentJsons[0]?.key).toBe("button-md-fill");
    expect(result.componentJsons[0]?.componentSetKey).toBe("buttonSetKey");
    expect(result.componentJsons[0]?.variants.map((variant) => variant.propertyName).sort()).toEqual([
      "Size",
      "State",
      "Type",
    ]);
    expect(calledUrls.some((url) => url.includes("buttonSetNode"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("buttonVariant1"))).toBe(false);
  });

  it("progress: unpublished library path only emits the normal sync stages", async () => {
    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/v1/files/F1/components")) return jsonRes({ meta: { components: [] } });
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      if (u.includes("/v1/files/F1/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/F1")) {
        return jsonRes({
          name: "Mat3",
          document: {
            children: [
              {
                id: "page1",
                name: "Components",
                type: "CANVAS",
                children: [{ id: "cBtn", name: "Button", type: "COMPONENT" }],
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
    const { emitter, events } = recordingProgressEmitter();
    const result = await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "Mat3",
      componentsDb,
      iconsDb,
      progress: emitter,
      fileCtx: { index: 1, total: 1, name: "Mat3" },
    });

    const unsupportedStage = events.find(
      (e) => e.kind === "stage" && (e.payload as { stage?: string })?.stage === "fallback"
    );
    expect(unsupportedStage).toBeUndefined();
    expect(result.skipped.some((s) => s.reason.includes("not published as a library"))).toBe(true);
  });

  it("progress: node_details emits stageProgress with monotonically increasing processed", async () => {
    // Build 150 components so we get 2 batches (BATCH=100)
    const componentList = Array.from({ length: 150 }, (_, i) => ({
      key: `ck${i}`,
      node_id: `n${i}`,
      name: `Comp${i}`,
    }));

    const fetch = (async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("/v1/files/F1/components")) {
        return jsonRes({ meta: { components: componentList } });
      }
      if (u.includes("/v1/files/F1/component_sets")) return jsonRes({ meta: { component_sets: [] } });
      if (u.includes("/v1/files/F1/styles")) return jsonRes({ meta: { styles: [] } });
      if (u.includes("/v1/files/F1/variables/local")) return jsonRes({ meta: { variables: {}, variableCollections: {} } });
      if (u.includes("/v1/files/F1/nodes")) return jsonRes({ nodes: {} });
      if (u.includes("/v1/files/F1")) return jsonRes({ name: "F1", document: { children: [] } });
      throw new Error("no match: " + u);
    }) as unknown as typeof globalThis.fetch;

    const client = new FigmaClient({
      token: "tkn",
      fetch,
      limiter: createLimiter({ minTime: 0, maxConcurrent: 5 }),
      backoffOpts: FAST,
    });
    const { componentsDb, iconsDb } = makeDbs();
    const { emitter, events } = recordingProgressEmitter();
    await syncOneFile({
      root: "/tmp",
      client,
      fileKey: "F1",
      fileName: "F1",
      componentsDb,
      iconsDb,
      progress: emitter,
      fileCtx: { index: 1, total: 1, name: "F1" },
    });

    const progressEvents = events.filter((e) => e.kind === "stageProgress" && (e.payload as { stage?: string })?.stage === "node_details");
    // With 150 ids and BATCH=100, expect 2 progress events
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    // processed values should be monotonically increasing
    const processedValues = progressEvents.map((e) => (e.payload as { p: { processed: number } }).p.processed);
    for (let i = 1; i < processedValues.length; i++) {
      expect(processedValues[i]).toBeGreaterThan(processedValues[i - 1]!);
    }
  });
});
