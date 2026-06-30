import type { Config } from "./schema";
import { defaultConfig, parseConfig } from "./schema";

export interface InitAnswers {
  autoCommit?: boolean;
  coAuthor?: Config["git"]["coAuthor"];
  figmaFiles?: { key: string; name: string }[];
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
    git: {
      ...base.git,
      autoCommit: answers.autoCommit ?? base.git.autoCommit,
      coAuthor: answers.coAuthor ?? base.git.coAuthor,
    },
  });
}
