import {
  type FigmaDraftTarget,
  isDraftPageName,
  parseFigmaDesignUrl,
} from "../../../figma/draft-target.js";
import { KotikitError } from "../../../util/result.js";

export function validateDraftTargetUrl(url: string): ReturnType<typeof parseFigmaDesignUrl> {
  return parseFigmaDesignUrl(url);
}

export function ensureDraftTarget(target: unknown): FigmaDraftTarget {
  const candidate = target as Partial<FigmaDraftTarget> | undefined;
  if (
    candidate === undefined ||
    candidate.fileKey === undefined ||
    candidate.pageId === undefined
  ) {
    throw new KotikitError(
      "This graph run needs a safe Figma draft page target before writing.",
      "Bind an exact Figma draft page URL before building an apply packet."
    );
  }
  if (candidate.pageName === undefined || !isDraftPageName(candidate.pageName)) {
    throw new KotikitError(
      "The Figma draft page target is not safe for writes.",
      'Use a page whose name contains "Draft" or "Drafts".'
    );
  }
  if (candidate.section?.name === undefined) {
    throw new KotikitError(
      "The Figma draft page target is missing a kotikit-owned Section.",
      "Keep generated work inside the section recorded by kotikit."
    );
  }
  return candidate as FigmaDraftTarget;
}

export function bindDraftTarget(input: {
  scope: string;
  screen?: string | null;
  pageUrl: string;
}): {
  scope: string;
  screen: string | null;
  parsed: ReturnType<typeof parseFigmaDesignUrl>;
} {
  return {
    scope: input.scope,
    screen: input.screen ?? null,
    parsed: validateDraftTargetUrl(input.pageUrl),
  };
}
