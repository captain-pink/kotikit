import { z } from "zod";
import { slugifyComponentName } from "../util/ids.js";
import { nowIso } from "../util/ids.js";

// ─── Output shape: ComponentJson (the on-disk per-component file) ────────────

export const ComponentJsonSchema = z.object({
  name: z.string(),
  key: z.string(),
  fileKey: z.string(),
  path: z.string(),
  description: z.string().optional(),
  variants: z.array(z.object({
    propertyName: z.string(),
    values: z.array(z.string()),
  })).default([]),
  properties: z.record(z.string(), z.object({
    type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]),
    defaultValue: z.union([z.string(), z.boolean()]).optional(),
  })).default({}),
  defaultKey: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  updatedAt: z.string(),
});
export type ComponentJson = z.infer<typeof ComponentJsonSchema>;

// ─── Input shapes: narrow projections of Figma API responses ─────────────────
// (Phase 2 only uses fields we actually need. Pass through extra fields freely.)

export interface FigmaPublishedComponent {
  key: string;
  name: string;
  description?: string;
  thumbnail_url?: string;
  component_set_id?: string;
  containing_frame?: { pageName?: string; name?: string };
}

/**
 * Figma `componentPropertyDefinitions` value shape.
 * Variant properties have `type: "VARIANT"` and `variantOptions: string[]`.
 * Other types: BOOLEAN, TEXT, INSTANCE_SWAP — with optional defaultValue.
 */
export interface FigmaPropertyDefinition {
  type: "VARIANT" | "BOOLEAN" | "TEXT" | "INSTANCE_SWAP";
  defaultValue?: string | boolean;
  variantOptions?: string[];
}

export interface FigmaComponentSet {
  key: string;
  name: string;
  description?: string;
  defaultVariantId?: string;
  /** Property definitions, keyed by property name. */
  componentPropertyDefinitions?: Record<string, FigmaPropertyDefinition>;
}

export interface FigmaNode {
  /** Node-level property definitions (an alternative source when component_set isn't published). */
  componentPropertyDefinitions?: Record<string, FigmaPropertyDefinition>;
}

// ─── The mapper ───────────────────────────────────────────────────────────────

export function buildComponentJson(input: {
  fileKey: string;
  publishedComponent: FigmaPublishedComponent;
  componentSet?: FigmaComponentSet;
  nodeDetails?: FigmaNode;
}): ComponentJson {
  const { fileKey, publishedComponent, componentSet, nodeDetails } = input;

  // Prefer the component-set name/key/desc when present, otherwise fall back to the
  // published-component values.
  const name = componentSet?.name ?? publishedComponent.name;
  const key = componentSet?.key ?? publishedComponent.key;
  const description = componentSet?.description ?? publishedComponent.description;
  const defaultKey = componentSet?.defaultVariantId;
  const thumbnailUrl = publishedComponent.thumbnail_url;

  // Property definitions: prefer component set, then node details.
  const propDefs =
    componentSet?.componentPropertyDefinitions ??
    nodeDetails?.componentPropertyDefinitions ??
    {};

  // Split into variants (VARIANT type) and properties (everything else).
  const variants: ComponentJson["variants"] = [];
  const properties: ComponentJson["properties"] = {};

  for (const [propName, def] of Object.entries(propDefs)) {
    if (def.type === "VARIANT") {
      variants.push({
        propertyName: propName,
        values: def.variantOptions ?? [],
      });
    } else {
      properties[propName] = {
        type: def.type,
        ...(def.defaultValue !== undefined ? { defaultValue: def.defaultValue } : {}),
      };
    }
  }

  const slug = slugifyComponentName(name);

  const result = {
    name,
    key,
    fileKey,
    path: `components/${slug}.json`,
    ...(description !== undefined ? { description } : {}),
    variants,
    properties,
    ...(defaultKey !== undefined ? { defaultKey } : {}),
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    updatedAt: nowIso(),
  };

  return ComponentJsonSchema.parse(result);
}

/**
 * Build the space-separated `props` string for the components.db FTS5 column.
 * Includes ALL property names — variants and non-variants alike — so a search
 * for "size" finds a component that has Size as a variant.
 */
export function buildPropsString(json: ComponentJson): string {
  const variantNames = json.variants.map((v) => v.propertyName);
  const propertyNames = Object.keys(json.properties);
  return [...variantNames, ...propertyNames].join(" ");
}
