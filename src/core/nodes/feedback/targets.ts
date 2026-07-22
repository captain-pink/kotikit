/**
 * Uses a present snapshot node map as the verified identity/geometry boundary.
 * Older snapshots without a node map retain their legacy target fallback.
 */
export function feedbackEvidenceNodes(input: {
  snapshotNodeMap: unknown;
  fallbackNodes: Record<string, unknown>[];
}): Record<string, unknown>[] {
  const nodeMap = recordFrom(input.snapshotNodeMap);
  if (!Array.isArray(nodeMap.nodes)) return input.fallbackNodes;

  const fallbackById = new Map(
    input.fallbackNodes.flatMap((node) => {
      const nodeId = nodeIdFrom(node);
      return nodeId === undefined ? [] : [[nodeId, node] as const];
    })
  );
  return recordArray(nodeMap.nodes).flatMap((verifiedNode) => {
    const nodeId = nodeIdFrom(verifiedNode);
    if (nodeId === undefined) return [];
    return [{ ...fallbackById.get(nodeId), ...verifiedNode }];
  });
}

function nodeIdFrom(node: Record<string, unknown>): string | undefined {
  return stringField(node, "nodeId") ?? stringField(node, "id");
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

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
