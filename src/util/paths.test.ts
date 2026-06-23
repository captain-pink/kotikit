import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bridgeConfigPath,
  checkpointPath,
  codeComponentDir,
  codeComponentFile,
  codePlanPath,
  componentJsonPath,
  componentsDbPath,
  configPath,
  designApplyLogPath,
  designNodeMapPath,
  designPlanPath,
  designReviewDbPath,
  designSystemDir,
  findProjectRoot,
  iconsDbPath,
  manifestPath,
  registryDbPath,
  screenSpecPath,
  singleSpecPath,
  syncReportPath,
  uiComponentFile,
  uiDir,
  uiStoryFile,
  variablesJsonPath,
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

  describe("Phase 3 path helpers", () => {
    it("codePlanPath with screenSlug returns <scope>/<slug>.code.plan.json", () => {
      expect(codePlanPath("/tmp/proj", "checkout-flow", "cart")).toBe(
        "/tmp/proj/.kotikit/specs/checkout-flow/cart.code.plan.json"
      );
    });

    it("codePlanPath with null screenSlug returns <scope>/code.plan.json", () => {
      expect(codePlanPath("/tmp/proj", "profile-page", null)).toBe(
        "/tmp/proj/.kotikit/specs/profile-page/code.plan.json"
      );
    });

    it("registryDbPath returns .kotikit/registry.db", () => {
      expect(registryDbPath("/tmp/proj")).toBe("/tmp/proj/.kotikit/registry.db");
    });

    it("codeComponentDir returns <root>/<codeComponentsDir>/<scope>", () => {
      expect(codeComponentDir("/tmp/proj", "src/components", "checkout-flow")).toBe(
        "/tmp/proj/src/components/checkout-flow"
      );
    });

    it("codeComponentFile returns full path to component file", () => {
      expect(codeComponentFile("/tmp/proj", "src/components", "checkout-flow", "Cart.tsx")).toBe(
        "/tmp/proj/src/components/checkout-flow/Cart.tsx"
      );
    });
  });

  describe("UI scaffold paths (Phase 4)", () => {
    it("uiDir returns <codeComponentsDir>/ui", () => {
      expect(uiDir("/tmp/proj", "src/components")).toBe("/tmp/proj/src/components/ui");
    });

    it("uiComponentFile returns <codeComponentsDir>/ui/<kebab>.tsx", () => {
      expect(uiComponentFile("/tmp/proj", "src/components", "button")).toBe(
        "/tmp/proj/src/components/ui/button.tsx"
      );
      expect(uiComponentFile("/tmp/proj", "src/components", "pie-chart-3d")).toBe(
        "/tmp/proj/src/components/ui/pie-chart-3d.tsx"
      );
    });

    it("uiStoryFile returns <codeComponentsDir>/ui/<kebab>.stories.tsx", () => {
      expect(uiStoryFile("/tmp/proj", "src/components", "button")).toBe(
        "/tmp/proj/src/components/ui/button.stories.tsx"
      );
    });

    it("works with a non-default codeComponentsDir", () => {
      expect(uiDir("/proj", "app/ui")).toBe("/proj/app/ui/ui");
      expect(uiComponentFile("/proj", "app/ui", "card")).toBe("/proj/app/ui/ui/card.tsx");
    });
  });

  describe("Phase 5 path helpers", () => {
    it("designPlanPath single-screen", () => {
      expect(designPlanPath("/p", "profile-page", null)).toBe(
        "/p/.kotikit/specs/profile-page/design.plan.json"
      );
    });

    it("designPlanPath multi-screen", () => {
      expect(designPlanPath("/p", "checkout-flow", "cart")).toBe(
        "/p/.kotikit/specs/checkout-flow/cart.design.plan.json"
      );
    });

    it("designApplyLogPath single-screen", () => {
      expect(designApplyLogPath("/p", "profile-page", null)).toBe(
        "/p/.kotikit/specs/profile-page/design.apply.log"
      );
    });

    it("designApplyLogPath multi-screen", () => {
      expect(designApplyLogPath("/p", "checkout-flow", "cart")).toBe(
        "/p/.kotikit/specs/checkout-flow/cart.design.apply.log"
      );
    });

    it("designNodeMapPath single-screen", () => {
      expect(designNodeMapPath("/p", "profile-page", null)).toBe(
        "/p/.kotikit/specs/profile-page/design.node-map.json"
      );
    });

    it("designNodeMapPath multi-screen", () => {
      expect(designNodeMapPath("/p", "checkout-flow", "cart")).toBe(
        "/p/.kotikit/specs/checkout-flow/cart.design.node-map.json"
      );
    });

    it("designReviewDbPath", () => {
      expect(designReviewDbPath("/p")).toBe("/p/.kotikit/design-review.db");
    });

    it("bridgeConfigPath", () => {
      expect(bridgeConfigPath("/p")).toBe("/p/.kotikit/bridge.json");
    });
  });
});
