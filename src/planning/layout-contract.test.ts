import { describe, expect, it } from "bun:test";
import type { ScreenSpec } from "../spec/schema.js";
import { newScreenSpec } from "../spec/schema.js";
import { buildLayoutContract, layoutZoneForRole, resolveComponentRole } from "./layout-contract.js";

const specWithComponents = (components: ScreenSpec["components"]): ScreenSpec => {
  const spec = newScreenSpec({ title: "Members", description: "Manage team access." });
  spec.requirements.states = { default: "Ready state" };
  spec.components = components;
  return spec;
};

describe("layout contracts", () => {
  it("resolves semantic component roles without depending on a specific design system", () => {
    expect(resolveComponentRole({ name: "Search field", usage: "Find members by name" })).toBe(
      "search-input"
    );
    expect(
      resolveComponentRole({ name: "Status toggle", usage: "Activate or deactivate a member" })
    ).toBe("binary-control");
    expect(resolveComponentRole({ name: "Remove action", usage: "Delete a member" })).toBe(
      "destructive-action"
    );
    expect(resolveComponentRole({ name: "Members data grid", usage: "Shows member rows" })).toBe(
      "data-display"
    );
    expect(resolveComponentRole({ name: "Invite member", usage: "Primary action" })).toBe(
      "primary-action"
    );
  });

  it("maps roles to stable generic layout zones", () => {
    expect(layoutZoneForRole("primary-action")).toBe("header-actions");
    expect(layoutZoneForRole("search-input")).toBe("controls");
    expect(layoutZoneForRole("filter-control")).toBe("controls");
    expect(layoutZoneForRole("data-display")).toBe("content");
    expect(layoutZoneForRole("binary-control")).toBe("content-toggles");
    expect(layoutZoneForRole("destructive-action")).toBe("content-actions");
  });

  it("builds only the zones needed by the spec while preserving deterministic order", () => {
    const contract = buildLayoutContract({
      spec: specWithComponents([
        { name: "Invite member", usage: "Primary action", dsKey: "invite-key" },
        { name: "Search field", usage: "Find members", dsKey: "search-key" },
        { name: "Status filter tabs", usage: "Filter members by status", dsKey: "tabs-key" },
        { name: "Members table", usage: "Data grid of members", dsKey: "table-key" },
        { name: "Status toggle", usage: "Activate or deactivate a member", dsKey: "switch-key" },
        { name: "Remove action", usage: "Delete a member", dsKey: "remove-key" },
      ]),
    });

    expect(contract.zones.map((zone) => zone.id)).toEqual([
      "header",
      "header-actions",
      "controls",
      "content",
      "content-toggles",
      "content-actions",
    ]);
    expect(
      contract.placements.map((placement) => [
        placement.componentName,
        placement.role,
        placement.zone,
      ])
    ).toEqual([
      ["Invite member", "primary-action", "header-actions"],
      ["Search field", "search-input", "controls"],
      ["Status filter tabs", "filter-control", "controls"],
      ["Members table", "data-display", "content"],
      ["Status toggle", "binary-control", "content-toggles"],
      ["Remove action", "destructive-action", "content-actions"],
    ]);
  });
});
