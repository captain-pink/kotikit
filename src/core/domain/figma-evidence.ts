import { KotikitError } from "../../util/result.js";

type EvidenceNode = Record<string, unknown>;

const MIN_VISIBLE_OPACITY = 0.5;

export function verifyFigmaEvidenceAgainstApplyPacket(input: {
  packet: Record<string, unknown>;
  evidenceSnapshots: Record<string, unknown>[];
}): void {
  if (input.evidenceSnapshots.length === 0) return;
  verifyEvidenceLayout(input.evidenceSnapshots);
  verifyExistingComponentParts({
    parts: recordArray(recordFrom(input.packet.uiComposition).parts),
    evidenceNodes: evidenceNodesFrom(input.evidenceSnapshots),
  });
  verifyIconEvidence({
    iconRequirements: recordArray(input.packet.iconRequirements),
    evidenceNodes: evidenceNodesFrom(input.evidenceSnapshots),
  });
}

function verifyExistingComponentParts(input: {
  parts: Record<string, unknown>[];
  evidenceNodes: EvidenceNode[];
}): void {
  input.parts
    .filter((part) => part.source === "existing-component" && stringField(part, "componentKey"))
    .forEach((part) => {
      const partId = stringField(part, "id");
      const componentKey = stringField(part, "componentKey");
      if (partId === undefined || componentKey === undefined) return;

      const candidates = input.evidenceNodes.filter((node) => evidencePartId(node) === partId);
      if (candidates.length === 0) {
        throw new KotikitError(
          `Figma evidence is missing actual node proof for "${partLabel(part)}".`,
          "Run the compact Figma evidence scanner for the applied root node before recording the transaction."
        );
      }
      if (candidates.some((node) => nodeSatisfiesExistingComponent(node, componentKey))) return;

      throw new KotikitError(
        `Figma evidence shows "${partLabel(part)}" expected an existing local design-system component but did not use one.`,
        recoveryHintForComponentCandidate(candidates[0], componentKey)
      );
    });
}

function verifyIconEvidence(input: {
  iconRequirements: Record<string, unknown>[];
  evidenceNodes: EvidenceNode[];
}): void {
  input.iconRequirements
    .filter((requirement) => requirement.source === "local-design-system")
    .forEach((requirement) => {
      const partId = stringField(requirement, "partId");
      const expectedIcon =
        stringField(requirement, "iconKey") ?? stringField(requirement, "iconName");
      const candidates =
        partId === undefined
          ? input.evidenceNodes
          : input.evidenceNodes.filter((node) => evidencePartId(node) === partId);
      const satisfied = candidates.some((node) => {
        if (nodeIsProofOnly(node)) return false;
        const refs = evidenceIconRefs(node);
        if (expectedIcon !== undefined) return refs.has(expectedIcon);
        return refs.size > 0 || evidenceSource(node) === "ds-icon";
      });
      if (satisfied) return;

      throw new KotikitError(
        `Figma evidence is missing local design-system icon proof for "${String(requirement.id ?? "icon")}".`,
        "Use a visible icon instance or icon ref from the local design-system icon index for the planned affordance."
      );
    });
}

function verifyEvidenceLayout(evidenceSnapshots: Record<string, unknown>[]): void {
  evidenceSnapshots.forEach((snapshot) => {
    const summary = recordFrom(snapshot.summary);
    const zeroOriginChildCount = numberField(summary, "zeroOriginChildCount") ?? 0;
    const topLevelChildCount =
      numberField(summary, "topLevelChildCount") ?? numberField(summary, "visibleNodeCount") ?? 0;
    if (
      topLevelChildCount >= 4 &&
      zeroOriginChildCount >= 4 &&
      zeroOriginChildCount / topLevelChildCount >= 0.4
    ) {
      throw new KotikitError(
        "Figma evidence shows the applied frame has collapsed child layout.",
        "Rebuild the root screen or region with real auto layout before recording the transaction."
      );
    }

    const hiddenInstanceCount = numberField(summary, "hiddenInstanceCount") ?? 0;
    const lowOpacityInstanceCount = numberField(summary, "lowOpacityInstanceCount") ?? 0;
    if (hiddenInstanceCount + lowOpacityInstanceCount > 0) {
      throw new KotikitError(
        "Figma evidence found hidden or low-opacity component proof layers.",
        "Use visible design-system component instances in the actual composed layout, not proof-only layers."
      );
    }
  });
}

