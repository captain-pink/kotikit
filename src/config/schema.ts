import { z } from "zod";
import { KotikitError } from "../util/result.js";

export const CONFIG_SCHEMA_VERSION = 1;

export const ConfigSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .positive()
    .max(CONFIG_SCHEMA_VERSION)
    .default(CONFIG_SCHEMA_VERSION),
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
  defaults: z.object({
    breakpoints: z.array(z.number().int().positive()).default([375, 768, 1024, 1440]),
    themes: z.array(z.string()).default(["light", "dark"]),
  }),
  git: z
    .object({
      autoCommit: z.boolean().default(true),
      coAuthor: z
        .object({
          name: z.string().trim().min(1),
          email: z.string().trim().min(1),
        })
        .default({
          name: "Claude Code",
          email: "noreply@anthropic.com",
        }),
    })
    .default({
      autoCommit: true,
      coAuthor: {
        name: "Claude Code",
        email: "noreply@anthropic.com",
      },
    }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Returns a fully-defaulted Config object with no user overrides. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({
    schemaVersion: CONFIG_SCHEMA_VERSION,
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
    throw new KotikitError(
      `The kotikit config file has an invalid format. Problem with: ${fields}. ` +
        `Try running /kotikit-auto in Claude Code or kotikit:auto in Codex to reinitialize the config.`
    );
  }
  return result.data;
}
