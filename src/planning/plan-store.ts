import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { codePlanPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";
import { type CodePlan, parseCodePlan } from "./code-plan-schema.js";

/**
 * Write a code plan to disk.
 * @returns the absolute path written
 */
export async function writeCodePlan(
  root: string,
  scope: string,
  screen: string | null,
  plan: CodePlan
): Promise<string> {
  const path = codePlanPath(root, scope, screen);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
  return path;
}

/**
 * Read a code plan from disk, returning null if missing.
 * Throws KotikitError on malformed JSON or schema mismatch.
 */
export async function readCodePlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<CodePlan | null> {
  const path = codePlanPath(root, scope, screen);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    const text = await readFile(path, "utf-8");
    raw = JSON.parse(text);
  } catch {
    throw new KotikitError(
      "The code plan file could not be read.",
      "It may have been edited manually and become malformed. Delete it and regenerate via plan_code."
    );
  }
  try {
    return parseCodePlan(raw);
  } catch (err) {
    throw new KotikitError("The code plan file has an invalid format.", (err as Error).message);
  }
}

/** Remove the plan file if it exists; no-op when absent. */
export async function deleteCodePlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<void> {
  const path = codePlanPath(root, scope, screen);
  if (existsSync(path)) await unlink(path);
}
