import { z } from "zod";
import { KotikitError } from "../util/result.js";

export const CONFIG_SCHEMA_VERSION = 1;

const FlowPackExtensionSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  versionOrRef: z.string().min(1),
  hash: z.string().min(1),
  capabilities: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(false),
});

const FlowPacksSchema = z
  .object({
    projectFlowsEnabled: z.boolean().default(false),
    allowedProjectCapabilities: z.array(z.string().min(1)).default([]),
    extensions: z.array(FlowPackExtensionSchema).default([]),
  })
  .default({
    projectFlowsEnabled: false,
    allowedProjectCapabilities: [],
    extensions: [],
  });

const FigmaSectionDefaultsSchema = z
  .object({
    background: z
      .object({
        color: z
          .string()
          .regex(/^#?[0-9a-fA-F]{6}$/)
          .transform((value) => value.replace(/^#/, "").toUpperCase())
          .default("AED0FF"),
        opacity: z.number().min(0).max(1).default(0.1),
      })
      .default({ color: "AED0FF", opacity: 0.1 }),
  })
  .default({
    background: {
      color: "AED0FF",
      opacity: 0.1,
    },
  });

const ConfigSchema = z.object({
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
    figmaSection: FigmaSectionDefaultsSchema,
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
  flowPacks: FlowPacksSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

/** Returns a fully-defaulted Config object with no user overrides. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaults: {
      breakpoints: [375, 768, 1024, 1440],
      themes: ["light", "dark"],
      figmaSection: {
        background: {
          color: "AED0FF",
          opacity: 0.1,
        },
      },
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
