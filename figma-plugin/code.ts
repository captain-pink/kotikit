// kotikit Figma plugin — sandbox entry
// This file runs in Figma's plugin main thread.
// UI runs in figma.showUI(__html__) iframe.

figma.showUI(__html__, { width: 400, height: 600, title: "kotikit" });

figma.ui.onmessage = async (msg: { type: string; payload?: unknown }) => {
  // Phase 5 MVP: the UI does most of the work via the bridge.
  // The sandbox only receives messages requesting Figma operations
  // that can't be done from the iframe.
  switch (msg.type) {
    case "close":
      figma.closePlugin();
      break;
    default:
      figma.notify(`Unknown message: ${msg.type}`);
  }
};
