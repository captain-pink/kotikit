import type { IconRow } from "../db/icons-db.js";
import { buildComponentJson, type ComponentJson } from "./component-shape.js";
import { detectIconSignal } from "./icon-detect.js";
import type { FigmaComponentSet, FigmaNode, FigmaPublishedComponent } from "./figma-types.js";

export interface NormalizeWarning {
  code:
    | "inferred-variants"
    | "missing-component-set-metadata"
    | "duplicate-logical-name";
  message: string;
}

export interface NormalizePublishedInput {
  fileKey: string;
  publishedComponents: FigmaPublishedComponent[];
  componentSets: FigmaComponentSet[];
  nodeDetailsById: Record<string, FigmaNode>;
  pageNameByNodeId?: Record<string, string>;
}

export interface NormalizePublishedResult {
  components: ComponentJson[];
  icons: IconRow[];
  nodeIdsForDetails: string[];
  warnings: NormalizeWarning[];
}

interface ComponentSetRef {
  id?: string;
  name?: string;
}

interface ComponentGroup {
  id: string;
  setRef?: ComponentSetRef;
  components: FigmaPublishedComponent[];
}

function setRefForComponent(component: FigmaPublishedComponent): ComponentSetRef | undefined {
  const containingSet = component.containing_frame?.containingComponentSet;
  const containingStateGroup = component.containing_frame?.containingStateGroup;
  const id = component.component_set_id ?? containingSet?.nodeId ?? containingStateGroup?.nodeId;
  const name = containingSet?.name ?? containingStateGroup?.name;
  if (id === undefined && name === undefined) return undefined;
  return { ...(id !== undefined ? { id } : {}), ...(name !== undefined ? { name } : {}) };
}

function groupIdForComponent(component: FigmaPublishedComponent): string {
  const setRef = setRefForComponent(component);
  if (setRef?.id) return `set:${setRef.id}`;
  if (setRef?.name) return `set-name:${setRef.name}`;
  return `component:${component.node_id}`;
}

function groupPublishedComponents(components: FigmaPublishedComponent[]): ComponentGroup[] {
  const groupById = components.reduce<Map<string, ComponentGroup>>((acc, component) => {
    const id = groupIdForComponent(component);
    const existing = acc.get(id);
    const nextGroup: ComponentGroup = existing ?? {
      id,
      setRef: setRefForComponent(component),
      components: [],
    };
    nextGroup.components.push(component);
    acc.set(id, nextGroup);
    return acc;
  }, new Map<string, ComponentGroup>());

  return Array.from(groupById.values());
}

function componentSetIndex(componentSets: FigmaComponentSet[]): Map<string, FigmaComponentSet> {
  return componentSets.reduce<Map<string, FigmaComponentSet>>((acc, set) => {
    acc.set(set.key, set);
    if (set.node_id) acc.set(set.node_id, set);
    return acc;
  }, new Map<string, FigmaComponentSet>());
}

function pageNameForComponent(
  component: FigmaPublishedComponent,
  pageNameByNodeId: Record<string, string>
): string {
  return pageNameByNodeId[component.node_id] ?? component.containing_frame?.pageName ?? "";
}

function signalForGroup(
  group: ComponentGroup,
  pageNameByNodeId: Record<string, string>
): NonNullable<ReturnType<typeof detectIconSignal>> | null {
  const signals = group.components.map((component) =>
    detectIconSignal({
      pageName: pageNameForComponent(component, pageNameByNodeId),
      componentName: component.name,
    })
  );

  if (signals.includes("page")) return "page";
  if (signals.includes("prefix")) return "prefix";
  if (signals.includes("slash")) return "slash";
  return null;
}

function parseVariantParts(name: string): Array<{ propertyName: string; value: string }> {
  return name
    .split(",")
    .map((part) => part.trim())
    .map((part) => /^([^=]+?)\s*=\s*(.+)$/.exec(part))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      propertyName: match[1]!.trim(),
      value: match[2]!.trim(),
    }))
    .filter((part) => part.propertyName.length > 0 && part.value.length > 0);
}

function inferPropertyDefinitions(
  components: FigmaPublishedComponent[]
): FigmaComponentSet["componentPropertyDefinitions"] | undefined {
  const partsByName = components.map((component) => parseVariantParts(component.name));
  const variantParts = partsByName.flat();
  if (variantParts.length === 0) return undefined;

  const valuesByProperty = variantParts.reduce<Map<string, string[]>>((acc, part) => {
    const values = acc.get(part.propertyName) ?? [];
    if (!values.includes(part.value)) values.push(part.value);
    acc.set(part.propertyName, values);
    return acc;
  }, new Map<string, string[]>());

  return Object.fromEntries(
    Array.from(valuesByProperty.entries()).map(([propertyName, values]) => [
      propertyName,
      { type: "VARIANT", variantOptions: values },
    ])
  );
}

