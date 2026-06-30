import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import type { GraphHashInput } from "../compiler.js";
import { computeGraphHash } from "../graph-hash.js";

function hashInput(overrides: Partial<GraphHashInput> = {}): GraphHashInput {
  const manifest = {
    schemaVersion: 1 as const,
    id: "create-screen",
    version: "1.0.0",
    title: "Create Screen",
    description: "Create a screen draft.",
    stateSchema: "KotikitGraphState/v1" as const,
    requiredCapabilities: ["brief.write"],
    nodes: [{ id: "capture", uses: "brief.captureMinimalIntent", params: { lane: "quick" } }],
    edges: [],
    start: "capture",
    end: ["capture"],
    safetyProfile: "standard-design-draft",
  };

  return {
    flowId: "create-screen",
    flowVersion: "1.0.0",
    stateSchemaVersion: "KotikitGraphState/v1",
    safetyProfile: "standard-design-draft",
    manifest,
    nodeVersions: {
      "brief.captureMinimalIntent": "1.0.0",
    },
    ...overrides,
  };
}

describe("computeGraphHash", () => {
  it("changes when manifest content changes", () => {
    const base = computeGraphHash(hashInput());
    const changed = computeGraphHash(
      hashInput({
        manifest: {
          ...hashInput().manifest,
          title: "Create Members Screen",
        },
      })
    );

    expect(changed).not.toBe(base);
  });

  it("changes when node versions change", () => {
    const base = computeGraphHash(hashInput());
    const changed = computeGraphHash(
      hashInput({
        nodeVersions: {
          "brief.captureMinimalIntent": "1.0.1",
        },
      })
    );

    expect(changed).not.toBe(base);
  });

  it("changes when state schema version changes", () => {
    const base = computeGraphHash(hashInput());
    const changed = computeGraphHash(hashInput({ stateSchemaVersion: "KotikitGraphState/v2" }));

    expect(changed).not.toBe(base);
  });

  it("changes when flow version changes", () => {
    const base = computeGraphHash(hashInput());
    const changed = computeGraphHash(hashInput({ flowVersion: "1.0.1" }));

    expect(changed).not.toBe(base);
  });

  it("remains stable when object key order changes", () => {
    const reordered = {
      safetyProfile: "standard-design-draft",
      nodeVersions: {
        "brief.captureMinimalIntent": "1.0.0",
      },
      manifest: {
        end: ["capture"],
        start: "capture",
        edges: [],
        nodes: [{ uses: "brief.captureMinimalIntent", params: { lane: "quick" }, id: "capture" }],
        requiredCapabilities: ["brief.write"],
        stateSchema: "KotikitGraphState/v1" as const,
        description: "Create a screen draft.",
        title: "Create Screen",
        version: "1.0.0",
        id: "create-screen",
        schemaVersion: 1 as const,
        safetyProfile: "standard-design-draft",
      },
      stateSchemaVersion: "KotikitGraphState/v1",
      flowVersion: "1.0.0",
      flowId: "create-screen",
    };

    expect(computeGraphHash(reordered)).toBe(computeGraphHash(hashInput()));
  });

  it("orders object keys by code point instead of locale", () => {
    const privateUseKey = "\ue000";
    const emojiKey = "\u{1f600}";
    const input = hashInput({
      manifest: {
        ...hashInput().manifest,
        nodes: [
          {
            id: "capture",
            uses: "brief.captureMinimalIntent",
            params: { a: "lower", Z: "upper", [emojiKey]: "emoji", [privateUseKey]: "private" },
          },
        ],
      },
    });

    expect(computeGraphHash(input)).toBe(computeCodePointStableHash(input));
  });
});

function computeCodePointStableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(codePointCanonicalize(value)))
    .digest("hex");
}

function codePointCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(codePointCanonicalize);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, codePointCanonicalize(child)])
  );
}

function compareCodePoints(left: string, right: string): number {
  const leftCodePoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightCodePoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftCodePoints[index];
    const rightCodePoint = rightCodePoints[index];
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      throw new Error("Expected code point.");
    }
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint;
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}
