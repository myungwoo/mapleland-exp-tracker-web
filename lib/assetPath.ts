// Helper to prefix asset URLs with base path when deployed under a subpath (e.g., GitHub Pages)
// - Leaves absolute URLs (http/https), protocol-relative URLs (//...), and data URLs unchanged
// - For root-relative or relative paths, prefixes NEXT_PUBLIC_BASE_PATH if present
export function assetPath(inputPath: string): string {
  if (!inputPath) return inputPath;
  // Absolute or protocol-relative
  if (/^(?:[a-z]+:)?\/\//i.test(inputPath)) return inputPath;
  // Data URL
  if (inputPath.startsWith("data:")) return inputPath;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
  if (!base) return inputPath;
  if (inputPath.startsWith("/")) {
    return `${base}${inputPath}`;
  }
  return `${base}/${inputPath}`.replace(/\/{2,}/g, "/");
}


