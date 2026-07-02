import { z } from "zod";
import { nowIso, slugifyComponentName } from "../util/ids.js";

// ─── Output shape: ComponentJson (the on-disk per-component file) ────────────

export const ComponentJsonSchema = z.object({
  name: z.string(),
  key: z.string(),
  componentSetKey: z.string().optional(),
  fileKey: z.string(),
  path: z.string(),
  description: z.string().optional(),
  variants: z
    .array(
      z.object({
        propertyName: z.string(),
        values: z.array(z.string()),
      })
    )
    .default([]),
  properties: z
    .record(
      z.string(),
      z.object({
        type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]),
        defaultValue: z.union([z.string(), z.boolean()]).optional(),
      })
    )
    .default({}),
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
  containing_frame?: {
    pageName?: string;
    name?: string;
    containingComponentSet?: { nodeId?: string; name?: string };
    containingStateGroup?: { nodeId?: string; name?: string };
  };
}

/**
 * Figma `componentPropertyDefinitions` value shape.
 * Variant properties have `type: "VARIANT"` and `variantOptions: string[]`.
 * Other types: BOOLEAN, TEXT, INSTANCE_SWAP — with optional defaultValue.
 */
interface FigmaPropertyDefinition {
  type: string; // z.string() in schema — unknown Figma types are skipped in buildComponentJson
  defaultValue?: unknown; // INSTANCE_SWAP sends object refs; guarded at use site
  variantOptions?: string[];
}

export interface FigmaComponentSet {
  key: string;
  node_id?: string;
  name: string;
  description?: string;
  defaultVariantId?: string;
  /** Property definitions, keyed by property name. */
  componentPropertyDefinitions?: Record<string, FigmaPropertyDefinition>;
}

export interface FigmaNode {
  /** Node-level property definitions, used when published component-set metadata is sparse. */
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

  // Prefer the component-set name/desc when present, but keep `key` as a concrete
  // published component key so Figma draft generation can import it directly.
  const name = componentSet?.name ?? publishedComponent.name;
  const key = publishedComponent.key;
  const componentSetKey = componentSet?.key;
  const description = componentSet?.description ?? publishedComponent.description;
  const defaultKey = componentSet?.defaultVariantId;
  const thumbnailUrl = publishedComponent.thumbnail_url;

  // Property definitions: prefer component set, then node details.
  const propDefs =
    componentSet?.componentPropertyDefinitions ?? nodeDetails?.componentPropertyDefinitions ?? {};

  // Split into variants (VARIANT type) and properties (everything else).
  const variants: ComponentJson["variants"] = [];
  const properties: ComponentJson["properties"] = {};

  const KNOWN_PROP_TYPES = new Set(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]);
  for (const [propName, def] of Object.entries(propDefs)) {
    if (!KNOWN_PROP_TYPES.has(def.type)) continue; // skip future/unknown Figma types
    if (def.type === "VARIANT") {
      variants.push({
        propertyName: propName,
        values: def.variantOptions ?? [],
      });
    } else {
      // defaultValue can be an object ref (INSTANCE_SWAP) — only keep scalar defaults
      const rawDefault = def.defaultValue;
      const safeDefault =
        typeof rawDefault === "string" || typeof rawDefault === "boolean" ? rawDefault : undefined;
      properties[propName] = {
        type: def.type as "BOOLEAN" | "TEXT" | "INSTANCE_SWAP",
        ...(safeDefault !== undefined ? { defaultValue: safeDefault } : {}),
      };
    }
  }

  const slug = slugifyComponentName(name);

  const result = {
    name,
    key,
    ...(componentSetKey !== undefined ? { componentSetKey } : {}),
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
