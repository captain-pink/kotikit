import { existsSync } from "fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { KotikitError } from "../../util/result.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string
) => Promise<CommandResult>;

export interface PreparePluginBuildDeps {
  runCommand?: CommandRunner;
}

export interface PreparePluginBuildResult {
  rebuilt: boolean;
  packageManager?: "bun" | "npm";
  warning?: string;
}

const REQUIRED_DIST_FILES = ["dist/code.js", "dist/ui.html"];
const TOP_LEVEL_BUILD_INPUTS = [
  "package.json",
  "bun.lock",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.code.json",
  "vite.config.ts",
  "code.ts",
];
const BUILD_INPUT_DIRS = ["src", "ui"];
const LOCALHOST_BRIDGE_DOMAIN =
  /^(?:https?|ws):\/\/localhost(?::(?:\d+|\*))?$/;

export const defaultPluginRoot = (): string =>
  fileURLToPath(new URL("../../../figma-plugin", import.meta.url));

export async function patchPluginManifestAllowedDomains(
  pluginRoot: string,
  port: number
): Promise<string[]> {
  const manifestPath = join(pluginRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new KotikitError(
      "Figma plugin manifest is missing.",
      `Expected to find ${manifestPath}. Reinstall or rebuild kotikit, then start the bridge again.`
    );
  }

  const manifest = parseManifest(await readFile(manifestPath, "utf-8"), manifestPath);
  const existingDomains = manifest.networkAccess.allowedDomains
    .filter((domain) => !LOCALHOST_BRIDGE_DOMAIN.test(domain));
  const allowedDomains = [
    `http://localhost:${port}`,
    `ws://localhost:${port}`,
    `https://localhost:${port}`,
    ...existingDomains,
  ];
  const nextManifest = {
    ...manifest.raw,
    networkAccess: {
      ...manifest.raw.networkAccess,
      allowedDomains,
    },
  };

  await writeJsonAtomic(manifestPath, nextManifest);
  return allowedDomains;
}

export async function preparePluginBuild(
  pluginRoot: string,
  deps: PreparePluginBuildDeps = {}
): Promise<PreparePluginBuildResult> {
  if (await isDistFresh(pluginRoot)) return { rebuilt: false };

  const runCommand = deps.runCommand ?? runCommandWithSpawn;
  const packageManager = await resolvePackageManager(pluginRoot, runCommand);
  const installIsNeeded = await needsInstall(pluginRoot);
  if (installIsNeeded) {
    await runRequiredCommand(
      runCommand,
      packageManager.command,
      packageManager.installArgs,
      pluginRoot,
      `install Figma plugin dependencies with ${packageManager.name}`
    );
  }

  await runRequiredCommand(
    runCommand,
    packageManager.command,
    packageManager.buildArgs,
    pluginRoot,
    "build the Figma plugin"
  );

  if (!(await hasRequiredDistFiles(pluginRoot))) {
    throw new KotikitError(
      "I couldn't build the Figma plugin.",
      `The build finished but did not produce ${REQUIRED_DIST_FILES.join(" and ")}.`
    );
  }

  return {
    rebuilt: true,
    packageManager: packageManager.name,
    ...(packageManager.warning ? { warning: packageManager.warning } : {}),
  };
}

interface ParsedManifest {
  raw: Record<string, unknown> & {
    networkAccess: Record<string, unknown>;
  };
  networkAccess: {
    allowedDomains: string[];
  };
}

const parseManifest = (text: string, manifestPath: string): ParsedManifest => {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw)) throw new Error("manifest root must be an object");
    const networkAccess = raw.networkAccess;
    if (!isRecord(networkAccess)) throw new Error("networkAccess must be an object");
    const allowedDomains = networkAccess.allowedDomains;
    if (!Array.isArray(allowedDomains) || !allowedDomains.every((domain) => typeof domain === "string")) {
      throw new Error("networkAccess.allowedDomains must be an array of strings");
    }
    return {
      raw: raw as ParsedManifest["raw"],
      networkAccess: { allowedDomains },
    };
  } catch {
    throw new KotikitError(
      "Figma plugin manifest could not be updated.",
      `Check that ${manifestPath} is valid JSON with networkAccess.allowedDomains.`
    );
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tmp, path);
};

