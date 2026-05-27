import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig, configExists, writeConfig, resolveSecret } from "./load";
import { buildConfig } from "./init";
import { defaultConfig } from "./schema";

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
    expect(loaded).not.toBeNull();
    expect(loaded!.project.framework).toBe("react");
    expect(loaded!.project.tests).toBe(true);
    expect(loaded!.git.autoCommit).toBe(true);
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
    const { readFileSync } = await import("fs");
    const content = readFileSync(join(tmp, ".kotikit", "config.json"), "utf-8");
    expect(content.endsWith("\n")).toBe(true);
    expect(content).toContain("  "); // pretty-printed (has indentation)
  });
});

describe("resolveSecret", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveSecret(undefined)).toBeUndefined();
  });

  it("resolves ${ENV_VAR} from environment", () => {
    process.env["TEST_SECRET_VAR"] = "mytoken";
    expect(resolveSecret("${TEST_SECRET_VAR}")).toBe("mytoken");
    delete process.env["TEST_SECRET_VAR"];
  });

  it("returns undefined for unset env var", () => {
    delete process.env["DEFINITELY_NOT_SET_12345"];
    expect(resolveSecret("${DEFINITELY_NOT_SET_12345}")).toBeUndefined();
  });

  it("passes through op:// strings unchanged", () => {
    expect(resolveSecret("op://vault/item/field")).toBe("op://vault/item/field");
  });

  it("passes through plain strings unchanged", () => {
    expect(resolveSecret("myplaintoken")).toBe("myplaintoken");
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
});
