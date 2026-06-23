import type { ComponentJson } from "../../sync/component-shape.js";

// ─── Slug + key helpers ───────────────────────────────────────────────────────

/**
 * Convert any variant value string to a lowercase-kebab slug.
 *
 * Algorithm:
 *   1. Insert a dash before each lowercase→uppercase transition to handle CamelCase
 *      (e.g. "PieChart" → "Pie-Chart").
 *   2. Insert a dash before each uppercase-run → uppercase+lower transition
 *      (e.g. "HTTPSConfig" → "HTTPS-Config").
 *   3. Trim, lowercase the whole string.
 *   4. Replace any run of non-alphanumeric characters (spaces, slashes, underscores, etc.)
 *      with a single dash.
 *   5. Strip leading/trailing dashes.
 *
 * Note: letter→digit boundaries are NOT split. "PieChart3D" → "pie-chart3d",
 * but "PieChart 3D" (space present) → "pie-chart-3d" because the space is a separator.
 * This matches Figma's typical naming convention where "3D" is a suffix, not a new word.
 *
 * Examples:
 *   "Primary"         → "primary"
 *   "On Hover"        → "on-hover"
 *   "PieChart 3D"     → "pie-chart-3d"
 *   "Pri/Sec"         → "pri-sec"
 *   "sm"              → "sm"
 *   "__leading--trailing__" → "leading-trailing"
 */
export function slugifyVariantValue(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Convert any name to lowercase-kebab-case.
 *
 * Uses the same CamelCase-aware algorithm as slugifyVariantValue but is
 * semantically intended for identifiers (prop keys, import names) rather than
 * display values.
 *
 * Examples:
 *   "Variant"   → "variant"
 *   "Size"      → "size"
 *   "IconRight" → "icon-right"
 */
export function kebabCase(input: string): string {
  return slugifyVariantValue(input);
}

/**
 * Map a Figma variant property name to the CVA prop key used in generated code.
 *
 * Clarity wrapper around kebabCase — makes call-sites read intentionally.
 *
 * "Variant" → "variant", "Size" → "size", "Icon Right" → "icon-right".
 */
export function variantPropKey(figmaPropertyName: string): string {
  return kebabCase(figmaPropertyName);
}

// ─── Defaults derivation ──────────────────────────────────────────────────────

/**
 * Derive the default value for each variant axis.
 *
 * Phase 4 MVP fallback: Figma's `defaultKey` identifies a child component node
 * by key, which maps to a specific combination of variant values — resolving that
 * combination requires a Figma API lookup that is a Phase 5+ refinement. Instead,
 * we simply use the FIRST value in each variant axis array as the default, which
 * corresponds to the first option listed in the Figma property panel.
 *
 * Returns Record<variantKeySlugified, valueSlugified>.
 * Returns an empty record if the component has no variants.
 */
export function deriveVariantDefaults(json: ComponentJson): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const axis of json.variants) {
    if (axis.values.length === 0) continue;
    const key = variantPropKey(axis.propertyName);
    const value = slugifyVariantValue(axis.values[0]!);
    defaults[key] = value;
  }
  return defaults;
}

// ─── Emission helpers ─────────────────────────────────────────────────────────

/**
 * Derive the HTML intrinsic element tag for a component based on its name.
 *
 * Heuristic (case-insensitive substring match, first match wins):
 *   "button"   → "button"
 *   "input"    → "input"
 *   "select"   → "select"
 *   "textarea" → "textarea"
 *   "label"    → "label"
 *   "anchor" or "link" → "a"
 *   default    → "div"
 *
 * Users can override the element by editing the generated file.
 */
export function intrinsicElementFor(componentName: string): string {
  const lower = componentName.toLowerCase();
  if (lower.includes("button")) return "button";
  if (lower.includes("input") || lower.includes("textfield")) return "input";
  if (lower.includes("select")) return "select";
  if (lower.includes("textarea")) return "textarea";
  if (lower.includes("label")) return "label";
  if (lower.includes("anchor") || lower.includes("link")) return "a";
  return "div";
}

