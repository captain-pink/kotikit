import { existsSync } from "fs";
import type { Config } from "../config/schema.js";
import { loadConfig } from "../config/load.js";
import { isGitRepo as defaultIsGitRepo } from "../git/auto-commit.js";
import { verifyGateEnvironment } from "../codegen/environment.js";
import type { EnvironmentReport } from "../codegen/environment.js";
import { reactAdapter } from "../codegen/react/adapter.js";
import { resolveFigmaToken } from "../sync/figma-token.js";
import { hasCheckpoint } from "../sync/checkpoint.js";
import { readBridgeConfig } from "../mcp/bridge/token.js";
import { inspectProjectSchemaVersions } from "../migrations/schema-inventory.js";
import { formatSchemaInventoryDetails } from "../migrations/dry-run.js";
import {
  bridgeConfigPath,
  componentsDbPath,
  configPath,
  iconsDbPath,
  manifestPath,
} from "../util/paths.js";

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  hint?: string;
  details?: string[];
}

export interface DoctorReport {
  ok: boolean;
  root: string;
  checks: DoctorCheck[];
  nextSteps: string[];
}

export interface DoctorDeps {
  loadConfig?: (root: string) => Promise<Config | null>;
  isGitRepo?: (root: string) => Promise<boolean>;
  verifyGates?: (input: {
    root: string;
    config: Config | null;
  }) => Promise<EnvironmentReport>;
}

const check = (input: DoctorCheck): DoctorCheck => input;

const gateHint = (report: EnvironmentReport): string | undefined =>
  report.missing.map((missing) => missing.hint).join(" ");

const designSystemArtifactsPresent = (root: string): boolean =>
  existsSync(componentsDbPath(root)) &&
  existsSync(iconsDbPath(root)) &&
  existsSync(manifestPath(root));

const schemaVersionCheck = async (root: string): Promise<DoctorCheck> => {
  const inventory = await inspectProjectSchemaVersions(root);
  const details = formatSchemaInventoryDetails(root, inventory);
  if (inventory.future > 0) {
    return check({
      id: "schema-versions",
      label: "Schema versions",
      status: "error",
      message: `${inventory.future} kotikit file(s) were created by a newer kotikit version.`,
      hint: "Update kotikit before editing these files.",
      details,
    });
  }
  if (inventory.unreadable > 0) {
    return check({
      id: "schema-versions",
      label: "Schema versions",
      status: "warn",
      message: `${inventory.unreadable} kotikit file(s) could not be inspected for schema version.`,
      hint: "Open the reported file(s) only if a tool later says they cannot be read.",
      details,
    });
  }
  if (inventory.legacyOrOlder > 0) {
    return check({
      id: "schema-versions",
      label: "Schema versions",
      status: "warn",
      message: `${inventory.legacyOrOlder} older kotikit file(s) can be read safely.`,
      hint: "They will be updated automatically when edited; no project-wide migration is required.",
      details,
    });
  }
  return check({
    id: "schema-versions",
    label: "Schema versions",
    status: "ok",
    message: inventory.checked === 0
      ? "No versioned kotikit files found yet."
      : "Versioned kotikit files are current.",
  });
};

const bridgeMessage = async (root: string): Promise<DoctorCheck> => {
  const bridge = await readBridgeConfig(root);
  if (bridge === null) {
    return check({
      id: "bridge",
      label: "Bridge",
      status: "warn",
      message: "The Figma plugin bridge is not running.",
      hint: `Ask your assistant to run kotikit_bridge_start when you need the Figma plugin. Expected config: ${bridgeConfigPath(root)}.`,
    });
  }
  return check({
    id: "bridge",
    label: "Bridge",
    status: "ok",
    message: `Bridge config points to ws://localhost:${bridge.port}.`,
  });
};

