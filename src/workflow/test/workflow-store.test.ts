import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCurrentWorkflowSession,
  recordWorkflowEvent,
  startWorkflowSession,
} from "../workflow-store";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kotikit-workflow-store-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workflow store", () => {
  it("starts a workflow session and marks it as current", async () => {
    const session = await startWorkflowSession(root, {
      intent: "create-design",
      scope: "members",
      screen: "list",
    });

    const current = await readCurrentWorkflowSession(root);

    expect(current?.id).toBe(session.id);
    expect(current?.intent).toBe("create-design");
    expect(current?.scope).toBe("members");
    expect(current?.screen).toBe("list");
    expect(existsSync(join(root, ".kotikit", "workflows", "current.json"))).toBe(true);
  });

  it("stores only the latest event summary instead of an ever-growing history", async () => {
    const started = await startWorkflowSession(root, {
      intent: "create-design",
      scope: "members",
    });

    await recordWorkflowEvent(root, {
      workflowId: started.id,
      event: "user-approved-literal-fallback",
      summary: "Designer approved literals for this draft only.",
    });
    const updated = await recordWorkflowEvent(root, {
      workflowId: started.id,
      event: "user-selected-component-mode",
      summary: "Designer chose reusable draft components.",
    });
    const raw = await readFile(join(root, ".kotikit", "workflows", `${started.id}.json`), "utf8");

    expect(updated.lastEvent?.event).toBe("user-selected-component-mode");
    expect(raw).not.toContain("Designer approved literals");
    expect(raw).not.toContain("events");
    expect(raw.length).toBeLessThan(2000);
  });
});
