import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { nowIso, slugify, uuid } from "../util/ids.js";
import { brainstormSessionPath } from "../util/paths.js";
import { KotikitError } from "../util/result.js";

export const BrainstormDimensionSchema = z.enum([
  "states",
  "visualEdgeCases",
  "accessibility",
  "interactions",
  "dataContracts",
  "responsive",
  "flowConnectivity",
]);
export type BrainstormDimension = z.infer<typeof BrainstormDimensionSchema>;

export const BrainstormClassificationSchema = z.enum(["singleScreen", "multiScreen"]);
export type BrainstormClassification = z.infer<typeof BrainstormClassificationSchema>;

const BrainstormAnswerSchema = z.object({
  answer: z.string().min(1),
  answeredAt: z.string().min(1),
});

export const BrainstormSessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  status: z.enum(["inProgress", "readyForConfirmation", "completed"]),
  idea: z.string().min(1),
  scope: z.string().min(1),
  classification: BrainstormClassificationSchema,
  requiredDimensions: z.array(BrainstormDimensionSchema).min(1),
  answers: z.partialRecord(BrainstormDimensionSchema, z.array(BrainstormAnswerSchema)),
  summary: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().optional(),
});
export type BrainstormSession = z.infer<typeof BrainstormSessionSchema>;

export interface BrainstormQuestion {
  dimension: BrainstormDimension;
  text: string;
}

const QUESTION_BY_DIMENSION: Record<BrainstormDimension, string> = {
  states: "What should someone see while the page is loading, empty, errored, and filled?",
  visualEdgeCases:
    "What edge cases should this design handle, like long text, too many items, or missing data?",
  accessibility:
    "If someone uses only a keyboard or screen reader, what should the first path through this screen be?",
  interactions:
    "What are the important interactions, including primary actions, hover, focus, and immediate feedback?",
  dataContracts:
    "What data does this screen need, where does it come from, and what should happen if it fails?",
  responsive: "How should this layout change on phone, tablet, and desktop in plain product terms?",
  flowConnectivity:
    "How does the user enter this flow, move between screens, and carry state from step to step?",
};

function parseSession(raw: unknown): BrainstormSession {
  const result = BrainstormSessionSchema.safeParse(raw);
  if (!result.success) {
    throw new KotikitError(
      "This brainstorm session could not be read.",
      "Start a new brainstorm for this screen, then save the spec after confirmation."
    );
  }
  return result.data;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpPath, path);
}

export function requiredDimensionsFor(
  classification: BrainstormClassification
): BrainstormDimension[] {
  const base: BrainstormDimension[] = [
    "states",
    "visualEdgeCases",
    "accessibility",
    "interactions",
    "dataContracts",
    "responsive",
  ];
  return classification === "multiScreen" ? [...base, "flowConnectivity"] : base;
}

export function questionForDimension(dimension: BrainstormDimension): BrainstormQuestion {
  return { dimension, text: QUESTION_BY_DIMENSION[dimension] };
}

export function answeredDimensions(session: BrainstormSession): BrainstormDimension[] {
  return session.requiredDimensions.filter((dimension) => {
    const answers = session.answers[dimension] ?? [];
    return answers.some((entry) => entry.answer.trim().length > 0);
  });
}

export function openDimensions(session: BrainstormSession): BrainstormDimension[] {
  const answered = new Set(answeredDimensions(session));
  return session.requiredDimensions.filter((dimension) => !answered.has(dimension));
}

export function nextQuestion(session: BrainstormSession): BrainstormQuestion | null {
  const nextDimension = openDimensions(session)[0];
  return nextDimension === undefined ? null : questionForDimension(nextDimension);
}

export async function createBrainstormSession(
  root: string,
  input: {
    idea: string;
    scope?: string;
    classification: BrainstormClassification;
  }
): Promise<BrainstormSession> {
  const now = nowIso();
  const session: BrainstormSession = {
    schemaVersion: 1,
    id: uuid(),
    status: "inProgress",
    idea: input.idea,
    scope: input.scope?.trim() || slugify(input.idea),
    classification: input.classification,
    requiredDimensions: requiredDimensionsFor(input.classification),
    answers: {},
    createdAt: now,
    updatedAt: now,
  };

  await writeJsonAtomic(brainstormSessionPath(root, session.id), session);
  return session;
}

