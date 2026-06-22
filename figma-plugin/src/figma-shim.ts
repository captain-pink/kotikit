export interface FigmaShim {
  getFileKey(): string | undefined;
  findOrCreatePage(name: string): Promise<{ id: string }>;
  getCurrentPageInfo(): Promise<{ id: string; name: string } | null>;
  getPageById(pageId: string): Promise<{ id: string; name: string } | null>;
  setCurrentPage(pageId: string): Promise<void>;
  findOrCreateSection(input: {
    pageId: string;
    name: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; name: string }>;
  createFrame(input: {
    name: string;
    parentId: string;
    width: number;
    height: number | "auto";
  }): Promise<{ id: string }>;
  getNodeSize(nodeId: string): Promise<{ width: number; height: number | "auto" } | null>;
  setAutoLayout(frameId: string, opts: {
    direction: "VERTICAL" | "HORIZONTAL";
    padding: number;
    itemSpacing: number;
  }): Promise<void>;
  importComponentByKey(dsKey: string): Promise<{ id: string }>;
  appendInstance(parentId: string, componentId: string): Promise<{ instanceId: string }>;
  setVariantProperties(instanceId: string, props: Record<string, string>): Promise<void>;
  findVariableByName(name: string): Promise<{ id: string } | null>;
  setBoundVariable(nodeId: string, property: "fill" | "text" | "effect", variableId: string): Promise<void>;
  notify(message: string, opts?: { error?: boolean }): void;
}
