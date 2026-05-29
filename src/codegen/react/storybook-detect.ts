import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * Returns true if Storybook appears to be installed/configured in the user's project.
 *
 * Detection logic:
 *   1. If <root>/.storybook directory exists → true.
 *   2. Else if <root>/package.json has "storybook" key in `devDependencies` OR `dependencies`,
 *      OR any key matching /^@storybook\// in either → true.
 *   3. Else → false.
 *
 * Reads package.json lazily. On read/parse error, returns false (does NOT throw).
 */
export async function hasStorybook(root: string): Promise<boolean> {
  // 1. Check for .storybook directory
  if (existsSync(join(root, ".storybook"))) return true;

  // 2. Check package.json
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const text = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const key of Object.keys(deps)) {
      if (key === "storybook") return true;
      if (key.startsWith("@storybook/")) return true;
    }
    return false;
  } catch {
    return false;
  }
}
