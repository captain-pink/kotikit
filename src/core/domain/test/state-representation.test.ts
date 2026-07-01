import { describe, expect, it } from "bun:test";
import { KotikitError } from "../../../util/result.js";
import {
  buildStateRepresentationContract,
  verifyStateRepresentationMetadata,
} from "../state-representation.js";

describe("state representation contract", () => {
  const stateMatrix = {
    schemaVersion: "StateMatrix/v1" as const,
    states: [
      {
        id: "members-loading",
        label: "Loading",
        kind: "loading" as const,
        scope: "region" as const,
        affectedRegion: "members table",
        persistentRegions: ["sidebar", "top bar"],
        replacementBehavior: "replace-table-body" as const,
        requiredComponents: ["skeleton row"],
        sourceRefs: ["https://carbondesignsystem.com/patterns/empty-states-pattern/"],
      },
    ],
  };

  it("builds expected state frame metadata", () => {
    expect(buildStateRepresentationContract({ stateMatrix })).toMatchObject({
      schemaVersion: "StateRepresentationContract/v1",
      states: [
        expect.objectContaining({
          stateId: "members-loading",
          representation: "region-state",
        }),
      ],
    });
  });

  it("rejects state preview cards for region states", () => {
    expect(() =>
      verifyStateRepresentationMetadata({
        contract: buildStateRepresentationContract({ stateMatrix }),
        appliedStates: [
          {
            stateId: "members-loading",
            representation: "preview-card",
            width: 320,
            height: 120,
          },
        ],
      })
    ).toThrow(KotikitError);
  });
});
