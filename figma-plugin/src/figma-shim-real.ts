declare const figma: any;

import type { FigmaShim } from "./figma-shim.js";

export const realFigmaShim: FigmaShim = {
  getFileKey() {
    return figma.fileKey;
  },
  async findOrCreatePage(name) {
    const existing = figma.root.children.find(
      (p: { type: string; name: string; id: string }) => p.type === "PAGE" && p.name === name
    );
    if (existing) return { id: existing.id };
    const page = figma.createPage();
    page.name = name;
    return { id: page.id };
  },
  async getCurrentPageInfo() {
    const page = figma.currentPage;
    return page ? { id: page.id, name: page.name } : null;
  },
  async getPageById(pageId) {
    const node = await figma.getNodeByIdAsync(pageId);
    return node?.type === "PAGE" ? { id: node.id, name: node.name } : null;
  },
  async setCurrentPage(pageId) {
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    if (typeof figma.setCurrentPageAsync === "function") {
      await figma.setCurrentPageAsync(page);
    } else {
      figma.currentPage = page;
    }
  },
  async findOrCreateSection({ pageId, name, metadata }) {
    const page = await figma.getNodeByIdAsync(pageId);
    if (!page || page.type !== "PAGE") throw new Error(`Page not found: ${pageId}`);
    const existing = page.children.find(
      (node: { type: string; name: string; id: string }) =>
        node.type === "SECTION" && node.name === name
    );
    if (existing) return { id: existing.id, name: existing.name };
    const section = figma.createSection();
    section.name = name;
    for (const [key, value] of Object.entries(metadata)) {
      section.setSharedPluginData("kotikit", key, value);
    }
    page.appendChild(section);
    return { id: section.id, name: section.name };
  },
  async createFrame({ name, parentId, width, height }) {
    const parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) throw new Error(`Parent not found: ${parentId}`);
    const frame = figma.createFrame();
    frame.name = name;
    frame.resize(width, typeof height === "number" ? height : 100);
    parent.appendChild(frame);
    return { id: frame.id };
  },
  async getNodeSize(nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || typeof node.width !== "number") return null;
    return {
      width: node.width,
      height: typeof node.height === "number" ? node.height : "auto",
    };
  },
  async setAutoLayout(frameId, opts) {
    const frame = await figma.getNodeByIdAsync(frameId);
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
    const parent = await figma.getNodeByIdAsync(parentId);
    const component = await figma.getNodeByIdAsync(componentId);
    if (!parent || !component) throw new Error("Parent or component not found");
    const instance = component.createInstance();
    parent.appendChild(instance);
    return { instanceId: instance.id };
  },
  async setVariantProperties(instanceId, props) {
    const instance = await figma.getNodeByIdAsync(instanceId);
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
    const node = await figma.getNodeByIdAsync(nodeId);
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
