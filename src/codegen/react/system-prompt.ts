import type { ScreenSpec, FlowManifest } from "../../spec/schema.js";

/**
 * The §7 quality baseline carried into every React code-generation pass.
 * Includes the literal quality-bar sentence the brainstorm agent uses:
 *   "any developer or designer could build this identically from the spec alone"
 */
export const REACT_SYSTEM_PROMPT = `\
You are writing one React + TypeScript screen component for a real production app.

Quality baseline — non-negotiable, enforced by automated gates after you finish:

- TypeScript strict — no \`any\`, no \`@ts-ignore\`, explicit prop types.
- WCAG-AA accessibility — semantic HTML first; ARIA only where semantics fall short.
- Full keyboard navigation; correct focus order; focus management for modals/overlays.
- Labelled inputs; \`aria-live\` for async feedback; respect reduced-motion.
- WCAG-AA contrast.
- Responsive — honor the breakpoints declared by the config (or per-spec overrides).
- Error boundary on every page-level component.
- No \`console.log\`, no commented-out debug code, no TODO comments in shipped code.

Code conventions:

- Imports for shadcn primitives use the lowercase-kebab path:
  \`import { Button } from "@/components/ui/button";\`
- Filenames are PascalCase: \`Cart.tsx\`, colocated with \`Cart.test.tsx\`.
- Export the named component as default: \`export default function Cart(props: CartProps) { ... }\`.
- Use \`function ComponentName(props: Props)\` — not arrow consts assigned to const.
- Define a \`Props\` interface at the top of the file.

The bar:

  Any developer or designer could build this identically from the spec alone.

When you finish writing, the framework runs:
  - tsc --noEmit
  - eslint --max-warnings 0 (with jsx-a11y)
  - prettier --check
  - vitest run (on the colocated test file, when tests are enabled)

Failures from any of these will be sent back to you to fix in place.
`;

/**
 * Build the full per-screen system prompt by combining the baseline with the
 * specific screen's context (spec, breakpoints, DS components, flow).
 */
export function buildReactSystemPrompt(input: {
  spec: ScreenSpec;
  breakpoints: number[];
  themes: string[];
  flowManifest?: FlowManifest;
  dsComponentNames: string[];
  testFramework: "vitest" | "none";
}): string {
  const { spec, breakpoints, themes, flowManifest, dsComponentNames, testFramework } = input;

  const lines: string[] = [REACT_SYSTEM_PROMPT];

  lines.push("---");
  lines.push("");
  lines.push(`## For THIS screen: ${spec.title}`);
  lines.push("");
  lines.push(`**Description:** ${spec.context.description}`);
  lines.push("");

  if (spec.requirements.functional.length > 0) {
    lines.push("**Functional requirements:**");
    for (const req of spec.requirements.functional) {
      lines.push(`- ${req}`);
    }
    lines.push("");
  }

  const stateEntries = Object.entries(spec.requirements.states);
  if (stateEntries.length > 0) {
    lines.push("**States:**");
    for (const [key, desc] of stateEntries) {
      lines.push(`- **${key}:** ${desc}`);
    }
    lines.push("");
  }

  if (spec.acceptanceCriteria.length > 0) {
    lines.push("**Acceptance criteria:**");
    for (const criterion of spec.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
    lines.push("");
  }

  lines.push(`**Breakpoints (px):** ${breakpoints.join(", ")}`);
  lines.push(`**Themes:** ${themes.join(", ")}`);
  lines.push("");

  if (dsComponentNames.length > 0) {
    lines.push("**Available design-system components:**");
    for (const name of dsComponentNames) {
      lines.push(`- ${name}`);
    }
    lines.push("");
  }

  if (flowManifest) {
    lines.push(`**Part of flow:** ${flowManifest.title}`);
    if (flowManifest.sharedState.length > 0) {
      lines.push("**Shared state carried between screens:**");
      for (const s of flowManifest.sharedState) {
        lines.push(`- ${s}`);
      }
    }
    lines.push("");
  }

  if (testFramework === "vitest") {
    lines.push("**Tests:** Generate a colocated `.test.tsx` file using Vitest + React Testing Library.");
    lines.push("Each acceptance criterion above becomes one `it(...)` test case.");
    lines.push("");
  }

  return lines.join("\n");
}
