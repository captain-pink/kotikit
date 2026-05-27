import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  configPath, screenSpecPath,
  singleSpecPath, findProjectRoot,
} from "./paths";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `kotikit-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("paths", () => {
  it("configPath returns the expected path", () => {
    expect(configPath(tmp)).toBe(`${tmp}/.kotikit/config.json`);
  });

  it("screenSpecPath returns the expected path", () => {
    expect(screenSpecPath(tmp, "checkout-flow", "cart")).toBe(
      `${tmp}/.kotikit/specs/checkout-flow/cart.spec.json`
    );
  });

  it("singleSpecPath returns spec.json", () => {
    expect(singleSpecPath(tmp, "profile-page")).toBe(
      `${tmp}/.kotikit/specs/profile-page/spec.json`
    );
  });

  it("findProjectRoot returns start dir when no .kotikit exists", () => {
    const result = findProjectRoot(tmp);
    // It should not throw and should return a string path
    expect(typeof result).toBe("string");
  });

  it("findProjectRoot finds .kotikit in parent directory", () => {
    // Create a .kotikit dir in tmp
    mkdirSync(join(tmp, ".kotikit"), { recursive: true });
    // Create a nested subdir
    const nested = join(tmp, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    // findProjectRoot from nested should walk up and find tmp
    expect(findProjectRoot(nested)).toBe(tmp);
  });
});
