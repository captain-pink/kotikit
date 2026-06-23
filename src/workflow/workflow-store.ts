import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nowIso, uuid } from "../util/ids.js";
import { KotikitError } from "../util/result.js";
import {
  type WorkflowEventName,
  type WorkflowIntent,
  type WorkflowSession,
  WorkflowSessionSchema,
} from "./workflow-schema.js";

interface StartWorkflowInput {
  intent: WorkflowIntent;
  scope?: string;
  screen?: string | null;
  idea?: string;
  figmaUrl?: string;
}

interface WorkflowEventInput {
  workflowId?: string;
  event: WorkflowEventName;
  summary: string;
}

const workflowsDir = (root: string): string => `${root}/.kotikit/workflows`;

const workflowSessionPath = (root: string, workflowId: string): string =>
  `${workflowsDir(root)}/${workflowId}.json`;

const currentWorkflowPath = (root: string): string => `${workflowsDir(root)}/current.json`;

const isNotFound = (err: unknown): boolean =>
  err instanceof Error && "code" in err && err.code === "ENOENT";

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tmpPath, path);
}

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function readWorkflowSession(root: string, workflowId: string): Promise<WorkflowSession> {
  const raw = await readJsonIfExists(workflowSessionPath(root, workflowId));
  if (raw === null) {
    throw new KotikitError(
      "I couldn't find that kotikit workflow.",
      "Start a fresh kotikit workflow and I will continue from the saved project state."
    );
  }
  const result = WorkflowSessionSchema.safeParse(raw);
  if (!result.success) {
    throw new KotikitError(
      "This kotikit workflow file has an invalid format.",
      "Start a fresh workflow. Existing specs, design-system indexes, and review data are still safe."
    );
  }
  return result.data;
}

async function writeCurrentWorkflow(root: string, workflowId: string): Promise<void> {
  await writeJsonAtomic(currentWorkflowPath(root), { workflowId });
}

export async function startWorkflowSession(
  root: string,
  input: StartWorkflowInput
): Promise<WorkflowSession> {
  const now = nowIso();
  const session = WorkflowSessionSchema.parse({
    schemaVersion: 1,
    id: uuid(),
    intent: input.intent,
    status: "active",
    currentPhase: "setup",
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.screen !== undefined ? { screen: input.screen } : {}),
    ...(input.idea !== undefined ? { idea: input.idea } : {}),
    ...(input.figmaUrl !== undefined ? { figmaUrl: input.figmaUrl } : {}),
    completedMilestones: [],
    approvals: {},
    createdAt: now,
    updatedAt: now,
  });

  await writeJsonAtomic(workflowSessionPath(root, session.id), session);
  await writeCurrentWorkflow(root, session.id);
  return session;
}

export async function readCurrentWorkflowSession(root: string): Promise<WorkflowSession | null> {
  const raw = await readJsonIfExists(currentWorkflowPath(root));
  if (raw === null) return null;
  const workflowId =
    typeof raw === "object" && raw !== null
      ? (raw as { workflowId?: unknown }).workflowId
      : undefined;
  return typeof workflowId === "string" ? readWorkflowSession(root, workflowId) : null;
}

export async function readWorkflowSessionById(
  root: string,
  workflowId: string
): Promise<WorkflowSession> {
  return readWorkflowSession(root, workflowId);
}

function approvalsForEvent(
  session: WorkflowSession,
  event: WorkflowEventName
): WorkflowSession["approvals"] {
  if (event === "user-approved-literal-fallback") {
    return { ...session.approvals, allowLiteralFallback: true };
  }
  if (event === "user-approved-comment-posting") {
    return { ...session.approvals, postFigmaComments: true };
  }
  if (event === "user-confirmed-component-review") {
    return { ...session.approvals, reusableComponentsReviewed: true };
  }
  return session.approvals;
}

export async function recordWorkflowEvent(
  root: string,
  input: WorkflowEventInput
): Promise<WorkflowSession> {
  const session =
    input.workflowId === undefined
      ? await readCurrentWorkflowSession(root)
      : await readWorkflowSession(root, input.workflowId);
  if (session === null) {
    throw new KotikitError(
      "No active kotikit workflow is running.",
      "Start kotikit:auto again and I will continue from the saved project state."
    );
  }

  const updated = WorkflowSessionSchema.parse({
    ...session,
    approvals: approvalsForEvent(session, input.event),
    lastEvent: {
      event: input.event,
      summary: input.summary,
      recordedAt: nowIso(),
    },
    updatedAt: nowIso(),
  });
  await writeJsonAtomic(workflowSessionPath(root, updated.id), updated);
  await writeCurrentWorkflow(root, updated.id);
  return updated;
}
