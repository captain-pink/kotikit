import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import type { ScreenSpec, FlowManifest } from "./schema";
import { parseScreenSpec, parseFlowManifest } from "./schema";
import {
  scopeDir,
  screenSpecPath,
  singleSpecPath,
  flowManifestPath,
} from "../util/paths";
import { upsertIndexEntry, readIndex } from "./index-store";
import type { IndexEntry } from "./index-store";
import { KotikitError } from "../util/result";

/**
 * Write a screen spec to disk and update the index.
 * @param screenSlug - null for a single-screen scope (writes spec.json); otherwise writes <slug>.spec.json
 * @returns the absolute path of the written file
 */
export async function writeScreenSpec(
  root: string,
  scope: string,
  screenSlug: string | null,
  spec: ScreenSpec
): Promise<string> {
  const dir = scopeDir(root, scope);
  await mkdir(dir, { recursive: true });
  const path = screenSlug
    ? screenSpecPath(root, scope, screenSlug)
    : singleSpecPath(root, scope);
  await writeFile(path, JSON.stringify(spec, null, 2) + "\n", "utf-8");

  // Update index — for single-screen scopes, the "screens" list is [screenSlug ?? scope]
  await upsertIndexEntry(root, {
    scope,
    title: spec.title,
    kind: "screen",
    status: spec.status,
    screens: [screenSlug ?? scope],
    updatedAt: spec.metadata.updatedAt,
  });

  return path;
}

/**
 * Read a screen spec from disk.
 * @param screenSlug - null reads spec.json; otherwise reads <slug>.spec.json
 */
export async function readScreenSpec(
  root: string,
  scope: string,
  screenSlug: string | null
): Promise<ScreenSpec> {
  const path = screenSlug
    ? screenSpecPath(root, scope, screenSlug)
    : singleSpecPath(root, scope);
  if (!existsSync(path)) {
    const slug = screenSlug ?? "spec";
    throw new KotikitError(
      `I couldn't find a screen called "${slug}" in the "${scope}" scope.`,
      `Check that the scope and screen name are spelled correctly, or use spec_list to see what exists.`
    );
  }
  const text = await readFile(path, "utf-8");
  return parseScreenSpec(JSON.parse(text));
}

/**
 * Write a flow manifest to disk and update the index.
 * @returns the absolute path of the written file
 */
export async function writeFlowManifest(
  root: string,
  scope: string,
  manifest: FlowManifest
): Promise<string> {
  const dir = scopeDir(root, scope);
  await mkdir(dir, { recursive: true });
  const path = flowManifestPath(root, scope);
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  // Update index for the flow entry (screens list is the screen IDs)
  await upsertIndexEntry(root, {
    scope,
    title: manifest.title,
    kind: "flow",
    status: "draft",
    screens: manifest.screens.map((s) => s.id),
    updatedAt: manifest.metadata.updatedAt,
  });

  return path;
}

/**
 * Read a flow manifest from disk.
 */
export async function readFlowManifest(
  root: string,
  scope: string
): Promise<FlowManifest> {
  const path = flowManifestPath(root, scope);
  if (!existsSync(path)) {
    throw new KotikitError(
      `I couldn't find a flow called "${scope}".`,
      `Use spec_list to see existing flows, or create it with flow_create.`
    );
  }
  const text = await readFile(path, "utf-8");
  return parseFlowManifest(JSON.parse(text));
}

/** List all known scopes by reading the index (never reads spec bodies). */
export async function listScopes(root: string): Promise<IndexEntry[]> {
  return readIndex(root);
}

/** Returns true if the scope directory exists on disk. */
export async function scopeExists(root: string, scope: string): Promise<boolean> {
  return existsSync(scopeDir(root, scope));
}