function nodeSatisfiesExistingComponent(node: EvidenceNode, componentKey: string): boolean {
  return (
    nodeLooksLikeVisibleInstance(node) &&
    evidenceSource(node) !== "local-new-component" &&
    evidenceSource(node) !== "draft-component" &&
    evidenceSource(node) !== "primitive" &&
    evidenceComponentRefs(node).has(componentKey)
  );
}

function nodeLooksLikeVisibleInstance(node: EvidenceNode): boolean {
  return (
    (node.isInstance === true ||
      stringField(node, "nodeType") === "INSTANCE" ||
      stringField(node, "type") === "INSTANCE" ||
      stringField(node, "kind") === "INSTANCE") &&
    !nodeIsProofOnly(node)
  );
}

function nodeIsProofOnly(node: EvidenceNode): boolean {
  return (
    node.effectiveVisible === false ||
    node.visible === false ||
    Number(node.effectiveOpacity ?? node.opacity ?? 1) < MIN_VISIBLE_OPACITY ||
    node.insideRoot === false ||
    !hasPositiveBounds(recordFrom(node.bounds))
  );
}

function recoveryHintForComponentCandidate(
  candidate: EvidenceNode | undefined,
  componentKey: string
): string {
  if (candidate === undefined) {
    return `Use the existing local design-system component key "${componentKey}" for this part.`;
  }
  const source = evidenceSource(candidate);
  if (source === "local-new-component") {
    return `Newly created local components do not satisfy existing design-system reuse. Use the pre-run local DS component key "${componentKey}".`;
  }
  if (source === "primitive" || !nodeLooksLikeVisibleInstance(candidate)) {
    return `Replace the primitive layers with a visible instance of the local DS component key "${componentKey}".`;
  }
  return `Use a visible instance whose main component key matches the local DS key "${componentKey}".`;
}

function evidenceNodesFrom(snapshots: Record<string, unknown>[]): EvidenceNode[] {
  return snapshots.flatMap((snapshot) => [
    ...recordArray(snapshot.parts),
    ...recordArray(snapshot.nodes),
  ]);
}

function evidencePartId(node: EvidenceNode): string | undefined {
  return stringField(node, "partId") ?? stringField(recordFrom(node.pluginData), "partId");
}

function evidenceSource(node: EvidenceNode): string | undefined {
  return stringField(node, "source") ?? stringField(node, "componentSource");
}

function evidenceComponentRefs(node: EvidenceNode): Set<string> {
  return new Set([
    ...stringArray(node.componentRefs),
    ...optionalString(node.componentKey),
    ...optionalString(node.mainComponentKey),
    ...optionalString(node.matchedComponentKey),
  ]);
}

function evidenceIconRefs(node: EvidenceNode): Set<string> {
  return new Set([
    ...stringArray(node.iconRefs),
    ...optionalString(node.iconKey),
    ...optionalString(node.matchedIconKey),
  ]);
}

function partLabel(part: Record<string, unknown>): string {
  return String(part.name ?? part.id ?? "component part");
}

function hasPositiveBounds(bounds: Record<string, unknown>): boolean {
  if (Object.keys(bounds).length === 0) return true;
  return Number(bounds.width) > 0 && Number(bounds.height) > 0;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function optionalString(value: unknown): string[] {
  return typeof value === "string" && value.length > 0 ? [value] : [];
}
