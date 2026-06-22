import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { basename, join } from "path";
import { CONFIG_SCHEMA_VERSION } from "../config/schema.js";
import {
  FLOW_MANIFEST_SCHEMA_VERSION,
  SCREEN_SPEC_SCHEMA_VERSION,
} from "../spec/schema.js";
import { configPath, scopeDir } from "../util/paths.js";

export interface SchemaInventory {
  checked: number;
  legacyOrOlder: number;
  future: number;
  unreadable: number;
  samples: string[];
}

type ArtifactKind = "config" | "screen" | "flow";

interface ArtifactRef {
  path: string;
  kind: ArtifactKind;
}

const emptyInventory = (): SchemaInventory => ({
  checked: 0,
  legacyOrOlder: 0,
  future: 0,
  unreadable: 0,
  samples: [],
});

const latestFor = (kind: ArtifactKind): number => {
  if (kind === "config") return CONFIG_SCHEMA_VERSION;
  if (kind === "flow") return FLOW_MANIFEST_SCHEMA_VERSION;
  return SCREEN_SPEC_SCHEMA_VERSION;
};

const artifactKindForFile = (path: string): ArtifactKind | null => {
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
    const nested = await Promise.all(
      entries.map(async (entry) => {
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
): "current" | "legacy-or-older" | "future" => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "legacy-or-older";
  }
  const schemaVersion = "schemaVersion" in raw
    ? (raw as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  if (schemaVersion === undefined) return "legacy-or-older";
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return "legacy-or-older";
  }
  if (schemaVersion > latest) return "future";
  if (schemaVersion < latest) return "legacy-or-older";
  return "current";
};

async function inspectArtifact(
  inventory: SchemaInventory,
  artifact: ArtifactRef
): Promise<SchemaInventory> {
  try {
    const raw = JSON.parse(await readFile(artifact.path, "utf-8"));
    const status = inspectRawSchemaVersion(raw, latestFor(artifact.kind));
    if (status === "current") return { ...inventory, checked: inventory.checked + 1 };
    if (status === "future") {
      return {
        ...inventory,
        checked: inventory.checked + 1,
        future: inventory.future + 1,
        samples: addSample(inventory.samples, artifact.path),
      };
    }
    return {
      ...inventory,
      checked: inventory.checked + 1,
      legacyOrOlder: inventory.legacyOrOlder + 1,
      samples: addSample(inventory.samples, artifact.path),
    };
  } catch {
    return {
      ...inventory,
      checked: inventory.checked + 1,
      unreadable: inventory.unreadable + 1,
      samples: addSample(inventory.samples, artifact.path),
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
      legacyOrOlder: acc.legacyOrOlder + item.legacyOrOlder,
      future: acc.future + item.future,
      unreadable: acc.unreadable + item.unreadable,
      samples: [...acc.samples, ...item.samples].slice(0, 5),
    }),
    emptyInventory()
  );
}
