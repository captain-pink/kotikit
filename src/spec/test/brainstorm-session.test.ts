import { describe, expect, it } from "bun:test";
import { BrainstormSessionSchema } from "../brainstorm-session.js";

describe("BrainstormSessionSchema", () => {
  it("accepts sparse answer records while a brainstorm is in progress", () => {
    expect(() =>
      BrainstormSessionSchema.parse({
        schemaVersion: 1,
        id: "00000000-0000-4000-8000-000000000000",
        status: "inProgress",
        idea: "Members admin page",
        scope: "members-admin-page",
        classification: "singleScreen",
        requiredDimensions: [
          "states",
          "visualEdgeCases",
          "accessibility",
          "interactions",
          "dataContracts",
          "responsive",
        ],
        answers: {},
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      })
    ).not.toThrow();
  });
});
