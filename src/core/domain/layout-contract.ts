import { KotikitError } from "../../util/result.js";
import type { LayoutContract, UICompositionContract } from "../schemas/artifact.js";

export function buildAutoLayoutContract(input: {
  uiComposition: UICompositionContract;
}): LayoutContract {
  if (input.uiComposition.notes?.includes("no-layout")) {
    throw new KotikitError(
      "Generated structural frames must use auto layout or grid.",
      "Regenerate the layout contract with explicit auto-layout or grid frames before drafting."
    );
  }

  return {
    schemaVersion: "LayoutContract/v1",
    strategy: "auto-layout",
    frames: [
      {
        id: "root",
        name: "Root",
        mode: "auto-layout",
        direction: "vertical",
        sizing: "fixed",
        spacingToken: "Space/400",
        children: input.uiComposition.parts.map((part) => part.id),
      },
      ...input.uiComposition.parts.map((part) => ({
        id: `${part.id}-frame`,
        name: part.name,
        parentId: "root",
        mode: "auto-layout" as const,
        direction: "vertical" as const,
        sizing: "hug" as const,
      })),
    ],
  };
}
