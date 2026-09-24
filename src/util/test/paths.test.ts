import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bridgeConfigPath,
  checkpointPath,
  componentJsonPath,
  componentsDbPath,
  configPath,
  designSystemDir,
  findProjectRoot,
  iconsDbPath,
  manifestPath,
  syncReportPath,
  variablesJsonPath,
} from "../paths";

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

  it("findProjectRoot defaults to CLAUDE_PROJECT_DIR when Claude Code launches MCP outside the project", () => {
    const previous = process.env.CLAUDE_PROJECT_DIR;
    mkdirSync(join(tmp, ".kotikit"), { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = tmp;

    try {
      expect(findProjectRoot()).toBe(tmp);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PROJECT_DIR;
      } else {
        process.env.CLAUDE_PROJECT_DIR = previous;
      }
    }
  });

  it("findProjectRoot explicit start takes precedence over CLAUDE_PROJECT_DIR", () => {
    const previous = process.env.CLAUDE_PROJECT_DIR;
    const explicit = join(tmp, "explicit");
    mkdirSync(join(tmp, ".kotikit"), { recursive: true });
    mkdirSync(join(explicit, ".kotikit"), { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = tmp;

    try {
      expect(findProjectRoot(explicit)).toBe(explicit);
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_PROJECT_DIR;
      } else {
        process.env.CLAUDE_PROJECT_DIR = previous;
      }
    }
  });

  describe("design-system path helpers", () => {
    it("designSystemDir returns root/design-system", () => {
      expect(designSystemDir("/tmp/proj")).toBe("/tmp/proj/design-system");
    });

    it("componentsDbPath returns root/design-system/components.db", () => {
      expect(componentsDbPath("/tmp/proj")).toBe("/tmp/proj/design-system/components.db");
    });

    it("iconsDbPath returns root/design-system/icons.db", () => {
      expect(iconsDbPath("/tmp/proj")).toBe("/tmp/proj/design-system/icons.db");
    });

    it("variablesJsonPath returns root/design-system/variables.json", () => {
      expect(variablesJsonPath("/tmp/proj")).toBe("/tmp/proj/design-system/variables.json");
    });

    it("manifestPath returns root/design-system/manifest.json", () => {
      expect(manifestPath("/tmp/proj")).toBe("/tmp/proj/design-system/manifest.json");
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
      expect(checkpointPath("/tmp/proj")).toBe("/tmp/proj/design-system/.sync-checkpoint.json");
    });

    it("syncReportPath returns root/design-system/.sync-report.json", () => {
      expect(syncReportPath("/tmp/proj")).toBe("/tmp/proj/design-system/.sync-report.json");
    });
  });

  describe("bridge path helper", () => {
    it("bridgeConfigPath", () => {
      expect(bridgeConfigPath("/p")).toBe("/p/.kotikit/bridge.json");
    });
  });
});
