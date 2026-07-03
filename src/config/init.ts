import type { Config } from "./schema";
import { defaultConfig, parseConfig } from "./schema";

export interface InitAnswers {
  figmaFiles?: { key: string; name: string }[];
  flowPacks?: Config["flowPacks"];
}

/**
 * Merge wizard answers over defaultConfig(); returns a validated Config.
 * Every field is optional — missing answers fall back to defaults.
 */
export function buildConfig(answers: InitAnswers): Config {
  const base = defaultConfig();
  return parseConfig({
    ...base,
    figma: {
      ...base.figma,
      designSystemFiles: answers.figmaFiles ?? base.figma.designSystemFiles,
    },
    defaults: base.defaults,
    flowPacks: answers.flowPacks ?? base.flowPacks,
  });
}