/** Map an HTML element tag to the React attributes interface it should extend. */
function intrinsicAttrsFor(element: string): string {
  switch (element) {
    case "button":
      return "React.ButtonHTMLAttributes<HTMLButtonElement>";
    case "input":
      return "React.InputHTMLAttributes<HTMLInputElement>";
    case "select":
      return "React.SelectHTMLAttributes<HTMLSelectElement>";
    case "textarea":
      return "React.TextareaHTMLAttributes<HTMLTextAreaElement>";
    case "label":
      return "React.LabelHTMLAttributes<HTMLLabelElement>";
    case "a":
      return "React.AnchorHTMLAttributes<HTMLAnchorElement>";
    default:
      return "React.HTMLAttributes<HTMLDivElement>";
  }
}

/**
 * Emit the body of a `cva(...)` call as a formatted string.
 *
 * Tailwind utility class strings are emitted as `""` (empty string) — kotikit
 * is responsible for the CVA SHAPE; the agent fills in the Tailwind utility classes
 * during the generate/implement pass.
 *
 * If the component has no variant axes, returns `cva("")` (no options object).
 *
 * Example for a Button with Variant + Size axes:
 *
 *   cva("", {
 *     variants: {
 *       variant: { primary: "", secondary: "", destructive: "", ghost: "" },
 *       size:    { sm: "", md: "", lg: "" },
 *     },
 *     defaultVariants: { variant: "primary", size: "sm" },
 *   })
 */
export function emitCvaVariantsBlock(json: ComponentJson): string {
  if (json.variants.length === 0) {
    return `cva("")`;
  }

  const defaults = deriveVariantDefaults(json);

  const variantLines = json.variants.map((axis) => {
    const key = variantPropKey(axis.propertyName);
    const valuePairs = axis.values.map((v) => `${slugifyVariantValue(v)}: ""`).join(", ");
    return `      ${key}: { ${valuePairs} },`;
  });

  const defaultPairs = Object.entries(defaults)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(", ");

  return [
    `cva("", {`,
    `  variants: {`,
    ...variantLines,
    `  },`,
    `  defaultVariants: { ${defaultPairs} },`,
    `})`,
  ].join("\n");
}

/**
 * Emit the TypeScript Props interface declaration for a component.
 *
 * Structure:
 *   interface <Name>Props
 *     extends VariantProps<typeof <name>Variants>,
 *             React.<X>HTMLAttributes<HTML<X>Element> {
 *     // BOOLEAN properties → prop?: boolean
 *     // TEXT properties    → prop?: string
 *     // INSTANCE_SWAP      → prop?: React.ReactNode
 *     // VARIANT properties are NOT redeclared — they come through VariantProps
 *     children?: React.ReactNode;
 *   }
 *
 * Property name convention: the Figma property name is lowercased to produce the
 * TypeScript prop name (e.g. "Disabled" → "disabled", "Label" → "label").
 *
 * The `intrinsicElement` argument must be the result of `intrinsicElementFor(name)`.
 */
export function emitPropsInterface(json: ComponentJson, intrinsicElement: string): string {
  const pascalName = json.name
    .split(/[\s-_/]+/)
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join("");

  const variantsConst = `${pascalName.charAt(0).toLowerCase()}${pascalName.slice(1)}Variants`;
  const attrsType = intrinsicAttrsFor(intrinsicElement);

  // Collect non-VARIANT props
  const propLines: string[] = [];
  for (const [figmaPropName, def] of Object.entries(json.properties)) {
    if (def.type === "VARIANT") continue; // exposed via VariantProps
    const propName = figmaPropName.toLowerCase();
    let tsType: string;
    switch (def.type) {
      case "BOOLEAN":
        tsType = "boolean";
        break;
      case "TEXT":
        tsType = "string";
        break;
      case "INSTANCE_SWAP":
        tsType = "React.ReactNode";
        break;
      default:
        tsType = "unknown";
        break;
    }
    propLines.push(`  ${propName}?: ${tsType};`);
  }
  propLines.push(`  children?: React.ReactNode;`);

  const lines = [
    `interface ${pascalName}Props`,
    `  extends VariantProps<typeof ${variantsConst}>,`,
    `          ${attrsType} {`,
    ...propLines,
    `}`,
  ];

  return lines.join("\n");
}
