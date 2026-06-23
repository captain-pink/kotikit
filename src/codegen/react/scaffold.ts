import type { ComponentJson } from "../../sync/component-shape.js";
import { pascalCase } from "../../util/ids.js";
import {
  emitCvaVariantsBlock,
  emitPropsInterface,
  intrinsicElementFor,
  kebabCase,
  variantPropKey,
} from "./cva-helpers.js";

export interface ScaffoldComponentArgs {
  json: ComponentJson;
  hasStorybook: boolean;
}

export interface ScaffoldedFile {
  /** Relative path under the user's project root, e.g. "src/components/ui/button.tsx" */
  path: string;
  content: string;
}

export interface ScaffoldResult {
  componentName: string; // PascalCase, derived from json.name
  kebabName: string; // lowercase-kebab, used for path construction
  files: ScaffoldedFile[]; // 1 file when no Storybook, 2 when present
  notes: string[]; // e.g. ["Storybook not detected — skipped story file."]
}

/**
 * Convert a kebab-case string to camelCase.
 * "button" → "button", "pie-chart" → "pieChart", "icon-button" → "iconButton"
 */
function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Build the .tsx contents for a DS component using the CVA pattern.
 *
 * Output structure:
 *   - imports: React, cva, VariantProps, cn (assumed at @/lib/utils)
 *   - const <name>Variants = cva(...)
 *   - interface <Name>Props extends VariantProps + intrinsic-element-attrs
 *   - export function <Name>({...}: <Name>Props) { return <El className={cn(...)} {...rest}>{children}</El>; }
 *   - export default <Name>
 *
 * The Tailwind utility strings in cva are PLACEHOLDERS (empty strings) — kotikit
 * emits the SHAPE; the agent fills in Tailwind utility classes during the implement pass.
 */
export function buildComponentTsx(json: ComponentJson, _codeComponentsDir: string): string {
  const name = pascalCase(json.name);
  const kebab = kebabCase(name);

  // e.g. "button" → "buttonVariants", "pie-chart" → "pieChartVariants"
  const variantsConstName = `${kebabToCamel(kebab)}Variants`;

  const intrinsic = intrinsicElementFor(name);
  const cvaBlock = emitCvaVariantsBlock(json);

  // emitPropsInterface may derive a slightly different const name if PascalCase mapping differs.
  // Normalise by replacing whatever typeof <x>Variants it emits with the correct variantsConstName.
  const propsBlock = emitPropsInterface(json, intrinsic).replace(
    /\btypeof \w+Variants\b/,
    `typeof ${variantsConstName}`
  );

  // Collect variant prop names for destructuring (e.g. "variant", "size")
  const variantPropNames = json.variants.map((v) => variantPropKey(v.propertyName));

  // Collect non-variant prop names for destructuring
  const otherPropNames: string[] = [];
  const slotPropNames: string[] = [];
  for (const [propName, def] of Object.entries(json.properties ?? {})) {
    if (def.type === "VARIANT") continue;
    // Lowercase the prop name to match what emitPropsInterface emits
    const lowerName = propName.toLowerCase();
    if (def.type === "INSTANCE_SWAP") {
      slotPropNames.push(lowerName);
    } else {
      otherPropNames.push(lowerName);
    }
  }

  const allProps = [
    ...variantPropNames,
    ...otherPropNames,
    ...slotPropNames,
    "className",
    "children",
    "...rest",
  ];
  const destructure = allProps.join(", ");

  // Build the cn() call: variants call + className
  const cnCall =
    variantPropNames.length > 0
      ? `cn(${variantsConstName}({ ${variantPropNames.map((p) => p).join(", ")} }), className)`
      : `cn(${variantsConstName}(), className)`;

  return `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const ${variantsConstName} = ${cvaBlock};

${propsBlock}

export function ${name}({ ${destructure} }: ${name}Props) {
  return (
    <${intrinsic} className={${cnCall}} {...rest}>
      {children}
    </${intrinsic}>
  );
}

export default ${name};
`;
}

/**
 * Build the .stories.tsx contents for the component using CSF3.
 *
 * Emits:
 *   - import { Meta, StoryObj } from "@storybook/react"
 *   - import { <Name> } from "./<kebab>"
 *   - const meta: Meta<typeof <Name>> = { title: "UI/<Name>", component: <Name>, tags: ["autodocs"] }
 *   - export default meta
 *   - export const Default: StoryObj<typeof <Name>> = { args: { ...defaults } }
 *   - one story per variant axis (e.g. Variants, Sizes) rendering all values side-by-side
 *   - a States story if any BOOLEAN properties are present
 */
