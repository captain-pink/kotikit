import type { ScreenSpec } from "../spec/schema.js";

export const COMPONENT_ROLES = [
  "navigation",
  "primary-action",
  "secondary-action",
  "destructive-action",
  "search-input",
  "filter-control",
  "data-display",
  "status-indicator",
  "binary-control",
  "feedback",
  "content",
] as const;

export type ComponentRole = (typeof COMPONENT_ROLES)[number];

export const LAYOUT_ZONE_IDS = [
  "root",
  "navigation",
  "header",
  "header-actions",
  "controls",
  "content",
  "content-status",
  "content-toggles",
  "content-actions",
  "feedback",
] as const;

export type LayoutZoneId = (typeof LAYOUT_ZONE_IDS)[number];

export type LayoutDirection = "VERTICAL" | "HORIZONTAL";

export interface LayoutZoneContract {
  id: LayoutZoneId;
  parent: LayoutZoneId;
  direction: LayoutDirection;
  padding: number;
  itemSpacing: number;
  minTargetSize: number;
}

export interface ComponentPlacementContract {
  componentName: string;
  role: ComponentRole;
  zone: LayoutZoneId;
}

export interface LayoutContract {
  version: 1;
  strategy: "semantic-zones";
  zones: LayoutZoneContract[];
  placements: ComponentPlacementContract[];
}

export const EMPTY_LAYOUT_CONTRACT: LayoutContract = {
  version: 1,
  strategy: "semantic-zones",
  zones: [],
  placements: [],
};

export interface BuildLayoutContractInput {
  spec: ScreenSpec;
}

interface RolePattern {
  role: ComponentRole;
  terms: string[];
}

const TOKEN_SPLIT_PATTERN = /[^a-z0-9]+/g;

const rolePatterns: RolePattern[] = [
  { role: "destructive-action", terms: ["delete", "remove", "discard", "archive", "danger", "destructive"] },
  { role: "binary-control", terms: ["switch", "toggle", "activate", "deactivate", "enable", "disable", "active", "inactive"] },
  { role: "search-input", terms: ["search", "find", "query"] },
  { role: "filter-control", terms: ["filter", "tab", "tabs", "segment", "segmented"] },
  { role: "navigation", terms: ["navigation", "nav", "sidebar", "menu"] },
  { role: "primary-action", terms: ["primary", "invite", "create", "add", "submit", "save", "continue"] },
  { role: "secondary-action", terms: ["secondary", "cancel", "back", "close"] },
  { role: "status-indicator", terms: ["status", "badge", "chip", "pill"] },
  { role: "feedback", terms: ["empty", "error", "loading", "alert", "toast", "message"] },
  { role: "data-display", terms: ["table", "grid", "list", "rows", "cards", "data"] },
];

const zoneByRole: Record<ComponentRole, LayoutZoneId> = {
  navigation: "navigation",
  "primary-action": "header-actions",
  "secondary-action": "header-actions",
  "destructive-action": "content-actions",
  "search-input": "controls",
  "filter-control": "controls",
  "data-display": "content",
  "status-indicator": "content-status",
  "binary-control": "content-toggles",
  feedback: "feedback",
  content: "content",
};

const zoneContracts: Record<LayoutZoneId, LayoutZoneContract> = {
  root: {
    id: "root",
    parent: "root",
    direction: "VERTICAL",
    padding: 24,
    itemSpacing: 24,
    minTargetSize: 44,
  },
  navigation: {
    id: "navigation",
    parent: "root",
    direction: "VERTICAL",
    padding: 0,
    itemSpacing: 8,
    minTargetSize: 44,
  },
  header: {
    id: "header",
    parent: "root",
    direction: "HORIZONTAL",
    padding: 0,
    itemSpacing: 16,
    minTargetSize: 44,
  },
  "header-actions": {
    id: "header-actions",
    parent: "header",
    direction: "HORIZONTAL",
    padding: 0,
    itemSpacing: 8,
    minTargetSize: 44,
  },
  controls: {
    id: "controls",
    parent: "root",
    direction: "HORIZONTAL",
    padding: 0,
    itemSpacing: 12,
    minTargetSize: 44,
  },
  content: {
    id: "content",
    parent: "root",
    direction: "VERTICAL",
    padding: 0,
    itemSpacing: 16,
    minTargetSize: 44,
  },
  "content-status": {
    id: "content-status",
    parent: "content",
    direction: "HORIZONTAL",
    padding: 0,
    itemSpacing: 8,
    minTargetSize: 44,
  },
  "content-toggles": {
    id: "content-toggles",
    parent: "content",
    direction: "HORIZONTAL",
    padding: 0,
    itemSpacing: 8,
    minTargetSize: 44,
  },
  "content-actions": {
    id: "content-actions",
    parent: "content",
    direction: "HORIZONTAL",
    padding: 0,
    itemSpacing: 8,
    minTargetSize: 44,
  },
  feedback: {
    id: "feedback",
    parent: "root",
    direction: "VERTICAL",
    padding: 0,
    itemSpacing: 12,
    minTargetSize: 44,
  },
};

const zoneOrder: LayoutZoneId[] = [
  "navigation",
  "header",
  "header-actions",
  "controls",
  "content",
  "content-status",
  "content-toggles",
  "content-actions",
  "feedback",
];

const searchableText = (input: { name: string; usage?: string }): string =>
  `${input.name} ${input.usage ?? ""}`.toLowerCase();

const tokensFor = (text: string): string[] =>
  text
    .replace(TOKEN_SPLIT_PATTERN, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const hasTerm = (tokens: string[], term: string): boolean =>
  tokens.some((token) => token === term || (term.length >= 4 && token.includes(term)));

export function resolveComponentRole(input: { name: string; usage?: string }): ComponentRole {
  const tokens = tokensFor(searchableText(input));
  const match = rolePatterns.find((pattern) =>
    pattern.terms.some((term) => hasTerm(tokens, term))
  );
  return match?.role ?? "content";
}

export function layoutZoneForRole(role: ComponentRole): LayoutZoneId {
  return zoneByRole[role];
}

const addZoneAndParents = (
  zone: LayoutZoneId,
  acc: Set<LayoutZoneId>
): Set<LayoutZoneId> => {
  if (zone === "root" || acc.has(zone)) return acc;
  const contract = zoneContracts[zone];
  return addZoneAndParents(contract.parent, new Set([...acc, zone]));
};

export function buildLayoutContract(input: BuildLayoutContractInput): LayoutContract {
  const placements = input.spec.components.map<ComponentPlacementContract>((component) => {
    const role = resolveComponentRole(component);
    return {
      componentName: component.name,
      role,
      zone: layoutZoneForRole(role),
    };
  });

  const neededZones = placements.reduce<Set<LayoutZoneId>>(
    (acc, placement) => addZoneAndParents(placement.zone, acc),
    new Set()
  );

  return {
    version: 1,
    strategy: "semantic-zones",
    zones: zoneOrder
      .filter((zone) => neededZones.has(zone))
      .map((zone) => zoneContracts[zone]),
    placements,
  };
}
