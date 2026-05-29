// @ts-expect-error -- figma global only exists at runtime in the plugin sandbox
declare const figma: any;

import type { FigmaShim } from "./figma-shim.js";

export const realFigmaShim: FigmaShim = {
  async findOrCreatePage(name) {
    const existing = figma.root.children.find((p: { type: string; name: string; id: string }) => p.type === "PAGE" && p.name === name);
    if (existing) return { id: existing.id };
    const page = figma.createPage();
    page.name = name;
    return { id: page.id };
  },
  async setCurrentPage(pageId) {
    const page = figma.root.findChild((n: { id: string }) => n.id === pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    figma.currentPage = page;
  },
  async createFrame({ name, parentId, width, height }) {
    const parent = figma.getNodeById(parentId);
    if (!parent) throw new Error(`Parent not found: ${parentId}`);
    const frame = figma.createFrame();
    frame.name = name;
    frame.resize(width, typeof height === "number" ? height : 100);
    parent.appendChild(frame);
    return { id: frame.id };
  },
  async setAutoLayout(frameId, opts) {
    const frame = figma.getNodeById(frameId);
    if (!frame) throw new Error(`Frame not found: ${frameId}`);
    frame.layoutMode = opts.direction;
    frame.paddingTop = opts.padding;
    frame.paddingBottom = opts.padding;
    frame.paddingLeft = opts.padding;
    frame.paddingRight = opts.padding;
    frame.itemSpacing = opts.itemSpacing;
  },
  async importComponentByKey(dsKey) {
    const component = await figma.importComponentByKeyAsync(dsKey);
    return { id: component.id };
  },
  async appendInstance(parentId, componentId) {
    const parent = figma.getNodeById(parentId);
    const component = figma.getNodeById(componentId);
    if (!parent || !component) throw new Error("Parent or component not found");
    const instance = component.createInstance();
    parent.appendChild(instance);
    return { instanceId: instance.id };
  },
  async setVariantProperties(instanceId, props) {
    const instance = figma.getNodeById(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);
    instance.setProperties(props);
  },
  async findVariableByName(name) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    for (const _col of collections) {
      const vars = await figma.variables.getLocalVariablesAsync();
      const match = vars.find((v: { name: string; id: string }) => v.name === name);
      if (match) return { id: match.id };
    }
    return null;
  },
  async setBoundVariable(nodeId, property, variableId) {
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) throw new Error(`Variable not found: ${variableId}`);
    if (property === "fill") {
      node.setBoundVariable("fills", variable);
    } else if (property === "text") {
      node.setBoundVariable("characters", variable);
    } else if (property === "effect") {
      node.setBoundVariable("effects", variable);
    }
  },
  notify(message, opts) {
    figma.notify(message, opts);
  },
};
