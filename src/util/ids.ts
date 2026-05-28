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

/**
 * Convert a component name to a kebab-case slug suitable for filenames.
 * "Pie Chart"   → "pie-chart"
 * "TextField"   → "text-field"
 * "ic_arrow"    → "ic-arrow"
 * "Button"      → "button"
 * "HTTPSConfig" → "https-config"
 * "PieChart3D"  → "pie-chart-3d"
 */
export function slugifyComponentName(name: string): string {
  // Insert a space before each transition:
  //   lowercase/digit → uppercase        e.g. "textField" → "text Field"
  //   uppercase run → uppercase+lower    e.g. "HTTPSConfig" → "HTTPS Config"
  //   letter → digit                     e.g. "Chart3D" → "Chart 3D"
  //   digit → letter                     e.g. "3D" → "3 D" (handled via slugify)
  const spaced = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2");
  return slugify(spaced);
}
