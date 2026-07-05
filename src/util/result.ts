import { z } from "zod";

/** Thrown when kotikit encounters a user-facing error (not a system error). */
export class KotikitError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly hint?: string
  ) {
    super(userMessage);
    this.name = "KotikitError";
  }
}

type McpContent = { type: "text"; text: string };
type ToolResult = { content: McpContent[] };
type ToolErrorResult = { content: McpContent[]; isError: true };

/**
 * Build the text payload an MCP tool returns:
 * starts with `summary`, followed by a blank line + pretty-printed `detail` JSON if provided.
 */
export function toolText(summary: string, detail?: unknown): ToolResult {
  const text = detail !== undefined ? `${summary}\n\n${JSON.stringify(detail, null, 2)}` : summary;
  return { content: [{ type: "text", text }] };
}

/**
 * Convert any thrown error into a friendly tool result.
 * - KotikitError: surfaces userMessage (+ hint on a second line)
 * - Any other error: generic friendly message, never leaks stack traces or system messages
 */
export function toolError(err: unknown): ToolErrorResult {
  let text: string;
  if (err instanceof KotikitError) {
    text = err.hint ? `${err.userMessage}\n${err.hint}` : err.userMessage;
  } else if (err instanceof z.ZodError) {
    text = formatValidationError(err);
  } else {
    text =
      "Something went wrong. The operation did not complete. Please try again, or check that the project is set up correctly.";
  }
  return { content: [{ type: "text", text }], isError: true };
}

/** Convert a Zod validation failure into a compact field-level user message. */
export function formatValidationError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (issue === undefined) return "Input validation failed.";
  const path = pathLabel(issue.path);
  return `Input validation failed: ${path} ${issue.message}.`;
}

function pathLabel(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "input";
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : String(segment)))
    .reduce((acc, segment) => {
      if (segment.startsWith("[")) return `${acc}${segment}`;
      return acc.length === 0 ? segment : `${acc}.${segment}`;
    }, "");
}