const hasRequiredDistFiles = async (pluginRoot: string): Promise<boolean> => {
  const results = await Promise.all(
    REQUIRED_DIST_FILES.map((path) => stat(join(pluginRoot, path)).then(() => true).catch(() => false))
  );
  return results.every(Boolean);
};

const isDistFresh = async (pluginRoot: string): Promise<boolean> => {
  const distStats = await Promise.all(
    REQUIRED_DIST_FILES.map((path) => stat(join(pluginRoot, path)).catch(() => null))
  );
  if (distStats.some((entry) => entry === null)) return false;

  const sourceFiles = await buildInputFiles(pluginRoot);
  const sourceStats = await Promise.all(
    sourceFiles.map((path) => stat(path).then((entry) => entry.mtimeMs).catch(() => 0))
  );
  const newestSource = Math.max(0, ...sourceStats);
  const oldestDist = Math.min(...distStats.map((entry) => entry?.mtimeMs ?? 0));
  return oldestDist >= newestSource;
};

const needsInstall = async (pluginRoot: string): Promise<boolean> => {
  const nodeModulesStat = await stat(join(pluginRoot, "node_modules")).catch(() => null);
  if (nodeModulesStat === null) return true;

  const dependencyFiles = await Promise.all(
    ["package.json", "bun.lock", "package-lock.json"]
      .map((path) => stat(join(pluginRoot, path)).then((entry) => entry.mtimeMs).catch(() => 0))
  );
  return nodeModulesStat.mtimeMs < Math.max(0, ...dependencyFiles);
};

const buildInputFiles = async (pluginRoot: string): Promise<string[]> => {
  const topLevel = TOP_LEVEL_BUILD_INPUTS.map((path) => join(pluginRoot, path))
    .filter((path) => existsSync(path));
  const nested = await Promise.all(
    BUILD_INPUT_DIRS.map((path) => collectFiles(join(pluginRoot, path)))
  );
  return [...topLevel, ...nested.flat()];
};

const collectFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return collectFiles(path);
      if (entry.isFile()) return [path];
      return [];
    })
  );
  return nested.flat();
};

interface PackageManager {
  name: "bun" | "npm";
  command: "bun" | "npm";
  installArgs: string[];
  buildArgs: string[];
  warning?: string;
}

const resolvePackageManager = async (
  pluginRoot: string,
  runCommand: CommandRunner
): Promise<PackageManager> => {
  const bun = await runCommand("bun", ["--version"], pluginRoot);
  if (bun.code === 0) {
    return {
      name: "bun",
      command: "bun",
      installArgs: ["install"],
      buildArgs: ["run", "build"],
    };
  }

  const npm = await runCommand("npm", ["--version"], pluginRoot);
  if (npm.code !== 0) {
    throw new KotikitError(
      "I couldn't build the Figma plugin because no package manager is available.",
      `Install Bun, then start the bridge again. Raw output:\n${formatOutput(npm)}`
    );
  }

  return {
    name: "npm",
    command: "npm",
    installArgs: ["install"],
    buildArgs: ["run", "build"],
    warning: "Bun was not available, so kotikit used npm. Installing Bun is recommended for this project.",
  };
};

const runRequiredCommand = async (
  runCommand: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  action: string
): Promise<CommandResult> => {
  const result = await runCommand(command, args, cwd);
  if (result.code === 0) return result;
  throw new KotikitError(
    `I couldn't ${action}.`,
    `Raw output:\n${formatOutput(result)}`
  );
};

const formatOutput = (result: CommandResult): string => {
  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter((part) => part.length > 0)
    .join("\n");
  return output.length > 0 ? output : `(exit code ${result.code})`;
};

const runCommandWithSpawn: CommandRunner = async (command, args, cwd) => {
  try {
    const proc = Bun.spawn([command, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (err) {
    return {
      code: 1,
      stdout: "",
      stderr: err instanceof Error ? err.message : "Command failed to start.",
    };
  }
};