function enrichedComponentSet(
  group: ComponentGroup,
  setById: Map<string, FigmaComponentSet>,
  nodeDetailsById: Record<string, FigmaNode>,
  warnings: NormalizeWarning[]
): FigmaComponentSet | undefined {
  const representative = group.components[0];
  if (!representative) return undefined;

  const setRef = group.setRef;
  const apiSet =
    (representative.component_set_id ? setById.get(representative.component_set_id) : undefined) ??
    (setRef?.id ? setById.get(setRef.id) : undefined);

  const nodeDetails = setRef?.id ? nodeDetailsById[setRef.id]?.document : undefined;
  const inferredDefinitions =
    apiSet?.componentPropertyDefinitions === undefined &&
    nodeDetails?.componentPropertyDefinitions === undefined
      ? inferPropertyDefinitions(group.components)
      : undefined;

  if (inferredDefinitions !== undefined) {
    warnings.push({
      code: "inferred-variants",
      message: `Inferred variants for ${apiSet?.name ?? setRef?.name ?? representative.name} from child component names.`,
    });
  }

  if (setRef !== undefined && apiSet === undefined) {
    warnings.push({
      code: "missing-component-set-metadata",
      message: `Figma did not return component-set metadata for ${setRef.name ?? setRef.id ?? representative.name}; using child component key as fallback.`,
    });
  }

  if (apiSet === undefined && setRef === undefined && inferredDefinitions === undefined) {
    return undefined;
  }

  return {
    key: apiSet?.key ?? representative.key,
    ...(apiSet?.node_id ?? setRef?.id ? { node_id: apiSet?.node_id ?? setRef?.id } : {}),
    name: apiSet?.name ?? nodeDetails?.name ?? setRef?.name ?? representative.name,
    ...(apiSet?.description ?? representative.description
      ? { description: apiSet?.description ?? representative.description }
      : {}),
    ...(apiSet?.defaultVariantId ? { defaultVariantId: apiSet.defaultVariantId } : {}),
    ...(apiSet?.componentPropertyDefinitions ?? inferredDefinitions
      ? { componentPropertyDefinitions: apiSet?.componentPropertyDefinitions ?? inferredDefinitions }
      : {}),
  };
}

function nodeDetailsForGroup(
  group: ComponentGroup,
  nodeDetailsById: Record<string, FigmaNode>
): FigmaNode["document"] | undefined {
  const setNode = group.setRef?.id ? nodeDetailsById[group.setRef.id]?.document : undefined;
  const representative = group.components[0];
  const componentNode = representative ? nodeDetailsById[representative.node_id]?.document : undefined;
  return setNode ?? componentNode;
}

function nodeIdsForGroups(groups: ComponentGroup[]): string[] {
  const ids = groups
    .map((group) => group.setRef?.id ?? group.components[0]?.node_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set(ids));
}

function iconRowsForGroup(
  group: ComponentGroup,
  fileKey: string,
  signal: NonNullable<ReturnType<typeof detectIconSignal>>
): IconRow[] {
  return group.components.map((component) => ({
    name: component.name,
    key: component.key,
    signal,
    fileKey,
  }));
}

export function normalizePublishedDesignSystem(
  input: NormalizePublishedInput
): NormalizePublishedResult {
  const warnings: NormalizeWarning[] = [];
  const pageNameByNodeId = input.pageNameByNodeId ?? {};
  const groups = groupPublishedComponents(input.publishedComponents);
  const setById = componentSetIndex(input.componentSets);

  const normalized = groups.reduce<{
    components: ComponentJson[];
    icons: IconRow[];
  }>(
    (acc, group) => {
      const iconSignal = signalForGroup(group, pageNameByNodeId);
      if (iconSignal !== null) {
        return {
          components: acc.components,
          icons: [...acc.icons, ...iconRowsForGroup(group, input.fileKey, iconSignal)],
        };
      }

      const representative = group.components[0];
      if (!representative) return acc;

      const componentSet = enrichedComponentSet(group, setById, input.nodeDetailsById, warnings);
      const nodeDetails = nodeDetailsForGroup(group, input.nodeDetailsById);
      const component = buildComponentJson({
        fileKey: input.fileKey,
        publishedComponent: representative,
        ...(componentSet ? { componentSet } : {}),
        ...(nodeDetails ? { nodeDetails } : {}),
      });

      return {
        components: [...acc.components, component],
        icons: acc.icons,
      };
    },
    { components: [], icons: [] }
  );

  const duplicateNames = normalized.components
    .map((component) => component.name)
    .filter((name, index, names) => names.indexOf(name) !== index);

  const duplicateWarnings = Array.from(new Set(duplicateNames)).map<NormalizeWarning>((name) => ({
    code: "duplicate-logical-name",
    message: `Multiple logical components normalize to the name ${name}; later files or rows may overwrite earlier ones.`,
  }));

  return {
    components: normalized.components,
    icons: normalized.icons,
    nodeIdsForDetails: nodeIdsForGroups(groups),
    warnings: [...warnings, ...duplicateWarnings],
  };
}
