import { z } from "zod";

export const ConfigSchema = z.object({
  figma: z
    .object({
      token: z.string().optional(),
      designSystemFiles: z
        .array(
          z.object({
            key: z.string(),
            name: z.string(),
          })
        )
        .default([]),
    })
    .default({ designSystemFiles: [] }),
  project: z.object({
    framework: z.enum(["react"]).default("react"),
    codeComponentsDir: z.string().default("src/components"),
    tests: z.boolean().default(true),
    testFramework: z.enum(["vitest", "none"]).default("vitest"),
  }),
  defaults: z.object({
    breakpoints: z.array(z.number().int().positive()).default([375, 768, 1024, 1440]),
    themes: z.array(z.string()).default(["light", "dark"]),
  }),
  git: z
    .object({
      autoCommit: z.boolean().default(true),
    })
    .default({ autoCommit: true }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Returns a fully-defaulted Config object with no user overrides. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({
    project: {
      framework: "react",
      codeComponentsDir: "src/components",
      tests: true,
      testFramework: "vitest",
    },
    defaults: {
      breakpoints: [375, 768, 1024, 1440],
      themes: ["light", "dark"],
    },
  });
}

/** Parse raw JSON into a Config, throwing a plain-English KotikitError on failure. */
export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".") || "root").join(", ");
    throw new Error(
      `The kotikit config file has an invalid format. Problem with: ${fields}. ` +
        `Try running /kotikit:auto to reinitialize the config.`
    );
  }
  return result.data;
}
