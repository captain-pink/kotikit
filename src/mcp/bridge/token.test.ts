import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  generateBridgeToken,
  writeBridgeConfig,
  readBridgeConfig,
  clearBridgeConfig,
  BridgeConfigSchema,
  type BridgeConfig,
} from "./token.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kotikit-bridge-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function sampleConfig(token = "tok123456789"): BridgeConfig {
  return {
    version: 1,
    port: 53124,
    token,
    projectRoot: "/tmp/proj",
    projectName: "proj",
    startedAt: "2026-05-29T10:00:00.000Z",
  };
}

describe("generateBridgeToken", () => {
  it("returns a 12-character string", () => {
    const t = generateBridgeToken();
    expect(t).toHaveLength(12);
  });

  it("is URL-safe (only [a-z0-9])", () => {
    const t = generateBridgeToken();
    expect(t).toMatch(/^[a-z0-9]+$/);
  });

  it("two consecutive calls produce different tokens", () => {
    const t1 = generateBridgeToken();
    const t2 = generateBridgeToken();
    expect(t1).not.toBe(t2);
  });
});

describe("writeBridgeConfig + readBridgeConfig", () => {
  it("round-trips", async () => {
    const root = mkTmp();
    await writeBridgeConfig(root, sampleConfig());
    const got = await readBridgeConfig(root);
    expect(got).toEqual(sampleConfig());
  });

  it("readBridgeConfig returns null when file is missing", async () => {
    const root = mkTmp();
    expect(await readBridgeConfig(root)).toBeNull();
  });

  it("readBridgeConfig returns null on malformed JSON (no throw)", async () => {
    const root = mkTmp();
    await writeBridgeConfig(root, sampleConfig());
    writeFileSync(`${root}/.kotikit/bridge.json`, "not valid {{{");
    expect(await readBridgeConfig(root)).toBeNull();
  });

  it("readBridgeConfig returns null on schema mismatch (no throw)", async () => {
    const root = mkTmp();
    await writeBridgeConfig(root, sampleConfig());
    writeFileSync(`${root}/.kotikit/bridge.json`, JSON.stringify({ version: 999 }));
    expect(await readBridgeConfig(root)).toBeNull();
  });

  it("writeBridgeConfig validates and throws on invalid input", async () => {
    const root = mkTmp();
    const bad = { ...sampleConfig(), port: 80 }; // < 1024
    await expect(writeBridgeConfig(root, bad as BridgeConfig)).rejects.toThrow();
  });

  it("write is atomic (.tmp does not linger)", async () => {
    const root = mkTmp();
    await writeBridgeConfig(root, sampleConfig());
    const { existsSync } = await import("fs");
    expect(existsSync(`${root}/.kotikit/bridge.json.tmp`)).toBe(false);
  });
});

describe("clearBridgeConfig", () => {
  it("removes the file", async () => {
    const root = mkTmp();
    await writeBridgeConfig(root, sampleConfig());
    await clearBridgeConfig(root);
    expect(await readBridgeConfig(root)).toBeNull();
  });

  it("is a no-op when no file exists", async () => {
    const root = mkTmp();
    await clearBridgeConfig(root); // should not throw
    expect(await readBridgeConfig(root)).toBeNull();
  });
});

describe("BridgeConfigSchema", () => {
  it("rejects port < 1024", () => {
    expect(() => BridgeConfigSchema.parse({ ...sampleConfig(), port: 80 })).toThrow();
  });

  it("rejects port > 65535", () => {
    expect(() =>
      BridgeConfigSchema.parse({ ...sampleConfig(), port: 99999 })
    ).toThrow();
  });

  it("rejects token < 12 chars", () => {
    expect(() =>
      BridgeConfigSchema.parse({ ...sampleConfig(), token: "short" })
    ).toThrow();
  });
});