export function buildStoryTsx(json: ComponentJson): string {
  const name = pascalCase(json.name);
  const kebab = kebabCase(name);

  // Default story args: first slugified value per variant axis, plus defaults for other props
  const defaultArgs: string[] = [];

  for (const v of json.variants) {
    const propKey = variantPropKey(v.propertyName);
    const firstValue = v.values[0];
    if (firstValue !== undefined) {
      // Slugify the value to match what CVA expects at runtime
      const slugified = firstValue
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      defaultArgs.push(`    ${propKey}: ${JSON.stringify(slugified)}`);
    }
  }

  for (const [propName, def] of Object.entries(json.properties ?? {})) {
    if (def.type === "VARIANT") continue;
    const lowerName = propName.toLowerCase();
    if (def.type === "BOOLEAN") {
      defaultArgs.push(`    ${lowerName}: ${def.defaultValue === true ? "true" : "false"}`);
    } else if (def.type === "TEXT") {
      defaultArgs.push(
        `    ${lowerName}: ${JSON.stringify(typeof def.defaultValue === "string" ? def.defaultValue : "Label")}`
      );
    }
    // INSTANCE_SWAP: skip in args (requires JSX, not expressible in plain args)
  }

  const defaultArgsBlock = defaultArgs.length > 0 ? `{\n${defaultArgs.join(",\n")},\n  }` : `{}`;

  // One story per variant axis
  const axisStories: string[] = [];
  for (const v of json.variants) {
    // "Variant" → "Variants", "Size" → "Sizes"
    const axisStoryName = `${pascalCase(v.propertyName)}s`;
    const propKey = variantPropKey(v.propertyName);
    const slugifiedValues = v.values.map((val) =>
      val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    );
    const rowContent = slugifiedValues
      .map((val) => `      <${name} ${propKey}="${val}">${val}</${name}>`)
      .join("\n");
    axisStories.push(`export const ${axisStoryName}: StoryObj<typeof ${name}> = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
${rowContent}
    </div>
  ),
};`);
  }

  // States story for BOOLEAN properties
  const booleanProps = Object.entries(json.properties ?? {}).filter(
    ([, d]) => d.type === "BOOLEAN"
  );
  let statesStory = "";
  if (booleanProps.length > 0) {
    const rows = booleanProps
      .map(([propName]) => {
        const lowerName = propName.toLowerCase();
        return `      <${name} ${lowerName}>{lowerName}: true</${name}>`;
      })
      .join("\n");
    statesStory = `\nexport const States: StoryObj<typeof ${name}> = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
${rows}
    </div>
  ),
};\n`;
  }

  return `import type { Meta, StoryObj } from "@storybook/react";
import { ${name} } from "./${kebab}";

const meta: Meta<typeof ${name}> = {
  title: "UI/${name}",
  component: ${name},
  tags: ["autodocs"],
};
export default meta;

export const Default: StoryObj<typeof ${name}> = {
  args: ${defaultArgsBlock},
};

${axisStories.join("\n\n")}${statesStory}
`;
}

/**
 * Top-level orchestrator: produces the ScaffoldResult for one DS component.
 * Honors hasStorybook (skips the story file if absent + emits a note).
 */
export function scaffoldComponent(
  args: ScaffoldComponentArgs,
  codeComponentsDir: string
): ScaffoldResult {
  const name = pascalCase(args.json.name);
  const kebab = kebabCase(name);

  const componentPath = `${codeComponentsDir}/ui/${kebab}.tsx`;
  const storyPath = `${codeComponentsDir}/ui/${kebab}.stories.tsx`;

  const files: ScaffoldedFile[] = [
    { path: componentPath, content: buildComponentTsx(args.json, codeComponentsDir) },
  ];
  const notes: string[] = [];

  if (args.hasStorybook) {
    files.push({ path: storyPath, content: buildStoryTsx(args.json) });
  } else {
    notes.push(`Storybook not detected — skipped story file for ${name}.`);
  }

  return { componentName: name, kebabName: kebab, files, notes };
}
