import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig } from "./init";
import { configExists, loadConfig, resolveSecret, resolveSecretImpl, writeConfig } from "./load";
import { CONFIG_SCHEMA_VERSION, defaultConfig, parseConfig } from "./schema";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-config-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("configExists", () => {
  it("returns false when no config", async () => {
    expect(await configExists(tmp)).toBe(false);
  });

  it("returns true after writeConfig", async () => {
    await writeConfig(tmp, defaultConfig());
    expect(await configExists(tmp)).toBe(true);
  });
});

describe("writeConfig + loadConfig round-trip", () => {
  it("round-trips the default config", async () => {
    const cfg = defaultConfig();
    await writeConfig(tmp, cfg);
    const loaded = await loadConfig(tmp);
    if (loaded === null) {
      throw new Error("Expected config to load.");
    }
    expect(loaded.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(loaded.project.framework).toBe("react");
    expect(loaded.project.tests).toBe(true);
    expect(loaded.git.autoCommit).toBe(true);
  });

  it("loadConfig returns null for a missing config", async () => {
    expect(await loadConfig(tmp)).toBeNull();
  });

  it("loadConfig throws a KotikitError for malformed JSON", async () => {
    const kotikitDir = join(tmp, ".kotikit");
    mkdirSync(kotikitDir, { recursive: true });
    writeFileSync(join(kotikitDir, "config.json"), "{ bad json }", "utf-8");
    await expect(loadConfig(tmp)).rejects.toThrow();
  });

  it("written file is pretty-printed and ends with newline", async () => {
    await writeConfig(tmp, defaultConfig());
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(join(tmp, ".kotikit", "config.json"), "utf-8");
    expect(content.endsWith("\n")).toBe(true);
    expect(content).toContain("  "); // pretty-printed (has indentation)
  });
});

describe("resolveSecret", () => {
  it("returns undefined for undefined input", async () => {
    expect(await resolveSecret(undefined)).toBeUndefined();
  });

  it("resolves env placeholder from environment", async () => {
    const secretRef = "$" + "{TEST_SECRET_VAR}";
    process.env.TEST_SECRET_VAR = "mytoken";
    expect(await resolveSecret(secretRef)).toBe("mytoken");
    delete process.env.TEST_SECRET_VAR;
  });

  it("returns undefined for unset env var", async () => {
    const missingSecretRef = "$" + "{DEFINITELY_NOT_SET_12345}";
    delete process.env.DEFINITELY_NOT_SET_12345;
    expect(await resolveSecret(missingSecretRef)).toBeUndefined();
  });

  it("passes through plain strings unchanged", async () => {
    expect(await resolveSecret("myplaintoken")).toBe("myplaintoken");
  });
});

describe("resolveSecretImpl — op:// handling", () => {
  it("resolves op:// via spawn and strips trailing newline", async () => {
    const mockSpawn = async (_cmd: string[]) => ({
      stdout: "secret-value\n",
      exitCode: 0,
    });
    const result = await resolveSecretImpl("op://vault/item/field", mockSpawn);
    expect(result).toBe("secret-value");
  });

  it("returns undefined when spawn exits with non-zero code", async () => {
    const mockSpawn = async (_cmd: string[]) => ({
      stdout: "",
      exitCode: 1,
    });
    const result = await resolveSecretImpl("op://vault/item/field", mockSpawn);
    expect(result).toBeUndefined();
  });

  it("returns undefined when spawn throws (op not installed)", async () => {
    const mockSpawn = async (_cmd: string[]): Promise<{ stdout: string; exitCode: number }> => {
      throw new Error("op: command not found");
    };
    const result = await resolveSecretImpl("op://vault/item/field", mockSpawn);
    expect(result).toBeUndefined();
  });

  it("strips trailing Windows-style CRLF newline", async () => {
    const mockSpawn = async (_cmd: string[]) => ({
      stdout: "secret-value\r\n",
      exitCode: 0,
    });
    const result = await resolveSecretImpl("op://vault/item/field", mockSpawn);
    expect(result).toBe("secret-value");
  });
});

describe("buildConfig", () => {
  it("empty answers returns default config", () => {
    const cfg = buildConfig({});
    const def = defaultConfig();
    expect(cfg.project.framework).toBe(def.project.framework);
    expect(cfg.project.tests).toBe(def.project.tests);
    expect(cfg.git.autoCommit).toBe(def.git.autoCommit);
  });

  it("overrides only specified fields", () => {
    const cfg = buildConfig({ tests: false, codeComponentsDir: "app/ui" });
    expect(cfg.project.tests).toBe(false);
    expect(cfg.project.codeComponentsDir).toBe("app/ui");
    expect(cfg.project.framework).toBe("react"); // default preserved
    expect(cfg.git.autoCommit).toBe(true); // default preserved
  });

  it("sets figmaFiles when provided", () => {
    const cfg = buildConfig({ figmaFiles: [{ key: "abc", name: "Core DS" }] });
    expect(cfg.figma.designSystemFiles).toHaveLength(1);
    expect(cfg.figma.designSystemFiles[0].key).toBe("abc");
  });

  it("defaultConfig().project.testFramework is 'vitest'", () => {
    expect(defaultConfig().project.testFramework).toBe("vitest");
  });

  it("defaultConfig() keeps the existing Claude Code co-author", () => {
    expect(defaultConfig().git.coAuthor).toEqual({
      name: "Claude Code",
      email: "noreply@anthropic.com",
    });
  });

  it("buildConfig({ testFramework: 'none' }) returns testFramework 'none'", () => {
    const cfg = buildConfig({ testFramework: "none" });
    expect(cfg.project.testFramework).toBe("none");
  });
});

describe("parseConfig — testFramework back-fill", () => {
  it("normalizes an existing config without schemaVersion to the latest in-memory schema", () => {
    const raw = {
      project: {
        framework: "react",
        codeComponentsDir: "src/components",
        tests: true,
      },
      defaults: {
        breakpoints: [375, 768, 1024, 1440],
        themes: ["light", "dark"],
      },
    };
    const cfg = parseConfig(raw);
    expect(cfg.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  it("parses an existing config without testFramework and fills default", () => {
    const raw = {
      project: {
        framework: "react",
        codeComponentsDir: "src/components",
        tests: true,
        // testFramework deliberately absent
      },
      defaults: {
        breakpoints: [375, 768, 1024, 1440],
        themes: ["light", "dark"],
      },
    };
    const cfg = parseConfig(raw);
    expect(cfg.project.testFramework).toBe("vitest");
  });

  it("parses a Codex co-author override", () => {
    const raw = {
      project: {
        framework: "react",
        codeComponentsDir: "src/components",
        tests: true,
      },
      defaults: {
        breakpoints: [375, 768, 1024, 1440],
        themes: ["light", "dark"],
      },
      git: {
        autoCommit: true,
        coAuthor: {
          name: "Codex",
          email: "noreply@openai.com",
        },
      },
    };
    const cfg = parseConfig(raw);
    expect(cfg.git.coAuthor).toEqual({
      name: "Codex",
      email: "noreply@openai.com",
    });
  });

  it("rejects empty co-author name and email", () => {
    const raw = {
      project: {
        framework: "react",
        codeComponentsDir: "src/components",
        tests: true,
      },
      defaults: {
        breakpoints: [375, 768, 1024, 1440],
        themes: ["light", "dark"],
      },
      git: {
        autoCommit: true,
        coAuthor: {
          name: "",
          email: "",
        },
      },
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  it("rejects configs from a future schema version", () => {
    expect(() =>
      parseConfig({
        ...defaultConfig(),
        schemaVersion: CONFIG_SCHEMA_VERSION + 1,
      })
    ).toThrow(/schemaVersion/);
  });
});
