import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { CONFIG_SCHEMA_VERSION } from "../config/schema.js";
import { configPath } from "../util/paths.js";

type SchemaArtifactKind = "config";

export type SchemaArtifactStatus = "current" | "legacy-or-older" | "future" | "unreadable";

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

const addSample = (samples: string[], path: string): string[] =>
  samples.length >= 5 ? samples : [...samples, path];

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
  const schemaVersion =
    "schemaVersion" in raw ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
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
  const latestVersion = CONFIG_SCHEMA_VERSION;
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
  const path = configPath(root);
  if (!existsSync(path)) return emptyInventory();
  return inspectArtifact(emptyInventory(), { path, kind: "config" });
}
