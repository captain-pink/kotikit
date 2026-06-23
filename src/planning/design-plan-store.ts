import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { designPlanPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";
import { type DesignPlan, parseDesignPlan } from "./design-plan-schema.js";

/** Write the plan as pretty JSON with a trailing newline. Returns absolute path. */
export async function writeDesignPlan(
  root: string,
  scope: string,
  screen: string | null,
  plan: DesignPlan
): Promise<string> {
  const path = designPlanPath(root, scope, screen);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  return path;
}

/**
 * Read + validate. Returns null if file is missing.
 * Throws KotikitError on JSON parse failure or schema mismatch.
 */
export async function readDesignPlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<DesignPlan | null> {
  const path = designPlanPath(root, scope, screen);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    const text = await readFile(path, "utf-8");
    raw = JSON.parse(text);
  } catch {
    throw new KotikitError(
      "The design plan file could not be read.",
      "It may have been edited manually and become malformed. Delete it and regenerate via plan_design."
    );
  }
  try {
    return parseDesignPlan(raw);
  } catch (err) {
    throw new KotikitError("The design plan file has an invalid format.", (err as Error).message);
  }
}

/** Remove the plan file if it exists; no-op when absent. */
export async function deleteDesignPlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<void> {
  const path = designPlanPath(root, scope, screen);
  if (existsSync(path)) await unlink(path);
}
