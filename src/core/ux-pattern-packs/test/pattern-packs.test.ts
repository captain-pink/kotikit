import { describe, expect, it } from "bun:test";
import { UXPatternPackSchema } from "../../domain/ux-pattern-pack.js";
import adminDataTable from "../admin-data-table.json" with { type: "json" };
import dashboardSummary from "../dashboard-summary.json" with { type: "json" };
import settingsForm from "../settings-form.json" with { type: "json" };

describe("built-in UX pattern packs", () => {
  for (const pack of [adminDataTable, dashboardSummary, settingsForm]) {
    it(`validates ${pack.id}`, () => {
      expect(UXPatternPackSchema.parse(pack)).toMatchObject({
        schemaVersion: "UXPatternPack/v1",
      });
    });
  }

  it("keeps data-table state rules region scoped", () => {
    const pack = UXPatternPackSchema.parse(adminDataTable);
    expect(pack.defaultStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "loading", scope: "region" }),
        expect.objectContaining({ kind: "empty", scope: "region" }),
        expect.objectContaining({ kind: "error", scope: "region" }),
      ])
    );
  });
});
