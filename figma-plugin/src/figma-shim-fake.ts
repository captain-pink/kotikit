import type { FigmaShim } from "./figma-shim.js";

interface FakeNode {
  id: string;
  type: "PAGE" | "FRAME" | "INSTANCE";
  name?: string;
  parentId?: string;
  children: string[];
  width?: number;
  height?: number | "auto";
  layoutMode?: "VERTICAL" | "HORIZONTAL";
  padding?: number;
  itemSpacing?: number;
  componentKey?: string;
  variantProperties?: Record<string, string>;
}

export class FakeFigmaShim implements FigmaShim {
  nodes: Map<string, FakeNode> = new Map();
  variables: Map<string, string> = new Map();   // name -> id
  bindings: { nodeId: string; property: string; variableId: string }[] = [];
  notifications: { message: string; error?: boolean }[] = [];
  currentPageId: string | null = null;
  fileKey: string | undefined;
  private nextId = 1;
  /** Toggled in tests to make a specific call throw. */
  throwOn: { method?: keyof FigmaShim } = {};

  private mkId(): string { return `node-${this.nextId++}`; }

  private check(method: keyof FigmaShim): void {
    if (this.throwOn.method === method) {
      throw new Error(`fake throw on ${String(method)}`);
    }
  }

  /** Seed a variable so findVariableByName returns it. */
  seedVariable(name: string, id: string): void {
    this.variables.set(name, id);
  }

  getFileKey(): string | undefined {
    return this.fileKey;
  }

  async findOrCreatePage(name: string): Promise<{ id: string }> {
    this.check("findOrCreatePage");
    for (const node of this.nodes.values()) {
      if (node.type === "PAGE" && node.name === name) return { id: node.id };
    }
    const id = this.mkId();
    this.nodes.set(id, { id, type: "PAGE", name, children: [] });
    return { id };
  }

  async setCurrentPage(pageId: string): Promise<void> {
    this.check("setCurrentPage");
    if (!this.nodes.has(pageId)) throw new Error(`Page not found: ${pageId}`);
    this.currentPageId = pageId;
  }

  async createFrame(input: { name: string; parentId: string; width: number; height: number | "auto" }): Promise<{ id: string }> {
    this.check("createFrame");
    const parent = this.nodes.get(input.parentId);
    if (!parent) throw new Error(`Parent not found: ${input.parentId}`);
    const id = this.mkId();
    this.nodes.set(id, {
      id, type: "FRAME", name: input.name, parentId: input.parentId,
      children: [], width: input.width, height: input.height,
    });
    parent.children.push(id);
    return { id };
  }

  async setAutoLayout(frameId: string, opts: { direction: "VERTICAL" | "HORIZONTAL"; padding: number; itemSpacing: number }): Promise<void> {
    this.check("setAutoLayout");
    const frame = this.nodes.get(frameId);
    if (!frame || frame.type !== "FRAME") throw new Error(`Frame not found: ${frameId}`);
    frame.layoutMode = opts.direction;
    frame.padding = opts.padding;
    frame.itemSpacing = opts.itemSpacing;
  }

  async importComponentByKey(dsKey: string): Promise<{ id: string }> {
    this.check("importComponentByKey");
    // Pretend the import returns a fresh component node id keyed by dsKey
    const id = `component-${dsKey}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, type: "INSTANCE", componentKey: dsKey, children: [] });
    }
    return { id };
  }

  async appendInstance(parentId: string, componentId: string): Promise<{ instanceId: string }> {
    this.check("appendInstance");
    const parent = this.nodes.get(parentId);
    if (!parent) throw new Error(`Parent not found: ${parentId}`);
    const instanceId = this.mkId();
    this.nodes.set(instanceId, { id: instanceId, type: "INSTANCE", parentId, children: [], componentKey: componentId });
    parent.children.push(instanceId);
    return { instanceId };
  }

  async setVariantProperties(instanceId: string, props: Record<string, string>): Promise<void> {
    this.check("setVariantProperties");
    const instance = this.nodes.get(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);
    instance.variantProperties = { ...(instance.variantProperties ?? {}), ...props };
  }

  async findVariableByName(name: string): Promise<{ id: string } | null> {
    this.check("findVariableByName");
    const id = this.variables.get(name);
    return id ? { id } : null;
  }

  async setBoundVariable(nodeId: string, property: "fill" | "text" | "effect", variableId: string): Promise<void> {
    this.check("setBoundVariable");
    if (!this.nodes.has(nodeId)) throw new Error(`Node not found: ${nodeId}`);
    this.bindings.push({ nodeId, property, variableId });
  }

  notify(message: string, opts?: { error?: boolean }): void {
    this.notifications.push({ message, ...(opts?.error ? { error: true } : {}) });
  }
}