export async function readBrainstormSession(
  root: string,
  sessionId: string
): Promise<BrainstormSession> {
  try {
    return parseSession(JSON.parse(await readFile(brainstormSessionPath(root, sessionId), "utf8")));
  } catch (err) {
    if (err instanceof KotikitError) throw err;
    throw new KotikitError(
      "I couldn't find that brainstorm session.",
      "Start a new brainstorm, answer the product/design questions, and confirm it before saving."
    );
  }
}

export async function recordBrainstormAnswer(
  root: string,
  input: {
    sessionId: string;
    dimension: BrainstormDimension;
    answer: string;
  }
): Promise<BrainstormSession> {
  const session = await readBrainstormSession(root, input.sessionId);
  const answer = input.answer.trim();

  if (session.status === "completed") {
    throw new KotikitError(
      "This brainstorm session is already confirmed.",
      "Start a new brainstorm if the screen direction has changed."
    );
  }
  if (!session.requiredDimensions.includes(input.dimension)) {
    throw new KotikitError(
      "That question does not belong to this brainstorm.",
      "Answer one of the open product/design questions returned by the brainstorm tool."
    );
  }
  if (answer.length === 0) {
    throw new KotikitError(
      "The answer can't be empty.",
      "Capture the designer's answer in plain language before marking the topic covered."
    );
  }

  const nextAnswers = {
    ...session.answers,
    [input.dimension]: [
      ...(session.answers[input.dimension] ?? []),
      { answer, answeredAt: nowIso() },
    ],
  };
  const updatedSession = {
    ...session,
    answers: nextAnswers,
    updatedAt: nowIso(),
  };
  const status =
    openDimensions(updatedSession).length === 0 ? "readyForConfirmation" : "inProgress";
  const sessionToWrite: BrainstormSession = { ...updatedSession, status };

  await writeJsonAtomic(brainstormSessionPath(root, session.id), sessionToWrite);
  return sessionToWrite;
}

export async function confirmBrainstormSession(
  root: string,
  input: { sessionId: string; summary: string }
): Promise<BrainstormSession> {
  const session = await readBrainstormSession(root, input.sessionId);
  const open = openDimensions(session);

  if (open.length > 0) {
    throw new KotikitError(
      `This brainstorm still needs ${open.join(", ")}.`,
      "Ask the remaining product/design questions before confirming the spec."
    );
  }

  const now = nowIso();
  const completed: BrainstormSession = {
    ...session,
    status: "completed",
    summary: input.summary.trim(),
    updatedAt: now,
    completedAt: now,
  };

  await writeJsonAtomic(brainstormSessionPath(root, session.id), completed);
  return completed;
}

export async function assertCompletedBrainstormForSave(
  root: string,
  input: {
    brainstormSessionId?: string;
    allowUnguided?: boolean;
    scope: string;
    classification: BrainstormClassification;
  }
): Promise<void> {
  if (input.allowUnguided === true) return;

  if (input.brainstormSessionId === undefined) {
    throw new KotikitError(
      "Finish the brainstorm before saving this spec.",
      "Ask the product/design questions, confirm the summary with the designer, then call this tool with brainstormSessionId. Use allowUnguided only for explicit advanced imports or tests."
    );
  }

  const session = await readBrainstormSession(root, input.brainstormSessionId);
  if (session.status !== "completed") {
    throw new KotikitError(
      "Finish the brainstorm before saving this spec.",
      "The session exists, but it has not been confirmed by the designer yet."
    );
  }
  if (session.scope !== input.scope) {
    throw new KotikitError(
      "This brainstorm belongs to a different spec scope.",
      `Use the completed brainstorm for "${session.scope}", or start a new brainstorm for "${input.scope}".`
    );
  }
  if (session.classification !== input.classification) {
    throw new KotikitError(
      "This brainstorm does not match the spec type.",
      "Use a single-screen brainstorm for a screen spec and a flow brainstorm for a flow."
    );
  }
}
