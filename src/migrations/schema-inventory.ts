import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { basename, join } from "path";
import { CONFIG_SCHEMA_VERSION } from "../config/schema.js";
import {
  FLOW_MANIFEST_SCHEMA_VERSION,
  SCREEN_SPEC_SCHEMA_VERSION,
} from "../spec/schema.js";
import { configPath, scopeDir } from "../util/paths.js";

export type SchemaArtifactKind = "config" | "screen" | "flow";

export type SchemaArtifactStatus =
  | "current"
  | "legacy-or-older"
  | "future"
  | "unreadable";

export interface SchemaArtifactFinding {
  path: string;
  kind: SchemaArtifactKind;
  status: SchemaArtifactStatus;
  schemaVersion: number | null;
  latestVersion: number;
  reason: string;
}

export interface SchemaInventory {
  checked: number;
  current: number;
  legacyOrOlder: number;
  future: number;
  unreadable: number;
  samples: string[];
  findings: SchemaArtifactFinding[];
}

interface ArtifactRef {
  path: string;
  kind: SchemaArtifactKind;
}

const emptyInventory = (): SchemaInventory => ({
  checked: 0,
  current: 0,
  legacyOrOlder: 0,
  future: 0,
  unreadable: 0,
  samples: [],
  findings: [],
});

const latestFor = (kind: SchemaArtifactKind): number => {
  if (kind === "config") return CONFIG_SCHEMA_VERSION;
  if (kind === "flow") return FLOW_MANIFEST_SCHEMA_VERSION;
  return SCREEN_SPEC_SCHEMA_VERSION;
};

const artifactKindForFile = (path: string): SchemaArtifactKind | null => {
  const name = basename(path);
  if (name === "flow.json") return "flow";
  if (name === "spec.json" || name.endsWith(".spec.json")) return "screen";
  return null;
};

const addSample = (samples: string[], path: string): string[] =>
  samples.length >= 5 ? samples : [...samples, path];

async function listSpecArtifacts(root: string): Promise<ArtifactRef[]> {
  const specsRoot = scopeDir(root, "");
  if (!existsSync(specsRoot)) return [];

  const walk = async (dir: string): Promise<ArtifactRef[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const nested = await Promise.all(
      sortedEntries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        const kind = artifactKindForFile(path);
        return kind === null ? [] : [{ path, kind }];
      })
    );
    return nested.flat();
  };

  return walk(specsRoot);
}

const inspectRawSchemaVersion = (
  raw: unknown,
  latest: number
): Pick<SchemaArtifactFinding, "status" | "schemaVersion" | "reason"> => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "legacy-or-older",
      schemaVersion: null,
      reason: "not a JSON object",
    };
  }
  const schemaVersion = "schemaVersion" in raw
    ? (raw as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  if (schemaVersion === undefined) {
    return {
      status: "legacy-or-older",
      schemaVersion: null,
      reason: "missing schemaVersion",
    };
  }
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return {
      status: "legacy-or-older",
      schemaVersion: null,
      reason: "invalid schemaVersion",
    };
  }
  if (schemaVersion > latest) {
    return {
      status: "future",
      schemaVersion,
      reason: `schemaVersion ${schemaVersion} is newer than ${latest}`,
    };
  }
  if (schemaVersion < latest) {
    return {
      status: "legacy-or-older",
      schemaVersion,
      reason: `schemaVersion ${schemaVersion} is older than ${latest}`,
    };
  }
  return {
    status: "current",
    schemaVersion,
    reason: "current",
  };
};

async function inspectArtifact(
  inventory: SchemaInventory,
  artifact: ArtifactRef
): Promise<SchemaInventory> {
  const latestVersion = latestFor(artifact.kind);
  try {
    const raw = JSON.parse(await readFile(artifact.path, "utf-8"));
    const finding = {
      path: artifact.path,
      kind: artifact.kind,
      latestVersion,
      ...inspectRawSchemaVersion(raw, latestVersion),
    };
    if (finding.status === "current") {
      return {
        ...inventory,
        checked: inventory.checked + 1,
        current: inventory.current + 1,
        findings: [...inventory.findings, finding],
      };
    }
    if (finding.status === "future") {
      return {
        ...inventory,
        checked: inventory.checked + 1,
        future: inventory.future + 1,
        samples: addSample(inventory.samples, artifact.path),
        findings: [...inventory.findings, finding],
      };
    }
    return {
      ...inventory,
      checked: inventory.checked + 1,
      legacyOrOlder: inventory.legacyOrOlder + 1,
      samples: addSample(inventory.samples, artifact.path),
      findings: [...inventory.findings, finding],
    };
  } catch {
    const finding: SchemaArtifactFinding = {
      path: artifact.path,
      kind: artifact.kind,
      status: "unreadable",
      schemaVersion: null,
      latestVersion,
      reason: "invalid JSON",
    };
    return {
      ...inventory,
      checked: inventory.checked + 1,
      unreadable: inventory.unreadable + 1,
      samples: addSample(inventory.samples, artifact.path),
      findings: [...inventory.findings, finding],
    };
  }
}

export async function inspectProjectSchemaVersions(root: string): Promise<SchemaInventory> {
  const artifacts = [
    ...(existsSync(configPath(root)) ? [{ path: configPath(root), kind: "config" as const }] : []),
    ...(await listSpecArtifacts(root)),
  ];
  const inspected = await Promise.all(
    artifacts.map((artifact) => inspectArtifact(emptyInventory(), artifact))
  );
  return inspected.reduce(
    (acc, item) => ({
      checked: acc.checked + item.checked,
      current: acc.current + item.current,
      legacyOrOlder: acc.legacyOrOlder + item.legacyOrOlder,
      future: acc.future + item.future,
      unreadable: acc.unreadable + item.unreadable,
      samples: [...acc.samples, ...item.samples].slice(0, 5),
      findings: [...acc.findings, ...item.findings],
    }),
    emptyInventory()
  );
}
