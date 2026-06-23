import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { componentPlanPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";
import { type ComponentPlan, parseComponentPlan } from "./component-plan-schema.js";

/** Write the component plan as pretty JSON with a trailing newline. Returns absolute path. */
export async function writeComponentPlan(
  root: string,
  scope: string,
  screen: string | null,
  plan: ComponentPlan
): Promise<string> {
  const path = componentPlanPath(root, scope, screen);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
  return path;
}

/** Read + validate. Returns null if the component plan is missing. */
export async function readComponentPlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<ComponentPlan | null> {
  const path = componentPlanPath(root, scope, screen);
  if (!existsSync(path)) return null;

  let raw: unknown;
  try {
    const text = await readFile(path, "utf-8");
    raw = JSON.parse(text);
  } catch {
    throw new KotikitError(
      "The component plan file could not be read.",
      "It may have been edited manually and become malformed. Delete it and create the component plan again."
    );
  }

  return parseComponentPlan(raw);
}

/** Remove the component plan file if it exists; no-op when absent. */
export async function deleteComponentPlan(
  root: string,
  scope: string,
  screen: string | null
): Promise<void> {
  const path = componentPlanPath(root, scope, screen);
  if (existsSync(path)) await unlink(path);
}