export async function runKotikitDoctor(
  root: string,
  deps: DoctorDeps = {}
): Promise<DoctorReport> {
  const loadProjectConfig = deps.loadConfig ?? loadConfig;
  const checkGit = deps.isGitRepo ?? defaultIsGitRepo;
  const checkGates = deps.verifyGates ?? ((input) =>
    input.config === null
      ? Promise.resolve({ ok: true, missing: [] })
      : verifyGateEnvironment({
          root: input.root,
          adapter: reactAdapter,
          testFramework: input.config.project.testFramework,
        }));

  const checks: DoctorCheck[] = [
    check({
      id: "root",
      label: "Project root",
      status: "ok",
      message: root,
    }),
  ];
  const nextSteps: string[] = [];

  let config: Config | null = null;
  try {
    config = await loadProjectConfig(root);
    if (config === null) {
      checks.push(check({
        id: "config",
        label: "Config",
        status: "error",
        message: "Kotikit is not initialized in this project.",
        hint: `Missing ${configPath(root)}.`,
      }));
      nextSteps.push("Run kotikit_config_init before syncing or generating designs.");
    } else {
      checks.push(check({
        id: "config",
        label: "Config",
        status: "ok",
        message: `${config.figma.designSystemFiles.length} design-system file(s) configured.`,
      }));
    }
  } catch (err) {
    checks.push(check({
      id: "config",
      label: "Config",
      status: "error",
      message: err instanceof Error ? err.message : "The kotikit config could not be parsed.",
      hint: `Fix ${configPath(root)} or re-run kotikit_config_init.`,
    }));
    nextSteps.push("Fix the kotikit config before running other tools.");
  }

  const gitRepo = await checkGit(root);
  checks.push(check({
    id: "git",
    label: "Git",
    status: gitRepo ? "ok" : "warn",
    message: gitRepo
      ? "Project is inside a git repository."
      : "Project is not inside a git repository; auto-commits will be skipped.",
    hint: gitRepo ? undefined : "Run git init if you want kotikit auto-commit support.",
  }));

  checks.push(await schemaVersionCheck(root));

  const token = await resolveFigmaToken(root, config);
  const figmaFiles = config?.figma.designSystemFiles.length ?? 0;
  checks.push(check({
    id: "figma-token",
    label: "Figma token",
    status: token && token.length > 0 ? "ok" : figmaFiles > 0 ? "error" : "warn",
    message: token && token.length > 0
      ? "Figma token resolved without exposing its value."
      : figmaFiles > 0
        ? "A design system is configured, but FIGMA_TOKEN could not be resolved."
        : "No Figma token resolved yet.",
    hint: token && token.length > 0
      ? undefined
      : "Set FIGMA_TOKEN in the project .env file or set figma.token in .kotikit/config.json.",
  }));

  checks.push(check({
    id: "design-system",
    label: "Design system",
    status: designSystemArtifactsPresent(root) ? "ok" : figmaFiles > 0 ? "warn" : "warn",
    message: designSystemArtifactsPresent(root)
      ? "Local design-system databases and manifest exist."
      : figmaFiles > 0
        ? "Design-system files are configured, but local DB/manifest artifacts are missing."
        : "No design-system files are configured.",
    hint: designSystemArtifactsPresent(root)
      ? undefined
      : figmaFiles > 0
        ? "Run kotikit_sync_ds to build the local design-system index."
        : "Connect a Figma design system with kotikit_config_init when design-system reuse is needed.",
  }));

  const checkpointExists = await hasCheckpoint(root);
  checks.push(check({
    id: "sync-checkpoint",
    label: "Sync checkpoint",
    status: checkpointExists ? "warn" : "ok",
    message: checkpointExists
      ? "A resumable design-system sync checkpoint exists."
      : "No resumable sync checkpoint is present.",
    hint: checkpointExists ? "Run kotikit_sync_ds again to resume, or inspect design-system/.sync-checkpoint.json." : undefined,
  }));

  const gateReport = await checkGates({ root, config });
  checks.push(check({
    id: "gates",
    label: "Code gates",
    status: gateReport.ok ? "ok" : "warn",
    message: gateReport.ok
      ? "Configured code gates are available."
      : `${gateReport.missing.length} configured code gate(s) are missing.`,
    hint: gateHint(gateReport),
  }));

  checks.push(await bridgeMessage(root));

  const errors = checks.filter((item) => item.status === "error");
  if (errors.some((item) => item.id === "figma-token")) {
    nextSteps.push("Add FIGMA_TOKEN before syncing design systems or reading Figma comments.");
  }
  if (
    checks.some((item) => item.id === "design-system" && item.status === "warn") &&
    figmaFiles > 0
  ) {
    nextSteps.push("Run kotikit_sync_ds after the Figma token is available.");
  }

  return {
    ok: errors.length === 0,
    root,
    checks,
    nextSteps: Array.from(new Set(nextSteps)),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const title = report.ok ? "kotikit doctor: ok" : "kotikit doctor: issues found";
  const lines = [
    title,
    `Root: ${report.root}`,
    "",
    ...report.checks.flatMap((item) => [
      `[${item.status}] ${item.label}: ${item.message}`,
      ...(item.hint ? [`  hint: ${item.hint}`] : []),
      ...(item.details?.map((detail) => `  - ${detail}`) ?? []),
    ]),
  ];

  if (report.nextSteps.length > 0) {
    lines.push("", "Next steps:", ...report.nextSteps.map((step) => `- ${step}`));
  }

  return `${lines.join("\n")}\n`;
}
