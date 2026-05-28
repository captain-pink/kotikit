import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerConfigTools, type ToolRegistry } from "./config";
import type { ToolContext } from "../context";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmp: string;
let registry: ToolRegistry;
let ctx: ToolContext;

function makeRegistry(): ToolRegistry {
  return { tools: [], handlers: new Map() };
}

function makeCtx(root: string): ToolContext {
  return {
    root,
    loadConfig: async () => null,
  };
}

async function call(
  name: string,
  args: unknown
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const handler = registry.handlers.get(name);
  if (!handler) throw new Error(`No handler for tool: ${name}`);
  return handler(args);
}

function getText(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-config-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  registry = makeRegistry();
  ctx = makeCtx(tmp);
  registerConfigTools(registry, ctx);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─── Tool registration ────────────────────────────────────────────────────────

describe("tool registration", () => {
  it("registers kotikit_config_status", () => {
    expect(registry.tools.find((t) => t.name === "kotikit_config_status")).toBeDefined();
  });

  it("registers kotikit_config_init", () => {
    expect(registry.tools.find((t) => t.name === "kotikit_config_init")).toBeDefined();
  });

  it("registers kotikit_config_get", () => {
    expect(registry.tools.find((t) => t.name === "kotikit_config_get")).toBeDefined();
  });
});

// ─── kotikit_config_status ────────────────────────────────────────────────────

describe("kotikit_config_status", () => {
  it("returns initialized: false before init", async () => {
    const result = await call("kotikit_config_status", {});
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('"initialized": false');
  });

  it("returns initialized: true after init", async () => {
    await call("kotikit_config_init", { tests: false });
    const result = await call("kotikit_config_status", {});
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('"initialized": true');
  });

  it("includes missing array in response", async () => {
    const result = await call("kotikit_config_status", {});
    const text = getText(result);
    expect(text).toContain('"missing"');
  });

  it("notes missing Figma design system after init without figmaFiles", async () => {
    await call("kotikit_config_init", {});
    const result = await call("kotikit_config_status", {});
    const text = getText(result);
    expect(text).toContain("Figma");
  });

  it("reports isGitRepo field", async () => {
    const result = await call("kotikit_config_status", {});
    const text = getText(result);
    expect(text).toContain('"isGitRepo"');
  });
});

// ─── kotikit_config_init ──────────────────────────────────────────────────────

describe("kotikit_config_init", () => {
  it("writes config with tests: false when specified", async () => {
    const result = await call("kotikit_config_init", { tests: false });
    expect(result.isError).toBeUndefined();

    // Verify by reading back via config_get
    const getResult = await call("kotikit_config_get", {});
    expect(getResult.isError).toBeUndefined();
    const text = getText(getResult);
    expect(text).toContain('"tests": false');
  });

  it("all other fields use defaults when only tests is specified", async () => {
    await call("kotikit_config_init", { tests: false });
    const getResult = await call("kotikit_config_get", {});
    const text = getText(getResult);
    expect(text).toContain('"framework": "react"');
    expect(text).toContain('"autoCommit": true');
    expect(text).toContain('"tests": false');
  });

  it("returns success message and configPath", async () => {
    const result = await call("kotikit_config_init", {});
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain("all set");
    expect(text).toContain(".kotikit/config.json");
  });

  it("accepts figmaFiles", async () => {
    const result = await call("kotikit_config_init", {
      figmaFiles: [{ key: "abc123", name: "Core DS" }],
    });
    expect(result.isError).toBeUndefined();

    const getResult = await call("kotikit_config_get", {});
    const text = getText(getResult);
    expect(text).toContain("abc123");
  });
});

// ─── kotikit_config_get ───────────────────────────────────────────────────────

describe("kotikit_config_get", () => {
  it("returns isError: true before init", async () => {
    const result = await call("kotikit_config_get", {});
    expect(result.isError).toBe(true);
    const text = getText(result);
    // Plain-English message
    expect(text).toContain("Kotikit isn't set up");
  });

  it("error message mentions how to fix it", async () => {
    const result = await call("kotikit_config_get", {});
    const text = getText(result);
    expect(text).toContain("config_init");
  });

  it("returns config after init", async () => {
    await call("kotikit_config_init", {});
    const result = await call("kotikit_config_get", {});
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain("kotikit config");
  });

  it("does not include literal FIGMA_TOKEN value when env var is set", async () => {
    const tokenValue = "secret-figma-token-abc";
    process.env["FIGMA_TOKEN"] = tokenValue;

    try {
      // Write config with token reference
      const { writeConfig } = await import("../../config/load");
      const { defaultConfig } = await import("../../config/schema");
      const cfg = defaultConfig();
      cfg.figma.token = "${FIGMA_TOKEN}";
      await writeConfig(tmp, cfg);

      const result = await call("kotikit_config_get", {});
      expect(result.isError).toBeUndefined();
      const text = getText(result);

      // Must NOT contain the literal secret
      expect(text).not.toContain(tokenValue);
      // Must show the placeholder instead
      expect(text).toContain("<resolved from env>");
    } finally {
      delete process.env["FIGMA_TOKEN"];
    }
  });

  it("does not echo plain token strings either", async () => {
    // If config.figma.token is a plain string (non-env-ref), resolveSecret returns it as-is
    // so it resolvedToken is defined, and we show "<resolved from env>"
    const { writeConfig } = await import("../../config/load");
    const { defaultConfig } = await import("../../config/schema");
    const cfg = defaultConfig();
    cfg.figma.token = "plaintoken123";
    await writeConfig(tmp, cfg);

    const result = await call("kotikit_config_get", {});
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).not.toContain("plaintoken123");
    expect(text).toContain("<resolved from env>");
  });
});
