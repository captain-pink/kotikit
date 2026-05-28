import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  configPath, screenSpecPath,
  singleSpecPath, findProjectRoot,
  designSystemDir, componentsDbPath, iconsDbPath,
  variablesJsonPath, manifestPath, componentJsonPath,
  checkpointPath, syncReportPath,
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

  describe("design-system path helpers", () => {
    it("designSystemDir returns root/design-system", () => {
      expect(designSystemDir("/tmp/proj")).toBe("/tmp/proj/design-system");
    });

    it("componentsDbPath returns root/design-system/components.db", () => {
      expect(componentsDbPath("/tmp/proj")).toBe(
        "/tmp/proj/design-system/components.db"
      );
    });

    it("iconsDbPath returns root/design-system/icons.db", () => {
      expect(iconsDbPath("/tmp/proj")).toBe(
        "/tmp/proj/design-system/icons.db"
      );
    });

    it("variablesJsonPath returns root/design-system/variables.json", () => {
      expect(variablesJsonPath("/tmp/proj")).toBe(
        "/tmp/proj/design-system/variables.json"
      );
    });

    it("manifestPath returns root/design-system/manifest.json", () => {
      expect(manifestPath("/tmp/proj")).toBe(
        "/tmp/proj/design-system/manifest.json"
      );
    });

    it("componentJsonPath returns root/design-system/components/<slug>.json", () => {
      expect(componentJsonPath("/tmp/proj", "button")).toBe(
        "/tmp/proj/design-system/components/button.json"
      );
      expect(componentJsonPath("/tmp/proj", "text-field")).toBe(
        "/tmp/proj/design-system/components/text-field.json"
      );
    });

    it("checkpointPath returns root/design-system/.sync-checkpoint.json", () => {
      expect(checkpointPath("/tmp/proj")).toBe(
        "/tmp/proj/design-system/.sync-checkpoint.json"
      );
    });

    it("syncReportPath returns root/design-system/.sync-report.json", () => {
      expect(syncReportPath("/tmp/proj")).toBe(
        "/tmp/proj/design-system/.sync-report.json"
      );
    });
  });
});
