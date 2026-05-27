/** Generates a cryptographically random UUID v4. */
export const uuid = (): string => crypto.randomUUID();

/** Returns the current timestamp as an ISO-8601 string. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Converts a human string to a URL/filesystem-safe slug.
 * "Checkout Flow" -> "checkout-flow"
 * "My Profile Page!" -> "my-profile-page"
 * "  A/B  c! " -> "a-b-c"
 * Rules: trim, lowercase, replace any run of non-alphanumerics with a single "-",
 * strip leading/trailing "-".
 */
export const slugify = (input: string): string => {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};
