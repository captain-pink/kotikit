import { resolveSecret } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { defaultConfig } from "../config/schema.js";
import { loadDotEnv } from "../util/env.js";

const DEFAULT_FIGMA_TOKEN_REF = "$" + "{FIGMA_TOKEN}";

const figmaTokenRef = (configToken: string | undefined): string => {
  const trimmed = configToken?.trim();
  return trimmed === undefined || trimmed === "" ? DEFAULT_FIGMA_TOKEN_REF : trimmed;
};

export const resolveFigmaToken = async (
  root: string,
  config: Config | null
): Promise<string | undefined> => {
  await loadDotEnv(root, { overrideEmpty: true });
  return resolveSecret(figmaTokenRef((config ?? defaultConfig()).figma.token));
};
