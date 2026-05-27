import { defaultConfig, ConfigSchema } from "./schema";
import type { Config } from "./schema";

export interface InitAnswers {
  framework?: "react";
  codeComponentsDir?: string;
  tests?: boolean;
  autoCommit?: boolean;
  figmaFiles?: { key: string; name: string }[];
}

/**
 * Merge wizard answers over defaultConfig(); returns a validated Config.
 * Every field is optional — missing answers fall back to defaults.
 */
export function buildConfig(answers: InitAnswers): Config {
  const base = defaultConfig();
  return ConfigSchema.parse({
    ...base,
    figma: {
      ...base.figma,
      designSystemFiles: answers.figmaFiles ?? base.figma.designSystemFiles,
    },
    project: {
      ...base.project,
      framework: answers.framework ?? base.project.framework,
      codeComponentsDir: answers.codeComponentsDir ?? base.project.codeComponentsDir,
      tests: answers.tests ?? base.project.tests,
    },
    defaults: base.defaults,
    git: {
      ...base.git,
      autoCommit: answers.autoCommit ?? base.git.autoCommit,
    },
  });
}
