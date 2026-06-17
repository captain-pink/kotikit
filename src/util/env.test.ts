import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDotEnv, loadDotEnv } from "./env.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-env-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("parseDotEnv", () => {
  it("KEY=value", () => {
    expect(parseDotEnv("FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("strips surrounding double quotes", () => {
    expect(parseDotEnv('FOO="bar baz"')).toEqual({ FOO: "bar baz" });
  });

  it("strips surrounding single quotes", () => {
    expect(parseDotEnv("FOO='bar baz'")).toEqual({ FOO: "bar baz" });
  });

  it("handles export prefix", () => {
    expect(parseDotEnv("export FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("ignores # comments", () => {
    expect(parseDotEnv("# comment\nFOO=bar")).toEqual({ FOO: "bar" });
  });

  it("ignores blank lines", () => {
    expect(parseDotEnv("\n\nFOO=bar\n\n")).toEqual({ FOO: "bar" });
  });

  it("ignores invalid identifiers", () => {
    expect(parseDotEnv("1FOO=bar\nFOO BAR=baz\nVALID=ok")).toEqual({ VALID: "ok" });
  });

  it("multiple keys", () => {
    expect(parseDotEnv("FOO=1\nBAR=2\nBAZ=three")).toEqual({
      FOO: "1",
      BAR: "2",
      BAZ: "three",
    });
  });

  it("strips whitespace around key and value", () => {
    expect(parseDotEnv("  FOO  =  bar  ")).toEqual({ FOO: "bar" });
  });

  it("FIGMA_TOKEN style", () => {
    expect(parseDotEnv("FIGMA_TOKEN=figd_abc123_xyz")).toEqual({
      FIGMA_TOKEN: "figd_abc123_xyz",
    });
  });
});

describe("loadDotEnv", () => {
  beforeEach(() => {
    // Clean up any test pollution
    delete process.env.KOTIKIT_TEST_ENV_VAR_1;
    delete process.env.KOTIKIT_TEST_ENV_VAR_2;
    delete process.env.KOTIKIT_TEST_ENV_VAR_3;
  });

  it("returns [] when .env is missing", async () => {
    const root = mkTmp();
    expect(await loadDotEnv(root)).toEqual([]);
  });

  it("injects fresh keys into process.env", async () => {
    const root = mkTmp();
    writeFileSync(`${root}/.env`, "KOTIKIT_TEST_ENV_VAR_1=hello");
    const injected = await loadDotEnv(root);
    expect(injected).toEqual(["KOTIKIT_TEST_ENV_VAR_1"]);
    expect(process.env.KOTIKIT_TEST_ENV_VAR_1).toBe("hello");
  });

  it("does NOT clobber keys that already exist", async () => {
    const root = mkTmp();
    process.env.KOTIKIT_TEST_ENV_VAR_2 = "pre-existing";
    writeFileSync(`${root}/.env`, "KOTIKIT_TEST_ENV_VAR_2=from-env-file");
    const injected = await loadDotEnv(root);
    expect(injected).toEqual([]);
    expect(process.env.KOTIKIT_TEST_ENV_VAR_2).toBe("pre-existing");
  });

  it("can replace an empty placeholder when requested", async () => {
    const root = mkTmp();
    process.env.KOTIKIT_TEST_ENV_VAR_2 = "";
    writeFileSync(`${root}/.env`, "KOTIKIT_TEST_ENV_VAR_2=from-env-file");

    const injected = await loadDotEnv(root, { overrideEmpty: true });

    expect(injected).toEqual(["KOTIKIT_TEST_ENV_VAR_2"]);
    expect(process.env.KOTIKIT_TEST_ENV_VAR_2).toBe("from-env-file");
  });

  it("preserves non-empty environment values when replacing empty placeholders", async () => {
    const root = mkTmp();
    process.env.KOTIKIT_TEST_ENV_VAR_3 = "pre-existing";
    writeFileSync(`${root}/.env`, "KOTIKIT_TEST_ENV_VAR_3=from-env-file");

    const injected = await loadDotEnv(root, { overrideEmpty: true });

    expect(injected).toEqual([]);
    expect(process.env.KOTIKIT_TEST_ENV_VAR_3).toBe("pre-existing");
  });

  it("handles malformed file silently", async () => {
    const root = mkTmp();
    writeFileSync(`${root}/.env`, "garbage line with no equals\n=novalue\n##\n");
    const injected = await loadDotEnv(root);
    expect(injected).toEqual([]); // nothing parseable
  });

  it("FIGMA_TOKEN end-to-end", async () => {
    const root = mkTmp();
    writeFileSync(`${root}/.env`, "FIGMA_TOKEN=figd_test_token\nOTHER=ignored\n");
    delete process.env.FIGMA_TOKEN; // ensure clean
    const injected = await loadDotEnv(root);
    expect(injected.sort()).toEqual(["FIGMA_TOKEN", "OTHER"]);
    expect(process.env["FIGMA_TOKEN"] as string | undefined).toBe("figd_test_token");
    delete process.env.FIGMA_TOKEN; // cleanup
    delete process.env.OTHER;
  });
});
