import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import { decideWorkflowNext } from "../../workflow/workflow-next.js";
import {
  WorkflowEventNameSchema,
  WorkflowIntentSchema,
  type WorkflowSession,
} from "../../workflow/workflow-schema.js";
import { collectWorkflowSnapshot } from "../../workflow/workflow-snapshot.js";
import {
  readCurrentWorkflowSession,
  readWorkflowSessionById,
  recordWorkflowEvent,
  startWorkflowSession,
} from "../../workflow/workflow-store.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

const WorkflowStartArgsSchema = z.object({
  intent: WorkflowIntentSchema,
  scope: z.string().min(1).optional(),
  screen: z.string().min(1).nullable().optional(),
  idea: z.string().min(1).optional(),
  figmaUrl: z.string().url().optional(),
});

const WorkflowByIdArgsSchema = z.object({
  workflowId: z.string().uuid().optional(),
});

const WorkflowEventArgsSchema = WorkflowByIdArgsSchema.extend({
  event: WorkflowEventNameSchema,
  summary: z.string().min(1),
});

const parseArgs = <T>(schema: z.ZodType<T>, args: unknown, summary: string): T => {
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  const fields = result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ");
  throw new KotikitError(summary, `Check these fields: ${fields}.`);
};

async function readSession(root: string, workflowId: string | undefined): Promise<WorkflowSession> {
  if (workflowId !== undefined) return readWorkflowSessionById(root, workflowId);
  const session = await readCurrentWorkflowSession(root);
  if (session !== null) return session;
  throw new KotikitError(
    "No active kotikit workflow is running.",
    "Start kotikit:auto again and I will continue from the saved project state."
  );
}

async function workflowPayload(ctx: ToolContext, session: WorkflowSession): Promise<unknown> {
  const bridgeStatus = await ctx.bridge?.status();
  const snapshot = await collectWorkflowSnapshot({
    root: ctx.root,
    ...(session.scope !== undefined ? { scope: session.scope } : {}),
    ...(session.screen !== undefined ? { screen: session.screen } : {}),
    ...(bridgeStatus !== undefined ? { bridgeStatus } : {}),
  });
  const next = decideWorkflowNext({ session, snapshot });
  return { session, snapshot, next };
}

export function registerWorkflowTools(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push(
    {
      name: "kotikit_workflow_start",
      description:
        "Start or restart a compact kotikit workflow controller session for setup, sync, design, or review work.",
      inputSchema: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: [
              "setup",
              "sync-design-system",
              "create-spec",
              "create-design",
              "review-comments",
              "design-review",
            ],
          },
          scope: { type: "string", description: "Optional spec scope slug." },
          screen: { type: "string", description: "Optional screen slug within a flow." },
          idea: { type: "string", description: "Optional short user intent." },
          figmaUrl: {
            type: "string",
            description: "Optional exact Figma page, section, or node URL.",
          },
        },
        required: ["intent"],
      },
    } satisfies Tool,
    {
      name: "kotikit_workflow_status",
      description: "Read the compact current kotikit workflow state and next recommended action.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Optional workflow id. Defaults to current." },
        },
      },
    } satisfies Tool,
    {
      name: "kotikit_workflow_next",
      description: "Return the next allowed kotikit action for the current compact workflow state.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Optional workflow id. Defaults to current." },
        },
      },
    } satisfies Tool,
    {
      name: "kotikit_workflow_event",
      description:
        "Record a compact workflow event or user decision. Stores only the latest summary, not history.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Optional workflow id. Defaults to current." },
          event: {
            type: "string",
            enum: [
              "user-approved-literal-fallback",
              "user-approved-comment-posting",
              "user-selected-component-mode",
              "user-confirmed-component-review",
              "user-provided-target",
              "tool-completed",
              "tool-failed",
            ],
          },
          summary: { type: "string", description: "One short decision or result summary." },
        },
        required: ["event", "summary"],
      },
    } satisfies Tool
  );

  registry.handlers.set("kotikit_workflow_start", async (args) => {
    try {
      const parsed = parseArgs(
        WorkflowStartArgsSchema,
        args,
        "The workflow start request is missing required information."
      );
      const session = await startWorkflowSession(ctx.root, parsed);
      return toolText("Kotikit workflow started.", await workflowPayload(ctx, session));
    } catch (err) {
      return toolError(err);
    }
  });

  registry.handlers.set("kotikit_workflow_status", async (args) => {
    try {
      const parsed = parseArgs(
        WorkflowByIdArgsSchema,
        args,
        "The workflow status request is malformed."
      );
      const session = await readSession(ctx.root, parsed.workflowId);
      return toolText("Kotikit workflow status.", await workflowPayload(ctx, session));
    } catch (err) {
      return toolError(err);
    }
  });

  registry.handlers.set("kotikit_workflow_next", async (args) => {
    try {
      const parsed = parseArgs(
        WorkflowByIdArgsSchema,
        args,
        "The workflow next request is malformed."
      );
      const session = await readSession(ctx.root, parsed.workflowId);
      return toolText("Kotikit next action.", await workflowPayload(ctx, session));
    } catch (err) {
      return toolError(err);
    }
  });

  registry.handlers.set("kotikit_workflow_event", async (args) => {
    try {
      const parsed = parseArgs(
        WorkflowEventArgsSchema,
        args,
        "The workflow event request is missing required information."
      );
      const session = await recordWorkflowEvent(ctx.root, parsed);
      return toolText("Kotikit workflow event recorded.", await workflowPayload(ctx, session));
    } catch (err) {
      return toolError(err);
    }
  });
}
