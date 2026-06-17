import { defaultConfig, parseConfig } from "./schema";
import type { Config } from "./schema";

export interface InitAnswers {
  framework?: "react";
  codeComponentsDir?: string;
  tests?: boolean;
  testFramework?: "vitest" | "none";
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
    project: {
      ...base.project,
      framework: answers.framework ?? base.project.framework,
      codeComponentsDir: answers.codeComponentsDir ?? base.project.codeComponentsDir,
      tests: answers.tests ?? base.project.tests,
      testFramework: answers.testFramework ?? base.project.testFramework,
    },
    defaults: base.defaults,
    git: {
      ...base.git,
      autoCommit: answers.autoCommit ?? base.git.autoCommit,
      coAuthor: answers.coAuthor ?? base.git.coAuthor,
    },
  });
}
