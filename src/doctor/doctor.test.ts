import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, closeSync, openSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultConfig } from "../config/schema.js";
import { writeConfig } from "../config/load.js";
import { newScreenSpec } from "../spec/schema.js";
import { checkpointPath, componentsDbPath, iconsDbPath, manifestPath } from "../util/paths.js";
import { runKotikitDoctor, formatDoctorReport } from "./doctor.js";

const tmpDirs: string[] = [];
const originalFigmaToken = process.env.FIGMA_TOKEN;

const mkTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kotikit-doctor-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  tmpDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  if (originalFigmaToken === undefined) {
    delete process.env.FIGMA_TOKEN;
  } else {
    process.env.FIGMA_TOKEN = originalFigmaToken;
  }
});

const touch = (path: string): void => {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  closeSync(openSync(path, "w"));
};

describe("runKotikitDoctor", () => {
  it("reports an uninitialized project as actionable instead of throwing", async () => {
    const root = mkTmp();

    const report = await runKotikitDoctor(root, {
      isGitRepo: async () => false,
      verifyGates: async () => ({ ok: true, missing: [] }),
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "config")?.status).toBe("error");
    expect(report.nextSteps).toContain("Run kotikit_config_init before syncing or generating designs.");
  });

  it("passes with config, token, design-system artifacts, gates, and bridge config", async () => {
    const root = mkTmp();
    const config = defaultConfig();
    config.figma.designSystemFiles = [{ key: "fig-file", name: "DS" }];
    await writeConfig(root, config);
    writeFileSync(join(root, ".env"), "FIGMA_TOKEN=figd_test\n");
    touch(componentsDbPath(root));
    touch(iconsDbPath(root));
    writeFileSync(manifestPath(root), JSON.stringify({ version: 1, files: [] }));
    mkdirSync(join(root, ".kotikit"), { recursive: true });
    writeFileSync(
      join(root, ".kotikit/bridge.json"),
      JSON.stringify({
        version: 1,
        port: 53124,
        token: "tok123456789",
        projectRoot: root,
        projectName: "app",
        startedAt: "2026-06-18T00:00:00.000Z",
      })
    );

    const report = await runKotikitDoctor(root, {
      isGitRepo: async () => true,
      verifyGates: async () => ({ ok: true, missing: [] }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status !== "error")).toBe(true);
    expect(report.checks.find((check) => check.id === "figma-token")?.status).toBe("ok");
    expect(report.checks.find((check) => check.id === "design-system")?.status).toBe("ok");
  });

  it("warns about resumable sync checkpoints and missing gates", async () => {
    const root = mkTmp();
    const config = defaultConfig();
    await writeConfig(root, config);
    mkdirSync(join(root, "design-system"), { recursive: true });
    writeFileSync(checkpointPath(root), JSON.stringify({ version: 1, startedAt: "now", files: [] }));

    const report = await runKotikitDoctor(root, {
      isGitRepo: async () => true,
      verifyGates: async () => ({
        ok: false,
        missing: [{ gate: "tsc", hint: "Install TypeScript." }],
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "sync-checkpoint")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "gates")?.hint).toContain("Install TypeScript");
  });

  it("warns about legacy readable artifacts without failing doctor", async () => {
    const root = mkTmp();
    await writeConfig(root, defaultConfig());
    const spec = newScreenSpec({ title: "Legacy", description: "x" });
    const { schemaVersion: _schemaVersion, ...legacySpec } = spec;
    mkdirSync(join(root, ".kotikit", "specs", "legacy"), { recursive: true });
    writeFileSync(
      join(root, ".kotikit", "specs", "legacy", "spec.json"),
      JSON.stringify(legacySpec, null, 2)
    );

    const report = await runKotikitDoctor(root, {
      isGitRepo: async () => true,
      verifyGates: async () => ({ ok: true, missing: [] }),
    });
    const check = report.checks.find((item) => item.id === "schema-versions");

    expect(report.ok).toBe(true);
    expect(check?.status).toBe("warn");
    expect(check?.message).toContain("1 older kotikit file");
    expect(check?.hint).toContain("updated automatically when edited");
    expect(check?.details).toContainEqual(expect.stringContaining(".kotikit/specs/legacy/spec.json"));
  });
});

describe("formatDoctorReport", () => {
  it("produces compact human-readable output", () => {
    const text = formatDoctorReport({
      ok: false,
      root: "/app",
      checks: [
        {
          id: "config",
          label: "Config",
          status: "error",
          message: "Missing config.",
          details: ["Missing .kotikit/config.json"],
        },
        { id: "bridge", label: "Bridge", status: "warn", message: "Bridge not running." },
      ],
      nextSteps: ["Run kotikit_config_init before syncing or generating designs."],
    });

    expect(text).toContain("kotikit doctor: issues found");
    expect(text).toContain("[error] Config: Missing config.");
    expect(text).toContain("  - Missing .kotikit/config.json");
    expect(text).toContain("Next steps:");
  });
});
