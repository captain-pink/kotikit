import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { indexPath } from "../util/paths";

export interface IndexEntry {
  scope: string;       // folder name, e.g. "checkout-flow"
  title: string;
  kind: "screen" | "flow";
  status: "draft" | "active";
  screens: string[];   // screen slugs; for single-screen: [scope-slug]; for flow: ["cart","shipping",…]
  updatedAt: string;   // ISO-8601
}

/** Read the index, returning an empty array if the file does not exist. */
export async function readIndex(root: string): Promise<IndexEntry[]> {
  const path = indexPath(root);
  if (!existsSync(path)) return [];
  try {
    const text = await readFile(path, "utf-8");
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw as IndexEntry[];
  } catch {
    return [];
  }
}

/** Insert or replace an entry for the given scope. */
export async function upsertIndexEntry(root: string, entry: IndexEntry): Promise<void> {
  const existing = await readIndex(root);
  const idx = existing.findIndex((e) => e.scope === entry.scope);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  const path = indexPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}

/** Remove the entry for a scope from the index (no-op if not present). */
export async function removeIndexEntry(root: string, scope: string): Promise<void> {
  const existing = await readIndex(root);
  const filtered = existing.filter((e) => e.scope !== scope);
  const path = indexPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(filtered, null, 2) + "\n", "utf-8");
}
