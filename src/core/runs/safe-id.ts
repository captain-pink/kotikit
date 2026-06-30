import { KotikitError } from "../../util/result.js";

const SAFE_LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeLocalId(kind: string, id: string): string {
  if (!SAFE_LOCAL_ID_PATTERN.test(id) || id.includes("..")) {
    throw new KotikitError(
      `Invalid ${kind} id.`,
      "Ids used for local kotikit files may contain only letters, numbers, dots, underscores, and hyphens, and cannot contain path segments."
    );
  }
  return id;
}
