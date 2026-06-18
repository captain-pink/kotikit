import { describe, it, expect } from "bun:test";
import {
  buildNormalizationDiagnostics,
  normalizePublishedDesignSystem,
} from "./normalize-design-system.js";
import type { FigmaPublishedComponent, FigmaComponentSet, FigmaNode } from "./figma-types.js";
import type { ComponentJson } from "./component-shape.js";

const buttonVariants: FigmaPublishedComponent[] = [
  {
    key: "button-md-fill",
    node_id: "buttonVariant1",
    name: "Size=md, Type=Fill, State=rest",
    containing_frame: {
      pageName: "Button",
      containingComponentSet: {
        nodeId: "buttonSetNode",
        name: "MDS-Public-TW-Button",
      },
    },
  },
  {
    key: "button-lg-outline",
    node_id: "buttonVariant2",
    name: "Size=lg, Type=Outline, State=hover",
    containing_frame: {
      pageName: "Button",
      containingComponentSet: {
        nodeId: "buttonSetNode",
        name: "MDS-Public-TW-Button",
      },
    },
  },
];

interface NormalizerFixture {
  input: {
    fileKey: string;
    publishedComponents: FigmaPublishedComponent[];
    componentSets: FigmaComponentSet[];
    nodeDetailsById: Record<string, FigmaNode>;
    pageNameByNodeId?: Record<string, string>;
  };
  expected: {
    components: Array<Omit<ComponentJson, "updatedAt">>;
    icons: unknown[];
    warningCodes: string[];
  };
}

const loadFixture = async (name: string): Promise<NormalizerFixture> =>
  Bun.file(new URL(`./fixtures/normalizer/${name}.json`, import.meta.url)).json();

const stableComponent = (component: ComponentJson): Omit<ComponentJson, "updatedAt"> => {
  const { updatedAt: _updatedAt, ...stable } = component;
  return stable;
};

describe("normalizePublishedDesignSystem", () => {
  it.each([
    "published-mui-like",
    "duplicate-logical-names",
  ])("matches the %s fixture", async (fixtureName) => {
    const fixture = await loadFixture(fixtureName);
    const result = normalizePublishedDesignSystem(fixture.input);

    expect(result.components.map(stableComponent)).toEqual(fixture.expected.components);
    expect(result.icons).toEqual(fixture.expected.icons);
    expect(result.warnings.map((warning) => warning.code)).toEqual(fixture.expected.warningCodes);
  });

  it("builds compact diagnostics for sync reports", async () => {
    const fixture = await loadFixture("published-mui-like");
    const result = normalizePublishedDesignSystem(fixture.input);
    const diagnostics = buildNormalizationDiagnostics(fixture.input, result);

    expect(diagnostics).toEqual({
      fileKey: "FIXTURE",
      publishedComponentCount: 5,
      componentSetCount: 1,
      nodeDetailsCount: 0,
      pageNameCount: 5,
      componentCount: 2,
      iconCount: 1,
      detailNodeCount: 3,
      warnings: [
        {
          code: "inferred-variants",
          count: 1,
        },
        {
          code: "missing-component-set-metadata",
          count: 1,
        },
      ],
    });
  });

  it("collapses published flattened variants into one logical component set", () => {
    const componentSets: FigmaComponentSet[] = [
      {
        key: "buttonSetKey",
        node_id: "buttonSetNode",
        name: "MDS-Public-TW-Button",
      },
    ];
    const nodeDetailsById: Record<string, FigmaNode> = {
      buttonSetNode: {
        document: {
          id: "buttonSetNode",
          name: "MDS-Public-TW-Button",
          type: "COMPONENT_SET",
          componentPropertyDefinitions: {
            Size: { type: "VARIANT", variantOptions: ["md", "lg"] },
            Type: { type: "VARIANT", variantOptions: ["Fill", "Outline"] },
            State: { type: "VARIANT", variantOptions: ["rest", "hover"] },
            "Label#1:2": { type: "TEXT", defaultValue: "Button text" },
          },
        },
      },
    };

    const result = normalizePublishedDesignSystem({
      fileKey: "F1",
      publishedComponents: buttonVariants,
      componentSets,
      nodeDetailsById,
    });

    expect(result.components).toHaveLength(1);
    expect(result.icons).toHaveLength(0);
    expect(result.components[0]?.name).toBe("MDS-Public-TW-Button");
    expect(result.components[0]?.key).toBe("button-md-fill");
    expect(result.components[0]?.componentSetKey).toBe("buttonSetKey");
    expect(result.components[0]?.variants.map((v) => v.propertyName).sort()).toEqual([
      "Size",
      "State",
      "Type",
    ]);
    expect(Object.keys(result.components[0]?.properties ?? {})).toEqual(["Label#1:2"]);
  });

  it("infers variants from flattened child names when Figma omits property definitions", () => {
    const result = normalizePublishedDesignSystem({
      fileKey: "F1",
      publishedComponents: buttonVariants,
      componentSets: [
        {
          key: "buttonSetKey",
          node_id: "buttonSetNode",
          name: "MDS-Public-TW-Button",
        },
      ],
      nodeDetailsById: {},
    });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.variants).toEqual([
      { propertyName: "Size", values: ["md", "lg"] },
      { propertyName: "Type", values: ["Fill", "Outline"] },
      { propertyName: "State", values: ["rest", "hover"] },
    ]);
    expect(result.warnings.some((w) => w.code === "inferred-variants")).toBe(true);
  });

  it("keeps standalone published components as components", () => {
    const result = normalizePublishedDesignSystem({
      fileKey: "F1",
      publishedComponents: [
        { key: "cardKey", node_id: "cardNode", name: "Card", containing_frame: { pageName: "Components" } },
      ],
      componentSets: [],
      nodeDetailsById: {},
    });

    expect(result.components.map((component) => component.name)).toEqual(["Card"]);
    expect(result.components[0]?.key).toBe("cardKey");
    expect(result.icons).toEqual([]);
  });

  it("classifies decorative Icons pages as icons instead of components", () => {
    const result = normalizePublishedDesignSystem({
      fileKey: "F1",
      publishedComponents: [
        {
          key: "arrowDown24",
          node_id: "arrowDown24Node",
          name: "Arrows=down, Type=stroke, Size=24px",
          containing_frame: {
            pageName: "    ↪️  Icons",
            containingComponentSet: {
              nodeId: "arrowsSetNode",
              name: "Arrows",
            },
          },
        },
        {
          key: "arrowUp24",
          node_id: "arrowUp24Node",
          name: "Arrows=up, Type=stroke, Size=24px",
          containing_frame: {
            pageName: "    ↪️  Icons",
            containingComponentSet: {
              nodeId: "arrowsSetNode",
              name: "Arrows",
            },
          },
        },
      ],
      componentSets: [
        {
          key: "arrowsSetKey",
          node_id: "arrowsSetNode",
          name: "Arrows",
        },
      ],
      nodeDetailsById: {},
    });

    expect(result.components).toEqual([]);
    expect(result.icons.map((icon) => icon.name)).toEqual([
      "Arrows=down, Type=stroke, Size=24px",
      "Arrows=up, Type=stroke, Size=24px",
    ]);
    expect(result.icons.every((icon) => icon.signal === "page")).toBe(true);
  });

  it("returns component-set node ids needed for variant enrichment", () => {
    const result = normalizePublishedDesignSystem({
      fileKey: "F1",
      publishedComponents: buttonVariants,
      componentSets: [],
      nodeDetailsById: {},
    });

    expect(result.nodeIdsForDetails).toEqual(["buttonSetNode"]);
  });
});
